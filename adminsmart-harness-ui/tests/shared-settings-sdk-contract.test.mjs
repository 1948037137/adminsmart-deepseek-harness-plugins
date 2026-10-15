/** 隔离装配证明：只读官方 SDK；状态、Remote、DOM 能力均为合成 Fixture。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPolicyBootstrapReads, installUiPolicyClient } from '../src/ui-policy-client.mjs'
import { emptyNativePolicy, isNativePolicy } from '../src/native-policy-client.mjs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { originalClientPlatform } from './official-client-boot-fixture.mjs'

const sdkRoot = process.env.ADMINSMART_DSH_ROOT // 被测 SDK 的进程级路径，不形成通用配置。
test('固定 alpha.3 真实 ModuleLoader 及 General/Locale/Theme/Chat 消费共享 façade', { skip: !sdkRoot }, async () => {
const sdkRequire = createRequire(pathToFileURL(resolve(sdkRoot, 'package.json'))) // 所有真实模块来自同一固定安装。
const officialPlatform = await originalClientPlatform() // 新版虚拟列表等平台依赖必须来自真实Web种子，不拼装假算法。
const cordis = await import(pathToFileURL(sdkRequire.resolve('@deepseek-ai/cordis')).href) // 验证实际 fiber 归属与公开 ctx.set。
const consumerIds = ['ui-settings-general', 'locale', 'ui-theme', 'ui-chat', 'ui-conversation'] // 原封不动装载的官方消费模块。
const registrations = new Map() // 保存官方公开 Slot 注册以读取注入的行为接口。
const clientFactories = new Map() // 保存原始官方Bundle的load登记，用于真实ClientModuleSystem的模块独立装载验证。

/** 为官方消费者提供稳定 ObservableSnapshot，实际发布替换引用。 */
function snapshotStore(initial) {
  let value = initial // 尚未再次发布时始终返回同一引用。
  const listeners = new Set() // 当前公开订阅者。
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set(next) { value = next; for (const listener of listeners) listener() },
    update(edit) { const next = structuredClone(value); edit(next); this.set(next) },
  }
}

/** 通过公开 client 导出读入完整 Lazy-CJS Bundle；禁止私有类抽取与源码改写。 */
async function loadClient(id) {
  const name = `@deepseek-ai/dsh-client-${id}` // 目标官方包身份。
  assert.equal(sdkRequire(`${name}/package.json`).version, '0.2.1-alpha.3')
  const file = sdkRequire.resolve(`${name}/client`) // 官方公开 Client subpath。
  let record // 官方 load 契约返回的模块登记。
  runInNewContext(await readFile(file, 'utf8'), {
    window: { __ModuleLoader__: { load(value) { record = value } } },
    navigator: { languages: ['zh'], language: 'zh' }, // 合成语言环境，不读取真实浏览器。
    structuredClone,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
  }, { filename: file })
  clientFactories.set(name, record)
  return record.factory(name => {
    if (name === '@deepseek-ai/cordis') return cordis
    if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore: snapshotStore, defineStore: spec => ({ ...spec, create() {
      const store = snapshotStore(spec.init()) // 每个官方 store.create 获得隔离稳定快照。
      const actions = Object.fromEntries(Object.entries(spec.actions ?? {}).map(([name, action]) => [name, (...args) => store.update(draft => action(draft, ...args))])) // 只模拟公开 defineStore 状态变更协议。
      return { ...store, actions }
    } }) }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return new Proxy({}, { get: () => () => null })
    if (name === '@deepseek-ai/dsh-client-ui-slots') return { resolveSlotLabel: label => typeof label === 'function' ? label() : label }
    if (['react', 'react/jsx-runtime', 'react-dom'].includes(name)) return sdkRequire(name)
    if (Object.hasOwn(officialPlatform.seeds, name)) return officialPlatform.seeds[name]
    throw new Error(`Fixture 未声明依赖：${name}`)
  })
}

