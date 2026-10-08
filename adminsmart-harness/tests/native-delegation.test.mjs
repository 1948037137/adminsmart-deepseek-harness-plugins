/** 经官方 Tool execute 与真实 in-process Agent Loop 验证只读委派，不访问模型、网络或用户数据。 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, call, cancellable, llmModule, sessionModule, subagentModule } from './helpers/native-delegation.mjs'
import { READONLY_CHILD_TOOL_NAMES, trustedDelegationParent } from '../src/knowledge-delegation.mjs'
import { sessionFiles } from '../src/session-files.mjs'

test('official foreground Tool retains native schema, parent model and cleanup; forced model/background/session fields fail', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 真正的官方服务图，任何意外 HTTP 均失败。
  const parent = await f.parent() // 官方知识 Preset 根 Agent。
  const native = f.context.tools.get('subagent', parent) // 聚合入口实际注册的官方 Tool 定义。
  assert.deepEqual(Object.keys(native.parameters.properties).sort(), ['description', 'prompt'])
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
  const result = await f.execute(parent, 'subagent', { description: 'fixture task', prompt: 'only synthetic input' }) // 实际进入官方 Tool、provider、Agent Loop 与 Fake adapter。
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.match(JSON.stringify(result), /synthetic result/)
  assert.deepEqual(f.context.agents.list(), [parent])
  assert.equal(f.context.sessions.get(child.id), undefined)
  assert.equal(f.ended.length, 1)
  assert.equal(f.ended[0].stopReason, 'completed')
  const preCancelled = new AbortController() // 预取消也不能创建任何子请求。
  preCancelled.abort()
  assert.equal((await f.execute(parent, 'subagent', { description: 'fixture', prompt: 'fixture' }, preCancelled.signal)).isError, true)
  for (const invalid of [{ provider: 'other', model: 'other' }, { reasoning_effort: 'high' }, { run_in_background: true }, { parentSession: 'foreign' }, { sessionId: 'foreign' }]) {
    assert.equal((await f.execute(parent, 'subagent', { description: 'fixture', prompt: 'fixture', ...invalid })).isError, true, `forced fields: ${JSON.stringify(invalid)}`)
  }
  const execution = { agent: parent, signal: new AbortController().signal } // 直接执行定义检查官方运行时二次拒绝，不只依赖 Schema。
  await assert.rejects(native.execute({ description: 'fixture', prompt: 'fixture', run_in_background: true }, execution), /run_in_background is disabled/)
  await assert.rejects(native.execute({ description: 'fixture', prompt: 'fixture', provider: 'other', model: 'other' }, execution), /model selection is disabled/)
  assert.equal(f.requests.length, 1, '无效参数不得创建子模型请求')
})

test('the child inherits the latest effective parent request route rather than stale creation options', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 使用官方 request waterfall 和真实 request/header，不伪造日志字段。
  const parent = await f.parent() // 创建模型固定为 fixture-model。
  parent.ctx.on('agent/request', async (_payload, next) => ({ ...await next(), model: 'fixture-selected-model' })) // 模拟受管模型选择在父请求前更新路线。
  parent.followup(llmModule.createUserMessage({ content: [{ type: 'text', text: 'synthetic parent route selection' }] }))
  await parent.whenIdle()
  assert.equal(parent.options.model, 'fixture-model')
  assert.equal(parent.session.requestHeader().config.model, 'fixture-selected-model')
  f.state.reply = async (options, child) => {
    assert.equal(options.model, 'fixture-selected-model')
    assert.equal(child.options.model, 'fixture-selected-model')
    return [{ type: 'text', text: 'fixture latest route inherited' }]
  }
  assert.equal((await f.execute(parent, 'subagent', { description: 'route fixture', prompt: 'only synthetic route' })).isError, false)
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
    await assert.rejects(f.context.subagents.start('spawn', {
      parent: child, // 即使从可信 API 直接请求，也不能绕过官方持久深度上限。
      prompt: [{ type: 'text', text: 'forbidden recursive fixture' }], // 只用合成文本。
      signal: new AbortController().signal, // 深度检查发生在发布新 child 之前。
      maxDepth: 1, // 官方工具交给 provider 的同一硬限制。
    }), error => error instanceof subagentModule.SubagentDepthError && error.attemptedDepth === 2)
    const liftLiveRestriction = parent.ctx.tools.restrict({ deny: ['search_knowledge'] }) // 子已创建后再收窄父工具可见性。
    try {
      assert.equal((await f.execute(child, 'search_knowledge', { query: 'fixture', highLevelKeywords: ['fixture'], lowLevelKeywords: ['fixture'] })).isError, true)
      assert.equal(f.counts.api, 0, '父能力撤销后不能到达 FastAPI Fake')
    } finally { liftLiveRestriction() }
    return [{ type: 'text', text: 'fixture stayed readonly' }]
  }
  assert.equal((await f.execute(parent, 'subagent', { description: 'guard fixture', prompt: 'verify only synthetic permissions' })).isError, false)
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
    assert.deepEqual(JSON.parse(options.body), { question: 'synthetic knowledge question', queries: ['synthetic knowledge question'], highLevelKeywords: ['fixture topic'], lowLevelKeywords: ['fixture entity'] })
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
  assert.equal(f.counts.api, 1)
})

test('structured_output stays fail-closed: the native foreground Tool does not expose outputSchema and no same-name tool is auto-authorized', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 直接调用官方有 outputSchema 的 API 仅用于验证禁用边界。
  const parent = await f.parent() // 模型仍只有原生 description/prompt 输入。
  const steps = new Map() // 官方结构化子运行必须以工具成功终态为结果，文字自述不算。
  f.state.reply = async (_options, child) => {
    const step = (steps.get(child.id) ?? 0) + 1 // 合成子步骤。
    steps.set(child.id, step)
    return step === 1 ? [call('structured_output', { answer: 'fixture' })] : [{ type: 'text', text: 'fixture not a structured completion' }]
  }
  const run = await f.context.subagents.start('spawn', {
    parent, // 可信主 Agent；API 不暴露给模型。
    prompt: [{ type: 'text', text: 'synthetic structured fixture' }], // 无真实知识或敏感信息。
    signal: new AbortController().signal, // 官方取消通道。
    maxDepth: 1, // 保留一层限制。
    toolFilter: { allow: f.context.tools.schemas(parent).map(tool => tool.name).filter(name => READONLY_CHILD_TOOL_NAMES.includes(name)) }, // 采用实际父工具交集，过滤不存在的平台工具。
    outputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false }, // 可信测试 Schema，不进入正式委派配置。
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
  parent.followup(llmModule.createUserMessage({ content: [{ type: 'text', text: 'two independent fixture tasks' }] }))
  await parent.whenIdle()
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

test('cancelling a running foreground call drains the real child and releases its Session authorization', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 整个取消通道来自官方 execute 和 provider。
  const parent = await f.parent() // 唯一根会话。
  const cancellation = new AbortController() // 父工具执行真正持有的取消信号。
  let notifyEntered // 确认不是只测试预取消。
  const entered = new Promise(resolve => { notifyEntered = resolve }) // child 已进入模型流的事实门闩。
  let child // 清理之后必须不能继续继承父文件。
  f.state.reply = async (options, agent) => {
    child = agent
    notifyEntered()
    await cancellable(new Promise(() => {}), options.signal)
    return []
  }
  const pending = f.execute(parent, 'subagent', { description: 'cancel fixture', prompt: 'wait for cancellation' }, cancellation.signal) // 真实前台调用拥有真实子驱动。
  await entered
  cancellation.abort(new Error('fixture parent cancelled'))
  assert.equal((await pending).isError, true)
  assert.deepEqual(f.context.agents.list(), [parent])
  assert.equal(f.context.sessions.get(child.id), undefined)
  assert.throws(() => sessionFiles(child.session), /可信父会话不可用/)
  assert.equal(f.ended[0].stopReason, 'aborted')
  f.state.reply = async () => [{ type: 'text', text: 'fixture after cancellation' }]
  assert.equal((await f.execute(parent, 'subagent', { description: 'next fixture', prompt: 'next task' })).isError, false)
})

test('official child failure cannot become successful text and is followed by complete disposal', { timeout: 10000 }, async t => {
  const f = await fixture(t) // Fake 模型给出官方 error finish，不能把普通文字当作失败状态。
  const parent = await f.parent() // 错误只影响本次委派。
  f.state.reply = async () => ({
    blocks: [{ type: 'text', text: 'synthetic partial result' }], // 即使错误流含合成正文，也不能冒充成功。
    reason: { kind: 'error', failure: { code: 'FIXTURE_FAILURE', message: 'synthetic child failure' } }, // 无内部路径或秘密的官方失败协议。
  })
  const result = await f.execute(parent, 'subagent', { description: 'error fixture', prompt: 'fail deterministically' }) // 经过官方结果和 dispose 处理。
  assert.equal(result.isError, true)
  assert.match(JSON.stringify(result), /subagent run failed/)
  assert.equal(f.ended[0].stopReason, 'error')
  assert.deepEqual(f.context.agents.list(), [parent])
})

test('a child uses the parent live web switch, never its own default or enabled record', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 两种公开 Web provider 都是可计数的离线 Fake。
  const parent = await f.parent() // 真正持有 UI 开关的主 Session。
  await f.webState({ [parent.id]: { enabled: false } })
  const steps = new Map() // 每个子模型最多发一组 Web calls，再返回限制说明。
  f.state.reply = async (options, agent) => {
    const step = (steps.get(agent.id) ?? 0) + 1 // 只跟踪合成会话，不读取真实用户历史。
    steps.set(agent.id, step)
    const prompt = options.messages.filter(message => message.role === 'system').flatMap(message => message.content).map(block => block.text ?? '').join('\n') // 检查实际组装的 RC2 scope 权限快照。
    assert.match(prompt, /当前会话已关闭联网/)
    if (step !== 1) return [{ type: 'text', text: 'fixture denied web access' }]
    await f.webState({ [parent.id]: { enabled: false }, [agent.id]: { enabled: true } }) // 子会话显式 on 仍不能放宽父会话 off。
    return [
      call('web_search', { queries: ['public fixture'] }, 'child-search'),
      call('web_fetch', { url: 'https://example.test/fixture' }, 'child-fetch'),
      call('lookup_business_registry', { entityName: 'synthetic company', targetFields: ['principal'] }, 'child-registry'),
    ]
  }
  assert.equal((await f.execute(parent, 'subagent', { description: 'offline fixture', prompt: 'try only public fixture queries' })).isError, false)
  const webOutcomes = f.outcomes.filter(({ execution }) => ['web_search', 'web_fetch', 'lookup_business_registry'].includes(execution.name)) // 只依据真实工具终态。
  assert.equal(webOutcomes.length, 3)
  assert.ok(webOutcomes.every(({ result }) => result.isError))
  assert.ok(webOutcomes.every(({ result }) => JSON.stringify(result).includes('已关闭联网')), '不得用参数失败冒充联网 guard 生效')
  assert.deepEqual(f.counts, { search: 0, fetch: 0, api: 0 })
  const liveSteps = new Map() // 第二次委派验证父开关在子运行中关闭后立即生效。
  await f.webState({ [parent.id]: { enabled: true } })
  f.state.reply = async (_options, agent) => {
    const step = (liveSteps.get(agent.id) ?? 0) + 1 // 本次独立子回合步骤。
    liveSteps.set(agent.id, step)
    if (step === 1) return [call('web_search', { queries: ['public fixture'] }, 'allowed-search')]
    if (step === 2) {
      await f.webState({ [parent.id]: { enabled: false }, [agent.id]: { enabled: true } })
      return [call('web_fetch', { url: 'https://example.test/fixture' }, 'denied-live-fetch')]
    }
    return [{ type: 'text', text: 'fixture complete within current switch' }]
  }
  assert.equal((await f.execute(parent, 'subagent', { description: 'live switch fixture', prompt: 'public fixture' })).isError, false)
  assert.equal(f.counts.search, 1)
  assert.equal(f.counts.fetch, 0)
})

test('native child reads only direct-parent attachments, excludes strangers and intersects parent Tool restrictions', { timeout: 10000 }, async t => {
  const f = await fixture(t) // 合成文件通过官方 AttachmentStore，而非手写服务器路径。
  const parent = await f.parent() // 当前附件归属的主 Session。
  const foreign = await f.parent('foreign-root') // 相同 Runtime 内另一合法但不相关的会话。
  const reference = await f.context.attachments.saveFile({ name: 'own-fixture.txt', data: Buffer.from('synthetic parent document') }) // 只由测试生成的原生文件身份。
  const workbook = await f.context.attachments.saveFile({ name: 'own-fixture.xlsx', data: Buffer.from('synthetic list-only workbook') }) // 本测试只验证文件清单，不把未解析的内容冒充工作簿数据。
  const stranger = await f.context.attachments.saveFile({ name: 'foreign-fixture.txt', data: Buffer.from('synthetic foreign document') }) // 不得因存储共享而获得读取权限。
  parent.followup(llmModule.createUserMessage({ content: [{ type: 'file', attachment: reference }, { type: 'file', attachment: workbook }] }))
  foreign.followup(llmModule.createUserMessage({ content: [{ type: 'file', attachment: stranger }] }))
  await parent.whenIdle()
  await foreign.whenIdle()
  const liftRestriction = parent.ctx.tools.restrict({ deny: ['lookup_business_registry'] }) // 父 Agent 个体限制不在 standing Preset 中，子代理仍必须继承交集。
  t.after(liftRestriction)
  let child // 原生委派返回后必须释放子权限。
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
