# 官方模型页面与运行时 UI 集成

当前固定 Harness 为 `0.2.1-alpha.3`。本插件只通过公开 Client Module、Slot、Settings、Credentials、LLM Remote 与 Host 路由扩展业务差异，不修改第三方源码或发布字节。

## 管理员模型页面

管理员恢复官方 `ui-settings-models`。供应商创建、编辑、删除、API 协议、服务地址、Key 输入、模型发现、模型 ID/名称、上下文、可选输出上限和输入模态都由原生 Models 页面负责，自有 Client 不维护另一套 CRUD、Key 或发现弹窗。普通用户的 Profile 不激活该页面和管理员 Settings/Credentials Remote。

管理员模型页面只保留官方实现，不注册自有 `settings.models.provider-card`。自定义思考等级启用、线值、默认等级、私有映射和自定义模型选择继承全部退役；官方页面没有的编辑能力不再由业务插件补齐。会话模型与思考等级由官方 Models、ModelDirectory 和模型选择组件根据官方 metadata 决定。

Host 继续通过官方 Settings/Credentials 事件自动把已保存供应商连接发布到受管目录，维持普通用户模型供给与删除保护。移除扩展卡不删除已保存共享目录、模型可见范围、新会话兜底或旧偏好文件；旧偏好文件不再通过自有路由或 Client 自动读取并覆盖官方 Session 选择。LightRAG 仍单独固定使用 `gpt-5.6-terra`、`none`，不跟随聊天思考等级。

alpha.3 原生 ConfigForms 不再按公网选择 `memory`；官方首次 eager describe 保持执行，也不伪造 `loopback`。受限 façade 保留官方原始服务，仅当后端共享策略与官方 `settings.describe` 都确认管理员写能力时，提供 `llm-pi-ai`、`llm-deepseek`、`ui-settings-models` 的原生脱敏描述。Schema、继承层、用户层和原生修订原样保留；未知命名空间或额外 descriptor 字段不透传。Models 的 CRUD/发现/Credentials 操作继续由原始官方 Client 发起，原生写入成功后回读描述，保持真实修订。普通用户只读取共享展示数据与官方 Schema，管理写操作仍在服务端拒绝。字体、并行、子代理和工作步骤收起等共享数据使用独立 Native 修订；混合主题或混合Chat保存同时核对两个 CAS 并在一条数据库事务中保存。

官方 Chat `collapseTiming` 的公开 setter 现在自身持久化，因此共享偏好采用只能通过官方 Host 表单订阅。桥把已有 `Native.clientPreferences.collapseTiming` 投影到 `ui-chat` 的有限 scope；明确操作只发一次 Native CAS，刷新/SSE不反向写回。安全 HTML 初值使用同一真源、两种枚举及原 Schema，不写入平行 namespace，也不把 raw Host 的旧默认覆盖共享记录。

## 官方插件管理与角色采用

管理员使用官方 PluginManager 页面管理实际已安装、固定版本、官方可寻址且不属于核心恢复依赖的行及 Bundle。可管理候选来自固定官方 composer 与当前 SDK 库存交集，不再限定历史三个 UI 行。安装、移除、版本豁免仍属于受管部署，网页不能安装缺少的 Claude/Codex 或暗中升级。共享 `plugins` / `bundles` 与其它 Native 字段使用同一 CAS，64KiB正文及有限身份条目预算；停用组合的成员覆盖保留，重新启用时恢复。

Inspector、Terminal、Team、Ralph、Worktree、AutoReview 的共享选择仅在签名管理员角色实际装载。普通 Runtime 对同一政策保留记录但跳过这些组合及成员的原生 setter，同时正常采用字体、子代理和工具并发；未知、未安装和核心身份仍先拒绝。内部采用标志只在 Host 闭包中，外部普通管理 RPC 与 HTTP 保存仍拒绝。alpha.3 官方 RemoteAccess 的 Owner 表示当前独占 Host 所有者，不等同业务管理员。

