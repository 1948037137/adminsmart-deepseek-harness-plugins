/** 官方模型发布只从 Host Profile/Credentials 读取，浏览器只选择提供方 ID。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildManagedProvider, installManagedProviderSync, listOfficialProviderModels, publishManagedProvider, runManagedProviderMutation, updateOfficialModelReasoning } from '../src/model-provider.mjs'

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

test('reasoning saved for one backend model mirrors only the corresponding official model', async () => {
  let updated // 官方 ConfigEditor 写入的完整非敏感候选配置。
  const privateCtx = {
    configEditor: {
      entries: () => [{ options: { id: 'llm-pi-ai' } }], // 与当前管理员可编辑条目一一对应。
      edit: async (_entry, change) => { updated = change({ providers: { gpt: { ...profile } } }) }, // 无磁盘写入的官方编辑器替身。
    },
  }
  await updateOfficialModelReasoning(privateCtx, 'gpt', 'fixture-model', { off: null, max: 'ultra' })
  assert.deepEqual(updated.providers.gpt.models[0].reasoningEfforts, { off: null, max: 'ultra' })
  assert.equal(profile.models[0].reasoningEfforts.off, undefined) // 原输入不得被隐式修改。
  await assert.rejects(updateOfficialModelReasoning(privateCtx, 'gpt', 'other-model', { high: 'high' }), /官方模型已变化/u)
})

test('unpublished official models expose their reasoning but never the provider credential', () => {
  const models = listOfficialProviderModels(ctx, 'gpt') // 不调用业务发布接口，直接列出私有 Profile 的已保存模型。
  assert.deepEqual(models, [{ id: 'fixture-model', name: 'Fixture Model', reasoningEfforts: { max: 'ultra' } }])
  assert.doesNotMatch(JSON.stringify(models), /GPT_FIXTURE_KEY|fixture-secret|models\.example\.test/u)
  assert.throws(() => listOfficialProviderModels(ctx, 'missing'), /请先保存模型供应商/u)
})

test('private reasoning validates each wire value and disables inherited capabilities when empty', async () => {
  let saved = { providers: { gpt: { ...profile, models: [...profile.models] } } } // 模拟官方编辑器在每次热重载后保留最新配置。
  const privateCtx = {
    configEditor: {
      entries: () => [{ options: { id: 'llm-pi-ai', config: saved } }], // 当前管理员的隔离 Profile，不是受管业务目录。
      edit: async (_entry, change) => { saved = change(saved) }, // 在内存中执行公开 ConfigEditor 的修改回调。
    },
  }
  await assert.rejects(updateOfficialModelReasoning(privateCtx, 'gpt', 'fixture-model', { ultra: 'ultra' }), /不受支持/u)
  await assert.rejects(updateOfficialModelReasoning(privateCtx, 'gpt', 'fixture-model', { high: '' }), /线协议值无效/u)
  await assert.rejects(updateOfficialModelReasoning(privateCtx, 'gpt', 'fixture-model', { high: null }), /线协议值无效/u)
  assert.deepEqual(listOfficialProviderModels(privateCtx, 'gpt')[0].reasoningEfforts, { max: 'ultra' })
  await updateOfficialModelReasoning(privateCtx, 'gpt', 'fixture-model', {})
  assert.equal(saved.providers.gpt.models[0].reasoningEfforts, false)
  assert.deepEqual(listOfficialProviderModels(privateCtx, 'gpt')[0].reasoningEfforts, {})
  await updateOfficialModelReasoning(privateCtx, 'gpt', 'fixture-model', { off: null, high: 'high' })
  assert.deepEqual(saved.providers.gpt.models[0].reasoningEfforts, { off: null, high: 'high' })
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
