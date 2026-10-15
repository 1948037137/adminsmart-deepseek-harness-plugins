/** 真实固定SettingsForms/Loader/pi-ai/LLM热更新；HTTP、凭据与用户状态均为隔离Fixture。 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { installManagedModelSync } from '../src/managed-model-sync.mjs'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 固定SDK安装，不读取生产Profile、会话或密钥。
const OPTIONS = Object.freeze({ apiBase: 'http://127.0.0.1:9977', userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge', isAdmin: false, readToken: async () => 'fixture-capability' }) // 签名身份及能力全部合成。

/** @param {string} name 合成模型名称。 @returns {object} 当前冷编译器形状的受管代理Profile。 */
function profile(name) {
  return { displayName: name, api: 'openai-completions', apiKeyEnv: 'ADMINSMART_AGENT_MODEL_TOKEN', baseURL: `${OPTIONS.apiBase}/internal/agent-model/v1`, transport: 'sse', headers: {
    'X-AdminSmart-User-Id': OPTIONS.userId, // 合成subject绑定。
    'X-AdminSmart-Agent-Mode-Id': OPTIONS.modeId, // 合成模式。
    'X-AdminSmart-Agent-Preset-Id': OPTIONS.presetId, // 合成Preset。
    'X-AdminSmart-Model-Provider-Id': 'fixture-provider', // 合成后端提供方身份，无真实Key/URL。
  }, models: [{ id: name, name, contextWindow: 128000, maxTokens: 128, input: ['text'], reasoningEfforts: false }] }
}

/** @param {number} revision 独立目录修订。 @param {object} providers 合成受管Proxy集合。 @returns {object} 精确四字段签名响应。 */
function envelope(revision, providers) {
  const first = Object.keys(providers)[0] // 默认仅作为响应元数据，模块不得写Session或AgentDefaultModel。
  return { revision, providers, defaultProvider: first ?? '', defaultModel: first ? providers[first].models[0].id : '' }
}

/**
 * 创建实际Loader/SettingsForms/LLM与本测试专属Profile；ConfigEditor只替代磁盘事务包装。
 * @returns {Promise<object>} 当前真实适配器、有限HTTPFixture、持久化证据与清理能力。
 */
