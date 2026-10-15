/** 原始SettingsForms验证冷启无变化采用与描述事件；只使用合成层数据及Fake Editor事务。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { applyGeneralSettings, captureGeneralSettings } from '../src/shared-ui-policy.mjs'
import { applyNativeNamespaces } from '../src/native-policy-host.mjs'
import { emptyNativePolicy, installNativePolicyClient } from '../src/native-policy-client.mjs'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 只读固定SDK，测试不读取任何生产配置。
const require = createRequire(pathToFileURL(join(runtimeRoot, 'package.json'))) // 所有Schema和Settings实现来自同一安装。
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { SettingsForms } = await load('@deepseek-ai/dsh-settings')
const BASELINE = { subagent: { maxDepth: 1, maxActiveSubagents: 2 }, 'agent-loop': { maxParallelToolCalls: 2 } } // 冻结业务模板值，两个并发2仅是本Fixture继承配置。

/**
 * 创建真实SettingsForms和公开Schema，Editor仅代替持久化事务及层数据。
 * @param {object} options 合成locale继承与字体用户覆盖。
 * @returns {Promise<object>} 实际Settings服务、调用证据与清理。
 */
async function fixture({ locale = {}, fontOverride = false } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'adminsmart-adopt-noop-')) // 当前测试唯一拥有的Home，不触碰真实legacy文档。
  const ctx = new Context() // 真实事件与service/fiber生命周期。
  const specs = [
    ['locale', '@deepseek-ai/dsh-client-locale', locale],
    ['ui-theme', '@deepseek-ai/dsh-client-ui-theme', { preference: 'light', fontSize: 14 }],
    ['ui-chat', '@deepseek-ai/dsh-client-ui-chat', { transcriptView: 'standard', performanceUsage: 'compact', linkOpening: 'sidebar' }],
    ['ui-conversation', '@deepseek-ai/dsh-client-ui-conversation', { busyEnter: 'queue' }],
    ['adminsmart-shared-settings', '@deepseek-ai/dsh-client-ui-settings', { enabled: false }],
    ['subagent', '@deepseek-ai/dsh-subagent', BASELINE.subagent],
    ['agent-loop', '@deepseek-ai/dsh-agent-loop', BASELINE['agent-loop']],
    ['ui-settings-general', '@deepseek-ai/dsh-client-ui-settings-general', {}],
  ] // 五General域与三个原生域使用真实SDK schema，不仿造默认配置。
  const rows = [] // Fake Editor返回的公开entry/inherited/override信息。
  for (const [id, name, inherited] of specs) {
    const module = await load(name) // 当前白名单原公开Host模块。
    const Config = module.Config ?? module.default.Config // 各官方包公开Schema身份。
    const override = id === 'ui-theme' && fontOverride ? { codeFontSize: Config(inherited).codeFontSize.get() } : {} // 故意用公开Volatile.get的真实默认字号构造同值用户覆盖。
    const raw = { ...structuredClone(inherited), ...override } // 冷编译后实际运行raw配置，与层数据分开。
    const entry = {
      id: 'include:' + id, // 原生SettingsForms区分完整Entry身份。
      options: { id, name, config: raw }, // 原始配置及真实Schema对应的唯一namespace。
      fiber: { uid: 'fixture-' + id, state: 2, runtime: { Config }, ctx, config: Config(raw) }, // Schema真实解析；不运行UI/Agent。
    }
    rows.push({ entry, inherited: structuredClone(inherited), override })
  }
  const edits = [] // 仅记录实际SettingsForms交给Editor的写入，不记录敏感内容。
  const calls = [] // 当前自有Adapter发起的update/mutate公开调用。
  const events = [] // 原SDK发出的非敏感namespace+revision事件。
  ctx.provide('loader', { await: async () => {} }) // SettingsForms仅等待Fixture已就绪的loader。
  ctx.provide('profileContext', { home: temporary, name: 'fixture' }) // Legacy探测只访问本测试空Home。
  ctx.provide('configEditor', {
    documentPath: join(temporary, 'fixture.patch.json'), // 只描述合成文档路径，没有生产写入。
    entries: () => rows.map(row => row.entry),
    configuration: () => rows,
    async edit(entry, change) {
      const row = rows.find(row => row.entry === entry) // 当前合成层，实际SettingsForms负责CAS、schema和path算法。
      const next = change(structuredClone(entry.options.config), structuredClone(row.inherited)) // 不能Fake官方unset到继承的转换。
      edits.push({ ns: entry.options.id, next })
      entry.options.config = next
      entry.fiber.config = entry.fiber.runtime.Config(next)
      row.override = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(row.inherited[key]))) // 模拟Editor完整config相对继承层的明确覆盖，不篡改SettingsForms。
    },
  })
  ctx.on('settings/document-updated', (ns, revision) => events.push({ ns, revision }))
  const fiber = ctx.plugin(SettingsForms) // 原始Settings描述、修订和变化事件全部实际执行。
  await fiber.await()
  const settings = {
    describe: options => ctx.settings.describe(options),
    update: async (...args) => { calls.push({ method: 'update', ns: args[0] }); return ctx.settings.update(...args) },
    mutate: async (...args) => { calls.push({ method: 'mutate', ns: args[0] }); return ctx.settings.mutate(...args) },
  } // 只记录外部调用，原服务实现没有被替换或monkeypatch。
  return { ctx, settings, calls, edits, events,
    async close() {
      await fiber.dispose()
      await ctx.fiber.dispose()
      assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
      await rm(temporary, { recursive: true, force: true })
    },
  }
}

