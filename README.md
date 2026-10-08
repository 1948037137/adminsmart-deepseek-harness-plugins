# AdminSmart DeepSeek Harness 插件库

本仓库保存 AdminSmart 围绕 DeepSeek Harness 公开扩展协议开发的自有插件，不包含也不修改 Harness 上游源码。

开发和生产共用 `C:\xiangmu\deepseek-harness-runtime` 中的官方 npm 运行包；本仓库只保存 AdminSmart 自有 Profile、Preset、Tool、Guard 和 UI 扩展。

## 包结构

- `adminsmart-harness`：AuraSearch 知识 Agent 插件，注册系统策略、相关性检索、知识原件原生附件桥接和公开信息工具。
- `adminsmart-harness-ui`：AuraSearch Host 与 Client UI 插件，提供 Session 搜索、会话侧栏、知识范围、图片附件和品牌界面。
- `adminsmart-harness-platform`：AdminSmart 固定 Harness Runtime Profile、业务 Agent Preset 和服务端业务模式白名单。

LightRAG 只通过 AdminSmart FastAPI 权限接口访问。知识 Agent Preset 使用官方文件、办公、限时命令和交付；自有插件只维护业务权限、策略与集成。命令写入使用官方 workspace-write，区外读取和命令联网主要靠提示词，不能宣称完整 OS 隔离。未授权 MCP、交互终端和后台常驻不挂载。
