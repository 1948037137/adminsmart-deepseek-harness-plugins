/** 共享 General 真实 ConfigForms 协议回归；所有策略、Remote 与身份均为隔离 Fixture。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { GENERAL_SETTINGS_NAMESPACES, installUiPolicyClient } from '../src/ui-policy-client.mjs'

const INITIAL_POLICY = Object.freeze({
  locale: 'zh', // 已接受的管理员语言偏好。
  theme: 'dark', // 已接受的外观偏好。
  fontSize: 15, // 合法内容字号。
  transcriptView: 'standard', // 已接受的工作步骤展示。
  performanceUsage: 'detailed', // 性能与用量明细。
  busyEnter: 'queue', // 忙碌时排队发送。
  linkOpening: 'sidebar', // 链接优先侧栏。
  developerTools: true, // 代码工作视图开启。
})

/**
 * 构造不连接后端的固定同源与公开官方服务 Fixture。
 * @param {object} [options] 指定公开native模式与可信写能力。
 * @param {'host'|'memory'} [options.mode] 原生Settings行为条件。
 * @param {boolean} [options.writable] 后端返回的可信管理员能力。
 * @returns {object} 隔离状态、native、remote及bridge。
 */
function fixture({ mode = 'memory', writable = true, failRead = false } = {}) {
  const state = { remote: { revision: 4, settings: structuredClone(INITIAL_POLICY), writable }, calls: [], failRead, failWrite: 0, beforeGet: null, beforePut: null, afterPut: null, delivery: 'delivered' } // 合成持久化真源与明确控制的响应时序。
  const nativeForm = { getSnapshot: () => ({ mode }), set: async () => true } // 未接管namespace应保持官方对象身份。
  const nativeSnapshot = Object.freeze({ status: mode === 'host' ? 'ready' : 'unavailable', view: mode === 'host' ? { namespaces: [{ ns: 'native-other', value: { value: 1 } }], writable: true, hasDocument: true } : undefined, error: null }) // memory模式必须没有原生describe值。
  const nativeListeners = new Set() // 官方未知namespace目录订阅。
  const events = new Map() // 原生文档变化事件的受控订阅。
  const nativeDescribe = { getSnapshot: () => nativeSnapshot, subscribe(listener) { nativeListeners.add(listener); return () => nativeListeners.delete(listener) }, ensure: async () => {}, acceptView() {} } // 保留公开describe的精确委托身份。
  const native = { get: () => nativeForm, describe: () => nativeDescribe } // 不能靠native memory form获得General值。
  const remote = {
    settings: { describe: async () => ({ ok: true, value: { namespaces: GENERAL_SETTINGS_NAMESPACES.map(ns => ({ ns, value: {}, schema: { type: 'object', dict: {} }, revision: 1, autoGenerate: false, applies: 'live', secrets: [] })), writable, hasDocument: false } }) }, // 官方公开Schema元数据Fixture。
    $on(name, listener) { events.set(name, listener); return () => events.delete(name) },
  }
  const fetchImpl = async (url, request) => {
    assert.equal(url, './adminsmart/ui-policy')
    const body = request.body ? JSON.parse(request.body) : undefined // 只解析合成请求，不读取认证数据。
    state.calls.push({ method: request.method, body })
    if (request.method === 'GET') {
      const held = structuredClone(state.remote) // 故意捕获请求发起时值，检验迟到GET失效。
      if (state.beforeGet) await state.beforeGet()
      return { ok: !state.failRead, status: state.failRead ? 503 : 200, json: async () => held }
    }
    if (state.beforePut) await state.beforePut()
    if (state.failWrite) return { ok: false, status: state.failWrite, json: async () => { throw new Error('失败正文不得读取') } }
    assert.equal(body.expectedRevision, state.remote.revision)
    state.remote = { ...state.remote, revision: state.remote.revision + 1, settings: structuredClone(body.settings) }
    const accepted = structuredClone(state.remote) // HTTP成功回答必须捕获commit时快照，不能夹带后续其它管理员值。
    if (state.afterPut) await state.afterPut()
    return { ok: true, headers: { get: () => state.delivery }, json: async () => accepted }
  }
  const bridge = installUiPolicyClient({ configForms: native, remote, fetchImpl, recoveryIntervalMs: 0 }) // 与产品相同纯契约，无DOM与网络。
  return { state, native, nativeForm, nativeDescribe, events, bridge }
}