Terminal 的模型持久终端与原生浏览器PTY属于两个官方组合区域，可信管理员明确选择后，冷物化同步开放 `terminal-controller` 和 `ui-sidebar-terminal`；普通角色始终禁用两行。热启停保留共享记录并报告 `restart-required/host-module`，在新的实际 Runtime 完成冷装配前不授予新能力或宣称整个功能已应用。

AutoReview 的真实官方卸载会把存活 Auto 会话写成 `danger-full-access` 并把审批写成 `never`。桥在保存和原生停用之前检查本Runtime实际会话，存在Auto时拒绝并提示从官方权限选择器明确退出，绝不自行切换权限。官方完整插件、真实权限服务和Session日志的隔离测试保留这一副作用证据。

官方 `failed`、`overridden`、`restart-required` 和 `restartReason` 保持实际分类；只有原SDK回执及当前active库存都确认时才发布Host内部live能力，不按Manifest已选择或后端保存成功假授予工具。

原始 `settings-controller` 装配停用，管理员 Host 通过官方公开导出的 `SettingsController`、`CredentialsController` 基类继承两个窄删除保护类。Key unset 或原生配置删除/祖先替换/Provider null 重置之前，调用可信签名只读删除资格检查；默认用途、固定知识依赖或资格读取故障都会在 `super` 之前拒绝，真实 Key 尚未删除。普通属性编辑继续调用原始 Schema 与 CAS；原生 `update` 的空 dict 深合并不会被误判为路由删除，但显式 null 会把 Provider 重置为失去模型与连接引用的空对象，因此需要资格检查。

配置单独清空 `models`、移除最后一个显式模型或删除/置空原有 `apiKeyEnv`，也属于上述破坏性重置，并覆盖原生 mutate/update/replace。一般非空模型、上下文和输入能力编辑不按供应商删除处理；合法非空凭据引用替换继续由官方与受管发布校验。这不是每个模型属性编辑的跨系统原子事务。

继承后显式装载官方 `dsh-api-settings-controller/typert` 完整 Schema，保留 Remote 服务身份、可选参数及错误契约。普通用户只装配既有只读 Settings Remote，不会得到管理 Credentials 接口。代码不伪恢复 Key，不使用事后 DOM 拦截冒充权限保护。

对当前 Host 实际成功发布并确认、且仍在原生 Profile 中的路由，删除桥在同 Host 的共享发布串行边界内先调用已有后台 DELETE，后台持锁再次检查引用；成功后才执行原生 `super` 删除。资格读取与真正 DELETE 之间默认用途发生变化时，后台再次拒绝，原生 Key 尚未删除。Key unset 与随后 Profile 删除之间标记路由暂停自动发布，防止官方事件重建共享目录；原生步骤失败时，只通过当前真实 Profile/Credentials 做一次正常发布补偿，不保存、恢复或重试 Key 删除。没有当前 Host 成功确认的其它路由，不按冷启动共享目录猜测归属并删除。

这仍是跨后端目录与官方私有配置的补偿流程，不是跨数据库、Host、Credentials 的分布式原子事务。同名路由在不同管理员之间目前没有后端资源 owner 字段；本桥不宣称解决了该数据模型归属缺口。官方工作流中 Key 删除已经完成、随后原生配置写入失败时，不能伪造恢复 Key；应保留真实原生错误并由管理员核对配置。受管默认与固定知识关联会在 Key 删除之前拒绝。

## 消息与 chrome 边界

Workspace、会话侧栏和管理页面使用官方实现；经用户明确授权，自有 Client 只注册 `sidebar.brand.mark` 与 `sidebar.brand.name` 显示既有 Logo，其他品牌、Provider Card 和移动侧栏不覆盖，不重命名 Workspace、清理官方视图偏好或自动导航会话。Profile 恢复官方品牌，管理入口仅按签名管理员身份装配。全页 TreeWalker 文本替换及 Preview 隐藏保持退役，不修改聊天、引用、代码或工具正文。

