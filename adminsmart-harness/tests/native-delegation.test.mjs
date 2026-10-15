/** 经官方 Tool execute 与真实 in-process Agent Loop 验证只读委派，不访问模型、网络或用户数据。 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fixture, call, cancellable, llmModule, sessionModule, subagentModule } from './helpers/native-delegation.mjs'
import { READONLY_CHILD_TOOL_NAMES, trustedDelegationParent } from '../src/knowledge-delegation.mjs'
import { sessionFiles } from '../src/session-files.mjs'

test('official activation Tool returns child identity before completion, preserves parent model and denies unauthorized parameters', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 真正的官方服务图，任何意外 HTTP 均失败。
  const parent = await f.parent() // 官方知识 Preset 根 Agent。
  const native = f.context.tools.get('subagent', parent) // 聚合入口实际注册的官方 Tool 定义。
  assert.deepEqual(Object.keys(native.parameters.properties).sort(), ['cwd', 'description', 'prompt'])
  assert.equal(f.context.tools.executionMode({ name: 'subagent', arguments: { description: 'fixture', prompt: 'fixture' }, agent: parent }).kind, 'parallel')
  let child // 只保留合成子对象做生命周期终态断言。
  f.state.reply = async (options, agent) => {
    child = agent
    assert.equal(agent.session.header.origin, 'subagent')
    assert.equal(agent.session.header.parentSession, parent.session.id)
    assert.equal(agent.session.header.delegationDepth, 1)
    assert.equal(f.context.agentPresets.composedPreset(agent.ctx), 'adminsmart-knowledge')
    assert.equal(trustedDelegationParent(f.context, agent), parent)
    assert.equal(options.provider, parent.options.provider)
    assert.equal(options.model, parent.options.model)
    assert.ok(f.context.tools.schemas(agent).every(tool => READONLY_CHILD_TOOL_NAMES.includes(tool.name)))
    return [{ type: 'text', text: 'synthetic result' }]
  }
  const result = await f.execute(parent, 'subagent', { description: 'fixture task', prompt: 'only synthetic input', cwd: '.' }) // 官方目录参数只能继承父当前目录。
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(result.value.kind, 'activation', '工具只返回启动回执，不能伪造最终答案')
  assert.equal(typeof result.value.subagentId, 'string')
  assert.doesNotMatch(JSON.stringify(result), /synthetic result/)
  await f.settle(parent)
  assert.deepEqual(f.context.agents.list(), [parent])
  assert.equal(f.context.sessions.get(child.id), undefined)
  assert.equal(f.ended.length, 1)
  assert.equal(f.ended[0].stopReason, 'completed')
  assert.equal(f.notifications.length, 1, '官方完成通知必须真正进入父模型')
  assert.match(JSON.stringify(f.notifications[0].settlementMessage), /synthetic result/)
  const preCancelled = new AbortController() // 预取消也不能创建任何子请求。
  preCancelled.abort()
  assert.equal((await f.execute(parent, 'subagent', { description: 'fixture', prompt: 'fixture' }, preCancelled.signal)).isError, true)
  for (const invalid of [{ provider: 'other', model: 'other' }, { reasoning_effort: 'high' }, { agent_preset: 'foreign-preset' }, { run_in_background: true }, { parentSession: 'foreign' }, { sessionId: 'foreign' }, { cwd: '..' }]) {
    assert.equal((await f.execute(parent, 'subagent', { description: 'fixture', prompt: 'fixture', ...invalid })).isError, true, `forced fields: ${JSON.stringify(invalid)}`)
  }
  const execution = { agent: parent, signal: new AbortController().signal } // 直接执行定义检查官方运行时二次拒绝，不只依赖 Schema。
  await assert.rejects(native.execute({ description: 'fixture', prompt: 'fixture', provider: 'other', model: 'other' }, execution), /model selection is disabled/)
  assert.equal(f.requests.length, 1, '无效参数不得创建子模型请求')
})

test('the child inherits the latest effective parent request route rather than stale creation options', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 使用官方 request waterfall 和真实 request/header，不伪造日志字段。
  const parent = await f.parent() // 创建模型固定为 fixture-model。
  parent.ctx.on('agent/request', async (_payload, next) => ({ ...await next(), model: 'fixture-selected-model' })) // 模拟受管模型选择在父请求前更新路线。
  parent.followup(llmModule.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'synthetic parent route selection' }] })) // 合成真实用户来源，不能省略官方必需的source。
  await parent.whenIdle()
  assert.equal(parent.options.model, 'fixture-model')
  assert.equal(parent.session.requestHeader().config.model, 'fixture-selected-model')
  f.state.reply = async (options, child) => {
    assert.equal(options.model, 'fixture-selected-model')
    assert.equal(child.options.model, 'fixture-selected-model')
    return [{ type: 'text', text: 'fixture latest route inherited' }]
  }
  assert.equal((await f.execute(parent, 'subagent', { description: 'route fixture', prompt: 'only synthetic route' })).isError, false)
  await f.settle(parent)
})

test('官方省略子Preset选择继承父当前live组合，过期header不能换回默认Preset', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 两个可信定义使用同一业务实现与Fake模型，只验证当前live组合身份。
  const parent = await f.parent() // 初始绑定adminsmart-knowledge。
  const selectedPreset = 'fixture-current-knowledge' // 本测试真实注册的替代业务定义，不来自模型参数。
  const wrapperPath = join(f.home, 'fixture-delegation-plugin.mjs') // 仅测试临时插件，给内部业务模块声明其真实公开依赖。
  await writeFile(wrapperPath, `export { apply } from ${JSON.stringify(new URL('../src/knowledge-delegation.mjs', import.meta.url).href)};\nexport const inject = ['tools', 'subagents', 'systemPrompt', 'sessionProjections', 'agents', 'sessions', 'agentPresets'];\n`, 'utf8') // 不复制工具实现，不修改正式业务入口或第三方。
  const dispose = await f.context.agentPresets.register({
    id: selectedPreset, // 只由当前可信测试注册，不通过模型agent_preset输入选择。
    name: 'synthetic selected knowledge', // 本用例展示元数据。
    plugins: [{ id: 'delegation', name: pathToFileURL(wrapperPath).href }], // 复用真实业务委派模块；避免第二组Web Provider定义改变无关服务所有权。
  }) // 使用官方公开定义入口，子Agent必须继承这一live revision。
  t.after(dispose)
  await f.context.agentPresets.recompose(parent.ctx, selectedPreset) // 官方当前组合更新，不手写Session持久header。
  assert.equal(f.context.agentPresets.composedPreset(parent.ctx), selectedPreset)
  assert.equal(f.context.tools.get('subagent', parent).parameters.properties.agent_preset, undefined) // 业务未开放新模型可选Preset参数。
  f.state.reply = async (options, child) => {
    assert.equal(f.context.agentPresets.composedPreset(child.ctx), selectedPreset)
    assert.equal(child.session.header.agentPreset, selectedPreset)
    assert.equal(trustedDelegationParent(f.context, child), parent)
    assert.equal(options.model, parent.options.model)
    assert.equal(child.session.header.delegationDepth, 1)
    return [{ type: 'text', text: 'synthetic live preset inherited' }]
  }
  assert.equal((await f.execute(parent, 'subagent', { description: 'current preset fixture', prompt: 'only synthetic input' })).isError, false)
  await f.settle(parent)
  assert.equal(f.requests.length, 1)
})

test('真实父Agent没有Preset时不能由子默认知识组合伪造可信继承', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 官方registry仍使用知识默认，但本父Agent没有进行任何preset mount。
  const handle = await f.context.agents.create({ sessionId: sessionModule.SessionId('fixture-preset-free-parent'), agentOptions: { provider: 'fixture', model: 'fixture-model' } }) // 真实live所有权，未绑定组合。
  t.after(() => handle.dispose())
  const parent = handle.agent // 无Preset不能成为知识附件/联网授权父。
  assert.equal(f.context.agentPresets.composedPreset(parent.ctx), undefined)
  await assert.rejects(f.context.agents.create({
    sessionId: sessionModule.SessionId('fixture-rejected-default-child'), // 本用例唯一合成子身份。
    parentAgent: parent, // 所有权虽真实，缺少同业务Preset仍必须拒绝。
    meta: { origin: 'subagent', parentSession: parent.id, delegationDepth: 1 }, // 正确一层父身份不能补造缺失Preset。
    setup: childCtx => f.context.agentPresets.mount(childCtx, 'adminsmart-knowledge').then(() => undefined), // 故意把默认业务挂到子上，必须被同组合校验否定；setup不返回无关Preset元数据。
  }), /可信父会话不可用/u)
  assert.equal(f.context.agents.get('fixture-rejected-default-child'), undefined)
  assert.equal(f.context.sessions.get('fixture-rejected-default-child'), undefined)
  assert.equal(f.requests.length, 0)
})

test('官方异步委派初始化失败由Preset接收并有界释放，没有未处理Promise或可执行残留', { timeout: 10000 }, async t => {
  const unhandled = [] // 只观察当前合成错误，不输出真实环境或用户正文。
  const observe = reason => unhandled.push(reason) // 捕获旧同步聚合遗漏的Promise拒绝。
  process.on('unhandledRejection', observe)
  t.after(() => process.off('unhandledRejection', observe))
  const f = await fixture(t, { spawnDepthLimit: false }) // 正式官方Tool拒绝无depthLimit的Provider，Fake不调用模型。
  await assert.rejects(f.parent(), /cannot enforce maxDepth|depthLimit|did not activate|未能激活|not usable/u) // actualLoader/Preset失败，而不是测试自行抛出的假错误。
  assert.equal(f.context.agents.list().length, 0)
  assert.equal(f.context.sessions.list().length, 0)
  assert.equal(f.requests.length, 0)
  await f.context.fiber.dispose() // 已失败的业务fiber及原SDK存储全部释放；Node测试timeout作为清理有界门。
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(unhandled, [])
})

test('hidden, late-registered or recursive tools cannot bypass the inherited guard or official maxDepth', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 真实工具可见性与执行双边界，不能只检查模型工具列表。
  const parent = await f.parent() // 本任务唯一授权的根 Agent。
  let unauthorizedExecutions = 0 // 任何越权工具 body 都不应被执行。
  f.state.reply = async (_options, child) => {
    child.ctx.tools.register({
      name: 'late_unsafe_tool', // 子本地注册不受继承过滤器约束，必须仍被单调 guard 拒绝。
      description: 'synthetic unsafe fixture', // 固定 Fixture，不包含真实命令。
      parameters: { type: 'object', properties: {}, additionalProperties: false }, // 没有路径、网络或代码参数。
      output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: 'fixture' }] }, // 仅合成返回值。
      execute: async () => { unauthorizedExecutions += 1; return true }, // 计数用于证明 body 从未被调用。
    })
    for (const name of ['subagent', 'fork', 'send_message', 'job_output', 'job_kill', 'bash', 'run_code', 'read_file', 'write_file', 'late_unsafe_tool']) {
      assert.equal((await f.execute(child, name, {})).isError, true, name)
    }
    await assert.rejects(f.context.subagents.startActivation({
      provider: 'spawn', // 与正式插件一致的官方同进程provider。
      label: 'recursive fixture', // 仅合成任务标签。
      request: {
        parent: child, // 可信API也不得绕过官方持久深度上限。
        prompt: [{ type: 'text', text: 'forbidden recursive fixture' }], // 只用合成文本。
        maxDepth: 1, // 计算后的第二层在发布child前拒绝。
      },
      signal: new AbortController().signal, // 官方激活接收前取消通道。
      delivery: 'caller', // 测试不会向父投递递归任务结果。
    }), error => error instanceof subagentModule.SubagentDepthError && error.attemptedDepth === 2)
    const liftLiveRestriction = parent.ctx.tools.restrict({ deny: ['search_knowledge'] }) // 子已创建后再收窄父工具可见性。
    try {
      assert.equal((await f.execute(child, 'search_knowledge', { query: 'fixture', highLevelKeywords: ['fixture'], lowLevelKeywords: ['fixture'] })).isError, true)
      assert.equal(f.counts.api, 0, '父能力撤销后不能到达 FastAPI Fake')
    } finally { liftLiveRestriction() }
    return [{ type: 'text', text: 'fixture stayed readonly' }]
  }
  assert.equal((await f.execute(parent, 'subagent', { description: 'guard fixture', prompt: 'verify only synthetic permissions' })).isError, false)
  await f.settle(parent)
  assert.equal(unauthorizedExecutions, 0)
  assert.deepEqual(f.context.agents.list(), [parent])
  assert.equal(f.requests.length, 1)
})

test('a child knowledge API call keeps trusted user, mode, preset, token and fixed payload despite model-supplied identity', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 真实业务 Tool + 完全离线 FastAPI Fake。
  const parent = await f.parent() // 身份来自本测试 Runtime 的受管环境。
  let childId // 审计 Session 应为真实子身份，而非模型填入的 ID。
  globalThis.fetch = async (url, options) => {
    f.counts.api += 1
    assert.equal(url, 'http://127.0.0.1:19099/internal/agent-tools/knowledge/search')
    assert.equal(options.headers['X-AdminSmart-User-Id'], '42')
    assert.equal(options.headers['X-AdminSmart-Agent-Mode-Id'], 'knowledge')
    assert.equal(options.headers['X-AdminSmart-Agent-Preset-Id'], 'adminsmart-knowledge')
    assert.equal(options.headers['X-AdminSmart-Agent-Token'], 'fixture-capability-token')
    assert.equal(options.headers['X-AdminSmart-Session-Id'], childId)
    assert.deepEqual(JSON.parse(options.body), { question: 'synthetic knowledge question', queries: ['synthetic knowledge question'], highLevelKeywords: ['fixture topic'], lowLevelKeywords: ['fixture entity'], includeSourceAssets: true })
    return new Response(JSON.stringify({ code: 200, data: {
      question: 'synthetic knowledge question', // 合成查询，不读取任何真实知识。
      scope: 'focused', // 后端已确认的固定相关性范围。
      queries: ['synthetic knowledge question'], // 官方检索语义。
      knowledgeFound: false, // 空 Fixture 证据，不暗示真实业务数据不存在。
      evidence: [], // 无用户数据。
      sourceCount: 0, // 固定合成计数。
      chunkCount: 0, // 固定合成计数。
      totalCandidateCount: 0, // 固定合成候选数。
      tokenBudget: 100, // 有界响应口径。
      usedTokens: 0, // 无正文预算。
      truncated: false, // 合成响应未截断。
      completeCoverage: false, // 相关性检索不冒充完整清单。
      answerBoundary: 'synthetic evidence only', // 测试结果边界。
    } }), { status: 200 })
  }
  f.state.reply = async (_options, child) => {
    childId = child.id
    const result = await f.execute(child, 'search_knowledge', {
      query: 'synthetic knowledge question', // 用户目标仅为固定合成问题。
      highLevelKeywords: ['fixture topic'], // 固定主题提示。
      lowLevelKeywords: ['fixture entity'], // 固定实体提示。
      userId: '99', // 尝试在参数中伪造另一个用户，业务 Tool 必须完全忽略它。
      sessionId: 'foreign-session', // 不能改变可信审计会话，更不能授权附件。
    })
    assert.equal(result.isError, false, JSON.stringify(result))
    return [{ type: 'text', text: 'fixture API kept trusted identity' }]
  }
  assert.equal((await f.execute(parent, 'subagent', { description: 'identity fixture', prompt: 'only synthetic query' })).isError, false)
  await f.settle(parent)
  assert.equal(f.counts.api, 1, JSON.stringify({ errors: f.errors.map(error => error.message), outcomes: f.outcomes.map(row => ({ name: row.execution.name, error: row.result.error })) }))
})

test('structured_output stays fail-closed: the native activation Tool does not expose outputSchema or auto-authorize another tool', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 直接调用官方有 outputSchema 的 API 仅用于验证禁用边界。
  const parent = await f.parent() // 模型仍只有原生 description/prompt 输入。
  const steps = new Map() // 官方结构化子运行必须以工具成功终态为结果，文字自述不算。
  f.state.reply = async (_options, child) => {
    const step = (steps.get(child.id) ?? 0) + 1 // 合成子步骤。
    steps.set(child.id, step)
    return step === 1 ? [call('structured_output', { answer: 'fixture' })] : [{ type: 'text', text: 'fixture not a structured completion' }]
  }
  const run = await f.context.subagents.startActivation({
    provider: 'spawn', // 使用真正的官方新激活入口。
    label: 'structured fixture', // 本测试的非敏感catalog标签。
    request: {
      parent, // 可信主Agent；API不暴露给模型。
      prompt: [{ type: 'text', text: 'synthetic structured fixture' }], // 无真实知识或敏感信息。
      maxDepth: 1, // 保留一层限制。
      outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false }, // 不进入正式委派配置的可信测试Schema。
    },
    signal: new AbortController().signal, // 只负责官方接收前取消。
    delivery: 'caller', // 真实官方result供测试观察，不模拟父通知。
  })
  try { assert.equal((await run.result).stopReason, 'error') } finally { await run.dispose() }
  assert.ok(f.outcomes.some(({ execution, result }) => execution.name === 'structured_output' && result.isError))
  assert.equal(f.context.tools.get('structured_output', parent), undefined)
  assert.deepEqual(f.context.agents.list(), [parent])
})

test('two independent native calls in one assistant message really overlap and settle separately', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 官方 Agent Loop 调度，不用 Promise.all 冒充同消息并行。
  const parent = await f.parent() // 模拟真实父回合，模型仅为确定性 Fake。
  let releaseChildren // 两个 child 都实际进入 Fake 流后才释放门闩。
  const bothEntered = new Promise(resolve => { releaseChildren = resolve }) // 串行调度无法通过这个门闩。
  const children = new Map() // 子身份与独立输入，用于检查没有复用一个会话。
  let parentSteps = 0 // 父 Fake 只发一次两个 calls，下一步给最终答案。
  f.state.reply = async (options, agent) => {
    if (agent === parent) {
      parentSteps += 1
      return parentSteps === 1 ? [
        call('subagent', { description: 'fixture A', prompt: 'independent A' }, 'delegation-a'),
        call('subagent', { description: 'fixture B', prompt: 'independent B' }, 'delegation-b'),
      ] : [{ type: 'text', text: 'fixture parent summary' }]
    }
    children.set(agent.id, options.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).join('\n'))
    if (children.size === 2) releaseChildren()
    await cancellable(bothEntered, options.signal)
    return [{ type: 'text', text: `fixture child ${agent.id}` }]
  }
  parent.followup(llmModule.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'two independent fixture tasks' }] })) // 真实官方用户消息使两次工具调用进入同一父回合。
  await parent.whenIdle()
  await f.settle(parent)
  assert.equal(children.size, 2)
  assert.ok([...children.values()].some(text => text.includes('independent A')))
  assert.ok([...children.values()].some(text => text.includes('independent B')))
  const delegations = f.outcomes.filter(({ execution }) => execution.name === 'subagent') // 官方实际执行结果，不读取父模型声称的完成数。
  assert.equal(delegations.length, 2)
  assert.ok(delegations.every(({ result }) => !result.isError))
  assert.equal(f.ended.length, 2)
  assert.ok(f.ended.every(event => event.stopReason === 'completed'))
  assert.deepEqual(f.context.agents.list(), [parent])
})

test('accepted activation outlives startup cancellation and official scoped drain releases its Session authorization', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 接收前取消、接收后托管与定向清理由真实官方manager负责。
  const parent = await f.parent() // 唯一根会话。
  const cancellation = new AbortController() // 官方只在激活接收前使用的工具取消信号。
  let notifyEntered // 确认不是只测试预取消。
  const entered = new Promise(resolve => { notifyEntered = resolve }) // child 已进入模型流的事实门闩。
  let child // 清理之后必须不能继续继承父文件。
  f.state.reply = async (options, agent) => {
    child = agent
    notifyEntered()
    await cancellable(new Promise(() => {}), options.signal)
    return []
  }
  const result = await f.execute(parent, 'subagent', { description: 'cancel fixture', prompt: 'wait for cancellation' }, cancellation.signal) // 官方工具即时回执，不等待子模型结束。
  assert.equal(result.isError, false)
  assert.equal(result.value.kind, 'activation')
  await entered
  cancellation.abort(new Error('fixture parent cancelled'))
  assert.equal(f.context.agents.get(child.id), child, '已接收激活由官方manager拥有，不能误称工具signal仍拥有执行')
  await f.context.subagents.drainChildren(parent, [result.value.subagentId])
  await f.settle(parent)
  assert.deepEqual(f.context.agents.list(), [parent])
  assert.equal(f.context.sessions.get(child.id), undefined)
  assert.throws(() => sessionFiles(child.session), /可信父会话不可用/)
  assert.equal(f.ended[0].stopReason, 'aborted')
  f.state.reply = async () => [{ type: 'text', text: 'fixture after cancellation' }]
  assert.equal((await f.execute(parent, 'subagent', { description: 'next fixture', prompt: 'next task' })).isError, false)
  await f.settle(parent)
})

test('official child failure cannot become successful text and is followed by complete disposal', { timeout: 10000 }, async t => {
  const f = await fixture(t) // Fake 模型给出官方 error finish，不能把普通文字当作失败状态。
  const parent = await f.parent() // 错误只影响本次委派。
  f.state.reply = async () => ({
    blocks: [{ type: 'text', text: 'synthetic partial result' }], // 即使错误流含合成正文，也不能冒充成功。
    reason: { kind: 'error', failure: { code: 'FIXTURE_FAILURE', message: 'synthetic child failure' } }, // 无内部路径或秘密的官方失败协议。
  })
  const result = await f.execute(parent, 'subagent', { description: 'error fixture', prompt: 'fail deterministically' }) // 工具成功启动与随后子模型失败是两个独立终态。
  assert.equal(result.isError, false)
  assert.equal(result.value.kind, 'activation')
  await f.settle(parent)
  assert.equal(f.ended[0].stopReason, 'error')
  assert.equal(f.notifications.length, 1)
  assert.match(f.notifications[0].settlementMessage.source.summary, /failed before it finished/, '父模型收到官方失败通知，不能把启动成功当成子任务成功')
  assert.deepEqual(f.context.agents.list(), [parent])
})

test('official child Web tools ignore retired Session preferences and preserve trusted lineage', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 真实官方子运行只访问计数Fake，不访问任何外部站点。
  const parent = await f.parent() // 当前可信live父Agent拥有知识Preset与原生Web能力。
  const legacyDirectory = join(f.home, '.adminsmart-state') // 仅为退役偏好回归而生成的合成历史目录。
  const legacyPath = join(legacyDirectory, 'session-web-access.json') // 运行代码不再读取该路径，文件无需迁移或删除。
  const legacyContent = JSON.stringify({ version: 1, sessions: { [parent.id]: { enabled: false } } }) // 模拟旧版会话明确关闭联网。
  await mkdir(legacyDirectory, { recursive: true })
  await writeFile(legacyPath, legacyContent)
  const steps = new Map() // 每个合成子Agent仅发一组原生工具调用，避免模型循环影响断言。
  f.state.reply = async (options, agent) => {
    const step = (steps.get(agent.id) ?? 0) + 1 // 只计当前测试子Agent的请求步骤。
    steps.set(agent.id, step)
    const prompt = options.messages.filter(message => message.role === 'system').flatMap(message => message.content).map(block => block.text ?? '').join('\n') // 检查真正模型请求中的业务指引。
    assert.equal(trustedDelegationParent(f.context, agent), parent)
    assert.doesNotMatch(prompt, /联网开关|已关闭联网|开启联网/)
    if (step !== 1) return [{ type: 'text', text: 'fixture public tools complete' }]
    return [
      call('web_search', { queries: ['public fixture'] }, 'child-search'),
      call('web_fetch', { url: 'https://example.test/fixture' }, 'child-fetch'),
    ]
  }
  assert.equal((await f.execute(parent, 'subagent', { description: 'public fixture', prompt: 'read only public fixture evidence' })).isError, false)
  await f.settle(parent)
  const webOutcomes = f.outcomes.filter(({ execution }) => ['web_search', 'web_fetch'].includes(execution.name)) // 只依据官方工具实际终态与FakeProvider到达计数。
  assert.equal(webOutcomes.length, 2)
  assert.ok(webOutcomes.every(({ result }) => !result.isError), JSON.stringify(webOutcomes.map(row => row.result)))
  assert.deepEqual(f.counts, { search: 1, fetch: 1, api: 0 })
  assert.equal(await readFile(legacyPath, 'utf8'), legacyContent, '能力退役不得改写或删除历史数据')
})

test('native child reads only direct-parent attachments, excludes strangers and intersects parent Tool restrictions', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 合成文件通过官方 AttachmentStore，而非手写服务器路径。
  const parent = await f.parent() // 当前附件归属的主 Session。
  const foreign = await f.parent('foreign-root') // 相同 Runtime 内另一合法但不相关的会话。
  const reference = await f.context.attachments.saveFile({ name: 'own-fixture.txt', data: Buffer.from('synthetic parent document') }) // 只由测试生成的原生文件身份。
  const workbook = await f.context.attachments.saveFile({ name: 'own-fixture.xlsx', data: Buffer.from('synthetic list-only workbook') }) // 本测试只验证文件清单，不把未解析的内容冒充工作簿数据。
  const stranger = await f.context.attachments.saveFile({ name: 'foreign-fixture.txt', data: Buffer.from('synthetic foreign document') }) // 不得因存储共享而获得读取权限。
  parent.followup(llmModule.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: reference }, { type: 'file', attachment: workbook }] })) // 当前父的合成附件归属。
  foreign.followup(llmModule.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: stranger }] })) // 另一会话的合成附件不得继承。
  await parent.whenIdle()
  await foreign.whenIdle()
  const liftRestriction = parent.ctx.tools.restrict({ deny: ['lookup_business_registry'] }) // 父 Agent 个体限制不在 standing Preset 中，子代理仍必须继承交集。
  t.after(liftRestriction)
  let child // 官方激活真正结束后必须释放子权限，启动回执不冒充清理完成。
  f.state.reply = async (_options, agent) => {
    child = agent
    assert.deepEqual([...sessionFiles(agent.session).values()].map(file => file.name), ['own-fixture.txt', 'own-fixture.xlsx'])
    assert.equal(f.context.tools.get('lookup_business_registry', agent), undefined)
    assert.equal([...sessionFiles(agent.session).values()].some(file => file.attachmentId === stranger.attachmentId), false)
    assert.equal(f.context.tools.get('read_chat_file', agent), undefined, '旧自定义文件读取不再挂载')
    assert.equal(f.context.tools.get('analyze_xlsx', agent), undefined, '旧自定义表格分析不再挂载')
    assert.equal(f.counts.api, 0, '引用收集不隐式发送字节或调用分析服务')
    return [{ type: 'text', text: 'fixture parent files only' }]
  }
  assert.equal((await f.execute(parent, 'subagent', { description: 'file fixture', prompt: 'read only the authorized parent file' })).isError, false)
  await f.settle(parent)
  assert.throws(() => sessionFiles(child.session), /可信父会话不可用/)
})

test('foreign or missing parentSession and forged depth fail before any child request', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 使用官方创建事务，不能通过手写 Fake 自述父归属。
  const parent = await f.parent() // 实际运行时 owner。
  const foreign = await f.parent('foreign-root') // 已存在但不是创建者的会话。
  for (const [id, parentSession, delegationDepth] of [
    ['missing-parent-child', 'missing-root', 1],
    ['foreign-parent-child', foreign.id, 1],
    ['too-deep-child', parent.id, 2],
  ]) {
    await assert.rejects(f.context.agents.create({
      sessionId: sessionModule.SessionId(id), // 本测试合成的子 Session 身份。
      parentAgent: parent, // 官方 registry 实际记录的 owner，不等于模型声明。
      meta: { origin: 'subagent', parentSession, delegationDepth }, // 测试不匹配的持久关系。
      setup: childCtx => subagentModule.applyChildComposition(childCtx, parent, {}), // 保持官方 live Preset 组合，但不能绕过权限校验。
    }), /可信父会话不可用/)
    assert.equal(f.context.agents.get(id), undefined)
    assert.equal(f.context.sessions.get(id), undefined)
  }
  assert.equal(f.requests.length, 0)
  assert.deepEqual(f.context.agents.list(), [parent, foreign])
})