test('相同General/native策略且无user覆盖：首次与重复采用均零update/mutate，首describe仍发事件', async () => {
  const f = await fixture() // 已由冻结模板冷编译到目标值，所有user层为空。
  try {
    const policy = captureGeneralSettings(f.settings) // 原SDK首describe产生真实namespace首见事件。
    assert.ok(policy)
    assert.equal(f.events.length, 8)
    assert.equal(f.events.every(event => event.revision === 0), true)
    assert.equal(f.ctx.settings.describe().every(row => Object.keys(row.user).length === 0), true)
    const initialEvents = f.events.length // 重复describe不能制造同raw新事件。
    for (let pass = 0; pass < 2; pass += 1) {
      await applyGeneralSettings(f.settings, policy)
      await applyNativeNamespaces(f.settings, emptyNativePolicy(), BASELINE)
    }
    assert.equal(f.calls.length, 0)
    assert.equal(f.edits.length, 0)
    assert.equal(f.events.length, initialEvents)
  } finally { await f.close() }
})

test('省略原生字体字段会清除真实同默认值user覆盖：有效值不变但raw修订与事件确实改变', async () => {
  const f = await fixture({ fontOverride: true }) // 同默认值仍是明确user覆盖，不能冒充无override。
  try {
    const before = f.ctx.settings.describe().find(row => row.ns === 'ui-theme') // 真实SDK值与覆盖可同时读取。
    assert.equal(Object.hasOwn(before.user, 'codeFontSize'), true)
    f.events.length = 0
    await applyNativeNamespaces(f.settings, emptyNativePolicy(), BASELINE)
    const after = f.ctx.settings.describe().find(row => row.ns === 'ui-theme') // 原SDKunset恢复schema/inherited语义。
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].ns, 'ui-theme')
    assert.equal(after.value.codeFontSize, before.value.codeFontSize)
    assert.equal(Object.hasOwn(after.user, 'codeFontSize'), false)
    assert.equal(after.revision, before.revision + 1)
    assert.deepEqual(f.events, [{ ns: 'ui-theme', revision: after.revision }])
  } finally { await f.close() }
})

test('locale=null但仅继承preference=zh：当前General仍调用unset，实际值无法清空且不因此发新revision事件', async () => {
  const f = await fixture({ locale: { preference: 'zh' } }) // 与无覆盖同policy情形严格区分，只验证候选边界。
  try {
    const current = captureGeneralSettings(f.settings) // 当前有效语言属于继承层。
    f.events.length = 0
    const row = f.ctx.settings.describe().find(row => row.ns === 'locale') // 真实user为空，证明冗余调用并非清理用户覆盖。
    assert.deepEqual(row.user, {})
    await applyGeneralSettings(f.settings, { ...current, locale: null })
    assert.deepEqual(f.calls, [{ method: 'mutate', ns: 'locale' }])
    assert.equal(f.edits.length, 1)
    assert.equal(captureGeneralSettings(f.settings).locale, 'zh')
    assert.equal(f.events.length, 0)
  } finally { await f.close() }
})

test('真实SettingsForms首describe事件合并到在途Native Client读取：GET/describe各一轮且无设置写入或connection/reset', async () => {
  const f = await fixture() // 尚未describe的真实SettingsForms，不能提前吞掉首见事件。
  const legacy = { revision: 1, writable: false, settings: { locale: null, theme: 'light', fontSize: 14, transcriptView: 'standard', performanceUsage: 'compact', developerTools: false, busyEnter: 'queue', linkOpening: 'sidebar' } } // 既有八字段Facade的合成只读真源。
  const form = { getSnapshot: () => ({ status: 'ready', value: { preference: 'light', fontSize: 14 }, writable: false, revision: 1 }), subscribe: () => () => {} } // 未操作的合成旧General表单。
  const directory = { getSnapshot: () => ({ status: 'ready', view: { writable: false, namespaces: [] } }), subscribe: () => () => {}, acceptView() {} } // 旧目录不生成原SDK事件，首见事件只来自实际SettingsForms。
  let gets = 0 // 新Native HTTP的实际Fake只读调用次数。
  let describes = 0 // 原SDK实际描述调用次数。
  let resets = 0 // 明确验证没有Connection事件参与此次重复。
  f.ctx.on('connection/reset', () => { resets += 1 })
  const controller = installNativePolicyClient({
    ctx: f.ctx, // 真实事件总线，允许测量原document-updated导致的回读。
    nativeBaseline: BASELINE, // 与实际初始继承完全一致。
    general: { configForms: { get: () => form, describe: () => directory }, getPolicySnapshot: () => legacy, acceptPolicySnapshot() {}, subscribe: () => () => {} },
    remote: {
      $on: (name, callback) => f.ctx.on(name, (...args) => queueMicrotask(() => callback(...args))), // Host事件经异步消息边界进入Client；不能用同步直连伪造跨进程重入。
      settings: { async describe() {
        describes += 1
        return { ok: true, value: { writable: false, namespaces: f.ctx.settings.describe({ redactSecrets: true }) } }
      } },
    },
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, 'GET') // 当前场景只读，不能用写入引发重复。
      gets += 1
      return { ok: true, json: async () => ({ revision: 1, settings: emptyNativePolicy(), writable: false }) }
    },
  })
  try {
    await controller.ready // 等待原公开首次读Promise，不手工调用refresh制造第二轮。
    assert.equal(controller.getSnapshot().status, 'ready')
    assert.equal(f.events.length, 8)
    assert.equal(f.events.every(event => event.revision === 0), true)
    assert.equal(gets, 1)
    assert.equal(describes, 1)
    assert.equal(f.calls.length, 0)
    assert.equal(f.edits.length, 0)
    assert.equal(resets, 0)
  } finally { controller.dispose(); await f.close() }
})
