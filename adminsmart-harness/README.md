# AdminSmart Harness 知识集成

本目录只维护 AdminSmart 的业务权限与证据集成，不修改 Harness 上游源码。共享固定版为 0.2.1-alpha.2。

## 保留的职责

- index.mjs：同一 Agent Preset 作用域内组合业务工具、策略和安全 Guard。
- security.mjs、native-file-policy.mjs：可信会话身份、原生文件路径、命令目录、原件只读、权限和后台模式检查。
- session-files.mjs、session-authority.mjs：从官方已接受消息与原件桥接结果取得授权引用；子代理只继承可信直接父会话。
- lightrag-tool.mjs：通过受管 FastAPI 调用当前用户知识检索，不直接访问数据库或 LightRAG 内部存储。
- knowledge-attachments.mjs：当前用户与 Session 校验后，把知识原件流入官方 AttachmentStore；只桥接，不解析。
- knowledge-delegation.mjs：复用官方单层子代理托管激活、启动回执、完成通知、父模型、并发和清理；不能扩大父权限，启动回执不等于任务完成。
- anysearch-provider.mjs、public-web-fetch-provider.mjs、business-registry-tool.mjs：现有受控公开信息能力；网页工具使用官方实现，父子会话继承实际工具范围，不维护私有联网开关。
- prompts/：证据、原生办公、身份、不可信文档和失败行为的独立模板。
- document-render.mjs、document-render-policy.mjs：在当前 Session 文件授权下只调用固定官方 LibreOffice Kit renderImages，自动输出业务目录；不接受可执行代码、任意输出路径或升权，不自行解析/绘制。原生 read_image 与 present 继续负责看图和交付。

文件上传、读取、Office 技能、PowerShell/Bash、PDF 工作流和交付使用 Harness 原生工具。read_chat_file、read_chat_pdf_pages、analyze_xlsx 与重复解析插件已退役；只补受控官方渲染 API 入口，不保留服务器 XLSX Worker 或自定义 PDF 解析/绘制。

## 业务文件范围

业务工作目录由 Gateway 的 ADMINSMART_AGENT_BUSINESS_ROOT 注入，解释器由 ADMINSMART_OFFICE_PYTHON 指定。脚本与结果可写该目录；当前会话附件、受管知识原件及官方技能资源只读。开发与生产使用同一实现，身份、凭据、Home 和数据由 Gateway 按环境、用户、管理员角色及模式分离。

普通文件工具检查真实路径；命令保持 workspace-write、限时前台运行，不准升级或后台常驻。同模式权限字段只允许 SDK 的 no-op，理由不能为空。

用户选择不用容器。官方 Windows 沙箱只提供部分写入限制，业务区外读取及命令联网主要依赖提示词；不能宣称 OS 读取、网络或跨用户命令隔离。真实合成 canary 测试专门记录读取缺口，而不是把可读取误报为安全通过。

## 验证

npm run check 执行语法、真实官方 Preset 装配、文件 Guard、官方命令 SDK/Windows 写入沙箱、父子会话、知识桥接、公开信息、证据和提示词目标测试。自动测试不访问真实用户文件、生产数据库、模型或外部服务。

运行代码变化后还须 validate、stop/start、修订一致与真实签名用户 Runtime 冷启动。业务权限和解析能力不能仅凭页面隐藏或模型自述判断。

详细迁移、实际目录和边界见后端 docs/native-file-qa-migration.md。
