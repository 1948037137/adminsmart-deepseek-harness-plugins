# AdminSmart Harness Platform 组合约束

- 本目录只保存 AdminSmart 自有的 Harness Runtime Profile、Agent Preset、业务模式白名单和组合文档，不保存运行日志、租户 Home、密钥或用户数据。
- Runtime Profile 只组装所有业务 Agent 共用的模型适配、Session、Web Client、工具流水线、存储和安全基础设施，不承载知识库、CRM、合同等具体业务提示词或工具。
- 每个业务模式必须映射到一个 Agent Preset；Preset 只挂载本业务插件、提示词、Skill、压缩策略和必要 Guard，不复制 Agent Loop。
- Workspace 只表示真实工作目录，不得作为 AdminSmart 用户、租户、业务模式、知识范围或会话历史的隔离键。
- Workflow 只用于需要模型动态编排 subagent 的多步骤任务，不得代替 Agent Preset 或普通业务 Tool。
- Profile、Preset 和插件路径中的本机绝对地址只能由 Gateway 写入租户运行副本，禁止提交到本目录。
- 当前固定 Harness 为 0.2.1-alpha.1；上传、存储、文件、Office、办公命令、交付与语音使用官方实现。知识原件仍经 FastAPI 用户/Session 授权导入，业务集成不解析文件。命令写入使用 workspace-write，普通文件路径由业务 Guard 检查；区外读取与命令联网只具提示词限制，不是完整 OS 隔离。知识任务允许单层前台子代理继承父业务边界，拒绝权限升级、后台常驻、外部 MCP、数据库直读与跨用户文件。
- 公开联网搜索的模型可见入口固定使用 Harness 官方 `@deepseek-ai/dsh-tool-web` 的 `web_search`；知识 Agent 的匿名 AnySearch Provider 只通过公开 `ctx.web` seam 注册，固定外部端点、限时限量，不复制官方 Tool、加载社区插件或静默切换引擎。聊天模型配置与搜索解耦；AuraSearch 的 Session 开关关闭时，Agent Guard 必须阻止全部联网工具真实执行。
- 修改组合后必须执行 Gateway 契约测试、插件目标测试和真实 `dsh --dump-config` 验证；禁止修改 `C:\xiangmu\deepseek-harness` 上游源码。
- Profile、Preset、Bundle 或固定插件版本发生变化后，还必须重启本地 Gateway 并通过内部签名租约完成真实租户 Runtime 冷启动；运行修订、目标修订不一致时禁止交付。
