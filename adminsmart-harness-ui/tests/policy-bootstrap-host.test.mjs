/** 真实固定SDK的Host设置引导正向合同；磁盘层、身份与网络全部使用合成隔离数据。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { installSharedUiPolicy, captureGeneralSettings } from '../src/shared-ui-policy.mjs'
import { installNativePolicy } from '../src/native-policy-host.mjs'
import { emptyNativePolicy, isNativePolicy } from '../src/native-policy-client.mjs'
import { createPolicyBootstrapReads } from '../src/ui-policy-client.mjs'
import { installPolicyBootstrapHost, SETTINGS_BOOTSTRAP_GLOBAL, SETTINGS_BOOTSTRAP_MAXIMUM_BYTES } from '../src/policy-bootstrap-host.mjs'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 调用方明确指定的只读固定SDK安装，绝不读取生产Profile。
const require = createRequire(pathToFileURL(join(runtimeRoot, 'package.json'))) // 所有公开类和Schema从相同安装解析。
const load = name => import(pathToFileURL(require.resolve(name)).href) // 仅加载本测试固定写出的公开包名。
const { Context } = await load('@deepseek-ai/cordis')
const { SettingsForms } = await load('@deepseek-ai/dsh-settings')
const { default: Registry } = await load('@deepseek-ai/dsh-typert-registry')
const { default: Schema } = await load('@deepseek-ai/schemastery')
const { renderIndexInjections } = await load('@deepseek-ai/dsh-host-webserver')
const { AdminSmartReadOnlySettings } = await import('../src/read-only-settings.mjs')
const { installGuardedSettingsControllers } = await import('../src/guarded-settings-controller.mjs')
const BASELINE = { subagent: { maxDepth: 1, maxActiveSubagents: 2 }, 'agent-loop': { maxParallelToolCalls: 2 } } // 合成冻结业务继承，不以当前用户配置播种。
const CANARY = 'synthetic-bootstrap-secret-canary' // 仅用于证明原生脱敏及精确投影，不是真实凭据。
const tick = () => new Promise(resolve => setImmediate(resolve)) // 只推进本进程已排队工作，不访问外部服务。

/**
 * 用真实SettingsForms、实际子fiber控制器和公开inject装配一个隔离Host。
 * @param {boolean} admin 合成Gateway可信角色。
 * @returns {Promise<object>} 已采用控制器、公开原始配置层、渲染与清理能力。
 * @sideEffects 仅在独占临时Home运行Settings legacy探针，全部HTTP由Fake接管。
 */
