# AuraSearch 的 Harness 业务接线

运行使用固定官方 Harness `0.2.1-alpha.3` npm 发行包。`C:\xiangmu\deepseek-harness` 只用于查看官方新功能和公开协议，不是业务启动或部署来源。官方界面、Agent 引擎、Session、附件、办公工具、模型选择和插件目录不由本项目复制实现。

本包保留的职责如下：

- 可信 Runtime 身份、管理员管理入口及服务端写权限，普通用户不能配置供应商、密钥或全站设置。
- 管理员通过官方 Models 界面配置模型池，全部已启用模型供普通用户用官方选择器自由切换。共享目录经官方 volatile Provider 字段热更新，不改写合法的会话模型、思考选择或已准备的请求。
- 通用设置、字体、官方工作步骤收起选项、子代理与工具并行配置、快捷键及已安装官方插件选择的跨用户持久化与分发。Schema、表单、启停和执行均使用当前官方接口；子代理仍遵守业务仅一层的边界，当前并行默认不是额外上限。管理员从官方插件页明确启停，未安装包不自动安装，不自动全开。
- 原生供应商发布与默认/固定知识来源的删除保护。真实连接保存在受保护服务端，浏览器和普通 Runtime 不获得供应商密钥。
- 手机业务账号退出、原件、反馈与审计接线，iframe 与主应用的模态几何协作，以及官方 Composer 所需的受管工作目录。
- 问答必需工作区登记的窄保护与恢复。基础目录只来自可信 Runtime，登记与同目录历史关联使用官方 API；拒绝删除该登记和外部目录的新会话，不删除文件，不替换官方工作区页面或 Session 生命周期。
- 通过 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark` 三个公开品牌接口接入AuraSearch。侧栏空renderer与Hero不可见自有锚点保留席位占用，避免撤掉登记后恢复官方FishLogo；两个位置都不绘制图片、SVG或其他替代图形，品牌名称继续显示AuraSearch。原JPG/WebP及受管资源路由仅作历史兼容保留，原始侧栏按钮、工作区、会话与输入区仍由官方实现。
- 用户已明确确认唯一新增的欢迎区展示例外：标题“今天想解决什么问题？”，隐藏其“预览版”标签。固定alpha.3没有两项独立配置，因此在现有自有Client内部以Hero品牌Slot的隐藏锚点限定DOM适配；只调整真实标题Text节点和标签本身。官方结构及中英文配对不匹配时停止并保留原生显示，不全局搜索、不依赖CSS哈希、不改祖先或复制Hero。卸载有条件恢复自己持有的字段，升级必须重跑真实官方Hero的DOM回归；这不是官方标题设置API，也没有新增请求或模型调用。

自定义模型页、思考等级、默认/偏好修复、侧栏、工作区视图、菜单、隐藏系统节点、密码框 DOM 处理和设置布局均已退役。不会删除既有 Home、会话、附件或偏好数据。

共享 Native 策略保留官方 Bundle 名称与稳定插件行 ID，并使用独立 CAS。alpha.2 历史记录可读取且保留原版本标记；管理员下一次明确保存才写 alpha.3。关闭 Bundle 后成员行的历史覆盖仍保留，重开后恢复。官方只读、核心恢复依赖、未安装包和不兼容入口继续拒绝，SDK 的失败、覆盖及需要重启结果如实反馈，不把共享保存冒充已经运行。

Inspector、Terminal、Team、Ralph、Worktree 和 AutoReview 仅装载到签名管理员 Runtime；普通用户仍采用同一份共享记录的兼容配置，但不装载或调用这些高权限能力。官方 Host Owner 与业务管理员身份不同，不能用 Owner 放宽角色边界。Terminal 还绑定原生 Web 终端 Controller/Sidebar，两行在热启停后需冷启动物化；当前页面不会伪报全部终端功能已经生效。AutoReview 的官方卸载会把存活 Auto 会话切为全访问，因此停用前必须由管理员在官方权限选择器明确退出 Auto；受管桥只检查和拒绝，不擅自切换会话权限。

Gateway 启动时校验并固定一份自有代码快照，开发和生产共用同一修订；官方 HMR 继续传送正常插件模块变化，开发源码编辑不会提前热更正在运行的生产产物。版本化代码和 Logo 仅缓存固定公开字节；会话、配置、租约、凭据和附件不进入静态缓存。

问答 HTML 可通过官方 `IndexInjection` 携带当前 Host 已确认并完整采用的 General/Native 安全初值，页面只消费一次，从而减少共享设置阻塞 Client Loader 的一轮公网读取。初值只含展示白名单和对应有限 Schema，不含供应商、任意请求 Header、凭据或模型配置；管理员 Models 首次使用仍等待原始完整描述。未确认、正在采用、损坏或版本不符时继续原 HTTP 初始化。真实首次 `connection/reset`、更高 SSE 修订、恢复读取及独立 CAS 均保持；这不是每次 HTML 都向数据库重新确认的承诺，也不允许静态缓存动态初值。

明暗是个人外观例外：只将官方 `ui-theme.preference` 保存在当前签名用户的官方 Profile，新账号继承 `light`，已有个人 `light/dark/system` 选择保留。旧 General 记录的 `theme` 字段作为历史兼容数据保留，但不再采用到用户主题，也不从个人选择反向发布。字体、字号、模型、规则及插件选择继续遵守管理员全站设置。普通用户的 Settings Remote 和目录仍然只读；唯一写例外是同源 `/adminsmart/personal-theme` 的 `PUT {"mode":"light"|"dark"}`，它只调用本人 Runtime 的官方 SettingsForms。混合字体、模型或身份字段一律拒绝。

主应用通过同源消息 `adminsmart:theme-request` 请求本人外观：`requestId` 为 1–128 位字母、数字、冒号、下划线或短横线，省略 `mode` 表示读取，提供 `light/dark` 表示选择。原生 Client 仍调用官方 `ThemeRuntime.setTheme` 并等持久化回执，返回 `adminsmart:theme-state` 的 `ready/saving/error`、已确认 `mode`、官方偏好 `preference: light/dark/system` 和原 `requestId`；挂载及本人状态变化另发无请求ID快照。`mode` 是有效颜色，`preference` 保留官方system语义，避免把系统当前暗色保存为固定暗色。双向检查来源和当前父/子窗口，不传递账号ID、凭据、字体或其他配置；失败保留原确认颜色，不把乐观界面当作保存成功。

alpha.3 官方 SettingsDescribeMirror 的首次 eager describe 保留。Chat 的 `collapseTiming` 由既有 `Native.clientPreferences` 投影到官方 Host 表单及安全启动描述；公开 setter 的明确操作保存一次，SSE/刷新采用通过官方订阅进行，不调用会再次持久化的 setter。

四份图外固定设置/快捷键桥代码通过官方 `IndexInjection` 使用标准预载提示：经典 Settings 原始模块用 `preload as=script`，General、Native、快捷键纯模块用 `modulepreload`，URL严格匹配后续消费的同源代码SHA。提示位于阻塞脚本之前，只提前下载，不执行模块或预请求政策、模型、会话。官方应用合并包已有预载，不额外按成员重复下载；这些提示只能减少图外代码的发现往返，不能消除官方大型合并包的首次传输。

离线验收使用固定 SDK、Fake 后端及本任务临时目录。运行 `npm run check` 与 `npm --prefix shared-shortcuts run check`；修改实际运行模块后，另须受管 validate、重启、修订一致、签名冷启动及本轮授权的生产浏览器验收。
