# 管理员共享快捷键配置桥

本包装配固定 Harness `0.2.1-alpha.1` 的公开快捷键服务。官方服务继续拥有按键分发、命令注册、编辑器、冲突处理和设备默认值；本包只把管理员偏好持久化到当前 AdminSmart 环境并通过签名失效流驱动其他窗口采用。

`src/shared-shortcuts-client.mjs` 是唯一业务实现。`lib/client.js` 是具有独立 `@adminsmart/dsh-client-shared-shortcuts` 身份的 Lazy-CJS Graph consumer，从当前 Gateway 页面的固定同源资源加载该实现，不把它复制进品牌模块。Host 在现有装配入口调用 `installShortcutPolicyHttp()`，传入当前签名身份、同源检查、有界 JSON 读取、自有固定资源读取和受管安装公开 `@deepseek-ai/dsh-client-shortcuts/protocol` 导出。

固定同源入口：

- `GET/PUT /adminsmart/shortcut-policy`：返回 `revision/document/writable`；管理员保存使用 `expectedRevision/document`。
- `GET /adminsmart/shortcut-policy/events`：只返回 `ready/resync` 或 `policy-invalidated` 的 `kind/revision`，实际文档始终通过 GET 读取。
- `GET /adminsmart/shared-shortcuts-client.mjs`：固定自有业务资源，不映射输入 URL 到本地路径。

FastAPI 对应 `/internal/agent-model/v1/shortcut-policy` 和 `/shortcut-policy/events`。策略保存在已有环境配置 JSONB 的 `agentShortcutPolicy`，独立快捷键 CAS 修订不会推进模型或 General 修订。SSE 不持有数据库会话；保存提交后调用现有环境通知 Stream，通知失败以 `X-AdminSmart-UI-Policy-Delivery: delayed` 表达，不能回滚已经成功的保存。

允许的 18 个命令来自 alpha.1 下列官方公开 feature owners 的 `shortcuts.register()`，本项目现有业务插件没有额外可编辑快捷键命令：

| 官方源码范围 | 可编辑命令 |
| --- | --- |
| `packages/client/ui-layout/src/client/index.ts` | `sidebar.left.toggle` |
| `packages/client/ui-sidebar-right/src/client/shortcuts.ts` | `sidebar.right.toggle`、`pane.split`、`pane.fullscreen.toggle`、`page.close`、`page.refresh` |
| `packages/client/ui-workspace/src/client/shortcuts.ts` | `session.new`、`session.search`、`workspace.add`、`session.rename`、`session.fork`、`session.archive` |
| `packages/client/ui-open-in-app/src/client/index.ts` | `workspace.openLocal` |
| `packages/client/ui-sidebar-terminal/src/client/index.ts` | `terminal.new` |
| `packages/client/ui-sidebar-browser/src/client/index.ts` | `browser.new` |
| `packages/client/ui-sidebar-files/src/client/index.ts` | `workspace.files` |
| `packages/client/ui-shortcuts/src/client/index.ts` | `shortcuts.open` |
| `packages/client/ui-settings-general/src/client/index.ts` | `settings.open` |

未挂载但属于这份白名单的命令保留在服务器文档中，等公开 catalog 注册后采用；其他六设备 profile 保持原值。Fixed 输入、菜单、审批、`response.stop` 等动作不进入共享编辑白名单。未知扩展或新版本指令会安全拒绝读取/发布，保留已有数据，不自动擦除；确需扩展时须按固定新版本的公开命令证据更新后端及桥 DTO 和目标测试。

采用只使用公开 `config.document`、`catalog`、`fixedCatalog`、`describeBinding()`、`edit()`；不读浏览器原始存储、不更换私有 adapter、不调用 private registry。编辑差异区分缺失继承默认与 null 显式取消。互换组合先通过受控 `set(null)` 释放本轮冲突占用，再 reset/set，默认不使用 reset-all。多项 edit 没有整批事务，部分采用失败会给出可见错误并允许重试。管理员发布合并实际编辑差异以保留服务端休眠和其他设备配置，远端采用期间禁止反向发布；CAS 冲突回读并要求重新编辑。

普通用户的官方 `ui-shortcuts` 编辑 UI 包由可信 Profile 的管理员条件控制，包括 Mod+/ 打开命令；官方核心 `shortcuts` 服务与本配置桥仍为全部用户加载。浏览器的 writable 仅是服务端角色提示，PUT 最终仍依赖后端签名管理员验权。

离线验证：在本目录运行 `npm run check`。测试原样加载当前共享安装公开 `./protocol`，所有存储、HTTP 和事件都使用内存 Fake，不访问真实数据库、Redis、模型或用户偏好。后端 `module_knowledge.tests.test_agent_shortcut_policy` 还用 336 个六设备代表组合核对严格 DTO 与官方纯协议的准入一致性。
