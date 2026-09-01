# AdminSmart DeepSeek Harness 插件

本项目是 AdminSmart 自有的 DeepSeek Harness 扩展，不修改 Harness 上游源码。

## 能力

- 在 Agent 作用域隐藏所有全局工具。
- 只暴露 `search_knowledge` LightRAG 知识检索工具。
- 注入中文知识库系统提示词和提示词注入防护。
- 使用本机能力凭证调用 FastAPI 内部知识工具 API。

## 运行变量

- `ADMINSMART_AGENT_API_BASE`：FastAPI 内部 API 根地址。
- `ADMINSMART_AGENT_USER_ID`：由受管 Harness 进程绑定的可信用户 ID。
- `ADMINSMART_AGENT_TOKEN_FILE`：当前用户 Runtime 的签名能力凭证文件；插件按工具调用实时读取。
- `ADMINSMART_AGENT_MODEL_TOKEN`：Harness 模型适配器调用 FastAPI 回环模型代理的同一 Runtime 能力凭证。
- `ADMINSMART_AGENT_PRESET_ROOT`：AdminSmart 只读业务 Agent preset 根目录。
- `ADMINSMART_DSH_ROOT`：只读 DeepSeek Harness 官方源码与构建产物目录。

能力凭证由独立 Gateway 按 `环境 + Profile + 用户 + Runtime` 签发，不是所有用户共享的静态 token。
真实模型 API Key 只保存在当前 FastAPI 环境，Harness 通过 `/internal/agent-model/v1/chat/completions`
流式代理访问模型。