async function fixture(admin) {
  const temporary = await mkdtemp(join(tmpdir(), 'adminsmart-bootstrap-host-')) // 本测试独占空Home，没有真实用户配置。
  const ctx = new Context() // 实际Cordis负责父子服务可见性、inject和释放。
  const rows = [] // Fake Editor只替代磁盘事务，Schema、修订、脱敏及事件由官方执行。
  const calls = { credentials: 0, requests: 0, writes: 0 } // 验证引导仅读确认值，不触及凭据服务或额外HTTP。
  const specs = [
    ['locale', '@deepseek-ai/dsh-client-locale', { preference: 'zh' }],
    ['ui-theme', '@deepseek-ai/dsh-client-ui-theme', { preference: 'light', fontSize: 14 }],
    ['ui-chat', '@deepseek-ai/dsh-client-ui-chat', { transcriptView: 'standard', performanceUsage: 'compact', linkOpening: 'sidebar' }],
    ['ui-conversation', '@deepseek-ai/dsh-client-ui-conversation', { busyEnter: 'queue' }],
    ['adminsmart-shared-settings', '@deepseek-ai/dsh-client-ui-settings', { enabled: false }],
    ['subagent', '@deepseek-ai/dsh-subagent', BASELINE.subagent],
    ['agent-loop', '@deepseek-ai/dsh-agent-loop', BASELINE['agent-loop']],
    ['ui-settings-general', '@deepseek-ai/dsh-client-ui-settings-general', { welcomeNoticeVersion: '</script><script>canary' }],
    ['llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai', { providers: { fixture: { api: 'openai-responses', baseURL: 'https://models.example.test/v1', headers: { Authorization: CANARY }, models: [{ id: 'synthetic-model' }] } } }],
  ] // 全部使用当前alpha.2公开Schema，不Fake序列化引用图。
  for (const [id, name, inherited] of specs) {
    const module = await load(name) // 当前固定命名的公开Host模块。
    let Config = module.Config ?? module.default.Config // 原始官方Schema身份。
    if (id === 'locale') Config = Schema.object({ ...Config.dict,
      credential: Schema.string().role('secret').default(CANARY).volatile(), // 未知secret分支必须整体剔除，不能泄露默认值或路径。
      unknownPublic: Schema.string().default(CANARY).volatile(), // 未标secret的未知业务字段同样不能被复制。
    })
    const raw = structuredClone(inherited) // 已冷编译的合成运行值，与继承/覆盖层分开。
    const entry = {
      id: 'include:' + id, // 真实SettingsForms按完整entry身份管理修订。
      options: { id, name, config: raw }, // 对应实际公开namespace和合成raw配置。
      fiber: { uid: 'synthetic-' + id, state: 2, runtime: { Config }, ctx, config: Config(raw) }, // 官方Schema真实解析，不运行模型或Agent。
    }
    rows.push({ entry, inherited: structuredClone(inherited), override: {} })
  }
  ctx.provide('loader', { await: async () => {} }) // Fixture原始层已经就绪，无第三方插件网络加载。
  ctx.provide('profileContext', { home: temporary, name: 'fixture' }) // Legacy探测严格限当前测试空Home。
  ctx.provide('webServer', { register: () => () => {} }) // 不开端口，仅满足受控路由装配。
  ctx.provide('credentials', {
    describe() { calls.credentials += 1; throw new Error('凭据不得进入bootstrap') },
    resolve() { calls.credentials += 1; throw new Error('凭据不得进入bootstrap') },
    set() { calls.credentials += 1; throw new Error('测试禁止写凭据') },
    unset() { calls.credentials += 1; throw new Error('测试禁止写凭据') },
  }) // 实际官方CredentialsController可以装配，但引导不能调用它。
  ctx.provide('configEditor', {
    documentPath: join(temporary, 'synthetic.patch.yml'), // 不创建真实配置文件。
    entries: () => rows.map(row => row.entry),
    configuration: () => rows,
    async edit(entry, change) {
      const row = rows.find(row => row.entry === entry) // 本次实际官方更新对应的唯一合成层。
      const next = change(structuredClone(entry.options.config), structuredClone(row.inherited)) // 原生SettingsForms负责set/unset及CAS。
      entry.fiber.config = entry.fiber.runtime.Config(next)
      entry.options.config = next
      row.override = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(row.inherited[key]))) // 模拟Editor明确覆盖层，不能仿造官方描述。
      calls.writes += 1
    },
  })
  const registry = ctx.plugin(Registry) // 实际Remote命名注册依赖。
  await registry.await()
  const settings = ctx.plugin(SettingsForms) // 真正的公开SettingsForms服务。
  await settings.await()
  const generalPolicy = { revision: 4, settings: captureGeneralSettings(ctx.settings) } // 当前真实有效General作为已确认合成后端回答。
  const nativePolicy = { revision: 7, settings: { ...emptyNativePolicy(), clientPreferences: { collapseTiming: 'next-input' } } } // 独立Native CAS真源，初始官方raw Chat默认completion不能覆盖它。
  let available = true // 用于模拟采用后的后端不可用，不改变确认快照。
  const originalFetch = globalThis.fetch // 当前测试完成后恢复进程原传输。
  globalThis.fetch = async (url, request) => {
    calls.requests += 1
    if (String(url).endsWith('/events')) return { ok: false, status: 503 } // 没有合成事件；卸载仍清理原订阅计时器。
    assert.equal(request.method, 'GET') // 完成前不允许引导把启动现值反向播种后端。
    if (!available) return { ok: false, status: 503 }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => structuredClone(String(url).endsWith('/native-policy') ? nativePolicy : generalPolicy) }
  }
  const options = { apiBase: 'https://backend.example.test', readToken: async () => 'synthetic-capability', userId: 'fixture-user', modeId: 'knowledge', presetId: 'adminsmart-knowledge', isAdmin: admin } // 完全合成可信租约，不读真实dotenv。
  const general = installSharedUiPolicy(ctx, options) // 使用正式General已采用getter。
  assert.equal(general.getBootstrapSnapshot(), null)
  for (let pass = 0; pass < 12 && !general.getBootstrapSnapshot(); pass += 1) await tick()
  assert.ok(general.getBootstrapSnapshot(), '真实General同步必须完成而非全fallback')
  const native = await installNativePolicy(ctx, options, { clientModuleSource: Buffer.from('export{}'), nativeBaseline: BASELINE, fetchImpl: globalThis.fetch, watchEvents: () => () => {}, assertSameOrigin() {}, readJsonBody: async () => ({}) }) // 正式Native采用器，只有HTTP/路由读写以Fake隔离。
  await native.refresh()
  assert.ok(native.getBootstrapSnapshot(), '真实Native同步必须完成而非全fallback')
  const injection = ctx.inject(['settingsController'], owner => installPolicyBootstrapHost(owner, { isAdmin: admin, getGeneralSnapshot: general.getBootstrapSnapshot, getNativeSnapshot: native.getBootstrapSnapshot })) // 与主Host相同的延迟公开inject，不制造Controller自依赖。
  const controller = admin ? installGuardedSettingsControllers(ctx, async () => {}) : ctx.plugin(AdminSmartReadOnlySettings) // 控制器必须在独立子fiber真正提供，不能ctx.provide假实例。
  await controller.await()
  await injection.await()
  /** @returns {object[]} 当前HTML的真实官方IndexInjection条目。 */
  const render = () => { const table = []; ctx.emit('webserver/index-inject', table); return table }
  return { ctx, rows, calls, general, native, render, injection,
    setAvailable(value) { available = value }, // 仅改变本测试后端Fake可用性。
    async close() {
      await ctx.fiber.dispose()
      globalThis.fetch = originalFetch
      assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
      await rm(temporary, { recursive: true, force: true }) // 只清理本次明确创建且已核对父目录的独占Home。
    },
  }
}

