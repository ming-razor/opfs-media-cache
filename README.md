# OPFS Media Cache

[English](README.en.md) · [API](docs/API.md) · [实现说明](docs/技术方案与开源说明.md) · [测试记录](docs/VALIDATION.md)

给 HLS.js 和 flv.js 添加本地磁盘缓存。播放时将视频分片写入 OPFS，再次播放时优先读取本地文件。

这个项目起源于一个大屏轮播需求：几段大视频循环播放，默认 HTTP 缓存却留不住整组资源，下一轮又要重新下载。OPFS Media Cache 让应用自己决定缓存多少、保留哪些视频、什么时候更新。

## 功能

- **边播边缓存**：HLS 按媒体分片保存，FLV 点播按 HTTP Range 字节块保存。
- **保留轮播资源**：设置缓存容量、LRU 淘汰和 TTL，用 `assetId` 保护正在轮播的视频。
- **管理内容更新**：用版本号区分资源，同一地址更新视频后可重新建立缓存。
- **缓存异常回源**：文件损坏、存储不可用或空间不足时，继续使用网络加载。
- **接入现有播放器**：通过自定义 Loader 使用，支持 TypeScript，无需注册 Service Worker。

## 运行示例

需要 Node.js 22+。

```bash
git clone https://github.com/ming-razor/opfs-media-cache.git
cd opfs-media-cache
npm ci
npm run demo
```

打开终端显示的地址，播放 HLS 或 FLV，刷新后再播一次，查看缓存命中。示例中的点播清单和分片全部缓存后，可以断网重播。

当前版本为 0.1.0，尚未发布 npm 包。接入其他项目可以先运行 `npm pack`，再安装生成的 `.tgz` 文件。播放器按需安装：

```bash
npm install /path/to/opfs-media-cache-0.1.0.tgz
npm install hls.js  # 或 flv.js
```

## 接入 HLS.js

```ts
import Hls from 'hls.js';
import { createMediaCache } from 'opfs-media-cache';
import { createHlsLoader } from 'opfs-media-cache/hls';

const video = document.querySelector('video')!;
const cache = await createMediaCache({
  namespace: 'screen-videos',
  maxBytes: 2 * 1024 ** 3
});

// 保留当前轮播列表。切换列表时用新的 assetId 集合替换。
await cache.setPinnedAssets(['intro']);

const hls = new Hls({
  loader: createHlsLoader(Hls.DefaultConfig.loader, cache, {
    resource: context => ({
      assetId: 'intro',
      version: 'v1',
      url: context.url
    })
  })
});

hls.loadSource('/videos/intro/index.m3u8');
hls.attachMedia(video);
// 在播放按钮事件中调用 video.play()。
```

默认缓存媒体分片，播放列表仍从网络获取。静态点播内容可以设置 `cachePlaylists: true`，将清单一起缓存；直播清单保持默认设置。

视频内容更新时修改 `version`。切换到其他视频时，使用对应的 `assetId` 和版本创建 Loader。缓存命中会影响播放器的带宽估算，当前主要面向固定码率的轮播场景。

## 接入 flv.js

```ts
import flvjs from 'flv.js';
import { createMediaCache } from 'opfs-media-cache';
import { createFlvLoader } from 'opfs-media-cache/flv';

const cache = await createMediaCache({ namespace: 'screen-videos' });
const player = flvjs.createPlayer({
  type: 'flv',
  url: 'https://media.example.com/intro.flv',
  isLive: false
}, {
  customLoader: createFlvLoader(cache, {
    resource: source => ({
      assetId: 'intro-flv',
      version: 'v1',
      url: source.url
    }),
    blockSize: 1024 ** 2
  })
});

player.attachMediaElement(document.querySelector('video')!);
player.load();
// 在播放按钮事件中调用 player.play()。
```

FLV 点播使用对齐的字节块，seek 时可以复用已保存的块。服务器需要支持 Range 请求，返回正确的 `206` 和 `Content-Range`。跨域服务器还需添加：

```http
Access-Control-Expose-Headers: Content-Range
```

不支持 Range 的服务器可以从头流式播放，缓存会跳过。FLV 直播与参数式 seek 也直接走网络。

## 缓存管理

```ts
const info = await cache.inspect();
console.log(info.bytes, info.counters.hits);

await cache.setPinnedAssets(['intro', 'project-tour']);
await cache.removeAsset('old-video');

// 停止播放器后，等待后台写入结束。
await cache.flush();
```

`setPinnedAssets()` 保护资源免于容量淘汰；TTL 和手动删除仍然生效。列表超过缓存预算时，新写入会被跳过，并产生 `pinned-budget-exceeded` 事件。各项事件及配置见 [API 文档](docs/API.md)。

## 浏览器与部署

- 使用 HTTPS 或 localhost。已通过 Chrome 和 GitHub Actions 中 Chromium 的播放测试。
- `maxBytes` 控制本库保存的数据量，实际可写空间还取决于浏览器站点配额与剩余磁盘。OPFS 不可用时使用网络加载。
- Web Locks 用于协调多标签页读写；缺少该 API 时使用实例内队列。同一命名空间应采用一致的缓存配置。
- 用户相关的视频请按身份划分 `namespace` 或 `variant`，退出登录时清理相应缓存。
- 当前通过 HLS.js / flv.js 接入。原生 HLS、WebSocket FLV、DRM 离线播放和 LL-HLS partial segment 缓存尚未支持。

## 开发

```bash
npm run check          # 类型检查、回归测试、示例构建
npm run test:browser   # 真实浏览器播放与断网重播
npm run fixtures       # 使用 FFmpeg 重新生成测试视频
npm pack --dry-run     # 检查发布文件
```

浏览器测试在 macOS 默认使用已安装的 Chrome，也可通过 `CHROME_PATH` 指定。Linux 使用 `npx playwright install --with-deps chromium` 安装测试浏览器。

后续计划加入可配置的 IndexedDB / Cache Storage 后端，并用相同的视频测试读写开销。当前可以通过 `store` 注入符合 `MediaStore` 接口的实现，内置后端为 OPFS。

## 致谢

播放器适配使用 [HLS.js](https://github.com/video-dev/hls.js) 和 [flv.js](https://github.com/bilibili/flv.js) 的 Loader 接口。缓存设计参考了 [Shaka Player](https://github.com/shaka-project/shaka-player) 和 [hls-movie-player-with-cache](https://github.com/code4fukui/hls-movie-player-with-cache)。

[MIT License](LICENSE) · [依赖说明](NOTICE.md)