/** @returns {object} 受控异步时序闸，不使用真实服务或长时间等待。 */
function deferred() {
  let resolve // 当前合成异步请求的放行方法。
  const promise = new Promise(done => { resolve = done }) // Fixture明确控制响应先后顺序。
  return { promise, resolve }
}

for (const mode of ['host', 'memory']) test(mode + '模式：准确映射八字段、真实served目录、稳定快照与未知Namespace委托', async () => {
  const { bridge, nativeForm, nativeDescribe, state } = fixture({ mode }) // 同一实现验证两个原生条件。
  try {
    let registered = 0 // whileServed真正看到General目录后的注册次数。
    let released = 0 // 公开目录注册的卸载次数。
    const off = bridge.configForms.whileServed(['ui-theme'], served => { assert.ok(served.has('locale')); registered += 1; return () => { released += 1 } })
    await bridge.ready
    assert.equal(registered, 1)
    const theme = bridge.configForms.get('ui-theme') // 所有消费者共享同一官方namespace接口。
    assert.strictEqual(theme, bridge.configForms.get('ui-theme'))
    assert.strictEqual(theme.getSnapshot(), theme.getSnapshot())
    assert.strictEqual(bridge.getSnapshot(), bridge.getSnapshot())
    assert.strictEqual(bridge.configForms.describe().getSnapshot(), bridge.configForms.describe().getSnapshot())
    assert.deepEqual(theme.getSnapshot().value, { preference: 'dark', fontSize: 15 })
    assert.deepEqual(bridge.configForms.describe().getSnapshot().view.namespaces.filter(row => GENERAL_SETTINGS_NAMESPACES.includes(row.ns)).map(row => row.ns), GENERAL_SETTINGS_NAMESPACES)
    assert.strictEqual(bridge.configForms.get('native-other'), nativeForm)
    assert.equal(typeof bridge.configForms.describe().acceptView, 'function')
    assert.ok(nativeDescribe)
    assert.equal(await theme.set('preference', 'light'), true)
    assert.equal(await bridge.configForms.get('locale').set('preference', 'en'), true)
    await bridge.configForms.developerTools.setEnabled(false)
    assert.equal(state.remote.settings.theme, 'light')
    assert.equal(state.remote.settings.locale, 'en')
    assert.equal(state.remote.settings.developerTools, false)
    assert.equal(bridge.configForms.developerTools.enabled.getSnapshot(), false)
    assert.equal(state.calls.filter(call => call.method === 'PUT').length, 3)
    off()
    assert.equal(released, 1)
  } finally { bridge.dispose() }
})

test('普通用户实时采用、无PUT且原生developerTools.enabled可订阅', async () => {
  const { bridge, state, events } = fixture({ writable: false }) // 可信后端明确只读。
  try {
    await bridge.ready
    assert.equal(bridge.configForms.get('ui-theme').getSnapshot().writable, false)
    assert.equal(await bridge.configForms.get('ui-theme').set('fontSize', 22), false)
    await assert.rejects(() => bridge.configForms.developerTools.setEnabled(false), /未保存/u)
    let notifications = 0 // 原始官方boolean消费者收到真实接受变化。
    const off = bridge.configForms.developerTools.enabled.subscribe(() => { notifications += 1 })
    state.remote = { ...state.remote, revision: 5, settings: { ...state.remote.settings, developerTools: false, fontSize: 20 } }
    events.get('settings/document-updated')('ui-theme')
    await bridge.refresh()
    assert.equal(bridge.configForms.get('ui-theme').getSnapshot().value.fontSize, 20)
    assert.equal(notifications, 1)
    assert.equal(state.calls.filter(call => call.method === 'PUT').length, 0)
    off()
  } finally { bridge.dispose() }
})

test('跨Namespace快速编辑串行CAS，第二次写入保留第一次编辑', async () => {
  const { bridge, state } = fixture() // 共享revision四起始。
  try {
    await bridge.ready
    const first = bridge.configForms.get('ui-theme').set('fontSize', 20) // 两个请求在同一轮立即排队。
    const second = bridge.configForms.get('ui-chat').set('transcriptView', 'verbose') // 不能捕获第一次PUT前的旧完整策略。
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    const puts = state.calls.filter(call => call.method === 'PUT') // 只比较合成CAS记录。
    assert.deepEqual(puts.map(call => call.body.expectedRevision), [4, 5])
    assert.equal(puts[1].body.settings.fontSize, 20)
    assert.equal(state.remote.settings.transcriptView, 'verbose')
  } finally { bridge.dispose() }
})

