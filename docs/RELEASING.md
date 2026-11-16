# 发布

源码仓库：[ming-razor/opfs-media-cache](https://github.com/ming-razor/opfs-media-cache)。当前 npm 包尚未发布。

## 检查

```bash
npm ci
npm run check
npm run test:browser
npm pack --dry-run
```

检查 CHANGELOG 和包内文件，用 `npm pack` 生成的 tarball 在独立项目中验证导入与播放器接入。确认 GitHub Actions 通过。

## GitHub 版本

更新 CHANGELOG 的版本与日期，在对应提交上创建 tag，再发布 Release，附上变更内容和使用示例。修复和已知问题应能在提交或 Issue 中找到。

## npm

首次发布前确认包名可用，并检查 npm 账号的发布权限。核对 `package.json` 中的版本、exports、peerDependencies 和仓库地址后，再发布经过验证的 tarball。