await loadClient('ui-settings') // 只读登记原始官方服务提供者Bundle。
const consumers = new Map(await Promise.all(consumerIds.map(async id => [id, await loadClient(id)]))) // 官方消费者代码不做替换。
const moduleExports = await loadClient('modules') // 真正固定版的公开ModuleLoader实现。
const registrationTarget = { mode: 'queue', pendingQueue: [], load() {} } // 官方公开经典script load目标Fixture。
const moduleSystem = moduleExports.createClientModuleSystem(registrationTarget, { id: '@deepseek-ai/dsh-client-modules', exports: moduleExports }, {
  boot: { rev: 'fixture', entries: [{ id: '@deepseek-ai/dsh-client-ui-theme', url: './fixture-theme.js?rev=fixture', rev: 'fixture', inject: ['@deepseek-ai/dsh-client-ui-settings'] }], batches: [{ phase: 'application', url: './fixture-combo.js?rev=fixture', rev: 'fixture', entries: ['@deepseek-ai/dsh-client-ui-theme'] }] }, // native ui-settings没有graph/plugin row。
  staticModules: { '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': { createSnapshotStore: snapshotStore, defineStore: spec => spec }, '@deepseek-ai/dsh-client-ui-primitives': new Proxy({}, { get: () => () => null }), react: sdkRequire('react'), 'react-dom': sdkRequire('react-dom'), 'react/jsx-runtime': sdkRequire('react/jsx-runtime') }, // 官方平台模块的隔离 Fixture；新版 Theme 与普通浏览器使用同一真实 React seed。
  loadBundle: async () => { throw new Error('禁止真实网络资源装载') }, // 模块必须来自已登记的原封不动SDK字节。
})
registrationTarget.load(clientFactories.get('@deepseek-ai/dsh-client-ui-settings')) // 模拟固定资源script原始Bundle直接调用官方load；没有自行构造native工厂。
registrationTarget.load(clientFactories.get('@deepseek-ai/dsh-client-ui-theme')) // 真实消费包仍保留其informational inject。
await moduleSystem.prefetch('@deepseek-ai/dsh-client-ui-theme') // 缺失inject原row不应使正式模块加载失败。
await moduleSystem.import('@deepseek-ai/dsh-client-ui-theme/client', '', {})
const settings = await moduleSystem.import('@deepseek-ai/dsh-client-ui-settings/client', '', {}) // 公开module import只取得exports，不启动native插件entry。
assert.equal(moduleSystem.manifest.plugins.some(row => row.id === '@deepseek-ai/dsh-client-ui-settings'), false)
assert.equal(typeof settings.apply, 'function')
console.log(JSON.stringify({ originalSdkBytesRegisteredWithoutNativeGraphRow: true, nativeModuleImportedWithoutPluginActivation: true, informationalInjectAbsentRowAccepted: true }))
const noOperation = () => () => {} // 不涉及呈现或真实会话的合成能力。
const sections = {
  locale: { preference: 'zh' }, // 初始管理员语言策略。
  'ui-theme': { preference: 'dark', fontSize: 17 }, // 初始外观与字号。
  'ui-chat': { transcriptView: 'verbose', performanceUsage: 'compact', linkOpening: 'new-tab' }, // 初始聊天展示与链接。
  'ui-conversation': { busyEnter: 'steer' }, // 初始忙碌输入行为。
  'ui-settings': { enabled: false }, // 初始代码工作视图策略。
}


const schemas = new Map() // 五个Namespace元数据来自固定SDK真实公开Config。
for (const namespace of Object.keys(sections)) {
  const module = await import(pathToFileURL(sdkRequire.resolve('@deepseek-ai/dsh-client-' + namespace)).href) // 原样官方Host Schema。
  schemas.set(namespace, module.Config.toJSON())
}

