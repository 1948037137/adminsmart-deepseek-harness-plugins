# AdminSmart Harness Platform

本目录按照 DeepSeek Harness 官方组合模型保存 AdminSmart Agent 平台配置，当前固定版本为 `0.2.1-alpha.1`。

## 组成

- `platform.json`：服务端允许签发的业务模式及其 Agent Preset 白名单。
- `profiles/adminsmart-web`：所有 AdminSmart 业务 Agent 共用的固定 Harness Web Runtime Profile。
- `presets/adminsmart-knowledge`：AuraSearch 知识问答会话使用的 Agent Preset。

运行时由 Agent Gateway 把 Profile 和当前业务 Preset复制到用户隔离的 `DSH_HOME`，并只在租户副本中物化 AdminSmart 插件的 `file:` URI。源码组合不包含用户目录、密钥、Token、Cookie 或知识正文。

## 职责边界

- AdminSmart 负责登录、租户、资源归属、业务 API、模型密钥和 LightRAG 权限。
- Harness `0.2.1-alpha.1` 原生能力负责 Session 附件上传、存储与发送回执、文件、办公技能、限时命令、PDF/Office/XLSX/CSV 预览与交付。`adminsmart-harness-input` 已退役，当前组合不再挂载自有附件解析或读取插件。知识原件仍经 FastAPI 所有权和 Session 校验导入；自有业务代码不解析文件。Windows 写入沙箱只具部分强制执行，区外读取和命令联网主要由业务提示词限制，不是完整 OS 隔离。原有模型、工商和受控公开网页策略仍独立保留。
- 会话搜索、导航、置顶及归档由官方 Workspace/SessionQuery 提供；管理员插件清单由官方 Plugin Inventory 提供。AdminSmart Host/Client 不保留自有 Session 搜索路由、搜索弹窗或手写插件目录。
- 公开网页搜索统一使用官方 `web_search` Tool，知识 Agent 的受管插件向固定 AnySearch HTTPS 端点发送匿名公开查询，不调用聊天模型代搜；历史搜索 Provider ID 仅保留以兼容共享 Gateway 校验。`web_fetch` 单独选用知识 Agent 的公开 HTTPS DNS 解析插件，地址校验和连接钉扎后仍使用官方 HTTP Provider，域名查询会发给 Cloudflare，不修改进程代理、系统 DNS 或其它出站请求。
- 管理员 Provider 配置初始为空，新建 Key 存入隔离的官方 Harness Credentials；管理员保存的供应商配置由受管 Host 通过官方设置与凭据事件同步到 FastAPI 加密保存。开发与生产使用同一受管模型管理页面，普通用户读取受管模型目录且不接触 Key。
- 官方 Voice Input Bundle 独占语音 UI 与识别 API，用户 Runtime 按需启动 SenseVoice Worker，共用已验签 ONNX 模型但不共享用户会话数据。
- Agent Preset 决定单个会话可见的工具、提示词和 Skill。
- Workspace 不参与 AuraSearch 的业务或权限隔离。
- 管理员通用设置的非敏感白名单由后端按 dev/prod 环境独立持久化，Gateway 冷启动时把它物化到每个用户的 Profile 副本，活动 Runtime 由 AdminSmart Host 插件通过官方 SettingsForms 接口更新。普通用户只装配只读 General 描述服务；Settings/Plugins 入口及凭据管理继续关闭。
- 旧生产后端在正式发布新策略 API 之前返回 404 时，Gateway 只对 prod 保持旧版界面策略和浅色外观，不阻断现有问答冷启动；dev 缺少同一路由仍视为部署错误。生产全员策略需与生产后端明确发布后才生效。

## 历史迁移记录

- 在 `0.1.7-rc.2` 阶段，官方已经负责 Session 附件上传、存储、发送回执与 Office/XLSX/CSV 预览，`adminsmart-harness-input` 曾补充受限附件格式校验与读取。该描述仅记录历史实现，不表示当前仍装载此插件。
- 在 `0.2.0-rc.2` 阶段，知识文件处理继续迁入官方文件、Office、限时命令、预览和交付流程。当前 `0.2.1-alpha.1` 延续官方能力及业务权限边界，固定版本以当前运行清单和 Profile 为准。
