# AdminSmart DeepSeek Harness 插件库

本仓库保存 AdminSmart 围绕 DeepSeek Harness 公开扩展协议开发的自有插件，不包含也不修改 Harness 上游源码。

## 包结构

- `adminsmart-harness`：AuraSearch 知识 Agent 插件，注册系统策略和 `search_knowledge` 结构化工具。
- `adminsmart-harness-ui`：AuraSearch Host 与 Client UI 插件，提供固定 Workspace、Session 搜索、会话侧栏、知识范围、图片附件和品牌界面。

LightRAG 只通过 AdminSmart FastAPI 权限接口访问。知识 Profile 默认禁止 Shell、文件系统、代码执行、公网搜索和未授权 MCP。
