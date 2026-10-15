/** 只读装载当前固定官方公开Config与原封不动的Client包；外部协议数据全部使用离线Fake。 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

import { applyGeneralSettings, captureGeneralSettings } from '../src/shared-ui-policy.mjs'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 仅进程级路径；未指定时明确跳过 SDK 契约，不写本机路径配置。
const packages = Object.freeze({
  locale: '@deepseek-ai/dsh-client-locale', // 官方语言属主。
  'ui-theme': '@deepseek-ai/dsh-client-ui-theme', // 官方外观与字号属主。
  'ui-chat': '@deepseek-ai/dsh-client-ui-chat', // 官方 transcript/统计/链接属主。
  'ui-conversation': '@deepseek-ai/dsh-client-ui-conversation', // 官方 Enter 行为属主。
  'ui-settings': '@deepseek-ai/dsh-client-ui-settings', // 官方诊断与共享 SettingsForms 属主。
})

/** @returns {Promise<object>} 从指定 SDK 的公开包入口装载 Schema，不创建 Cordis Runtime。 */
async function officialSdk() {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 所有模块只能来自本次指定的同一安装。
  const expectedVersion = require('./package.json').dependencies['@deepseek-ai/dsh'] // 核对待验收清单的精确目标发行版，不把旧版本成功误当成新版本兼容。
  const groupVersion = require('@deepseek-ai/dsh-app-boot/package.json').peerDependencies['@deepseek-ai/cordis-plugin-group'].replace(/^~/u, '') // 配套 vendor 版本取自官方声明。
  const modules = new Map() // 五个官方命名空间的公开 Config 模块。
  for (const [ns, name] of Object.entries(packages)) {
    assert.equal(require(`${name}/package.json`).version, expectedVersion, `${name} 必须来自同一目标发行版`)
    modules.set(ns, await import(pathToFileURL(require.resolve(name)).href))
  }
  assert.equal(require('@deepseek-ai/cordis-plugin-group/package.json').version, groupVersion)
  return { require, modules }
}

/** @param {Map<string, object>} modules 官方 Config 模块。 @param {object} sections 原生命名空间值。 @returns {Array<object>} 官方 Schema 解析后的展示描述 Fake。 */
function describeOfficial(modules, sections = {}) {
  return [...modules].map(([ns, module]) => ({
    ns, // 官方固定命名空间。
    value: Object.fromEntries(Object.entries(module.Config(structuredClone(sections[ns] ?? {}))).map(([key, value]) => [key, value.get()])), // 使用官方 Schema 本身验证与解析，不复制验证器。
    schema: module.Config.toJSON(), // 官方公开序列化 Schema，用于真实 Client 解码。
    revision: 1, // 合成原生修订，不读取任何用户 Profile。
    applies: 'live', // 五个通用字段均为官方实时表单。
    autoGenerate: false, // 普通用户没有可编辑表单。
    secrets: [], // 展示白名单不携带认证字段。
  }))
}

/** @param {unknown} initial 初始快照。 @returns {object} 官方 SnapshotStore 协议的最小离线 Fake。 */
function snapshotStore(initial) {
  let current = initial // 每次 set/update 发布一个稳定引用，供官方策略订阅。
  const listeners = new Set() // 公开 store.subscribe 订阅者。
  const store = {
    getSnapshot: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set(value) { current = value; for (const listener of [...listeners]) listener() },
    update(change) { const next = structuredClone(current); change(next); store.set(next) },
  } // 不挂 DOM、浏览器、React renderer 或真实连接。
  return store
}

/** @param {object} ctx Fake 服务上下文。 @param {string} name 官方服务名。 */
class FakeService {
  constructor(ctx, name) { this.ctx = ctx; ctx[name] = this }
}

/**
 * 用官方 ModuleLoader 契约装载原封不动的 Client 文件。
 * @param {object} sdk 当前固定官方SDK。
 * @param {string} name 官方包名。
 * @returns {Promise<object>} 官方 exports.apply/inject；其服务、store 和 React 依赖在进程内提供。
 * @sideEffects 仅读 npm 包文件，不改写、补丁或向上游注入导出；不创建浏览器。
 */
