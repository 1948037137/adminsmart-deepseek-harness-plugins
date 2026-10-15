# AdminSmart Harness 客户端 UI 插件约束

- 用户于 2026-10-15 确认仅明暗 `ui-theme.preference` 属于个人偏好：新账号浅色，存量本人原生偏好保留，主应用与官方 ThemeRuntime 同步；旧 General.theme 历史兼容保留但不再作为共享真源。个人写入只经当前已认证 Runtime 的窄接口，其他字段与 Settings/Credentials/插件权限不开放。不得为了个人外观自造主题、Token 覆盖或放开普通用户全站设置；字号、字体、模型和规则仍采用管理员共享策略。

- 本项目只扩展 DeepSeek Harness 的 Host 基础服务和 Web Client 插件，不修改 `C:\xiangmu\deepseek-harness` 上游源码；公开模块必须从共享 npm 运行项目解析。
- Host 插件提供品牌资产、业务账号退出接线和始终返回取消的 DirectoryPicker seam；当前用户与业务模式 Runtime 的真实 `process.cwd()` 是问答必需的基础 Workspace。登记、会话关联和界面均使用官方公开实现；后台只保护该基础登记不被删除、在启动或公开事件后恢复缺失登记，并将新 Workspace/Session 的目录准入限定为可信 Runtime 目录。普通用户保留官方工作区与会话操作，禁止用 Workspace 作为业务、权限、知识范围或会话搜索隔离键，禁止浏览任意服务器目录、迁移历史会话或删除实际文件。
- Client 只补用户指定的 AuraSearch 品牌标记、已明确批准的欢迎区展示例外、必要的身份入口门禁、手机业务账号退出和共享配置数据接线；侧栏、模型、插件、设置、消息、思考、工具和会话操作全部使用 Harness 官方实现。不访问 FastAPI Token、Gateway Cookie、模型密钥或知识正文；除下述两处欢迎区展示例外外，不以 DOM 改写文本、密码框、菜单或表单来补产品功能。
- 用户于2026-10-15明确确认欢迎区展示例外：通过现有自有Client把空会话欢迎语改为“今天想解决什么问题？”，只隐藏该欢迎区的“预览版”标签。以既有官方Hero品牌Slot中的不可见自有锚点限定位置，不显示图片或icon；只校验并调整该标题Text节点和标签本身，禁止全页文字扫描、哈希类名、改写祖先、重做Hero或干预聊天正文/输入/工具/设置。缺少能力、未知结构或不受支持文本时保留官方显示并停止本实例适配；卸载只恢复仍由自己持有的字段。升级必须执行真实官方Hero的隔离DOM回归，不把此例外扩大为其他自定义覆盖。
- 客户端包必须使用 Harness `window.__ModuleLoader__.load` 契约导出 `inject` 和 `apply`，并在 `package.json` 声明 `dsh.client` 和 `exports["./client"]`。
- 所有浏览器 DOM 适配必须限定为精确语义文本、ARIA 或自有 `data-adminsmart-*` 标记；禁止依赖上游 CSS Module 哈希类名。
- 修改后执行 Node 语法检查、client bundle 注册测试、Harness Profile 验证和实际 `/plugins` 资源验证。
- 修改 Host、Client、Profile 组合或共享插件依赖后必须重启本地 Agent Gateway，并完成运行修订一致性和真实租户 Runtime 冷启动检查；旧 Gateway 或只有静态 `dump-config` 通过都不算完成。
- 系统提示词节点、聊天正文、普通上下文、思考折叠、工具调用和详情面板保持原生呈现，禁止恢复隐藏节点、强制展开、正文改写或额外滚动接管。可信身份凭证、模型密钥和未授权服务器文件不得进入页面或模型上下文，不能依靠 UI 隐藏建立保密边界。
- 业务页面必须由服务端签发的 `agentModeId` 决定模式，并由 Gateway Platform 白名单解析 `agentPresetId`；同一个 Client 包复用品牌、历史、附件、模型和会话交互，不得为每个业务页面复制一套 Harness UI。Harness Runtime Profile 对所有业务固定且不由页面选择。
- 当前知识问答产品名固定为 `AuraSearch`；用户于2026-10-15澄清侧栏与空会话品牌位置不显示任何图片或icon。侧栏品牌Slot为空renderer，Hero品牌Slot仅放置不可见自有展示锚点，保留席位占用以防止官方FishLogo回退；不绘制星芒或其他替代图形，官方布局保留，欢迎语和预览标记仅按上述明确例外处理。原JPG/WebP仅作历史资产和兼容资源保留。`AdminSmart`只表示所属系统和权限域，不得重新显示为产品名或恢复DSH/DeepSeek品牌。
- 会话侧栏、搜索、置顶、批量操作和归档均由 Harness 官方 `ui-sidebar`/`ui-workspace` 负责；自有 Client 只通过公开品牌和业务 Slot 扩展，不再注册整套侧栏或自行渲染搜索弹窗。
- 会话搜索与插件清单完全由官方 Workspace/SessionQuery 和 Plugin Inventory 提供；不得恢复自有历史搜索路由、手写插件目录或复制官方状态。
- 思考、工具、消息和会话 UI 必须通过 Harness Slot、Store、Theme、Settings 或公开事件扩展；DOM 适配只用于上游尚未提供 Slot 的精确语义表层，不得承担业务协议解析。
- 聊天附件、文件预览与办公工具展示使用固定版 Harness 原生能力；品牌 UI 插件不得复制上传、解析、缓存或读取协议，也不得重新挂载退役解析插件或旧附件 Dock。
- 聊天附件只用于 Harness 与 AI 的当前会话，不创建 AdminSmart 业务文件，不进入知识库、MinerU 或 LightRAG，也不得扩大为任意 Workspace 或服务器文件系统访问。
- 联网能力使用 Harness 官方 Web Tool seam；当前通过 AdminSmart 受管 Responses Provider 执行，不增加自有 Session 联网开关；官方工具按既有身份和业务数据边界正常使用。
- 管理员通过官方界面管理全站配置和可用模型池；普通用户可以用官方选择器自由切换池内模型，但不能写供应商、密钥或全站配置。共享 Adapter 只保存、分发并经官方公开 Settings/volatile 接口采用数据，不重写官方界面或猜测模型能力，不覆盖用户仍合法的会话选择；刷新、重启、发版和后续升级必须验收持久化及同步。
