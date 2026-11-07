# macOS 构建指南（Intel 与 Apple Silicon）

## 适用范围

本项目同时发布两种 macOS 产物：

| 架构 | Rust 目标 | 最低系统版本 | 产物 |
| --- | --- | --- | --- |
| Intel (x64) | `x86_64-apple-darwin` | macOS 10.15 Catalina | `easytier-manager-pro-x64.dmg` |
| Apple Silicon (arm64) | `aarch64-apple-darwin` | macOS 11.0 Big Sur | `easytier-manager-pro-arm64.dmg` |

Apple Silicon 无法低于 11.0：Rust 的 `aarch64-apple-darwin` 目标本身以 macOS 11.0 为下限，链接器会把 arm64 的 `minos` 钳制回 11.0，且 macOS 11 之前的系统只存在于 Intel 机器上。

对应工作流：

- `.github/workflows/build-macos-local.yml`（`CI Pro MacOS`）：手动触发或推送到 `codex/macos-local-build` 分支，矩阵构建两种架构。
- `.github/workflows/release-pro-all.yml`（`Release Pro ALL`）：发布流程中的 `build-macos` job，同样矩阵构建两种架构。

当前构建为 ad-hoc 签名，不包含 Apple Developer ID 签名或 notarization，适合开发和本地验证，不等同于面向公众分发的正式签名包。

## 最低系统版本如何生效

Tauri v2 的 `bundle.macOS.minimumSystemVersion` 只会写入 `Info.plist` 的 `LSMinimumSystemVersion`，**不会**注入 `MACOSX_DEPLOYMENT_TARGET`（该行为只存在于 Tauri v1 CLI）。本项目通过两处配置共同保证最低版本：

1. `src-tauri/tauri.conf.json5` → `bundle.macOS.minimumSystemVersion = "10.15"`，写入 `Info.plist`。
2. `src-tauri/.cargo/config.toml` → `[env] MACOSX_DEPLOYMENT_TARGET = "10.15"`，决定 Mach-O 的 `LC_BUILD_VERSION.minos`；CI 中另以 job 级环境变量声明同一取值。
3. `vite.config.ts` → `build.target = ['safari13']`，并通过 `safari13-transpile` 插件对 Monaco 等 chunk 与 worker 产物再降级一次。

第 3 项不可省略：Catalina 的 WKWebView 实际是 Safari 13 内核，不支持 `??=`、类静态块等语法；仅改 Rust 部署目标只能让二进制可加载，前端仍会在启动时因语法解析失败而白屏。

因此两个架构的 `Info.plist` 都声明 10.15，而二进制 `minos` 分别为：x64 = 10.15，arm64 = 11.0。

## 本地构建

```bash
# 安装目标工具链（只需一次）
rustup target add aarch64-apple-darwin x86_64-apple-darwin

# 分别构建
pnpm build:mac-arm64
pnpm build:mac-x64

# 或者依次构建两种架构
pnpm build:mac
```

脚本等价于：

```bash
MACOSX_DEPLOYMENT_TARGET=10.15 pnpm tauri build --target x86_64-apple-darwin
MACOSX_DEPLOYMENT_TARGET=10.15 pnpm tauri build --target aarch64-apple-darwin
```

产物默认位于：

```text
src-tauri/target/<target>/release/bundle/macos/easytier-manager-pro.app
src-tauri/target/<target>/release/bundle/dmg/easytier-manager-pro_<version>_<arch>.dmg
```

CI 会把 DMG 重命名为 `easytier-manager-pro-arm64.dmg` / `easytier-manager-pro-x64.dmg` 后上传。

## 本地验证

```bash
# 校验 DMG 完整性
hdiutil verify easytier-manager-pro-x64.dmg

# 只读挂载后校验签名、架构与最低版本
hdiutil attach easytier-manager-pro-x64.dmg -readonly -nobrowse -mountpoint /tmp/etm
codesign --verify --deep --strict --verbose=2 /tmp/etm/easytier-manager-pro.app
lipo -archs /tmp/etm/easytier-manager-pro.app/Contents/MacOS/easytier-manager-pro
otool -l /tmp/etm/easytier-manager-pro.app/Contents/MacOS/easytier-manager-pro | grep -A4 LC_BUILD_VERSION
plutil -extract LSMinimumSystemVersion raw /tmp/etm/easytier-manager-pro.app/Contents/Info.plist
hdiutil detach /tmp/etm
```

预期结果：

| 产物  | `lipo -archs` | `minos` | `LSMinimumSystemVersion` |
| ----- | ------------- | ------- | ------------------------ |
| x64   | `x86_64`      | `10.15` | `10.15`                  |
| arm64 | `arm64`       | `11.0`  | `10.15`                  |

安装新版本后请退出旧 App 并重新启动，工作台才会重新扫描实际运行的 `easytier-core` 进程。

## 工作台运行状态和操作列

macOS 的进程命令行可能包含带空格的 `Application Support` 路径。工作台会从结构化进程字段和完整命令行中识别配置文件，避免把路径截断为 `Application.toml`。

macOS 工作台操作列支持 Ping、端口检测和 SSH；Windows 额外支持 RDP 和 Xshell。macOS 端口检测通过 Terminal 执行 `nc`，需要允许应用控制 Terminal。