for (const admin of [true, false]) test(`真实${admin ? 'Guarded管理员' : '只读普通用户'}子fiber控制器公开inject生成可采用bootstrap`, async () => {
  const f = await fixture(admin) // 两角色各用独立Home、Context及合成后端。
  try {
    const before = { ...f.calls } // HTML渲染不能引发HTTP、配置或凭据操作。
    const table = f.render() // 正式Host监听直接消费当前公开controller.describe。
    const row = table.find(row => row.kind === 'global' && row.name === SETTINGS_BOOTSTRAP_GLOBAL) // 精确官方typed global，不能靠自拼script过测。
    assert.ok(row, '真实公开控制器必须正向注入，不能静默全部fallback')
    assert.deepEqual(f.calls, before)
    assert.equal(row.value.described.value.hasDocument, false)
    assert.equal(row.value.described.value.writable, admin)
    assert.equal(row.value.native.writable, admin)
    assert.equal(row.value.general.writable, admin)
    const namespaces = row.value.described.value.namespaces // 只包含当前角色真实存在的安全公开域。
    assert.equal(namespaces.length, admin ? 8 : 5)
    assert.ok(namespaces.some(row => row.ns === 'adminsmart-shared-settings'))
    assert.equal(namespaces.some(row => row.ns === 'llm-pi-ai'), false)
    const chat = namespaces.find(row => row.ns === 'ui-chat') // 两角色启动描述都必须立即采用Native偏好，不能先闪回raw默认。
    assert.equal(chat.value.collapseTiming, 'next-input')
    assert.equal(chat.base?.collapseTiming, admin ? 'completion' : undefined)
    assert.equal(chat.user?.collapseTiming, admin ? 'next-input' : undefined)
    assert.doesNotMatch(JSON.stringify(row.value), new RegExp(CANARY, 'u'))
    for (const descriptor of namespaces) {
      const schema = new Schema(descriptor.schema) // 官方公开构造器必须能重建投影引用图。
      assert.doesNotThrow(() => schema(structuredClone(descriptor.value))) // 不可仅检查shape而实际消费时fallback。
      if (!admin) { assert.equal(descriptor.autoGenerate, false); assert.equal(Object.hasOwn(descriptor, 'base'), false); assert.equal(Object.hasOwn(descriptor, 'user'), false) }
    }
    const remote = { settings: { describe: async () => { throw new Error('首次bootstrap不得发真实HTTP') } } } // 只接受一次启动读，意外回退明确失败。
    const reads = createPolicyBootstrapReads(row.value, { isNativePolicy, remote }) // 最新生产客户端解析器消费实际Host输出。
    assert.ok(reads, 'Host输出必须被正式客户端接受')
    assert.deepEqual(await reads.general.remote.settings.describe(), row.value.described)
    assert.deepEqual(await reads.native.remote.settings.describe(), row.value.described)
    const html = renderIndexInjections('<html><head></head><body></body></html>', table) // 官方renderer负责script敏感内容转义。
    assert.ok(html.includes(SETTINGS_BOOTSTRAP_GLOBAL))
    assert.equal(html.includes('</script><script>canary'), false)
    assert.equal(f.calls.credentials, 0)
  } finally { await f.close() }
})

