# AdminSmart Harness 客户端 UI 插件约束

- 本项目只扩展 DeepSeek Harness 的 Host 基础服务和 Web Client 插件，不修改 `C:\xiangmu\deepseek-harness` 上游源码。
- Host 插件只能创建当前租户 `process.cwd()` 对应的固定知识 Workspace，并提供取消式目录选择 seam；禁止读取、列出、创建或选择其它目录。
- Client 插件负责 AdminSmart 品牌、中文知识问答文案和隐式 Workspace 交互，不访问 FastAPI Token、Gateway Cookie、模型密钥或知识正文。
- 客户端包必须使用 Harness `window.__ModuleLoader__.load` 契约导出 `inject` 和 `apply`，并在 `package.json` 声明 `dsh.client` 和 `exports["./client"]`。
- 所有浏览器 DOM 适配必须限定为精确语义文本、ARIA 或自有 `data-adminsmart-*` 标记；禁止依赖上游 CSS Module 哈希类名。
- 修改后执行 Node 语法检查、client bundle 注册测试、Harness Profile 验证和实际 `/plugins` 资源验证。
- Client 插件面向最终业务用户时必须隐藏系统提示词、上下文注入、Session 日志、内部工具名、JSON/XML 协议、能力凭证、服务器路径和实现诊断；这些内容只允许进入受控日志或管理员诊断面。
- 业务页面必须由服务端签发的 `profileId` 决定模式和工具集合；同一个 Client 包复用品牌、历史、附件、模型和会话交互，不得为每个业务页面复制一套 Harness UI。
- 当前知识问答产品名固定为 `AuraSearch`，使用项目内 `assets/aurasearch-logo.jpg`；`AdminSmart` 只表示所属系统和权限域，不得重新显示为产品名或恢复 DSH/DeepSeek 品牌。
- 会话搜索和批量选择必须保持已验收的 DeepSeek 交互：搜索框靠上且无强调边框，结果按左侧会话图标、右侧标题/时间、下方摘要排列；普通侧栏顶部提供批量入口，选择模式显示圆形复选框和底部置顶/删除操作栏。
- 会话搜索必须通过 Host 插件复用 Harness `sessionQuery`，返回当前固定 Workspace 内的 `sessionId/seq/time/snippet`；点击结果后通过公开 Session `loadOlder()` 补齐历史并定位高亮，禁止复制或修改上游检索实现。
- 置顶操作在行菜单和批量操作栏统一使用 Lucide Pin 线性图标；知识范围使用紧凑草稿式多选菜单，只有点击“应用”才保存 Session 文档白名单。
- 思考、工具、消息和会话 UI 必须通过 Harness Slot、Store、Theme、Settings 或公开事件扩展；DOM 适配只用于上游尚未提供 Slot 的精确语义表层，不得承担业务协议解析。
- 聊天附件入口只允许模型原生支持的图片，并通过 Harness 图片附件协议进入当前用户问题的多模态上下文；不得在聊天插件中提供 PDF、Office、文本或其它知识文档上传，不得创建知识库资源，也不得进入 MinerU 或 LightRAG。
- 知识文档上传属于 AdminSmart 独立的知识库文档管理页面和鉴权入库链路，不属于 Harness 聊天 UI 插件职责；禁止把任意本机文件直接交给模型或 Harness 文件系统。
