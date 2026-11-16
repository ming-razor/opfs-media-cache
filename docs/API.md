# API 与支持边界

## 核心

`await createMediaCache(options)` 返回 `MediaCache`。默认 namespace 为 `default`，逻辑容量预算 1 GiB，最大条目 32 MiB，HLS 待写字节上限 64 MiB，默认不设置 TTL，默认校验内容 SHA-256。默认预算是库策略，不代表浏览器固定限制。

OPFS 初始化失败时返回 `available: false` 的网络模式实例，并产生 `storage-unavailable` 错误事件；不会偷偷把整个媒体缓存切换到内存。

```ts
interface MediaResource {
  assetId: string;
  version: string;
  url: string;
  range?: readonly [number, number]; // inclusive
  variant?: string;
}
```

完整身份经 SHA-256 生成目录键。必须明确内容版本。不要随意移除查询参数；令牌续期复用需先建立可信的稳定资源映射和权限隔离。`variant` 不是服务端鉴权替代品。

| 方法 | 行为 |
| --- | --- |
| `get(resource)` | 返回 ArrayBuffer 或 undefined；无缓存、过期、读取失败和损坏均可回源 |
| `put(resource, bytes)` | 复制输入并提交；返回成功与否。无效身份会抛错，存储故障返回 false |
| `enqueuePut(resource, bytes)` | 有界的后台写入，适合播放器成功回调；超限产生 skip 事件 |
| `flush()` | 等待已排入后台的写入；不能依靠 beforeunload 保证等待完成 |
| `setPinnedAssets(ids)` | 替换本命名空间的持久化保护集合；不触发下载 |
| `removeAsset(id)` | 等待现有后台写入，删除逻辑视频的所有版本和表示；不移除保护名单 |
| `clear()` | 等待现有后台写入，清理当前命名空间和保护集合；不会删除其他命名空间 |
| `inspect()` | 条目、逻辑字节数、保护集合、当前实例统计、浏览器站点配额估算 |

`inspect()` 和初始化会清理无效条目。`available` 表示后端已打开，不保证后续每次写入都成功。`now` 和 `store` 可注入以便测试或实现替代后端。

事件：`hit`、`miss`、`write`、`skip`、`evict`、`error`。`bytes` 是本库数据字节数（FLV 内含 8 字节长度头），不是物理磁盘计费值。统计只记录当前实例；页面刷新后归零，条目仍留在磁盘。

TTL 从写入时计算，不因读取延长。保护仅阻止自动容量淘汰，不阻止到期、版本策略或清理。清理操作应先停止播放器，避免新的并发请求再次创建缓存。

## HLS

`createHlsLoader(Hls.DefaultConfig.loader, cache, options)` 返回可赋给 `new Hls({ loader })` 的类。

- `resource(context)`：返回媒体身份；undefined 表示绕过缓存。上下文的完整 URL 和 ByteRange 会自动覆盖身份中的对应字段。
- `cachePlaylists`：默认 false。只有确定清单不可变、相关资源身份稳定的 VOD 才开启。重定向清单不会持久化，以免破坏相对 URI 基准。
- `lookupTimeoutMs`：默认 150ms。超时后沿用网络 Loader；超时的底层磁盘读取本身不被强制终止。
- 密钥、LL-HLS partial segment 绕过持久化。没有支持 DRM 离线许可。
- 缓存命中返回本地读取耗时，复杂 ABR 仍需集成侧验证；网络路径保留上游统计。
- 本库不透明拦截浏览器原生 HLS 请求。服务端跨域规则、播放器解码支持仍然适用。

## FLV

`createFlvLoader(cache, options)` 返回可赋给 flv.js `customLoader` 的类，无需运行时导入 flv.js。

- `resource(source)`：返回稳定身份和版本。
- `blockSize`：默认 1 MiB；必须是正安全整数且 `blockSize + 8 <= maxEntryBytes`。更改块大小会改变范围键，旧块仍受预算淘汰。
- `fetch`：可注入标准 Fetch 实现。请求沿用配置的 headers / credentials / referrerPolicy。
- 缓存路径是 HTTP(S) + Range seek 的 FLV 点播。`config.isLive` 或 source.isLive 时仅透传网络流。
- param/custom seek 使用传入 SeekHandler 流式透传，不缓存。
- Content-Range 必须可见、完整且匹配请求；错误范围、长度变化或截断明确报错。
- 不支持 Range 的服务器在从头播放时降级为 uncached streaming；非零偏移不能把 200 响应错误标为该范围。
- 每块收齐后先等待缓存尝试，再交给播放器；没有“每网络 chunk 同时解码并落盘”的承诺。
- FLV 点播不内建重试次数策略；网络错误交由播放器/应用处理。
- 不支持 WebSocket FLV。flv.js 自身浏览器兼容和维护状态不由本库改变。

## 一致性与容量

Web Locks 可用时以 namespace 串行化缓存操作。无 Web Locks 只提供实例内队列。同命名空间各实例的预算和策略应保持一致。

可用磁盘、浏览器配额、临时文件、内容校验、目录扫描和锁竞争均会影响实际行为。`navigator.storage.persist()` 可由应用在合适时机请求，结果不保证；库不主动弹权限对话框。

本版本不自动清除旧版本、合并不同实例的网络请求，也不承诺完整媒体的预下载、所有浏览器原生离线播放或无限容量。通过事件和 `inspect()` 建立业务监测。