async function officialClient(sdk, name) {
  const path = sdk.require.resolve(`${name}/client`) // 官方公开 Client 导出路径。
  const source = await readFile(path, 'utf8') // 完整原始包只读加载，不抽取或改写私有类。
  let registration = null // 官方 __ModuleLoader__.load 注册结果。
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: record => { registration = record } } },
    structuredClone,
  }, { filename: path, timeout: 5_000 })
  assert.equal(registration.id, name)
  const { seeds } = await (await import('./official-client-boot-fixture.mjs')).originalClientPlatform() // 新版平台依赖采用真实官方Web种子，不能用空对象掩盖Tanstack等公开依赖。
  return registration.factory(dependency => {
    if (dependency === '@deepseek-ai/cordis') return { Service: FakeService }
    if (dependency === '@deepseek-ai/dsh-client-store') return { createSnapshotStore: snapshotStore, defineStore: spec => spec }
    if (dependency === '@deepseek-ai/dsh-client-ui-primitives') {
      const primitive = () => null // 给未挂载的官方图标/组件提供有效 React 类型，不复制 UI 或隐藏渲染警告。
      return new Proxy({}, { get: () => primitive })
    }
    if (['react', 'react/jsx-runtime', 'react-dom'].includes(dependency)) return sdk.require(dependency)
    if (Object.hasOwn(seeds, dependency)) return seeds[dependency] // 未被本Fixture明确隔离的纯前端平台依赖保持官方实现。
    throw new Error(`未隔离的官方 Client 依赖：${dependency}`)
  })
}

/**
 * 为官方 Client 提供公开 Remote/Slot/Store 协议 Fake。
 * @param {Array<object>} namespaces 来自官方 Config 的原生描述。
 * @param {boolean} loopback 官方 Remote 公告的 Host 能力条件；只用于验证两个官方分支，不修改产品判定。
 * @returns {object} 无浏览器、无网络的 Client 上下文及观察计数。
 */
function clientContext(namespaces, loopback) {
  const state = { namespaces, reads: 0, mutations: 0 } // Fake Remote 描述与读写计数。
  const slots = new Map() // 保存官方 General Slot 注册，供测试调用公开 inject。
  const events = new Map() // 官方 Remote/连接事件订阅。
  const dictionaries = new Map() // 官方注册的中文菜单文案。
  const cleanups = [] // 官方 effect 生命周期的卸载回调。
  const noOperation = () => () => {} // 不涉及会话分析的官方注册行为。
  const ctx = {
    remote: {
      $host: { isLoopback: loopback }, // 仅合成Host公告；当前官方两种入口均从Host获取描述，不能据此推断全站角色。
      $on(name, callback) { events.set(name, callback); return () => events.delete(name) },
      settings: {
        async describe() { state.reads += 1; return { ok: true, value: { writable: false, hasDocument: false, namespaces: state.namespaces } } },
        async mutate() { state.mutations += 1; throw new Error('只读 Remote 不能写入') },
      },
    },
    effect(register) { const dispose = register(); if (typeof dispose === 'function') cleanups.push(dispose); return dispose },
    on(name, callback) { events.set(name, callback); return () => events.delete(name) },
    inject(_names, register) { register(ctx) },
    locale: {
      register(ns, values) { dictionaries.set(ns, values.zh); return () => dictionaries.delete(ns) },
      bind(ns) { return key => dictionaries.get(ns)?.[key] ?? key },
    },
    slots: {
      inject(_name, register) { return register() },
      register(options, component) { slots.set(`${options.name}:${options.id}`, { options, component }); return () => {} },
      registerFactory(options, component) { slots.set(`${options.name}:${options.id}`, { options, component }); return () => {} }, // 新版官方推理内容工厂仍只记录注册，不伪造聊天呈现。
    },
    uiSession: { provide: noOperation },
    uiConversation: {
      events: { register: noOperation, registerFallback: noOperation },
      views: { register: noOperation },
      groups: { register: noOperation },
    },
    sidebarRightTabs: { get: () => ({}), subscribe: noOperation },
  } // 只提供官方安装所需公开注册协议，不复制其业务行为。
  return { ctx, state, slots, events, dictionaries, async close() { for (const dispose of cleanups.reverse()) await dispose() } }
}