test('locale unset/API null在原生快照省略，transcript null保留且非法路径拒绝', async () => {
  const { bridge, state } = fixture() // 官方原生消费者不能得到locale.preference:null。
  try {
    await bridge.ready
    assert.equal(await bridge.configForms.get('locale').unset('preference'), true)
    assert.equal(state.remote.settings.locale, null)
    assert.equal(Object.hasOwn(bridge.configForms.get('locale').getSnapshot().value, 'preference'), false)
    assert.equal(await bridge.configForms.get('ui-chat').unset('transcriptView'), true)
    assert.equal(bridge.configForms.get('ui-chat').getSnapshot().value.transcriptView, null)
    const count = state.calls.length // 非法字段不能访问网络。
    assert.equal(await bridge.configForms.get('ui-theme').mutate([{ op: 'set', path: ['credentials', 'key'], value: 'fixture' }]), false)
    assert.equal(await bridge.configForms.get('ui-theme').set('preference', 'invalid'), false)
    assert.equal(state.calls.length, count)
  } finally { bridge.dispose() }
})

test('CAS409回读胜出策略，错误可展示、旧草稿不重发', async () => {
  const { bridge, state } = fixture() // 另一个管理员的合成并发更新。
  try {
    await bridge.ready
    state.remote = { ...state.remote, revision: 5, settings: { ...state.remote.settings, theme: 'light' } }
    state.failWrite = 409
    assert.equal(await bridge.configForms.get('ui-theme').set('fontSize', 22), false)
    assert.equal(bridge.configForms.get('ui-theme').getSnapshot().value.preference, 'light')
    assert.equal(state.calls.filter(call => call.method === 'PUT').length, 1)
    assert.match(bridge.getError(), /其他管理员/u)
    assert.equal(bridge.getSnapshot().saving, false)
  } finally { bridge.dispose() }
})

test('已排队旧编辑不能借用外部事件采用的新CAS，迟到自有ACK不能降级winner', async () => {
  const { bridge, state, events } = fixture() // 自有commit后，另一管理员先于ACK到达修改策略。
  try {
    await bridge.ready
    const committed = deferred() // 确认第一个合成PUT已commit。
    const release = deferred() // 暂时扣住已经commit的旧成功回答。
    state.afterPut = async () => { committed.resolve(); await release.promise }
    const first = bridge.configForms.get('ui-theme').set('fontSize', 20) // 自有修订四到五。
    const queued = bridge.configForms.get('ui-chat').set('transcriptView', 'verbose') // 与第一项同一旧epoch的排队草稿。
    await committed.promise
    state.remote = { ...state.remote, revision: 6, settings: { ...state.remote.settings, fontSize: 18, theme: 'light' } } // 另一管理员的后续胜出修订。
    events.get('settings/document-updated')('ui-theme')
    await bridge.refresh()
    release.resolve()
    assert.equal(await first, true) // 自有PUT曾成功commit，不能误报未保存。
    assert.equal(await queued, false) // 旧草稿不能冒用另一管理员的新revision继续提交。
    assert.equal(state.calls.filter(call => call.method === 'PUT').length, 1)
    assert.equal(bridge.getSnapshot().revision, 6)
    assert.deepEqual(bridge.configForms.get('ui-theme').getSnapshot().value, { preference: 'light', fontSize: 18 })
    assert.equal(state.remote.settings.transcriptView, 'standard')
    assert.match(bridge.getError(), /其他管理员/u)
  } finally { bridge.dispose() }
})

test('自有commit原生事件早于PUT回答仍保留连续排队编辑，不误认为其它管理员', async () => {
  const { bridge, state, events } = fixture() // Host推送事件可以早于当前HTTP成功回答。
  try {
    await bridge.ready
    const committed = deferred() // 先确认自有修订五已经提交。
    const release = deferred() // 暂扣当前PUT的成功ACK。
    state.afterPut = async () => { committed.resolve(); await release.promise }
    const first = bridge.configForms.get('ui-theme').set('fontSize', 20)
    const second = bridge.configForms.get('ui-chat').set('transcriptView', 'verbose')
    await committed.promise
    state.remote.settings = Object.fromEntries(Object.entries(state.remote.settings).reverse()) // 同一提交的JSON键序不改变业务身份。
    events.get('settings/document-updated')('ui-theme')
    await bridge.refresh()
    state.afterPut = null
    release.resolve()
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    assert.deepEqual(state.calls.filter(call => call.method === 'PUT').map(call => call.body.expectedRevision), [4, 5])
    assert.equal(state.remote.settings.fontSize, 20)
    assert.equal(state.remote.settings.transcriptView, 'verbose')
    assert.equal(bridge.getError(), null)
  } finally { bridge.dispose() }
})