test('真实raw Native变化或官方文档失效立即撤销采用证明，重新采用成功后恢复', async () => {
  const f = await fixture(true) // 管理员仍经官方Schema与CAS更新原生字体。
  try {
    const theme = f.ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'ui-theme') // 当前真实raw namespace修订。
    await f.ctx.settings.mutate('ui-theme', [{ op: 'set', path: ['codeFontSize'], value: theme.value.codeFontSize === 12 ? 13 : 12 }], theme.revision)
    assert.equal(f.native.getBootstrapSnapshot(), null)
    assert.equal(f.render().some(row => row.name === SETTINGS_BOOTSTRAP_GLOBAL), false)
    assert.equal(f.native.getPolicySnapshot().revision, 7) // 管理桥仍保留原后端确认语义，不能被bootstrap失效清空。
    await f.native.refresh()
    assert.ok(f.native.getBootstrapSnapshot())
    assert.ok(f.render().some(row => row.name === SETTINGS_BOOTSTRAP_GLOBAL))
    f.ctx.emit('settings/document-updated', 'subagent', 99) // 即使当前值相同，已有原生raw变更事实也撤销旧采用证明。
    assert.equal(f.native.getBootstrapSnapshot(), null)
    await f.native.refresh()
    assert.ok(f.native.getBootstrapSnapshot())
    f.setAvailable(false)
    await f.native.refresh()
    assert.equal(f.native.getBootstrapSnapshot(), null)
  } finally { await f.close() }
})

test('下调可信预算使过大引导回退HTTP，禁止突破固定128KiB硬上限', async () => {
  const f = await fixture(false) // 普通用户真实公开控制器用于失败关闭测试。
  try {
    await f.injection.dispose()
    const owner = f.ctx.extend() // 每个候选监听只拥有本测试独立scope。
    installPolicyBootstrapHost(owner, { isAdmin: false, getGeneralSnapshot: f.general.getBootstrapSnapshot, getNativeSnapshot: f.native.getBootstrapSnapshot, maximumBytes: 1 })
    assert.equal(f.render().some(row => row.name === SETTINGS_BOOTSTRAP_GLOBAL), false)
    assert.throws(() => installPolicyBootstrapHost(owner, { isAdmin: false, getGeneralSnapshot: () => null, getNativeSnapshot: () => null, maximumBytes: SETTINGS_BOOTSTRAP_MAXIMUM_BYTES + 1 }), /装配无效/u)
  } finally { await f.close() }
})
