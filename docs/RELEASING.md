# 发布说明

源码仓库：https://github.com/ming-razor/opfs-media-cache 。npm 包尚未发布，包名可用性未验证。以下保留首次建库与后续发布的操作说明。

## 首次发布 GitHub

1. 确定目标 GitHub 用户或组织，以及仓库是否公开。
2. 检查 README、许可证、素材和 NOTICE；填写 package.json 的 repository / bugs / homepage 为实际地址。
3. 运行 `npm ci`、`npm run check`、`npm run test:browser` 和 `npm pack --dry-run`。
4. 在 GitHub 创建空的公开仓库，将此目录提交并推送到目标仓库。本项目使用 main 分支；发布前先检查本地提交和 origin 指向是否符合预期。
5. 确认远程 CI 通过后，再标记 v0.1.0；CHANGELOG 的 unreleased 应改为实际发布日期。

如果使用 GitHub CLI，可在确认 owner/name 后执行 `gh repo create OWNER/NAME --public --source=. --remote=origin`，先检查待提交文件，再提交、推送。项目不会自动执行这些远程操作。

## 发布 npm

检查包名是否可用、peerDependencies、ESM 支持范围和分发文件。用 `npm pack` 生成的 tarball 在独立消费者项目测试后，再由维护者登录 npm 并发布。切勿把本地验证视为性能领先或跨浏览器认证。