async function fixture() {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 所有公开SDK入口来自同一固定安装。
  const load = name => import(pathToFileURL(require.resolve(name)).href) // 不读取私有类或第三方源文件片段。
  const { Context } = await load('@deepseek-ai/cordis')
  const { default: Loader } = await load('@deepseek-ai/cordis-plugin-loader')
  const { SettingsForms } = await load('@deepseek-ai/dsh-settings')
  const { default: LlmRuntime, createUserMessage } = await load('@deepseek-ai/dsh-llm')
  const temporary = await mkdtemp(join(tmpdir(), 'adminsmart-model-sync-')) // 本测试唯一拥有的Profile根。
  const patchPath = join(temporary, 'fixture-profile.json') // FakeConfigEditor持久化证据，不能指向生产文件。
  const ctx = new Context() // 实际服务归属、volatile事件和适配器目录生命周期。
  const initial = { providers: { 'agent-old': profile('fixture-old') } } // 初始目录之后应被精确撤销。
  let saved = structuredClone(initial) // FakeConfigEditor原始配置，官方SDK负责校验与更新算法。
  const writes = [] // 记录官方SettingsForms交给Editor的真实候选。
  const selection = { agentDefault: ['agent-old', 'fixture-old'], session: ['agent-old', 'fixture-old', 'off'] } // 独立用户选择标记，热同步不得改动。
  ctx.provide('profileContext', { name: 'fixture', home: temporary })
  ctx.provide('credentials', { resolve: async ref => { assert.equal(ref, 'ADMINSMART_AGENT_MODEL_TOKEN'); return { value: 'fixture-key' } }, readRecord: async () => undefined, listRecords: async () => [] }) // 没有真实凭据或文件读取。
  const loader = ctx.plugin(Loader, { baseUrl: pathToFileURL(join(runtimeRoot, 'package.json')).href })
  await loader.await()
  const llm = ctx.plugin(LlmRuntime)
  await llm.await()
  await ctx.loader.root.update([{ id: 'adminsmart-managed-llm', name: pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-pi-ai')).href, config: initial }]) // 公开EntryGroup建立真实pi-ai行。
  await ctx.loader.await()
  const entry = ctx.loader.resolve('adminsmart-managed-llm') // 真实Entry支持volatile单字段更新。
  assert.equal(entry.fiber.state, 2)
  ctx.provide('configEditor', {
    documentPath: patchPath, // 仅测试Profile文件。
    entries: () => [entry], // 官方namespace来源为真正的Loader行。
    configuration: () => [{ entry, inherited: {}, override: saved }], // 不伪造SettingsForms Schema或merge语义。
    async edit(currentEntry, change) {
      assert.strictEqual(currentEntry, entry)
      const next = change(saved, {}) // 真实SettingsForms的路径set与Schema/CAS逻辑。
      await entry.update({ config: next }) // 实际官方Loader volatile更新，不重造适配器状态。
      await ctx.loader.await()
      saved = structuredClone(next)
      writes.push(structuredClone(next))
      await writeFile(patchPath, JSON.stringify(saved), 'utf8')
    },
  })
  const settings = ctx.plugin(SettingsForms)
  await settings.await()
  let latest = envelope(1, initial.providers) // 每次Fake GET取得当前后端已确认响应。
  let readOverride // 单次故障、迟到或超限实体的受控Fixture。
  let callback // 不启动真实SSE，只保存模块合法失效处理器。
  let requests = 0 // 完整同步请求次数，不打印认证或响应正文。
  let stopped = false // dispose必须释放订阅。
  const sync = installManagedModelSync(ctx, OPTIONS, {
    watchEvents(_options, handler) { callback = handler; return () => { stopped = true } },
    fetchImpl: async (url, options) => {
      requests += 1
      assert.equal(url, `${OPTIONS.apiBase}/internal/agent-model/v1/harness-profile`)
      assert.equal(options.redirect, 'error')
      assert.equal(options.headers.Authorization, 'Bearer fixture-capability')
      if (readOverride) return readOverride(options)
      return new Response(JSON.stringify(latest), { headers: { 'content-type': 'application/json' } })
    },
  })
  await sync.refresh()
  return { ctx, entry, sync, selection, writes, createUserMessage,
    saved: () => structuredClone(saved),
    set(value) { latest = value }, // 合成后端提交新revision。
    override(value) { readOverride = value }, // 仅控制Fake响应，不修改官方SDK。
    event(event) { return callback(event) }, // 严格有限事件只触发回读，不传提供方正文。
    requests: () => requests,
    async close() {
      sync.dispose()
      assert.equal(stopped, true)
      await settings.dispose(); ctx.loader.remove('adminsmart-managed-llm'); await ctx.loader.await(); await llm.dispose(); await loader.dispose(); await ctx.fiber.dispose()
      assert.equal(dirname(resolve(temporary)), resolve(tmpdir())) // 递归删除仅限本测试独占临时根。
      await rm(temporary, { recursive: true, force: true })
    },
  }
}

test('原始SettingsForms精确替换Provider、真实pi-ai目录热变且用户选择不改', { skip: !runtimeRoot }, async () => {
  const state = await fixture()
  try {
    const fiber = state.entry.fiber // 公开volatile更新必须保留原始活跃fiber。
    const before = structuredClone(state.selection)
    let directoryEvents = 0 // 原始LLM目录变化事件必须通过SDK产生，不由同步模块仿造。
    const stopEvents = state.ctx.on('llm/adapters-updated', () => { directoryEvents += 1 })
    assert.equal(state.sync.status().status, 'ready')
    state.set(envelope(2, { 'agent-new': profile('fixture-new') }))
    await state.event({ kind: 'models', revision: 2 })
    assert.strictEqual(state.entry.fiber, fiber)
    assert.equal(fiber.state, 2)
    assert.deepEqual(Object.keys(state.saved().providers), ['agent-new'])
    assert.ok(state.ctx.llm.listProviders().some(row => row.id === 'agent-new'))
    assert.equal(state.ctx.llm.listProviders().some(row => row.id === 'agent-old'), false)
    assert.ok(directoryEvents > 0)
    stopEvents()
    assert.deepEqual(state.selection, before)
    const count = state.writes.length // 同修订与旧修订都不重写目录。
    await state.sync.refresh()
    state.set(envelope(1, { 'agent-old': profile('fixture-old') }))
    await state.sync.refresh()
    assert.equal(state.writes.length, count)
    assert.deepEqual(Object.keys(state.saved().providers), ['agent-new'])
    assert.equal(state.sync.status().revision, 2)
  } finally { await state.close() }
})

test('真实官方prepareCall在目录撤销后保留已开始流的快照，不中断请求', { skip: !runtimeRoot }, async () => {
  let state // 必须在Fake fetch装配后才构造原生Provider，避免SDK构造时捕获真实fetch。
  const previousFetch = globalThis.fetch // 真实pi-ai网络入口全程由受控Fixture替换。
  let release // 已开始HTTP请求的受控结算门。
  try {
    let started // 实际SDK已经dispatch旧模型的确认门。
    const dispatched = new Promise(resolve => { started = resolve })
    const gate = new Promise(resolve => { release = resolve })
    let dispatchedModel // 实际SDK请求正文中的模型，不从测试预设猜测。
    let signal // 实际SDK请求取消状态，热采用不能将其abort。
    globalThis.fetch = async (_url, options) => {
      dispatchedModel = JSON.parse(options.body).model
      signal = options.signal
      started()
      await gate
      return new Response('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: dispatchedModel, choices: [{ index: 0, delta: { role: 'assistant', content: 'fixture reply' }, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: dispatchedModel, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }
    state = await fixture()
    const prepared = await state.ctx.llm.prepareCall({ provider: 'agent-old', model: 'fixture-old', maxTokens: 32 }) // 官方公开冻结入口，实际适配器保持捕获的旧profiles。
    const chunks = [] // 合成输出，不读取用户对话。
    const flowing = (async () => { for await (const chunk of prepared.stream({ ...prepared.config, messages: [state.createUserMessage({ content: [{ type: 'text', text: 'fixture question' }], source: { kind: 'user' } })] })) chunks.push(chunk) })()
    await Promise.race([dispatched, flowing.then(() => { throw new Error('原始SDK流在dispatch前已结束：' + JSON.stringify(chunks.map(chunk => ({ type: chunk.type, reason: chunk.reason, error: chunk.error, message: chunk.message })))) }), new Promise((_, reject) => setTimeout(() => reject(new Error('原始SDK未dispatch FakeHTTP')), 1000))])
    state.set(envelope(2, { 'agent-new': profile('fixture-new') }))
    await state.sync.refresh()
    assert.ok(signal instanceof AbortSignal)
    assert.equal(signal.aborted, false)
    release()
    await flowing
    assert.equal(dispatchedModel, 'fixture-old')
    assert.ok(chunks.length > 0)
    await assert.rejects(state.ctx.llm.prepareCall({ provider: 'agent-old', model: 'fixture-old' })) // 下一步不能继续选择已撤销路由。
    assert.equal((await state.ctx.llm.prepareCall({ provider: 'agent-new', model: 'fixture-new' })).config.model, 'fixture-new')
  } finally { release?.(); globalThis.fetch = previousFetch; await state?.close() }
})

test('流式512KiB限制、错误身份/私有地址与失败保留最后已确认目录', { skip: !runtimeRoot }, async () => {
  const state = await fixture()
  try {
    const before = state.saved()
    let cancelled = false // 超限JSON实体必须释放Fake流，而不是只检查Content-Length。
    state.override(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(512 * 1024 + 1)) }, cancel() { cancelled = true } })))
    await state.sync.refresh()
    assert.equal(cancelled, true)
    assert.deepEqual(state.saved(), before)
    assert.equal(state.sync.status().revision, 1)
    assert.equal(state.sync.status().status, 'unavailable')
    for (const patch of [
      { baseURL: 'https://models.example.test/v1' }, // 不能接受真实供应商或外部地址。
      { apiKeyEnv: 'PRIVATE_FIXTURE_KEY' }, // 只能复用内部能力引用。
      { headers: { 'X-AdminSmart-User-Id': 'other-user' } }, // 不能跨subject代理。
    ]) {
      state.override(() => new Response(JSON.stringify(envelope(2, { 'agent-invalid': { ...profile('fixture-invalid'), ...patch } }))))
      await state.sync.refresh()
      assert.deepEqual(state.saved(), before)
    }
    state.override(() => new Response('synthetic-private-failure', { status: 500 }))
    await state.sync.refresh()
    assert.doesNotMatch(JSON.stringify(state.sync.status()), /synthetic-private|PRIVATE_FIXTURE|models\.example/u)
    state.override(undefined)
    await state.event({ kind: null, revision: null }) // ready/resync重新回读并恢复，仍不采用陈旧响应。
    assert.equal(state.sync.status().status, 'ready')
  } finally { await state.close() }
})

