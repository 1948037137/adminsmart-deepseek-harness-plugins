/** 管理员已选官方能力与普通知识边界：真实SDK工具/Agent，执行世界和外网全部合成隔离。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, call, llmModule } from './helpers/native-delegation.mjs'
import { loadRuntimeModule } from '../src/runtime.mjs'
import { KNOWLEDGE_BUNDLES, selectedKnowledgeToolNames } from '../src/plugin-capabilities.mjs'

/** @param {object} f 当前真实SDK Fixture。 @param {string[]} initial Host已实际采用的初始选择。 @returns {Function} 更新Host只读服务并同步通知，模拟SDK applied之后的发布。 */
function liveCapabilities(f, initial = []) {
  let selectedBundles = [...initial] // 只由测试Host控制，不来自模型参数。
  const listeners = new Set() // 官方Context拥有的订阅回调，Fixture结束后整体释放。
  f.context.provide('adminsmartPluginCapabilities', {
    getSnapshot: () => ({ isAdmin: process.env.ADMINSMART_AGENT_IS_ADMIN === '1', selectedBundles: [...selectedBundles] }), // 可信角色与真正采用选择同源。
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }, // 不把此face注册为Remote。
  })
  return async value => { selectedBundles = [...value]; for (const listener of listeners) listener(); await new Promise(resolve => setImmediate(resolve)) }
}

test('管理员持久终端及Jobs只在已选且真实注册时执行，live撤销后立即拒绝', { timeout: 10000 }, async t => {
  const f = await fixture(t, { isAdmin: true }) // 未选时即使原官方工具已注册也不能执行。
  let reads = 0 // Fake终端backend只记录真实工具body抵达次数，不创建交互进程。
  f.context.provide('terminals', { list(agent) { assert.ok(f.context.agents.get(agent.id) === agent); reads += 1; return [] } }) // 原工具继续传可信live Agent归属。
  const terminal = await f.context.plugin(await loadRuntimeModule('@deepseek-ai/dsh-tool-terminal')) // 六个工具及Schema使用实际发行实现。
  const jobs = await f.context.plugin((await loadRuntimeModule('@deepseek-ai/dsh-jobs-local')).default) // 真实本进程Jobs owner隔离，未启动任何任务。
  const jobTools = await f.context.plugin(await loadRuntimeModule('@deepseek-ai/dsh-tool-jobs'), { completionDelivery: 'quiet' }) // 正式job_output/list/kill注册，避免测试通知启动额外回合。
  t.after(async () => { await jobTools.dispose(); await jobs.dispose(); await terminal.dispose() })
  const update = liveCapabilities(f) // liveface优先于任何冷启环境选择。
  const parent = await f.parent()
  assert.equal((await f.execute(parent, 'terminal_list')).isError, true)
  assert.equal(reads, 0)
  await update([KNOWLEDGE_BUNDLES.terminal])
  assert.equal((await f.execute(parent, 'terminal_list')).isError, false)
  assert.equal(reads, 1)
  assert.equal((await f.execute(parent, 'job_list')).isError, false)
  const selected = selectedKnowledgeToolNames(f.context) // 精确3个Jobs身份，不允许任意后台工具前缀。
  for (const name of ['job_output', 'job_list', 'job_kill']) assert.equal(selected.has(name), true)
  let bypassed = false // 即使管理员也不能通过未知工具名绕过固定能力集合。
  parent.ctx.tools.register({ name: 'terminal_unapproved', description: 'synthetic unknown', parameters: {}, output: { schema: { type: 'boolean' }, render: () => [] }, execute: async () => { bypassed = true; return true } })
  assert.equal((await f.execute(parent, 'terminal_unapproved')).isError, true)
  assert.equal(bypassed, false)
  await update([])
  assert.equal((await f.execute(parent, 'terminal_list')).isError, true)
  assert.equal(reads, 1)
})

test('普通用户即使错误列出管理员Bundle也不获得终端或Jobs权限', { timeout: 10000 }, async t => {
  const f = await fixture(t, { isAdmin: false, selectedBundles: [KNOWLEDGE_BUNDLES.terminal, KNOWLEDGE_BUNDLES.team, KNOWLEDGE_BUNDLES.ralph, KNOWLEDGE_BUNDLES.worktree] }) // 角色事实优先，错误共享选择不能升权。
  f.context.provide('terminals', { list() { assert.fail('普通用户不得抵达终端body') } })
  const terminal = await f.context.plugin(await loadRuntimeModule('@deepseek-ai/dsh-tool-terminal')) // 让真实工具存在，拒绝不能只是没有注册。
  t.after(() => terminal.dispose())
  const parent = await f.parent()
  assert.equal((await f.execute(parent, 'terminal_list')).isError, true)
  assert.equal(selectedKnowledgeToolNames(f.context).size, 0)
  assert.ok(f.context.tools.get('subagent', parent), '普通知识模式保留原单层委派')
})

