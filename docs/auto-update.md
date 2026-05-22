# 发版与自动更新

Recall 通过 [electron-updater](https://www.electron.build/auto-update) 实现自动更新，更新文件托管在 **GitHub Releases**（仓库 `zhaozhongwenzzw/message_manager`）。

## 一次性准备

1. **GitHub Personal Access Token**
   - 打开 https://github.com/settings/tokens → Generate new token (classic)
   - 勾选 `repo` 完整权限即可
   - 复制下来，**只显示这一次**
2. **把 token 写到项目根目录的 `.env` 文件**（推荐 — `.env` 已在 `.gitignore` 里，不会被提交）：

   复制示例文件：
   ```bash
   cp .env.example .env
   ```
   然后编辑 `.env`：
   ```
   GH_TOKEN=ghp_你的真实token
   ```
   发版脚本启动时会自动读取 `.env`（用 Node 20+ 内置的 `process.loadEnvFile`，不需要额外的包）。

   **其他方式**（可选）
   - PowerShell 永久设置：`[System.Environment]::SetEnvironmentVariable('GH_TOKEN', '你的token', 'User')`，开新终端生效
   - 当前 shell 临时设置：`export GH_TOKEN=...`（git bash）/ `$env:GH_TOKEN="..."`（PS）/ `set GH_TOKEN=...`（CMD）

   ⚠️ **绝对不要把真实的 token 写到任何会被 git 跟踪的文件里**（包括这份文档）— GitHub 会自动扫描公开仓库里的 token 并 revoke。
3. 确保 GitHub 仓库 `zhaozhongwenzzw/message_manager` **是 public**（私有仓库 electron-updater 默认拉不到，需要额外配 token 给客户端）。

## 发新版本

```bash
# 1. 升版本号（自动改 package.json + git tag）
npm version patch   # 0.1.0 -> 0.1.1   bug fix
npm version minor   # 0.1.0 -> 0.2.0   新功能
npm version major   # 0.1.0 -> 1.0.0   破坏性改动

# 2. 打包并发布到 GitHub Releases
npm run release:win
```

`release:win` 会：
- `electron-vite build` 编译代码
- `electron-builder --publish=always` 打安装包 + portable + 生成 `latest.yml` + 把它们全上传到 GitHub Releases 作为 **draft** 发布

## 完成发布

打开 https://github.com/zhaozhongwenzzw/message_manager/releases，找到刚创建的草稿：
- 写 Release Notes（Markdown）— 会作为更新弹窗里的"更新日志"显示给用户
- 点 **Publish release**

发布完，所有装了老版本的客户端：
- **启动后 5 秒**会自动后台静默检查
- 之后每小时检查一次
- 发现新版 → 后台增量下载（只传变化的字节，靠 blockmap）
- 下载完 → 弹窗"立即重启并安装"

用户也可以随时点 Header 上的下载图标手动检查。

## dev 模式注意

dev 跑 `npm run dev` 时**不会**触发 updater 检查（autoUpdater 必须在打包后才工作，否则会抛 dev 错误）。Header 的图标会显示"检查更新"按钮，点了会立刻报错——这是正常的，证明你在 dev。

测自动更新只能装两次：
1. 装 v0.1.0 跑起来
2. 把 package.json 改成 v0.1.1，`npm run release:win`，去 GitHub publish
3. 让 v0.1.0 检查，能拉到 v0.1.1 就成功

## 常见问题

| 问题 | 解决 |
|---|---|
| 发布时报 `GitHub Personal Access Token is not set` | `GH_TOKEN` 没设；按"一次性准备"那步重做 |
| 用户端报 `404 latest.yml` | Release 还是草稿，没 Publish；或者 `latest.yml` 没上传 |
| 用户端报 `Could not connect to ...` | 国内访问 github.com 慢/被墙；后续可考虑加镜像或 generic provider |
| 用户报 SmartScreen 警告 | 安装包没代码签名；忽略可点"仍要运行"。彻底解决需要买签名证书 |

## 关掉自动更新（如果以后想要）

`src/main/updater.ts` 里 `initUpdater()` 不再被 `src/main/index.ts` 的 `ready-to-show` 调用即可。或者把 `autoDownload = true` 改 false，变成"只检查不下载，问过用户再下"。