test('管理员不读取共享代理、不覆盖PrivateProvider；卸载中止未结算GET', { skip: !runtimeRoot }, async () => {
  let calls = 0 // 管理员只供给，不能用global代理替换自己配置。
  const privateSync = installManagedModelSync({ settings: { mutate() { assert.fail('禁止覆盖管理员原生Provider') } } }, { ...OPTIONS, isAdmin: true }, { watchEvents() { calls += 1 }, fetchImpl() { calls += 1 } })
  await privateSync.refresh()
  assert.equal(calls, 0)
  assert.equal(privateSync.status().status, 'private')
  privateSync.dispose()
  const state = await fixture()
  try {
    const before = state.saved()
    state.override(() => new Promise(() => {})) // Fake忽略signal，模块总预算/卸载仍必须自行终止等待。
    const pending = state.sync.refresh()
    state.sync.dispose()
    await pending
    assert.deepEqual(state.saved(), before)
  } finally { await state.close() }
})

test('在途旧GET被新models修订拦下，恢复回读串行且相同修订不能换内容', { skip: !runtimeRoot }, async () => {
  const state = await fixture()
  let release // 仅释放本测试控制的旧响应。
  try {
    let requested // 已经进入Fake GET的确认门。
    const reached = new Promise(resolve => { requested = resolve })
    const waiting = new Promise(resolve => { release = resolve })
    state.override(async () => { requested(); await waiting; return new Response(JSON.stringify(envelope(2, { 'agent-stale': profile('fixture-stale') }))) })
    const reading = state.sync.refresh() // 修订2请求先进入网络，之后收到已提交修订3的消息。
    await reached
    state.set(envelope(3, { 'agent-latest': profile('fixture-latest') }))
    const event = state.event({ kind: 'models', revision: 3 }) // 不等待正在进行的旧读，模块将合并一次最新回读。
    state.override(undefined)
    release()
    await Promise.all([reading, event])
    assert.equal(state.sync.status().revision, 3)
    assert.deepEqual(Object.keys(state.saved().providers), ['agent-latest'])
    assert.equal(state.writes.some(write => Object.hasOwn(write.providers, 'agent-stale')), false)
    const count = state.requests() // 其它业务流或旧模型通知不得触发目录读写。
    await state.event({ kind: 'native', revision: 99 })
    await state.event({ kind: 'models', revision: 2 })
    assert.equal(state.requests(), count)
    state.set(envelope(3, { 'agent-drift': profile('fixture-drift') })) // 同一修订的内容漂移必须拒绝，不降级或换代码。
    await state.sync.refresh()
    assert.equal(state.sync.status().status, 'unavailable')
    assert.deepEqual(Object.keys(state.saved().providers), ['agent-latest'])
  } finally { release?.(); await state.close() }
})

test('八秒总预算覆盖未结算响应体，超时取消且保留旧目录', { skip: !runtimeRoot }, async () => {
  const state = await fixture()
  let guardTimer // 单独维持测试事件循环，产品超时不依赖测试Timer完成。
  try {
    const before = state.saved()
    let cancelled = false // 真实ReadableStream收到预算取消的证据。
    state.override(() => new Response(new ReadableStream({ start() {}, cancel() { cancelled = true } }))) // HTTP已回答，响应体永久不产出。
    const started = Date.now() // 预算只测同步调用，不包含SDKFixture构造。
    await Promise.race([state.sync.refresh(), new Promise((_, reject) => { guardTimer = setTimeout(() => reject(new Error('八秒响应预算失效')), 9500) })])
    assert.ok(Date.now() - started >= 7900 && Date.now() - started < 9500)
    assert.equal(cancelled, true)
    assert.deepEqual(state.saved(), before)
    assert.equal(state.sync.status().revision, 1)
    assert.equal(state.sync.status().status, 'unavailable')
  } finally { clearTimeout(guardTimer); await state.close() }
})