test('管理员Team使用原团队工具与真实成员，局部legacy subagent撤回且子成员保持单层', { timeout: 10000 }, async t => {
  const f = await fixture(t, { isAdmin: true, selectedBundles: [KNOWLEDGE_BUNDLES.team] }) // Team选择来自可信Host，不从工具参数决定。
  const update = liveCapabilities(f, [KNOWLEDGE_BUNDLES.team]) // 后续撤销必须释放Team准入并恢复唯一普通委派。
  const domain = await f.context.plugin((await loadRuntimeModule('@deepseek-ai/dsh-experimental-agent-team')).default, { maxMembers: 2 }) // 原官方roster、Session事件和生命周期。
  const tools = await f.context.plugin(await loadRuntimeModule('@deepseek-ai/dsh-experimental-tool-agent-team'), { freshProvider: 'spawn', forkProvider: 'fork', interrupt: true }) // 原Team工具自己处理成员与Lead权限。
  t.after(async () => { await tools.dispose(); await domain.dispose() })
  const parent = await f.parent()
  assert.equal(f.context.tools.get('subagent', parent), undefined)
  assert.equal((await f.execute(parent, 'list_agents')).isError, false)
  const steps = new Map() // 子模型只运行一个团队只读查询，再给出合成完成文字。
  f.state.reply = async (options, child) => {
    assert.equal(child.session.header.delegationDepth, 1)
    assert.equal(f.context.agentPresets.composedPreset(child.ctx), f.context.agentPresets.composedPreset(parent.ctx))
    assert.equal(options.model, parent.options.model)
    assert.equal((await f.execute(child, 'spawn_teammate', { name: 'grandchild', description: 'forbidden', prompt: 'synthetic' })).isError, true)
    const step = (steps.get(child.id) ?? 0) + 1 // 同一真实Child最多发一次工具调用。
    steps.set(child.id, step)
    return step === 1 ? [call('team_task_list', {}, 'synthetic-team-list')] : [{ type: 'text', text: 'synthetic team complete' }]
  }
  const result = await f.execute(parent, 'spawn_teammate', { name: 'helper', description: 'synthetic helper', prompt: 'only current authorized scope', context: 'fresh' })
  assert.equal(result.isError, false, JSON.stringify(result))
  await f.settle(parent)
  assert.ok(f.outcomes.some(row => row.execution.name === 'team_task_list' && !row.result.isError))
  assert.ok(f.outcomes.some(row => row.execution.name === 'spawn_teammate' && row.execution.agent !== parent && row.result.isError))
  await update([])
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(f.context.tools.get('subagent', parent), 'Team撤销后官方普通委派在同scope恢复')
  assert.equal((await f.execute(parent, 'list_agents')).isError, true)
})

test('管理员已选Ralph的官方入口抵达Workflow，真实trusted Child可提交结构化结果', { timeout: 10000 }, async t => {
  const f = await fixture(t, { isAdmin: true, selectedBundles: [KNOWLEDGE_BUNDLES.ralph] }) // 只开放固定ralph及其真实子输出，不开放任意run_code。
  let workflows = 0 // Workflow执行世界Fake，工具协议和子Agent仍为实际官方实现。
  f.context.provide('workflowEngine', { start(request) {
    assert.equal(request.subagentProvider, 'spawn')
    assert.ok(f.context.agents.get(request.parent.id) === request.parent)
    workflows += 1
    return { id: 'synthetic-ralph-run', result: Promise.resolve({ stopReason: 'completed', agentsStarted: 1, value: { status: 'complete', roundsStarted: 1, report: { status: 'complete', summary: 'synthetic done', evidence: ['synthetic test'], nextSteps: [], blocker: '' } } }), cancel() {}, dispose: async () => {} }
  } })
  const tool = await f.context.plugin(await loadRuntimeModule('@deepseek-ai/dsh-tool-ralph'), { subagentProvider: 'spawn', maxRounds: 2 }) // 原始工具验证固定脚本结果，不实现编排替身。
  t.after(() => tool.dispose())
  const parent = await f.parent()
  assert.equal((await f.execute(parent, 'ralph', { objective: 'synthetic explicit iteration', maxRounds: 1 })).isError, false)
  assert.equal(workflows, 1)
  f.state.reply = async (options, child) => {
    assert.equal(options.model, parent.options.model)
    assert.equal(child.session.header.delegationDepth, 1)
    assert.equal((await f.execute(child, 'ralph', { objective: 'forbidden recursive loop' })).isError, true)
    return [call('structured_output', { answer: 'synthetic structured result' }, 'synthetic-output')]
  }
  const run = await f.context.subagents.startActivation({ provider: 'spawn', label: 'synthetic Ralph child', delivery: 'caller', signal: new AbortController().signal, request: { parent, prompt: [{ type: 'text', text: 'synthetic structured scope' }], maxDepth: 1, outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } } }) // 公开官方结构化Child API。
  try { assert.equal((await run.result).stopReason, 'completed') } finally { await run.dispose() }
  assert.ok(f.outcomes.some(row => row.execution.name === 'structured_output' && !row.result.isError))
  assert.equal(f.context.tools.get('structured_output', parent), undefined)
})