test('固定alpha.3 Config覆盖八项字段、全部枚举、字号及官方未指定状态', { skip: !runtimeRoot }, async () => {
  const sdk = await officialSdk() // 只读当前指定 SDK，不装载 Gateway 或用户 Runtime。
  const rows = describeOfficial(sdk.modules) // 官方实际默认值及 optional 字段。
  const defaults = captureGeneralSettings({ describe: () => rows }) // 被测白名单捕获应与官方解析值一致。
  assert.deepEqual(defaults, { locale: null, theme: 'light', fontSize: 14, transcriptView: null, performanceUsage: 'detailed', developerTools: true, busyEnter: 'queue', linkOpening: 'sidebar' })
  assert.deepEqual(sdk.modules.get('ui-chat').TRANSCRIPT_VIEW_MODES, ['compact', 'standard', 'detailed', 'verbose'])
  assert.equal(sdk.modules.get('ui-chat').DEFAULT_TRANSCRIPT_VIEW_MODE, 'detailed')
  assert.deepEqual(sdk.modules.get('ui-theme').THEME_PREFERENCES, ['light', 'dark', 'system'])
  assert.deepEqual(sdk.modules.get('locale').LOCALE_IDS, ['zh', 'en'])
  assert.deepEqual(sdk.modules.get('ui-conversation').BUSY_ENTER_BEHAVIORS, ['queue', 'steer'])
  for (const mode of ['compact', 'standard', 'detailed', 'verbose', 'normal', 'expanded', null, undefined]) {
    const captured = captureGeneralSettings({ describe: () => describeOfficial(sdk.modules, { 'ui-chat': { transcriptView: mode } }) }) // 由官方 Schema 校验当前与兼容模式。
    assert.equal(captured.transcriptView, mode ?? null)
  }
  for (let fontSize = 10; fontSize <= 22; fontSize += 1) {
    assert.equal(captureGeneralSettings({ describe: () => describeOfficial(sdk.modules, { 'ui-theme': { fontSize } }) }).fontSize, fontSize)
  }
  assert.throws(() => describeOfficial(sdk.modules, { 'ui-theme': { fontSize: 9 } }))
  assert.throws(() => describeOfficial(sdk.modules, { 'ui-theme': { fontSize: 23 } }))
  for (const preference of ['zh', 'en', 'zh-Hans-CN', 'en-US']) {
    assert.equal(captureGeneralSettings({ describe: () => describeOfficial(sdk.modules, { locale: { preference } }) }).locale, preference)
  }
  assert.throws(() => describeOfficial(sdk.modules, { locale: { preference: 'zh_CN' } }))
  for (const performanceUsage of ['compact', 'detailed']) {
    assert.equal(captureGeneralSettings({ describe: () => describeOfficial(sdk.modules, { 'ui-chat': { performanceUsage } }) }).performanceUsage, performanceUsage)
  }
  for (const linkOpening of ['sidebar', 'new-tab']) {
    assert.equal(captureGeneralSettings({ describe: () => describeOfficial(sdk.modules, { 'ui-chat': { linkOpening } }) }).linkOpening, linkOpening)
  }
  for (const busyEnter of ['queue', 'steer']) {
    assert.equal(captureGeneralSettings({ describe: () => describeOfficial(sdk.modules, { 'ui-conversation': { busyEnter } }) }).busyEnter, busyEnter)
  }
  for (const enabled of [false, true]) {
    assert.equal(captureGeneralSettings({ describe: () => describeOfficial(sdk.modules, { 'ui-settings': { enabled } }) }).developerTools, enabled)
  }
})

