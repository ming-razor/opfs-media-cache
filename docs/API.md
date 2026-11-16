# API

核心模块以 ESM 导出。HLS.js 和 flv.js 的适配器分别位于 `opfs-media-cache/hls`、`opfs-media-cache/flv`。

## createMediaCache(options)

创建缓存实例并检查存储。默认打开 OPFS；也可以通过 `store` 注入 `MediaStore` 实现。

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `namespace` | `default` | 隔离不同业务或用户的缓存 |
| `maxBytes` | 1 GiB | 缓存数据总量上限 |
| `maxEntryBytes` | 32 MiB | 单个条目的大小上限 |
| `maxPendingWriteBytes` | 64 MiB | 后台待写数据上限，超出时跳过新写入 |
| `ttlMs` | 无 | 写入后多久过期，读取不续期 |
| `verifyIntegrity` | `true` | 读取时检查 SHA-256 |
| `onEvent` | 无 | 接收命中、写入、淘汰等事件 |
| `store` | OPFS | 自定义存储实例 |
| `now` | `Date.now` | 时间函数，便于测试 |

容量参数需要正安全整数，`ttlMs` 需要正有限数值。OPFS 初始化失败时，实例的 `available` 为 `false`，读取返回未命中，写入返回 `false`。应用仍可从网络播放。

`maxBytes` 统计本库保存的数据。文件元数据和写入临时空间另有开销；浏览器实际可写容量可通过 `inspect().quota` 查看估算值。

## 资源身份

```ts
interface MediaResource {
  assetId: string;
  version: string;
  url: string;
  range?: readonly [number, number];
  variant?: string;
}
```

- `assetId`：逻辑视频标识，用于保护和整组删除。
- `version`：内容版本。同一 URL 的视频更新后修改此值。
- `url`：完整资源地址，查询参数会参与缓存键。
- `range`：包含起止位置的字节范围，例如 `[0, 1023]` 表示前 1024 字节。
- `variant`：区分同一地址下的不同表示、请求头或用户身份。

这些字段共同生成缓存键。签名地址续期时是否复用旧缓存，需要由应用建立稳定的资源映射。用户相关资源应按身份隔离，并在退出登录时清理。

## 缓存方法

| 方法 | 返回值 | 用途 |
| --- | --- | --- |
| `get(resource)` | `Promise<ArrayBuffer \| undefined>` | 读取；过期、缺失或损坏视为未命中 |
| `put(resource, bytes)` | `Promise<boolean>` | 复制并保存数据，返回写入结果 |
| `enqueuePut(resource, bytes)` | `void` | 加入有大小上限的后台写入队列 |
| `flush()` | `Promise<void>` | 等待当前后台写入完成 |
| `setPinnedAssets(ids)` | `Promise<void>` | 替换当前命名空间的保护名单 |
| `removeAsset(id)` | `Promise<void>` | 删除该视频的所有版本和表示 |
| `clear()` | `Promise<void>` | 清理当前命名空间的数据和保护名单 |
| `inspect()` | `Promise<...>` | 查看条目、大小、保护名单、统计和配额估算 |

`put()` 的资源参数无效时抛出错误，存储失败则返回 `false`。写入会复制数据与资源身份，调用方可在随后复用原对象。

`pin` 只影响容量淘汰，TTL 和手动删除仍生效。`removeAsset()` 保留保护名单中的标记。清理前请先停止播放器，避免后续请求再次写入。

`flush()` 等待的是已加入后台队列的任务。需要可靠完成时，应在页面关闭前主动调用，而不是依赖 `beforeunload`。

## 事件与统计

`onEvent` 接收：

| 类型 | 含义 |
| --- | --- |
| `hit` / `miss` | 本地命中或未命中 |
| `write` | 数据已保存 |
| `skip` | 本次写入被跳过，原因见 `reason` |
| `evict` | 按容量策略删除了条目 |
| `error` | 存储操作失败，详情见 `error` 和 `reason` |

常见跳过原因：`entry-too-large`、`write-backpressure`、`pinned-budget-exceeded`、`storage-unavailable`。

统计属于当前实例，刷新页面后归零；文件继续留在磁盘。`bytes` 统计保存的数据大小，FLV 块包含 8 字节长度头。初始化和 `inspect()` 会清理无效条目。

## HLS.js 适配

```ts
createHlsLoader(Hls.DefaultConfig.loader, cache, {
  resource: context => ({ assetId, version, url: context.url }),
  cachePlaylists: false,
  lookupTimeoutMs: 150
});
```

`resource()` 返回资源身份，返回 `undefined` 时跳过缓存。适配器使用上下文解析出的完整 URL 和字节范围；HLS.js 的 exclusive `rangeEnd` 会转换为 inclusive 范围。

`cachePlaylists` 默认关闭。静态 VOD 可以开启；清单发生重定向时仍使用网络结果，保留正确的相对路径基准。密钥和 LL-HLS partial segment 走原始 Loader。

`lookupTimeoutMs` 是本地读取的等待上限，必须为正有限数值。超时后交给原始网络 Loader，底层文件读取可能仍在完成。网络的请求设置、超时和重试策略由 HLS.js 管理。

命中统计反映本地读取耗时，可能影响 ABR 的网络带宽估算。固定码率轮播是当前适配的主要使用场景。

## flv.js 适配

```ts
createFlvLoader(cache, {
  resource: source => ({ assetId, version, url: source.url }),
  blockSize: 1024 ** 2
});
```

`blockSize` 默认 1 MiB，需要满足 `blockSize + 8 <= maxEntryBytes`。点播按对齐范围保存，seek 时派发所需字节。每个块收齐并完成缓存尝试后再交给播放器。

请求沿用配置中的 headers、credentials、referrerPolicy。服务器需要返回正确的 `206 Content-Range`，跨域时暴露该响应头。范围和长度错误会交给播放器的错误回调处理。

`isLive: true`、param/custom seek 使用网络流式加载。服务器忽略 Range 时，从头播放退回普通流式请求；非零 seek 收到 `200` 响应则报错。

适配器面向 HTTP(S) FLV，网络重试由播放器或应用处理。原生 HLS 请求、WebSocket FLV 和 DRM 离线播放不经过这套缓存接口。

## 多实例

Web Locks 可用时，同一命名空间的缓存操作串行执行。没有该 API 时，仅协调同一实例内的操作。同一命名空间应使用一致的容量和过期配置。

浏览器站点配额由存储 API 共享，切换后端不会额外增加配额。应用可以在合适时机申请 `navigator.storage.persist()`，具体结果由浏览器决定。
