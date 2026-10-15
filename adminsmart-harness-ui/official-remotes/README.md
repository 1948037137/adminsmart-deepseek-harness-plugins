# 官方 Workspace 与 Session Client 装配

本包只为固定 npm Harness `0.2.1-alpha.2` 补齐两个官方浏览器模块的代码贡献。受管 Host 已通过公开继承提供 Workspace、Session Controller，因此 Profile 必须保持原 `workspace-controller`、`session-controller` 停用，避免重复注册服务。

当前官方 `ClientModuleRegistry` 只扫描存在 fiber 的非停用 Loader 行。`dsh.client.inject` 是依赖信息，不会递归装载缺失包；公开 Registry 没有单独注册 Client 的接口。因此 Boot Graph 中保留的是自有装配包，不能把它报告成两个原 Host 包仍在 Graph 中。

Host 依赖官方 `clientModules` 先激活，再通过结构化 `webserver/index-inject` 的 `script-src` 在 head 预登记两份固定官方 Client 发布字节。网页使用 parser-blocking 经典脚本，官方 worker 渲染器使用 awaited 执行。两个资源只接受固定 GET/HEAD，正确 SHA URL 使用私有不可变缓存，legacy 不缓存，错误、空或重复 SHA 返回 410；gzip 来自同一原字节快照。

Client 通过原始公开 ModuleSystem 导入已登记的官方 factory，在同一提供方 fiber 调用两个原始模块的公开 `apply`。其完整原依赖不缩减；启动解析共用五秒预算，卸载会取消迟到采用。

本包不创建 GUI，不重写 Workspace、Session、模型选择、发送、缓存、查询或控制流，不替换官方 Service 实现，不伪造 Boot Graph 行，也不修改、复制为私有版本或重新构建第三方源码和构建产物。所有浏览器行为和服务生命周期继续由固定官方模块负责。

生产验收需要同时确认真实 Loader Host 行 active、两个原始脚本原字节可用、官方 ModuleSystem 能导入两个原始模块、官方消费者已就绪，以及主 Host 提供的 UI/Native 策略静态入口返回当前修订。只通过 Host SDK 或只看到包装包的 Boot 行不能代替 Client 装配验收。
