# AdminSmart Harness 客户端 UI 插件约束

- 本项目只扩展 DeepSeek Harness 的 Host 基础服务和 Web Client 插件，不修改 `C:\xiangmu\deepseek-harness` 上游源码；公开模块必须从共享 npm 运行项目解析。
- Host 插件提供品牌资产、Session 联网开关路由和始终返回取消的 DirectoryPicker seam；允许为当前用户与业务模式 Runtime 的 `process.cwd()` 创建一个完全隐藏的 Web Composer 兼容 Workspace，但禁止将其作为业务、权限、知识范围或会话搜索边界，禁止选择或展示其它 Workspace，也禁止读取或列出服务器目录。
- Client 插件负责 AdminSmart 品牌、中文知识问答文案和普通 Session 交互，不访问 FastAPI Token、Gateway Cookie、模型密钥或知识正文。
- 客户端包必须使用 Harness `window.__ModuleLoader__.load` 契约导出 `inject` 和 `apply`，并在 `package.json` 声明 `dsh.client` 和 `exports["./client"]`。
- 所有浏览器 DOM 适配必须限定为精确语义文本、ARIA 或自有 `data-adminsmart-*` 标记；禁止依赖上游 CSS Module 哈希类名。
- 修改后执行 Node 语法检查、client bundle 注册测试、Harness Profile 验证和实际 `/plugins` 资源验证。
- 修改 Host、Client、Profile 组合或共享插件依赖后必须重启本地 Agent Gateway，并完成运行修订一致性和真实租户 Runtime 冷启动检查；旧 Gateway 或只有静态 `dump-config` 通过都不算完成。
- 仅允许通过官方 `conversation.chat.node` 的 `system-prompt` key 隐藏独立系统提示词节点，不删除模型实际提示词；聊天正文、普通上下文、思考折叠、工具调用和详情面板保持原生呈现，禁止恢复强制展开、正文改写或额外滚动接管。UI 隐藏不构成提示词保密边界，可信身份凭证、模型密钥和未授权服务器文件仍不得进入页面或模型上下文。
- 业务页面必须由服务端签发的 `agentModeId` 决定模式，并由 Gateway Platform 白名单解析 `agentPresetId`；同一个 Client 包复用品牌、历史、附件、模型和会话交互，不得为每个业务页面复制一套 Harness UI。Harness Runtime Profile 对所有业务固定且不由页面选择。
- 当前知识问答产品名固定为 `AuraSearch`，使用项目内 `assets/aurasearch-logo.jpg`；`AdminSmart` 只表示所属系统和权限域，不得重新显示为产品名或恢复 DSH/DeepSeek 品牌。
- 会话侧栏、搜索、置顶、批量操作和归档均由 Harness 官方 `ui-sidebar`/`ui-workspace` 负责；自有 Client 只通过公开品牌和业务 Slot 扩展，不再注册整套侧栏或自行渲染搜索弹窗。
- 会话搜索与插件清单完全由官方 Workspace/SessionQuery 和 Plugin Inventory 提供；不得恢复自有历史搜索路由、手写插件目录或复制官方状态。
- 思考、工具、消息和会话 UI 必须通过 Harness Slot、Store、Theme、Settings 或公开事件扩展；DOM 适配只用于上游尚未提供 Slot 的精确语义表层，不得承担业务协议解析。
- 聊天附件、文件预览与办公工具展示使用固定版 Harness 原生能力；品牌 UI 插件不得复制上传、解析、缓存或读取协议，也不得重新挂载退役解析插件或旧附件 Dock。
- 聊天附件只用于 Harness 与 AI 的当前会话，不创建 AdminSmart 业务文件，不进入知识库、MinerU 或 LightRAG，也不得扩大为任意 Workspace 或服务器文件系统访问。
- 联网能力使用 Harness 官方 Web Tool seam；当前通过 AdminSmart 受管 Responses Provider 执行，插件只提供默认开启的 Session 开关，关闭时必须由 Agent Guard 阻止真实网络工具执行。