test('固定alpha.3原生Schema以独立owned entry描述，false回写只命中实际namespace', { skip: !runtimeRoot }, async () => {
  const sdk = await officialSdk() // 原始SDK仅提供公开Config，不修改或复制任何第三方文件。
  const rows = describeOfficial(sdk.modules, { 'ui-settings': { enabled: true } }) // 所有元数据与有效值来自固定版真实Schema。
  const owned = 'adminsmart-shared-settings' // 唯一wrapper entry ID，原ui-settings被Profile停用。
  const general = rows.find(row => row.ns === 'ui-settings') // 官方Schema在独立entry上仍使用公开enabled字段。
  general.ns = owned
  general.revision = 11
  const writes = [] // 仅观察正式apply使用公开SettingsForms.update的真实namespace和CAS。
  const settings = {
    describe: () => structuredClone(rows), // 返回原生公开描述副本，不读取private Store。
    async update(ns, fields, expected) {
      const row = rows.find(candidate => candidate.ns === ns) // 只能命中已服务的实际entry，旧ui-settings不存在。
      assert.ok(row, '不能写未挂载旧官方entry')
      assert.equal(expected, row.revision)
      writes.push({ ns, fields: structuredClone(fields), expected })
      row.value = { ...row.value, ...fields }
      row.revision += 1
    },
    async mutate() { throw new Error('当前Fixture不需要unset') }, // 语言为null且未指定，不允许其它原生写入。
  }
  const captured = captureGeneralSettings(settings) // canonical八项策略必须完整，不能因owned ID缺失developerTools。
  assert.equal(captured.developerTools, true)
  await applyGeneralSettings(settings, { ...captured, developerTools: false })
  assert.deepEqual(writes, [{ ns: owned, fields: { enabled: false }, expected: 11 }])
  assert.equal(captureGeneralSettings(settings).developerTools, false)
  assert.equal(rows.some(row => row.ns === 'ui-settings'), false)
})

test('原始alpha.3 Client采用Host只读设置，verbose是完全展开且旧值按detailed显示', { skip: !runtimeRoot }, async () => {
  const sdk = await officialSdk() // 正式共享 SDK 的公开模块。
  const settings = await officialClient(sdk, packages['ui-settings']) // 原始官方 Settings Client，无源代码改写。
  const chat = await officialClient(sdk, packages['ui-chat']) // 原始官方 General transcript/统计/链接 Client。
  const fixture = clientContext(describeOfficial(sdk.modules, { 'ui-settings': { enabled: false } }), true) // 只读描述，但官方 Host 条件成立。
  try {
    settings.apply(fixture.ctx)
    await new Promise(resolve => setImmediate(resolve))
    chat.apply(fixture.ctx)
    const row = fixture.slots.get('settings.general.item:transcript-view') // 官方公开 General Slot 注册。
    const props = row.options.inject() // 直接读取官方公开 hooks，不进入浏览器或渲染 DOM。
    assert.equal(props.hooks.transcriptView.getSnapshot(), 'detailed')
    assert.equal(fixture.ctx.configForms.get('ui-settings').getSnapshot().writable, false)
    assert.equal(fixture.ctx.configForms.developerTools.enabled.getSnapshot(), false)
    const element = row.component({
      useTranscriptView: selector => selector(props.hooks.transcriptView.getSnapshot()), // 官方 hook 协议的离线读取。
      setTranscriptView: props.setTranscriptView, // 仅传入，不触发管理员 UI 编辑。
      useCollapseTiming: selector => selector(props.hooks.collapseTiming.getSnapshot()), // 当前折叠时机来自官方Host配置，仍与自有共享八字段白名单独立。
      setCollapseTiming: props.setCollapseTiming, // 使用官方原始行级动作，不自行实现折叠规则。
      t: fixture.ctx.locale.bind(row.options.locale), // 官方注册中文文案。
    }) // 官方 General 行返回的 React 元素，不挂载 renderer。
    const transcriptElement = element.props.children[0] // 新版公开返回 Fragment 的首行仍是工作步骤展示，次行是独立折叠时机。
    assert.deepEqual(Array.from(transcriptElement.props.options, option => option.id), ['compact', 'standard', 'detailed', 'verbose'])
    assert.equal(transcriptElement.props.options.find(option => option.id === 'verbose').label, '完全展开')
    assert.equal(props.hooks.collapseTiming.getSnapshot(), 'completion')
    fixture.state.namespaces = describeOfficial(sdk.modules, { 'ui-chat': { collapseTiming: 'next-input' } }) // 模拟管理员在Host保存，普通用户只采用描述，不调用原生编辑setter。
    fixture.events.get('settings/document-updated')()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(props.hooks.collapseTiming.getSnapshot(), 'next-input')
    for (const [saved, expected] of [[undefined, 'detailed'], [null, 'detailed'], ['normal', 'detailed'], ['expanded', 'detailed'], ['verbose', 'verbose']]) {
      fixture.state.namespaces = describeOfficial(sdk.modules, { 'ui-chat': { transcriptView: saved } }) // 替换合成共享描述，模拟保存后回读。
      fixture.events.get('settings/document-updated')()
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(props.hooks.transcriptView.getSnapshot(), expected)
    }
    assert.equal(fixture.state.mutations, 0, '只读采用不能发起任何官方 Remote 写入')
  } finally { await fixture.close() }
})