test('409撤销同一旧epoch其它待提交草稿，delayed成功提示不重发', async () => {
  const { bridge, state } = fixture() // 并发冲突和commit后推送延迟是两种不同状态。
  try {
    await bridge.ready
    state.remote = { ...state.remote, revision: 5, settings: { ...state.remote.settings, theme: 'light' } }
    state.failWrite = 409
    const first = bridge.configForms.get('ui-theme').set('fontSize', 22) // 旧修订提交被CAS拒绝。
    const queued = bridge.configForms.get('ui-chat').set('transcriptView', 'verbose') // 旧pending不得覆盖胜出值。
    assert.deepEqual(await Promise.all([first, queued]), [false, false])
    assert.equal(state.calls.filter(call => call.method === 'PUT').length, 1)
    state.failWrite = 0
    state.delivery = 'delayed'
    assert.equal(await bridge.configForms.get('ui-theme').set('fontSize', 19), true) // 用户重新编辑形成新的epoch。
    assert.equal(bridge.getSnapshot().notice, '设置已保存，实时同步暂不可用')
    assert.equal(bridge.getError(), null)
    assert.equal(state.calls.filter(call => call.method === 'PUT').length, 2)
  } finally { bridge.dispose() }
})

test('失败保留接受值、公开错误并恢复，初次GET不可用也可回读恢复', async () => {
  const { bridge, state } = fixture() // 不解析失败响应正文。
  try {
    await bridge.ready
    state.failWrite = 503
    await assert.rejects(() => bridge.configForms.get('ui-theme').set('fontSize', 22), /保存失败/u)
    assert.equal(bridge.configForms.get('ui-theme').getSnapshot().value.fontSize, 15)
    assert.match(bridge.getSnapshot().error, /保存失败/u)
    state.failWrite = 0
    assert.equal(await bridge.configForms.get('ui-theme').set('fontSize', 21), true)
    assert.equal(bridge.getError(), null)
    state.failRead = true
    await bridge.refresh()
    assert.equal(bridge.getSnapshot().status, 'ready')
    assert.match(bridge.getError(), /失败/u)
    state.failRead = false
    await bridge.refresh()
    assert.equal(bridge.getError(), null)
  } finally { bridge.dispose() }
})

test('初次GET不可用明确结束为unavailable，恢复后提供完整served目录', async () => {
  const { bridge, state } = fixture({ failRead: true }) // 不依赖首次成功值的真实失败启动。
  try {
    await bridge.ready
    assert.equal(bridge.getSnapshot().status, 'unavailable')
    assert.equal(bridge.configForms.get('ui-theme').getSnapshot().writable, false)
    state.failRead = false
    await bridge.refresh()
    assert.equal(bridge.getSnapshot().status, 'ready')
    assert.equal(bridge.configForms.describe().getSnapshot().view.namespaces.length, 5)
  } finally { bridge.dispose() }
})

test('较早GET不能覆盖已确认PUT，dispose后迟到写入也不能发布', async () => {
  const { bridge, state, events } = fixture() // 闸门控制读取/写入响应顺序。
  try {
    await bridge.ready
    const gate = deferred() // 拦住捕获旧值的GET。
    state.beforeGet = () => gate.promise
    const reading = bridge.refresh()
    assert.equal(await bridge.configForms.get('ui-theme').set('fontSize', 19), true)
    gate.resolve()
    await reading
    assert.equal(bridge.configForms.get('ui-theme').getSnapshot().value.fontSize, 19)
    state.beforeGet = null
    const writeGate = deferred() // 拦住将要返回成功的PUT。
    state.beforePut = () => writeGate.promise
    const writing = bridge.configForms.get('ui-theme').set('fontSize', 22)
    await Promise.resolve()
    bridge.dispose()
    writeGate.resolve()
    assert.equal(await writing, false)
    assert.equal(bridge.configForms.get('ui-theme').getSnapshot().value.fontSize, 19)
    assert.equal(bridge.configForms.get('ui-theme').getSnapshot().writable, false)
    assert.equal(events.size, 0)
  } finally { bridge.dispose() }
})
