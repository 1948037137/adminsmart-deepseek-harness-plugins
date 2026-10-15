/** Verify the Host plugin exposes only browser-safe routes and no Harness Workspace capability. */

import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'

import { inject as hostInject, installRuntimeRoleIndexInjection } from '../src/index.mjs'

for (const isAdmin of [true, false]) {
  let listener // 隔离捕获官方 Index Injection 回调，不启动网络服务。
  const dispose = () => {} // 官方 Host 生命周期的无副作用释放替身。
  assert.strictEqual(installRuntimeRoleIndexInjection({ on(event, callback) {
    assert.equal(event, 'webserver/index-inject')
    listener = callback
    return dispose
  } }, isAdmin), dispose)
  const table = [] // 页面启动前唯一新增的 JSON 行，不携带用户数据。
  listener(table)
  assert.deepEqual(table, [{ kind: 'global', name: '__ADMINSMART_RUNTIME_ROLE__', value: isAdmin ? 'admin' : 'managed-user' }])
}

const logoPath = new URL('../assets/aurasearch-logo.webp', import.meta.url) // Repository-owned product artwork served by the Host plugin.
const logoMetadata = await stat(logoPath) // Binary asset must remain present for every Runtime activation.
const hostSource = await readFile(new URL('../src/index.mjs', import.meta.url), 'utf8') // Source-level contract check avoids starting a real web server.
const workspaceSource = await readFile(new URL('../src/managed-workspace.mjs', import.meta.url), 'utf8') // 受管目录业务归独立模块，静态边界检查不读取用户登记。

assert.ok(logoMetadata.size > 1024, 'AuraSearch logo asset must be non-empty')
for (const dependency of ['workspaceRegistry', 'sessionPersistence', 'sessions', 'webServer', 'messageFeedback', 'configEditor', 'credentials', 'settings', 'llm', 'agentDefaultModel', 'agents', 'attachments', 'fileUploads', 'fs', 'sessionProjections', 'sessionQuery', 'typert']) assert.equal(hostInject.includes(dependency), true) // 真正业务依赖门禁不能被源码格式或旧静态行掩盖。
assert.doesNotMatch(hostSource, /SESSION_SEARCH_ROUTE|ctx\.sessionQuery|sessionSearchSnippet/, '会话搜索只由官方工作区实现')
assert.match(hostSource, /AURASEARCH_LOGO_ROUTE = '\/adminsmart\/assets\/aurasearch-logo\.webp'/)
assert.doesNotMatch(hostSource, /ctx\.sessions\.binding/)
assert.doesNotMatch(hostSource, /knowledge\/scope|requestKnowledgeScope/)
assert.match(hostSource, /installFeedbackRoute\(ctx/, '原生管理反馈只通过受限 Host 路由读取')
assert.match(hostSource, /installFeedbackMutationSync\(ctx, feedbackDependencies\)/, '官方反馈事件必须立即增量同步主应用索引')
assert.match(hostSource, /apiBase: requiredEnvironment\('ADMINSMART_AGENT_API_BASE'\)/, '反馈增量只调用当前环境受管 FastAPI 回环根')
assert.match(hostSource, /capabilityTokenPath: requiredEnvironment\('ADMINSMART_AGENT_TOKEN_FILE'\)/, '内部读取必须使用受管能力证明，不能以浏览器 Cookie 代替 admin 授权')
assert.match(hostSource, /class AdminSmartCancelledDirectoryPicker extends DirectoryPicker/)
assert.match(hostSource, /return null \/\/ Every directory request behaves like an operator cancellation/)
assert.match(hostSource, /installManagedWorkspace\(ctx, \{ runtimeCwd \}\)/)
assert.doesNotMatch(hostSource, /ensureInternalRuntimeWorkspace|runtimeSessionHeaders|\breadFile, realpath\b/)
assert.match(workspaceSource, /registry\.create\(canonical, retainedTitle\)/)
assert.match(workspaceSource, /snapshot\?\.header/)
assert.doesNotMatch(hostSource, /workspace\.setTitle|INTERNAL_RUNTIME_WORKSPACE_TITLE|ADMIN_MODELS_ROUTE|ADMIN_MODELS_DISCOVER_ROUTE|MODEL_REASONING_ROUTE|MODEL_DEFAULTS_ROUTE|MODEL_CONFIGURATION_ROUTE|PRIVATE_MODEL_REASONING_ROUTE/)
assert.doesNotMatch(hostSource, /FIXED_WORKSPACE_TITLE|WORKSPACE_REPAIR_INTERVAL_MS|sessionFilters: \[{ kind: 'cwd'/)

assert.doesNotMatch(hostSource, /SESSION_WEB_ACCESS|session-web-access\.json|readSessionWebAccessState|updateSessionWebAccessState/, 'Host 不再保存会话联网开关或装载退役路由')

process.stdout.write('host_runtime_contract=ok\n')
