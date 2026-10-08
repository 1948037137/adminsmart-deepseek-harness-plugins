# AuraSearch（AdminSmart Harness 客户端 UI 插件）

本项目通过 Harness 公开的 Host Service、Client Module 和 UI Slot 扩展点提供 AuraSearch 知识问答界面，不修改官方源码。

## Host 能力

- 提供 AuraSearch 品牌资产、当前 Session 联网开关路由；不保留旧会话搜索包装，界面使用官方 `ui-workspace` 搜索。
- 提供始终返回取消的 DirectoryPicker seam，只用于满足官方 `uiWorkspace` 基础服务依赖。
- 为当前用户与业务模式 Runtime 创建一个官方 Workspace，供 Harness 原生 Workspace/Session 导航和 Composer 复用；它不承担租户或知识范围隔离。
- 内部 Workspace 不参与业务权限、知识范围、会话搜索或 LightRAG 隔离；插件不读取、列出、创建或打开其它服务器目录。
- 开发与生产管理员共用自有 Models 页面，私有 Provider 和 Key 仍保存在各自 Harness Home 的官方 ConfigEditor/Credentials 中；Host 经签名回环接口发布业务模型。浏览器不接触后端能力令牌或已存 Key。
- 管理员通用设置通过签名回环 API 持久化为当前环境的全员策略；只同步语言、外观、字号、工作过程、性能与用量、开发者工具、繁忙发送及链接打开方式。普通用户只获得脱敏的官方 `settings.describe`，没有设置写入、凭据或插件管理 Remote。
- 模型和侧栏视图偏好分别保存于当前用户与业务模式隔离的 Runtime Home；侧栏只通过官方 Slot 的 Store seat 同步，不复刻官方 Workspace 浏览器或使用跨账号 localStorage 作为权威数据。

## Client 能力

- 通过官方 `sidebar`、`ui-workspace` 和 `conversation.session.header` 保留 Harness 原生会话、工作区和头部；自有插件不复制这些入口。
- 使用 `assets/aurasearch-logo.jpg` 作为侧栏和空会话统一 Logo，产品名固定为 AuraSearch，AdminSmart 表示所属系统。
- 会话搜索、导航、重命名、置顶和归档由 Harness 官方侧栏负责；自有 Client 不再挂载旧侧栏、搜索弹窗或其移动端抽屉。
- 通过官方 `uiWorkspace` 连接唯一的“知识库工作区”，保留原生 Workspace、Session 和 Header；普通用户不显示“设置”“插件”，管理员仍可使用这两个管理入口。当前业务暂不显示 Header 右侧边栏展开按钮，仅通过公开 Slot 遮蔽按钮，不修改官方侧栏能力。
- 聊天附件、上传回执、发送重试、文件预览、办公工具展示和交付使用固定 Harness 0.2.1-alpha.1 原生能力，不再挂载自定义输入或解析插件。
- 聊天附件只是 Harness 与 AI 沟通的消息条件，不创建 AdminSmart 业务文件，不进入知识库、MinerU 或 LightRAG；知识文档上传仍属于独立文档管理页面。
- 输入区提供 Session 级联网图标开关，默认开启；关闭后 Agent Guard 会阻止公开搜索、网页读取和平台搜索真实执行。
- 同一 `settings.section` 插件页面在开发与生产展示管理员供应商、模型目录和逐模型思考等级；官方 Models 页面均停用，普通用户没有“设置”“插件”入口。会话模型选择仍由 Harness 原生能力负责。
- 仅通过官方 Slot 隐藏独立系统提示词节点；聊天正文、普通上下文、思考过程、工具调用和详情保持原生渲染与折叠。UI 不改写正文、不强制展开、不接管聊天滚动；知识检索、实际系统提示词和 Session 权限守卫保持启用。显示隐藏不等于对开发者工具或会话数据接口保密。