保留的 DOM 集成只向主应用通知 iframe 模态框几何与关闭握手；密码自动填充改写和系统节点隐藏已退役；不修改官方设置页内部布局、菜单候选或键盘高亮。根观察器只发现明确语义区域装卸；属性变化限制在局部 Owner，并按微任务合批。`data-conversation-region="chat"` 下的伪 UI 标记也不进入适配。

工具记录保持官方状态、详情和生命周期。官方工具视图已经区分参数准备、执行、成功、失败和中止，本插件不维护另一套执行状态机，不把卡片中的参数大小当作文件写入完成证明。

## 侧栏视图偏好

Workspace Store、视图菜单和会话列表由官方组件负责。旧 Workspace 视图 Host 路由及偏好辅助实现已删除，既有状态文件保留。业务 Client 不再请求自有 Workspace 视图、替换官方 Store、清理官方浏览器偏好或注册同步状态浮层。既有 Host 状态文件不删除；退役后不会通过客户端覆盖官方交互。

## 必需工作区登记

聊天 Composer 依赖官方 Workspace 登记。业务 Runtime 的真实工作目录由 Gateway 决定，Host 通过公开 `workspaceRegistry.create` 幂等恢复登记，并从官方 `sessionPersistence.list()` 的 `snapshot.header` 与实时 Session Header 关联同目录历史；不读取正文、不改变会话模型、不迁移其他目录。公开 `WorkspaceController` 与 `SessionController` 的窄继承只拒绝删除基础登记和外部目录的新建请求，其余操作继续调用官方实现。启动恢复和有限删除/新会话事件随 Host 生命周期释放，没有常驻轮询，也不删除文件或 Session。

## 固定代码缓存

官方 Settings Client 原始资源与纯静态 `ui-policy-client.mjs` 由 Host 只读加载，以实际公开代码字节 SHA-256 注入可信启动版本，Client 使用固定同源 URL 的 `rev` 查询。仅当前匹配版本 URL 返回浏览器 `private, max-age=31536000, immutable`；新 `native-policy-client.mjs` 也使用相同的可信版本与缓存规则；旧无版本入口与错误版本不获得永久缓存，错误版本返回 410。gzip 从相同原字节生成，`q=0` 返回 identity，编码变体由 `Vary: Accept-Encoding` 区分。

该缓存只涉及代码，不缓存 General 策略、模型配置、Credentials、附件、Session 或租约。

Gateway 启动时校验并固定自有插件、Client、资源与 Profile/Preset 的完整代码快照。开发与生产使用同一快照修订；官方 `client-hmr` 保持启用以传送插件图变化，但不观察正在编辑的工作区文件。Host `hmr` 与 `patchReload: live` 保留。代码更新经过受管 validate、重启和页面刷新生效；共享字段通过受控修订通知和官方 volatile 接口采用，模型热更新保留已准备请求的官方快照。

## 验证

`npm run check` 使用调用方明确指定的固定 Runtime；候选验证同时设置 `ADMINSMART_DSH_ROOT` 与 `ADMINSMART_DSH_TEST_ROOT`，不能偷换到另一套安装。目标用例覆盖原始官方 Models Client、真实 Cordis/Typert Gateway/SettingsForms、公开 CAS/发现操作、管理员/普通用户描述边界、默认 Key 删除前拒绝及非默认原生删除、资格后引用竞态拒绝不删 Key、原生失败的当前 Profile 补偿、暂停重发布、raw Remote 删除路径与真实 update 深合并、Workspace 黑洞与取消、最新 PUT 退避、正文 canary 和局部合批、版本 URL/gzip/HEAD/过期版本。

离线目标验证不访问真实模型、数据库、生产凭据或用户资料；生产启停、修订核对、签名 Runtime 冷启动与浏览器真实验收由受管发布流程单独完成。
