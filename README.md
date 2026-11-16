# OPFS Media Cache

**为大屏轮播和重复播放场景设计的、由应用管理的浏览器媒体持久化缓存。**

基于 **TypeScript、OPFS、Web Locks、HLS.js 自定义 Loader、flv.js 自定义 Loader / HTTP Range**。

[English](README.en.md) · [技术方案与差异](docs/技术方案与开源说明.md) · [API 与边界](docs/API.md) · [验证记录](docs/VALIDATION.md) · [参与贡献](CONTRIBUTING.md)

## 为什么做这个库

大屏连续轮播多个大视频时，默认 HTTP 缓存不一定能保留整组资源，可能不断重复下载。本项目把缓存管理移到应用层：媒体分片/字节块写入 OPFS，后续播放优先读取本地文件；通过资源版本、容量预算与播放列表保护控制缓存生命周期。

这是对具体业务问题的工程实现。**不宣称 OPFS 比 IndexedDB / Cache Storage 拥有更大配额，也不宣称未经基准测试的性能领先或首创。**

## 已实现

- **HLS.js 适配**：装饰原生 Loader，保留网络路径的取消、超时、重试和请求配置；按媒体分片缓存，处理字节范围。播放列表默认不缓存，只有不可变 VOD 可显式开启。
- **flv.js 适配**：HTTP FLV 点播按固定 Range 块加载与落盘，跨 seek 复用对齐块，单次内存与请求块大小相关；直播和参数式 seek 走不缓存的流式透传。
- **磁盘缓存**：SHA-256 资源键与默认内容校验；数据关闭成功后写入提交元数据，重新初始化时清理未提交/长度异常条目。
- **资源管理**：按字节预算、LRU、TTL、按 assetId 持久化的播放列表保护。保护资源装不下时跳过新写入，继续网络播放并发出事件。
- **故障降级**：不可用的 OPFS、损坏缓存、写入配额不足不应让正常网络播放失败。
- **生命周期**：Web Locks 串行化同命名空间的跨标签页操作；HLS 待写队列有字节上限，提供 `flush()`；清理仅作用于当前命名空间。
- **可验证演示**：本地合成 HLS / FLV 视频、缓存指标、事件列表、真实 Chromium 刷新后断网重播测试。

## 快速开始

