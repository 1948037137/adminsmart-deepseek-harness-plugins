/** Verify the Host plugin exposes only browser-safe routes and no Harness Workspace capability. */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installRuntimeRoleIndexInjection, readSessionWebAccessState, updateSessionWebAccessState } from '../src/index.mjs'

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

const logoPath = new URL('../assets/aurasearch-logo.jpg', import.meta.url) // Repository-owned product artwork served by the Host plugin.
const logoMetadata = await stat(logoPath) // Binary asset must remain present for every Runtime activation.
const hostSource = await readFile(new URL('../src/index.mjs', import.meta.url), 'utf8') // Source-level contract check avoids starting a real web server.

assert.ok(logoMetadata.size > 1024, 'AuraSearch logo asset must be non-empty')
assert.match(hostSource, /export const inject = \['workspaceRegistry', 'sessionPersistence', 'sessions', 'webServer', 'messageFeedback', 'configEditor', 'credentials', 'settings', 'llm'\]/)
assert.doesNotMatch(hostSource, /SESSION_SEARCH_ROUTE|ctx\.sessionQuery|sessionSearchSnippet/, '会话搜索只由官方工作区实现')
assert.match(hostSource, /AURASEARCH_LOGO_ROUTE = '\/adminsmart\/assets\/aurasearch-logo\.jpg'/)
assert.match(hostSource, /SESSION_WEB_ACCESS_ROUTE = '\/adminsmart\/sessions\/web-access'/)
assert.match(hostSource, /harnessRequire\.resolve\('@deepseek-ai\/dsh-atomic-write'\)/)
assert.match(hostSource, /ctx\.sessions\.get\(sessionId\)/)
assert.doesNotMatch(hostSource, /ctx\.sessions\.binding/)
assert.doesNotMatch(hostSource, /knowledge\/scope|requestKnowledgeScope/)
assert.match(hostSource, /installFeedbackRoute\(ctx/, '原生管理反馈只通过受限 Host 路由读取')
assert.match(hostSource, /installFeedbackMutationSync\(ctx, feedbackDependencies\)/, '官方反馈事件必须立即增量同步主应用索引')
assert.match(hostSource, /apiBase: requiredEnvironment\('ADMINSMART_AGENT_API_BASE'\)/, '反馈增量只调用当前环境受管 FastAPI 回环根')
assert.match(hostSource, /capabilityTokenPath: requiredEnvironment\('ADMINSMART_AGENT_TOKEN_FILE'\)/, '内部读取必须使用受管能力证明，不能以浏览器 Cookie 代替 admin 授权')
assert.match(hostSource, /class AdminSmartCancelledDirectoryPicker extends DirectoryPicker/)
assert.match(hostSource, /return null \/\/ Every directory request behaves like an operator cancellation/)
assert.match(hostSource, /ensureInternalRuntimeWorkspace\(ctx, runtimeCwd\)/)
assert.match(hostSource, /INTERNAL_RUNTIME_WORKSPACE_TITLE = '知识库工作区'/)
assert.doesNotMatch(hostSource, /FIXED_WORKSPACE_TITLE|WORKSPACE_REPAIR_INTERVAL_MS|sessionFilters: \[{ kind: 'cwd'/)

const temporaryRoot = await mkdtemp(join(tmpdir(), 'adminsmart-session-web-access-')) // 当前测试独占且结束时完整清理的 Runtime 状态根。
const statePath = join(temporaryRoot, '.adminsmart-state', 'session-web-access.json') // 与生产相同的固定文件布局。
const passthroughLock = async (_path, operation) => operation() // 单进程测试替身只验证锁内读改写语义。
const localAtomicWrite = async (path, content) => { await writeFile(path, content, { encoding: 'utf8' }) } // 临时目录内的原子写接口替身。
try {
  const initialState = await readSessionWebAccessState(statePath) // 不存在的状态文件必须按产品默认开启解释。
  assert.deepEqual(initialState, { version: 1, sessions: {} })
  const savedEnabled = await updateSessionWebAccessState({
    statePath, // 当前测试状态文件。
    sessionId: 'session-a', // 当前用户 Runtime 内的一个普通 Session 身份。
    enabled: false, // 用户明确关闭联网。
    withFileLock: passthroughLock, // 与生产签名相同的测试写锁。
    writeFileAtomic: localAtomicWrite, // 与生产签名相同的测试写入器。
  })
  assert.equal(savedEnabled, false)
  const savedState = await readSessionWebAccessState(statePath) // 关闭选择必须持久保留到下一次页面加载。
  assert.equal(savedState.sessions['session-a'].enabled, false)
  await writeFile(statePath, '{broken', 'utf8') // 模拟异常退出留下的不可解析旧状态。
  const repairedEnabled = await updateSessionWebAccessState({
    statePath, // 复用同一损坏状态文件。
    sessionId: 'session-a', // 当前用户仍在操作的原 Session。
    enabled: true, // 明确点击开启应修复状态而不是永久卡死。
    withFileLock: passthroughLock,
    writeFileAtomic: localAtomicWrite,
  })
  assert.equal(repairedEnabled, true)
  assert.equal((await readSessionWebAccessState(statePath)).sessions['session-a'].enabled, true)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

process.stdout.write('host_runtime_contract=ok\n')
