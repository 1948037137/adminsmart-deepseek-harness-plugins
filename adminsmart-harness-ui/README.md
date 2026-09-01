# AuraSearch（AdminSmart Harness 客户端 UI 插件）

本项目通过 Harness 公开的 Host Service、Client Module 和 UI Slot 扩展点提供 AuraSearch 知识问答界面，不修改官方源码。

## Host 能力

- 为当前用户隔离 Runtime 的 `process.cwd()` 创建或复用固定“知识问答” Workspace。
- 提供始终返回取消结果的目录选择能力。
- 不读取、列出、创建或打开其它服务器目录。

## Client 能力

- 通过官方 `sidebar` Slot 提供 AuraSearch 完整会话侧栏，不暴露 Workspace 概念。
- 使用 `assets/aurasearch-logo.jpg` 作为侧栏和空会话统一 Logo，产品名固定为 AuraSearch，AdminSmart 表示所属系统。
- 会话支持顶部遮罩搜索、标题/时间/摘要结果、命中消息定位、今天/7 天内/30 天内分组、当前项高亮、重命名、置顶、顶部批量选择和可恢复删除。
- 隐藏 Workspace 选择入口，固定 Workspace 由 Host 自动创建并由官方 Workspace 导航自动连接。
- 在聊天输入区提供 Session 级知识文档多选：空选择检索全部 ready 文档，非空选择由 FastAPI 强制限制为勾选文档。
- 知识范围使用草稿式多选：勾选过程不请求后端，点击“应用”后一次保存；取消或点击外部不改变已保存范围。
- 聊天附件只允许 PNG、JPEG、WebP 和 GIF 图片，并通过 Harness 原生图片草稿协议作为当前问题的多模态上下文。
- 聊天附件不创建知识库资源，不进入 MinerU 或 LightRAG；知识文档上传只属于独立的知识库文档管理页面。
- 保留 Harness 会话、流式消息、思考过程、工具轨迹和模型选择能力。