test('共享会话搜索使用真实当前Runtime SessionStore，普通用户不能从参数选择外部存储', { timeout: 10000 }, async t => {
  const f = await fixture(t, { selectedBundles: [KNOWLEDGE_BUNDLES.sessionSearch] }) // 普通角色可共享只读Session查询，但仍只有当前Runtime的合成存储。
  const query = await f.context.plugin((await loadRuntimeModule('@deepseek-ai/dsh-session-query-sqlite')).default, { path: ':memory:', openAt: 'first-search' }) // 真实SQLite只索引当前Session/Persistence服务。
  const tools = await f.context.plugin(await loadRuntimeModule('@deepseek-ai/dsh-tool-session-query'), { maxSearchResults: 5 }) // 五工具使用官方Schema与cwd范围检查。
  t.after(async () => { await tools.dispose(); await query.dispose() })
  const prior = await f.parent('synthetic-prior-self-session')
  prior.followup(llmModule.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'SYNTHETIC_SCOPE_RECORD unique history' }] }))
  await prior.whenIdle()
  const current = await f.parent('synthetic-current-self-session')
  const result = await f.execute(current, 'session_search', { query: 'SYNTHETIC_SCOPE_RECORD' })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.match(result.value, /synthetic-prior-self-session|SYNTHETIC_SCOPE_RECORD/u)
  const forced = await f.execute(current, 'session_search', { query: 'SYNTHETIC_SCOPE_RECORD', storageRoot: 'foreign-runtime', userId: 'other-user' }) // 未声明参数不能改变官方查询绑定；部分SDK会忽略额外字段。
  assert.equal(forced.isError, false)
  assert.match(forced.value, /synthetic-prior-self-session|SYNTHETIC_SCOPE_RECORD/u) // 即便附带外部身份/根声明，实际结果仍来自本Runtime自建会话。
})

test('管理员已选Worktree通过实际官方Tool，来源不明时在body前拒绝且不初始化仓库', { timeout: 10000 }, async t => {
  const f = await fixture(t, { isAdmin: true, selectedBundles: [KNOWLEDGE_BUNDLES.worktree] }) // 真实已选角色能力，Git执行世界仍为Fake。
  let creates = 0 // 只证明官方Tool最终调用了受管Worktree服务，不执行真实Git。
  f.context.provide('worktrees', { async create(agent) {
    assert.ok(f.context.agents.get(agent.id) === agent)
    creates += 1
    return { path: join(f.home, '.agents/worktrees/synthetic'), branch: 'synthetic', baseCommit: 'a'.repeat(40), repositoryRoot: f.home }
  } })
  const tools = await f.context.plugin(await loadRuntimeModule('@deepseek-ai/dsh-experimental-tool-worktree')) // Schema、execute与输出均为原官方实现。
  t.after(() => tools.dispose())
  const parent = await f.parent()
  const missing = await f.execute(parent, 'create_worktree', { name: 'synthetic' }) // 未建仓库时不能沿业务根外祖先寻找Git。
  assert.equal(missing.isError, true)
  assert.match(missing.error.message, /没有可用Git仓库/u)
  assert.equal(creates, 0)
  await mkdir(join(f.home, '.git')) // 仅合成标记，不初始化或连接真实仓库。
  assert.equal((await f.execute(parent, 'create_worktree', { name: 'synthetic' })).isError, false)
  assert.equal(creates, 1)
})