test('原始alpha.3非loopback入口也立即读取Host只读描述，公开表单拒绝写入且采用共享更新', { skip: !runtimeRoot }, async () => {
  const sdk = await officialSdk() // 同一固定官方安装，无真实网络。
  const settings = await officialClient(sdk, packages['ui-settings']) // 原始官方设置 Client。
  const fixture = clientContext(describeOfficial(sdk.modules), false) // 明确模拟官方非 loopback 条件，不推断真实部署。
  try {
    settings.apply(fixture.ctx)
    await new Promise(resolve => setImmediate(resolve))
    const form = fixture.ctx.configForms.get('ui-chat') // 原始公开Host ConfigForm，alpha.3已移除旧memory回退。
    assert.equal(form.getSnapshot().status, 'ready')
    assert.equal(form.getSnapshot().revision, 1)
    assert.equal(form.getSnapshot().writable, false)
    assert.equal(form.getSnapshot().value.performanceUsage, 'detailed')
    assert.equal(fixture.state.reads, 1)
    assert.equal(fixture.state.mutations, 0)
    let notifications = 0 // 观察公开订阅能否捕获原生本地编辑。
    const unsubscribe = form.subscribe(() => { notifications += 1 }) // 与拟议浏览器桥相同的公开订阅入口。
    const accepted = structuredClone(form.getSnapshot().value) // 原始Host接受值，拒绝写入后不能伪装成本地成功。
    await assert.rejects(form.set('transcriptView', 'verbose'), /只读 Remote 不能写入/u) // alpha.3原表单把传输拒绝交给调用方；真实权限在Host拒绝，不能吞掉此错误。
    assert.deepEqual(form.getSnapshot().value, accepted)
    assert.equal(fixture.state.mutations, 1, '显式越权写尝试必须实际到达拒绝入口')
    assert.equal(notifications, 0, '只读表单不能把被拒绝的编辑发布成本地成功状态')
    fixture.state.namespaces = describeOfficial(sdk.modules, { 'ui-chat': { transcriptView: 'verbose' } }) // 模拟管理员已保存后Host返回的新共享描述。
    fixture.events.get('settings/document-updated')()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(form.getSnapshot().value.transcriptView, 'verbose')
    assert.ok(notifications > 0, '真实Host描述变化必须经原生公开订阅发布')
    assert.equal(fixture.state.reads, 2)
    assert.equal(fixture.state.mutations, 1, '共享describe采用不能产生额外Remote写尝试，先前唯一尝试已明确拒绝')
    unsubscribe()
  } finally { await fixture.close() }
})