源码仓库：[ming-razor/opfs-media-cache](https://github.com/ming-razor/opfs-media-cache)。当前为 **0.1.0 实验性版本，尚未发布到 npm**。克隆后在项目目录执行：

```bash
npm ci
npm run check
npm run demo
```

打开终端显示的 localhost 地址。先播放 HLS 或 FLV，刷新页面后重播；完整缓存后再断网播放。测试素材由 FFmpeg 的合成信号生成，无第三方视频版权依赖。

接入其他项目时，先在本库运行 `npm pack`，再在目标项目 `npm install /absolute/path/to/opfs-media-cache-0.1.0.tgz`。按需安装播放器 `hls.js` 或 `flv.js`。

### HLS.js

```ts
import Hls from 'hls.js';
import { createMediaCache } from 'opfs-media-cache';
import { createHlsLoader } from 'opfs-media-cache/hls';

const cache = await createMediaCache({
  namespace: 'screen-public-v1',
  maxBytes: 2 * 1024 ** 3,
  onEvent: event => console.log(event)
});

// assetId 表示一个逻辑视频；这份集合会替换同命名空间的保护名单。
await cache.setPinnedAssets(['intro']);

const hls = new Hls({
  loader: createHlsLoader(Hls.DefaultConfig.loader, cache, {
    resource: context => ({
      assetId: 'intro', version: 'content-2026-11-16', url: context.url,
      variant: 'public'
    }),
    cachePlaylists: true // 仅适用于清单及其引用资源均不可变的 VOD
  })
});
hls.loadSource('/videos/intro/index.m3u8');
hls.attachMedia(document.querySelector('video')!);
// 清单解析完成后按产品交互调用 video.play()。
// 结束使用时 hls.destroy(); await cache.flush();
```

轮播切换视频时，以对应视频的 `assetId` 和 `version` 构造新 Loader/播放器。多码率路径仍由完整 URL 区分；同 URL 返回不同表示或身份数据时，必须补充 `variant` 或隔离 `namespace`。

### flv.js

```ts
import flvjs from 'flv.js';
import { createFlvLoader } from 'opfs-media-cache/flv';

const player = flvjs.createPlayer({
  type: 'flv', url: 'https://media.example.com/intro.flv', isLive: false
}, {
  customLoader: createFlvLoader(cache, {
    resource: source => ({
      assetId: 'intro-flv', version: 'content-v1', url: source.url
    }),
    blockSize: 1024 ** 2
  })
});
player.attachMediaElement(document.querySelector('video')!);
player.load();
// 在用户交互或满足自动播放策略时调用 player.play()。
```

FLV 缓存路径要求服务器支持正确的 `206 Content-Range`；跨域必须通过 `Access-Control-Expose-Headers: Content-Range` 暴露响应头。不支持范围请求时，从头播放降级为不缓存的网络流；服务端忽略非零 seek 范围时明确报错，避免把错误字节交给解码器。

## 需要知道的边界

- OPFS、IndexedDB、Cache Storage 通常共享站点配额；`maxBytes` 是本库的逻辑媒体预算，不是预留磁盘。文件元数据、临时写入与浏览器记账会额外占空间。
- HTTPS / localhost；需检测 OPFS 及 `createWritable()` 的实际支持。Web Locks 不可用时，只保证单实例串行，不保证跨标签页一致性。未认证旧浏览器、Safari / Firefox 的完整播放组合。
- **版本由调用方维护**：同 URL 的内容更新必须改变 `version`。不会自动判断内容是否变更，也不自动删除签名 URL 的查询参数。
- `isLive: true` 的 FLV 不写缓存；HLS 直播不应开启清单缓存。v0.1 不提供直播录制、DRM 离线许可或 LL-HLS partial segment 持久化。
- HLS 缓存命中统计反映本地读取速度，可能影响 ABR 估计；优先用于固定表示的轮播，复杂自适应策略仍需专项验证。
- 不绕过 CORS。鉴权资源应按用户/权限分区；缓存命中不会重新请求服务器验证权限，退出登录时应清理对应命名空间。
- 没有 Service Worker，无法缓存应用外壳或拦截原生 `<video>` HLS 请求。HLS 清单默认仍走网络；开启不可变 VOD 清单缓存且引用资源完整命中，才可能断网重播。
- `pin` 只保护自动容量淘汰，不阻止 TTL、手动删除、浏览器整站清理，也不会自动下载视频。整个播放列表超过预算时无法保证全量命中。
- 原生 FLV 路径每个块先收齐再提交/派发；HLS 每个分片完整收齐再异步存储。不是零拷贝或任意文件的字节级渐进解码。
- 同命名空间多实例应使用相同预算和策略；暂不合并重复网络请求，也不提供预下载整组 HLS 资源的 API。

## 验证

```bash
npm run check          # 类型检查、Node 回归测试、演示生产构建
npm run test:browser   # 使用 macOS 已安装的 Chrome；其他平台先安装 Playwright Chromium
# Linux: npx playwright install --with-deps chromium
# 自定义浏览器: CHROME_PATH=/path/to/chrome npm run test:browser
npm run fixtures       # 可选：安装 FFmpeg 后重新生成素材
npm pack --dry-run
```

浏览器测试在隔离配置中运行，测试媒体设置 `Cache-Control: no-store`，依次验证 HLS / FLV 首播、页面刷新、断网重播和未提交文件恢复。浏览器测试不是跨存储方案的性能基准。

## 参考与许可证

本库为重新实现，没有复制参考仓库的播放器或缓存源码。

- [Shaka Player](https://github.com/shaka-project/shaka-player)：参考其分片存储、下载生命周期与存储抽象思路，Apache-2.0。
- [hls-movie-player-with-cache](https://github.com/code4fukui/hls-movie-player-with-cache)：参考其 HLS 资源持久化与本地优先播放思路，MIT。
- [HLS.js](https://github.com/video-dev/hls.js)：通过官方自定义 Loader 接口接入，Apache-2.0。
- [flv.js](https://github.com/bilibili/flv.js)：通过 customLoader 接口接入，Apache-2.0。

本项目采用 [MIT](LICENSE)。库以 ESM 发布，播放器是可选 peer dependency，不打包进核心库。[第三方说明](NOTICE.md)
