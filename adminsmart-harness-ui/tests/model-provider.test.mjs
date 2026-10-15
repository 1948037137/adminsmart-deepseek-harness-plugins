/** 官方模型发布只从 Host Profile/Credentials 读取，浏览器只选择提供方 ID。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildManagedProvider, installManagedProviderSync, publishManagedProvider, runManagedProviderMutation } from '../src/model-provider.mjs'

const profile = {
  displayName: 'Fixture GPT', // 后端唯一供应商展示名。
  api: 'openai-responses', // 官方已保存的上游协议。
  baseURL: 'https://models.example.test/v1', // 合成 HTTPS 根，不发真实请求。
  apiKeyEnv: 'GPT_FIXTURE_KEY', // 官方 Credentials 引用而非明文。
  models: [{ id: 'fixture-model', name: 'Fixture Model', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'], reasoningEfforts: { max: 'ultra' } }], // 已经确认的合成模型能力。
}
const ctx = {
  configEditor: { entries: () => [{ options: { id: 'llm-pi-ai', config: { providers: { gpt: profile } } } }] }, // 只有管理员官方设置条目可被读取。
  credentials: { resolve: async ref => ref === 'GPT_FIXTURE_KEY' ? { value: 'fixture-secret' } : undefined }, // 不访问本机密钥文件。
  settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { gpt: { defaultMaxTokens: 32768 } } } }] }, // 官方生效 Profile 的非敏感默认上限。
  llm: { resolveModelInfo: async () => ({ context: { contextWindow: 128000 }, inputModalities: ['text', 'image'] }) }, // 官方公开模型能力替身。
}

test('saved official models publish through a signed Host request without echoing their key', async () => {
  const built = await buildManagedProvider(ctx, 'gpt') // 私有凭据仅进入 Host 的内存请求对象。
  assert.equal(built.models[0].reasoningEfforts.max, 'ultra')
  const previousFetch = globalThis.fetch // 测试局部替换网络边界。
  let called = false // 禁止真实外部网络连接。
  try {
    globalThis.fetch = async (url, options) => {
      called = true
      assert.equal(url, 'http://127.0.0.1:9098/internal/agent-model/v1/harness-providers/gpt')
      assert.equal(options.headers.Authorization, 'Bearer fixture-capability')
      assert.equal(JSON.parse(options.body).apiKey, 'fixture-secret')
      return { ok: true, json: async () => ({ providers: [{ providerId: 'agent-gpt' }] }) }
    }
    const response = await publishManagedProvider(ctx, 'gpt', {
      apiBase: 'http://127.0.0.1:9098', token: 'fixture-capability', userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge',
    })
    assert.equal(called, true)
    assert.deepEqual(response, { providers: [{ providerId: 'agent-gpt' }] })
    assert.doesNotMatch(JSON.stringify(response), /fixture-secret/u)
  } finally { globalThis.fetch = previousFetch }
})

test('reserved Runtime credentials cannot be published as a model provider key', async () => {
  const invalid = { ...ctx, configEditor: { entries: () => [{ options: { id: 'llm-pi-ai', config: { providers: { gpt: { ...profile, apiKeyEnv: 'ADMINSMART_AGENT_MODEL_TOKEN' } } } } }] } } // 恶意引用不能读取能力令牌。
  await assert.rejects(buildManagedProvider(invalid, 'gpt'), /凭据引用无效/u)
})

test('tagged native options preserve raw reasoning states and never infer defaults or edit official settings', async () => {
  const officialProfile = { ...profile, reasoning: 'max', models: [
    { id: 'inherited-model', name: 'Inherited Model', contextWindow: 128000 }, // 缺省元数据必须与显式禁用不同。
    { id: 'disabled-model', name: 'Disabled Model', contextWindow: 128000, reasoningEfforts: false }, // 原生明确无思考能力。
    { id: 'declared-model', name: 'Declared Model', contextWindow: 128000, reasoning: 'fixture-legacy-value', reasoningEfforts: { off: null, max: 'ultra' } }, // 保留官方线值；旧模型reasoning字段不是官方Schema能力，不得发布。
  ] } // 同一提供方各模型三态保持独立，不套用整组共同能力。
  const before = structuredClone(officialProfile) // 原生配置快照用于确认发布没有回写或隐式修改。
  const host = { ...ctx,
    configEditor: {
      entries: () => [{ options: { id: 'llm-pi-ai', config: { providers: { gpt: officialProfile } } } }], // 发布仅从实际官方原始配置构造元数据。
      edit: async () => { assert.fail('共享发布不得修改官方设置') }, // 不允许业务插件重写原生等级。
    },
    settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { gpt: { reasoning: 'high' } } } }] }, // 生效默认不能补入原始配置缺失字段。
    llm: { resolveModelInfo: async () => ({
      context: { contextWindow: 128000 }, // 模型解析仅提供容量兜底。
      inputModalities: ['text'], // 保留已有公开输入能力兜底。
      reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' }, // UI级解析不提供真实线值，不能重造映射或默认。
    }) },
  } // 全部使用内存Fixture，无真实凭据或模型网络请求。
  const built = await buildManagedProvider(host, 'gpt') // 直接验证实际共享请求构造函数。
  assert.deepEqual(built.nativeProviderOptions, { reasoning: 'max' })
  assert.deepEqual(built.models.map(model => model.nativeModelOptions), [
    {}, { reasoningEfforts: false }, { reasoningEfforts: { off: null, max: 'ultra' } },
  ])
  assert.equal(built.models.some(model => Object.hasOwn(model, 'defaultReasoningEffort') || Object.hasOwn(model, 'modelId')), false)
  assert.deepEqual(officialProfile, before)
  built.models[2].nativeModelOptions.reasoningEfforts.max = 'fixture-local-change'
  built.models[2].reasoningEfforts.max = 'fixture-compat-change'
  assert.deepEqual(officialProfile, before) // 请求对象与原始官方映射分离，调用方不能污染真源。
  delete officialProfile.reasoning
  const withoutDefault = await buildManagedProvider(host, 'gpt') // 不从生效Profile的high或模型解析的low补缺失默认。
  assert.deepEqual(withoutDefault.nativeProviderOptions, {})
  assert.deepEqual(withoutDefault.models[0].nativeModelOptions, {})
})

test('signed publication serializes native false and omission distinctly and rejects malformed metadata before writing', async () => {
  const officialProfile = { ...profile, reasoning: 'off', models: [
    { id: 'inherited-model', name: 'Inherited Model', contextWindow: 128000 }, // 序列化后仍不生成reasoningEfforts字段。
    { id: 'disabled-model', name: 'Disabled Model', contextWindow: 128000, reasoningEfforts: false }, // 序列化后明确保留false。
  ] } // 合成原生配置，无磁盘或用户数据访问。
  const host = { ...ctx, configEditor: {
    entries: () => [{ options: { id: 'llm-pi-ai', config: { providers: { gpt: officialProfile } } } }], // 唯一可信模型配置源。
  } } // 发布函数使用Fake签名回环网络。
  const previousFetch = globalThis.fetch // 测试结束恢复网络入口。
  let requests = 0 // 形状无效时不允许向后台提交。
  try {
    globalThis.fetch = async (_url, options) => {
      requests += 1
      const body = JSON.parse(options.body) // 实际Host请求序列化结果，只包含合成数据。
      assert.deepEqual(body.nativeProviderOptions, { reasoning: 'off' })
      assert.deepEqual(body.models[0].nativeModelOptions, {})
      assert.deepEqual(body.models[1].nativeModelOptions, { reasoningEfforts: false })
      return { ok: true, json: async () => ({ providers: [] }) }
    }
    const options = {
      apiBase: 'http://127.0.0.1:9098', // 合成内部API根地址。
      token: 'fixture-capability', // 合成签名能力，不访问真实令牌。
      userId: '7', // Fake可信actor。
      modeId: 'knowledge', // 固定知识模式Fixture。
      presetId: 'adminsmart-knowledge', // 合成受管Preset。
    } // 当前测试的签名上下文，不改变认证契约。
    await publishManagedProvider(host, 'gpt', options)
    for (const malformed of [null, true, [], 'low']) { // 不能把错误形状静默转成继承或禁用。
      officialProfile.models[1].reasoningEfforts = malformed
      await assert.rejects(publishManagedProvider(host, 'gpt', options), /官方模型思考元数据无效/u)
    }
    assert.equal(requests, 1)
  } finally { globalThis.fetch = previousFetch }
})

test('a native inherited output cap remains unknown in the managed catalog', async () => {
  const inherited = { ...ctx,
    configEditor: { entries: () => [{ options: { id: 'llm-pi-ai', config: { providers: { gpt: { ...profile, models: [{ id: 'fixture-model', name: 'Fixture Model' }] } } } } }] },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 128000 }, defaultMaxTokens: 32768, inputModalities: ['text', 'image'] }) },
  } // 官方返回的请求默认值和路由 fallback 均不证明模型输出能力。
  const built = await buildManagedProvider(inherited, 'gpt') // 路由请求默认值不等于模型公开能力。
  assert.equal(built.models[0].contextWindow, 128000)
  assert.equal(built.models[0].maxOutputTokens, null)
  const previousFetch = globalThis.fetch // 仅拦截合成回环发布请求。
  let publishedOutputCap // 业务目录实际收到的可选模型能力。
  try {
    globalThis.fetch = async (_url, options) => {
      publishedOutputCap = JSON.parse(options.body).models[0].maxOutputTokens
      return { ok: true, json: async () => ({ providers: [] }) }
    }
    await publishManagedProvider(inherited, 'gpt', { apiBase: 'http://127.0.0.1:9098', token: 'fixture-capability', userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge' })
    assert.equal(publishedOutputCap, null)
  } finally { globalThis.fetch = previousFetch }
})

test('official settings and credential commits automatically synchronize the administrator provider', async () => {
  const listeners = new Map() // 官方 Host 事件订阅替身，不触碰真实 Profile 或凭据。
  const disposers = [] // 插件生命周期释放所有订阅和定时器。
  const requests = [] // 只捕获对回环后端的合成发布请求。
  const oldFetch = globalThis.fetch // 测试结束恢复全局网络能力。
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options })
      return { ok: true, json: async () => ({ providers: [] }) }
    }
    installManagedProviderSync({
      ...ctx,
      logger: { warn() {} },
      on: (name, callback) => { listeners.set(name, callback); return () => listeners.delete(name) },
      effect: register => { disposers.push(register()) },
    }, {
      apiBase: 'http://127.0.0.1:9098', readToken: async () => 'fixture-capability',
      userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge',
    })
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(requests.length, 1) // 冷启动同步已保存供应商，且不会回传 Key 给浏览器。
    assert.equal(JSON.parse(requests[0].options.body).apiKey, 'fixture-secret')
    listeners.get('settings/document-updated')?.('unrelated')
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(requests.length, 1)
    listeners.get('settings/document-updated')?.('llm-pi-ai')
    listeners.get('credentials/reference-updated')?.('GPT_FIXTURE_KEY')
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(requests.length, 2) // 官方设置先写、Key 后写合并成一次最新快照。
  } finally {
    for (const dispose of disposers) dispose?.()
    globalThis.fetch = oldFetch
  }
})

test('automatic sync publishes models with an unknown output cap without inventing one', async () => {
  const warnings = [] // 无真实故障时不产生误导性告警。
  const disposers = [] // 运行时效果在测试结束释放定时器和订阅。
  const inherited = { ...ctx,
    configEditor: { entries: () => [{ options: { id: 'llm-pi-ai', config: { providers: { gpt: { ...profile, models: [{ id: 'fixture-model', name: 'Fixture Model', contextWindow: 128000 }] } } } } }] },
    logger: { warn: message => warnings.push(message) },
    on: () => () => {},
    effect: register => { disposers.push(register()) },
  } // Harness 允许缺省 maxTokens，受管目录同样保存未知值。
  const previousFetch = globalThis.fetch // 自动同步只能使用测试替身。
  let publishedOutputCap // 回环后端收到的可选模型能力。
  try {
    globalThis.fetch = async (_url, options) => {
      publishedOutputCap = JSON.parse(options.body).models[0].maxOutputTokens
      return { ok: true, json: async () => ({ providers: [] }) }
    }
    installManagedProviderSync(inherited, {
      apiBase: 'http://127.0.0.1:9098', readToken: async () => 'fixture-capability',
      userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge',
    })
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(publishedOutputCap, null)
    assert.deepEqual(warnings, [])
  } finally {
    for (const dispose of disposers) dispose?.()
    globalThis.fetch = previousFetch
  }
})

test('provider mutations serialize per Runtime and recover after a failed task', async () => {
  const runtime = {} // 同一 Host Context 的发布与管理员编辑共享顺序。
  const steps = [] // 人工延期让两个动作真实重叠到达。
  let release // 第一项动作的受控完成门。
  const gate = new Promise(resolve => { release = resolve })
  const first = runManagedProviderMutation(runtime, async () => {
    steps.push('first-start')
    await gate
    steps.push('first-end')
    throw new Error('fixture-failure')
  })
  const second = runManagedProviderMutation(runtime, async () => { steps.push('second'); return 'confirmed' })
  assert.deepEqual(steps, []) // 两项工作均在微任务队列内按提交顺序启动。
  release()
  await assert.rejects(first, /fixture-failure/u)
  assert.equal(await second, 'confirmed')
  assert.deepEqual(steps, ['first-start', 'first-end', 'second'])
})

test('共享删除与原生操作串行，后台引用竞态拒绝不删Key，super失败只补偿当前真实Profile', async () => {
  const previousFetch = globalThis.fetch // 全部网络动作由本测试的签名回环Fake接管。
  const callbacks = new Map() // 当前Host公开设置/凭据通知，不伪造Key恢复。
  const disposers = [] // 任务结束前停止本测试去抖及订阅。
  const requests = [] // 发布/撤销的顺序证据，不记录任何真实凭据。
  let refuseDelete = false // 资格检查后另一客户端改变默认用途时，后台锁内DELETE必须拒绝。
  let nativeDeletes = 0 // 后台拒绝前不允许真实Key或Profile动作。
  let saved = { gpt: structuredClone(profile) } // 当前官方Profile是失败补偿的唯一真源。
  const host = {
    ...ctx,
    configEditor: { entries: () => [{ options: { id: 'llm-pi-ai', config: { providers: saved } } }] },
    credentials: { ...ctx.credentials, describe: async () => ({ configured: false }) }, // Keyunset期间不允许事件自动重新发布。
    logger: { warn() {} },
    on(name, callback) { callbacks.set(name, callback); return () => callbacks.delete(name) },
    effect(register) { disposers.push(register()) },
  }
  try {
    globalThis.fetch = async (_url, options) => {
      requests.push(options.method)
      if (options.method === 'DELETE' && refuseDelete) return { ok: false, status: 400, json: async () => ({ error: { code: 'chat_provider_in_use' } }) }
      return { ok: true, status: 200, json: async () => ({ providers: [] }) }
    }
    const synchronization = installManagedProviderSync(host, { apiBase: 'http://127.0.0.1:9098', readToken: async () => 'fixture-capability', userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge' }) // 当前成功POST确认的route才可删除。
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.deepEqual(requests, ['POST'])
    refuseDelete = true
    await assert.rejects(synchronization.withDeletion(['gpt'], async () => { nativeDeletes += 1 }), /未获后台确认/u)
    assert.equal(nativeDeletes, 0)
    assert.deepEqual(requests, ['POST', 'DELETE'])
    refuseDelete = false
    await assert.rejects(synchronization.withDeletion(['gpt'], async () => { throw new Error('synthetic-native-CAS-failure') }), /synthetic-native-CAS-failure/u)
    assert.deepEqual(requests.slice(-2), ['DELETE', 'POST']) // 只重新发布仍存在的真实Profile，不重试Key删除或伪恢复Key。
    await synchronization.withDeletion(['gpt'], async () => { nativeDeletes += 1 }) // 模拟官方先删Key，Profile仍在等待随后mutate。
    const afterUnset = requests.length // 凭据提交事件不能在native Profile删除前重新建共享目录。
    callbacks.get('credentials/reference-updated')('GPT_FIXTURE_KEY')
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(requests.length, afterUnset)
    await synchronization.withDeletion(['gpt'], async () => { saved = {}; nativeDeletes += 1 }) // 后续配置删除无二次DELETE，仍使用原生动作。
    assert.equal(requests.length, afterUnset)
    assert.equal(nativeDeletes, 2)
    const unknownBaseline = requests.length // 未由本Host确认的其它共享route不能被冷启动推测撤销。
    await synchronization.withDeletion(['other-admin-route'], async () => {})
    assert.equal(requests.length, unknownBaseline)
  } finally {
    for (const dispose of disposers) dispose?.()
    globalThis.fetch = previousFetch
  }
})