for (const loopback of [false, true]) for (const writable of [false, true]) for (const bootstrapEnabled of [false, true]) {
  const ctx = new cordis.Context() // 真实 Cordis Context，测试其公开 fiber 服务所有权。
  const shared = { revision: 3, settings: { locale: 'zh', theme: 'dark', fontSize: 17, transcriptView: 'verbose', performanceUsage: 'compact', linkOpening: 'new-tab', busyEnter: 'steer', developerTools: false }, writable } // 合成共享策略唯一真源。
  let personalPreference = 'dark' // 当前用户的官方持久化选择，不能复用General.theme。
  const remote = {
    $host: { isLoopback: loopback }, // 仅测试官方原生模式，不修改产品Host事实。
    $on: noOperation, // 此回归通过公开refresh模拟采用，不连接真实事件服务。
    settings: { // 原样公开Settings Remote的合成回答。
      describe: async () => ({
        ok: true, // 合成官方Remote成功信封。
        value: {
          namespaces: [
            ...Object.entries(sections).map(([ns, value]) => ({
              ns: ns === 'ui-settings' ? 'adminsmart-shared-settings' : ns, // 实际owned entry身份仅在bridge归一化。
              value: { ...value, ...(ns === 'ui-theme' ? { preference: personalPreference } : {}), extra: 'fixture-private-extra' }, // 合成源额外值不得进入八字段DTO。
              schema: schemas.get(ns), // 当前固定SDK真实官方Schema。
              revision: 1, // 合成原生描述修订。
              applies: 'live', // General的原生实时生效能力。
              autoGenerate: false, // 不开放任意生成配置表单。
              secrets: [], // General没有秘密字段。
              extra: 'fixture-private-extra', // 合成源额外元数据也不得转发。
            })),
            ...(loopback ? [{ ns: 'ui-settings', value: { enabled: true }, schema: { type: 'object', dict: {} }, revision: 1, applies: 'live', autoGenerate: false, secrets: [] }] : []), // 历史canonical同存时owned优先，不能采用其不同Schema或产生重复行。
          ],
          writable: false, // 原生Remote只读，全部共享写必须经过CAS桥。
          hasDocument: false, // 合成环境不提供原生文件编辑。
        },
      }),
      mutate: async () => { throw new Error('禁止真实 Remote 写') }, // 测试不能误走官方持久化写入口。
    },
  }
  const fetchImpl = async (_url, request) => {
    if (_url === './adminsmart/personal-theme') {
      personalPreference = JSON.parse(request.body).mode // 单用户Fake，不修改全站记录。
      return { ok: true, json: async () => ({ preference: personalPreference, revision: 2 }) }
    }
    if (request.method === 'PUT') {
      assert.equal(writable, true)
      const body = JSON.parse(request.body) // 合成CAS请求，不使用凭据。
      assert.equal(body.expectedRevision, shared.revision)
      shared.revision += 1
      shared.settings = structuredClone(body.settings)
    }
    return { ok: true, json: async () => structuredClone(shared) }
  }
  const bootstrapDescription = await remote.settings.describe() // 从同一合成公开描述生成测试HTML元数据，不读取外部服务或凭据。
  bootstrapDescription.value.writable = writable // 当前组合模拟由真实Host交叉确认后的能力，不伪造实际产品角色。
  const bootstrap = bootstrapEnabled ? createPolicyBootstrapReads({
    version: 1, // 一次性自有HTML合同。
    harnessVersion: '0.2.1-alpha.3', // 与真正载入的原始SDK严格一致。
    general: structuredClone(shared), // 当前已确认八字段，与HTTP回答相同。
    native: { revision: 1, settings: emptyNativePolicy(), writable }, // 本组只验旧字段消费者，Native明确为空覆盖而非缺失能力。
    described: bootstrapDescription, // 原始固定SDK Schema，无网络Fake或私人字段投影代码替换。
  }, { isNativePolicy, remote, fetchImpl }) : null // 未启用时保留历史网络初始化组合。
  if (bootstrapEnabled) assert.ok(bootstrap)
  const slots = { inject: (_name, register) => register(), register: (options, component) => { registrations.set(`${options.name}:${options.id ?? ''}`, { options, component }); return () => {} }, registerFactory: (options, component) => { registrations.set(`${options.name}:${options.id ?? ''}`, { options, component }); return () => {} }, installLocale: noOperation, getVersion: () => 0, entries: () => [], subscribe: noOperation } // 仅记录官方公开接口，包含新版推理内容工厂注册，不渲染 UI。
  ctx.provide('remote', remote)
  ctx.provide('remote.settings', remote.settings)
  ctx.provide('slots', slots)
  ctx.provide('connection', { state: snapshotStore({ status: 'connected' }), reconnect() {} })
  ctx.provide('shortcuts', { catalog: snapshotStore([]), register: noOperation })
  ctx.provide('uiSession', { provide: noOperation })
  ctx.provide('uiConversation', { events: { register: noOperation, registerFallback: noOperation }, views: { register: noOperation }, groups: { register: noOperation } })
  ctx.provide('sidebarRightTabs', { get: () => ({}), subscribe: noOperation })
  let native // wrapper 所属 fiber 创建的官方原服务。
  let adapted // 供所有消费者共享的适配器。
  const wrapper = ctx.plugin({
    inject: settings.inject,
    apply(owner) {
      settings.apply(owner)
      native = owner.get('configForms', false) // providing fiber 正在 apply，公开 false 允许读取自身未激活的已提供实例。
      const bridge = installUiPolicyClient({ configForms: native, remote, fetchImpl, recoveryIntervalMs: 0, ...bootstrap?.general }) // 被测正式实现；启用时原始Theme/Locale首份值来自一次HTML确认数据。
      adapted = { adapter: bridge.configForms, bridge, async publish(namespace, fields) {
        const mapping = { locale: { preference: 'locale' }, 'ui-theme': { preference: 'theme', fontSize: 'fontSize' }, 'ui-chat': { transcriptView: 'transcriptView', performanceUsage: 'performanceUsage', linkOpening: 'linkOpening' }, 'ui-settings': { enabled: 'developerTools' } } // 测试外部管理员修改的真实协议映射。
        shared.revision += 1
        for (const [field, value] of Object.entries(fields)) shared.settings[mapping[namespace][field]] = value
        await bridge.refresh()
      } }
      owner.effect(() => () => bridge.dispose(), 'Fixture shared forms cleanup')
      owner.set('configForms', adapted.adapter) // 与服务提供方是同一 fiber，使用公开 API 替换值。
    },
  })
  await wrapper.await()
  assert.equal(wrapper.state, 2)
  await adapted.bridge.ready
  assert.equal(adapted.adapter.describe().getSnapshot().view.namespaces.length, 5)
  const ownedCanonical = adapted.adapter.describe().getSnapshot().view.namespaces.find(row => row.ns === 'ui-settings') // 原始General消费者仅看到canonical身份。
  assert.ok(ownedCanonical)
  if (bootstrapEnabled) assert.deepEqual(ownedCanonical.schema, schemas.get('ui-settings')) // HTML JSON序列化会分离引用，结构和官方消费者仍必须一致。
  else assert.strictEqual(ownedCanonical.schema, schemas.get('ui-settings'))
  assert.deepEqual(ownedCanonical.value, { enabled: false })
  assert.equal(Object.hasOwn(ownedCanonical, 'extra'), false)
  assert.equal(adapted.adapter.describe().getSnapshot().view.namespaces.some(row => row.ns === 'adminsmart-shared-settings'), false)
  let served = 0 // native memory模式也必须实际注册General能力。
  const offServed = adapted.adapter.whileServed(['ui-theme'], () => { served += 1; return () => {} })
  assert.equal(served, 1)
  assert.strictEqual(ctx.get('configForms'), adapted.adapter)
  assert.ok(ctx.get('settingsSchema'))
  assert.strictEqual(adapted.adapter.get('ui-theme').getSnapshot(), adapted.adapter.get('ui-theme').getSnapshot())
  let foreignRejected = false // 证明不能从另一个品牌 fiber 偷换服务。
  const foreign = ctx.plugin({ inject: ['configForms'], apply(owner) { try { owner.set('configForms', {}) } catch { foreignRejected = true } } })
  await foreign.await()
  assert.equal(foreignRejected, true)
  await consumers.get('locale').apply(ctx)
  consumers.get('ui-theme').apply(ctx)
  consumers.get('ui-settings-general').apply(ctx)
  consumers.get('ui-chat').apply(ctx)
  const react = sdkRequire('react') // 官方组件与JSX使用同一真实React实例。
  const { renderToStaticMarkup } = sdkRequire('react-dom/server') // 离线渲染官方General，不创建浏览器或访问网络。
  const generalSection = registrations.get('settings.section:general') // 真正原始官方General注册结果。
  assert.ok(generalSection)
  const items = [...registrations.values()].filter(entry => entry.options.name === 'settings.general.item') // 实际已注册的原生设置行。
  const renderedItems = items.map(entry => {
    const instance = entry.options.store?.create() // 依照公开renderer合同绑定官方声明store。
    const injected = entry.options.inject?.(instance?.actions) ?? {} // 官方公开行级方法和Observable hooks。
    const hooks = Object.fromEntries(Object.entries(injected.hooks ?? {}).map(([name, hook]) => ['use' + name[0].toUpperCase() + name.slice(1), select => select(hook.getSnapshot())])) // 提供原生renderer同名selector接口。
    return react.createElement(entry.component, { key: entry.options.id, ...injected, ...hooks, ...(instance ? { useStore: select => select(instance.getSnapshot()) } : {}), t: ctx.get('locale').bind(entry.options.locale ?? 'settings') })
  })
  const markup = renderToStaticMarkup(react.createElement(generalSection.component, { renderSlot: () => renderedItems })) // General按真实子Slot渲染原始组件。
  for (const label of ['外观', '字号大小', '工作步骤展示', '性能与用量', '显示代码工作视图']) assert.ok(markup.includes(label), label)
  assert.equal(ctx.get('locale').getSnapshot().active, 'zh')
  assert.equal(ctx.get('theme').getTheme().preference, 'dark')
  assert.equal(ctx.get('theme').getTheme().fontSizes.text, 17)
  assert.equal(ctx.get('theme').getTheme().fontFamilies.text, '')
  const transcript = registrations.get('settings.general.item:transcript-view').options.inject() // 官方 transcript 行的真实 Policy observable。
  assert.equal(transcript.hooks.transcriptView.getSnapshot(), 'verbose')
  const performance = registrations.get('settings.general.item:performance-usage').options.inject() // 官方性能行的真实 Policy observable。
  assert.equal(performance.hooks.performanceUsage.getSnapshot(), 'compact')
  const developer = registrations.get('settings.general.item:developer-tools').options.inject() // 官方 General 读取 adapter.developerTools.enabled。
  assert.equal(developer.hooks.developerTools.getSnapshot(), false)
  let changes = 0 // 记录真实官方策略订阅在无 DOM、无设置弹窗情况下的生效。
  const off = transcript.hooks.transcriptView.subscribe(() => { changes += 1 })
  await adapted.publish('ui-chat', { transcriptView: 'compact', performanceUsage: 'detailed' })
  await adapted.publish('ui-theme', { preference: 'light', fontSize: 20 })
  await adapted.publish('locale', { preference: 'en' })
  await adapted.publish('ui-settings', { enabled: true })
  assert.equal(changes, 1)
  assert.equal(transcript.hooks.transcriptView.getSnapshot(), 'compact')
  assert.equal(performance.hooks.performanceUsage.getSnapshot(), 'detailed')
  assert.equal(ctx.get('theme').getTheme().preference, 'dark', '共享历史主题不覆盖本人原生值')
  assert.equal(ctx.get('theme').getTheme().fontSizes.text, 20)
  assert.equal(ctx.get('locale').getSnapshot().active, 'en')
  assert.equal(developer.hooks.developerTools.getSnapshot(), true)
  transcript.setTranscriptView('standard')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(adapted.adapter.get('ui-chat').getSnapshot().value.transcriptView, writable ? 'standard' : 'compact')
  const beforePersonal = shared.revision // 本人主题不得推进General的共享CAS。
  ctx.get('theme').setTheme('light')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(adapted.adapter.get('ui-theme').getSnapshot().value.preference, 'light')
  assert.equal(shared.revision, beforePersonal)
  ctx.get('locale').setLocale('zh')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(adapted.adapter.get('locale').getSnapshot().value.preference, writable ? 'zh' : 'en')
  if (!writable) await assert.rejects(() => developer.setEnabled(false), /未保存/u)
  else { await developer.setEnabled(false); assert.equal(adapted.adapter.developerTools.enabled.getSnapshot(), false) }
  assert.strictEqual(adapted.adapter.get('unknown-native'), native.get('unknown-native'))
  assert.notStrictEqual(adapted.adapter.describe(), native.describe())
  assert.strictEqual(adapted.adapter.describe().getSnapshot(), adapted.adapter.describe().getSnapshot())
  if (writable) await adapted.adapter.get('locale').unset('preference')
  else { shared.settings.locale = null; shared.revision += 1; await adapted.bridge.refresh() }
  assert.equal(Object.hasOwn(adapted.adapter.get('locale').getSnapshot().value, 'preference'), false)
  assert.equal(ctx.get('locale').getSnapshot().active, 'zh') // 原始LocaleRuntime恢复合成浏览器语言，无null.toLowerCase异常。
  offServed()
  off()
  await wrapper.dispose()
  await foreign.dispose()
  console.log(JSON.stringify({ loopback, writable, bootstrapEnabled, sameFiberSet: true, foreignFiberRejected: true, nativeSettingsSchemaPreserved: true, officialConsumerAdoption: true, officialConsumerWritesEnforced: true, nativeUnknownNamespaceDelegation: true }))
}


})
