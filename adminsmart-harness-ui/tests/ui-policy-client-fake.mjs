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
 * @param {object} [options.themeMetadata] 指定当前官方主题 Schema 与安全值，用于升级兼容边界回归。
 * @param {boolean} [options.officialWritable] 官方 describe 自身确认的写能力，与共享策略分别验证。
 * @param {object[]} [options.nativeRows] 原生模型及恶意未知行的脱敏描述，用于验证管理员白名单。
 * @returns {object} 隔离状态、native、remote及bridge。
 */
function fixture({ mode = 'memory', writable = true, failRead = false, themeMetadata, officialWritable = writable, nativeRows = [] } = {}) {
  const state = { personal: { preference: themeMetadata?.value?.preference ?? 'light', revision: 1 }, remote: { revision: 4, settings: structuredClone(INITIAL_POLICY), writable }, calls: [], failRead, failWrite: 0, beforeGet: null, beforePut: null, afterPut: null, delivery: 'delivered' } // 合成持久化真源与明确控制的响应时序。
  const nativeForm = { getSnapshot: () => ({ mode }), set: async () => true } // 未接管namespace应保持官方对象身份。
  let nativeSnapshot = Object.freeze({ status: mode === 'host' ? 'ready' : 'unavailable', view: mode === 'host' ? { namespaces: [{ ns: 'native-other', value: { value: 1 } }], writable: true, hasDocument: true } : undefined, error: null }) // 可控官方镜像；memory模式初始没有原生describe值。
  const nativeListeners = new Set() // 官方未知namespace目录订阅。
  const events = new Map() // 原生文档变化事件的受控订阅。
  const nativeDescribe = { getSnapshot: () => nativeSnapshot, subscribe(listener) { nativeListeners.add(listener); return () => nativeListeners.delete(listener) }, ensure: async () => {}, acceptView() {} } // 保留公开describe的精确委托身份。
  const native = { get: () => nativeForm, describe: () => nativeDescribe } // 不能靠native memory form获得General值。
  const remote = {
    settings: { describe: async () => ({ ok: true, value: { namespaces: [...GENERAL_SETTINGS_NAMESPACES.map(ns => ({ ns, value: ns === 'ui-theme' ? { ...themeMetadata?.value, preference: state.personal.preference } : {}, schema: ns === 'ui-theme' ? themeMetadata?.schema ?? { type: 'object', dict: {} } : { type: 'object', dict: {} }, revision: 1, autoGenerate: false, applies: 'live', secrets: [] })), ...nativeRows], writable: officialWritable, hasDocument: false } }) }, // 原生模型属主仅在两份可信能力同时确认时投影，测试从不解引用凭据。
    $on(name, listener) { events.set(name, listener); return () => events.delete(name) },
  }
  const fetchImpl = async (url, request) => {
    if (url === './adminsmart/personal-theme') {
      const body = JSON.parse(request.body) // 本人主题单字段Fake，不走General数据库。
      state.calls.push({ method: request.method, personal: true, body })
      state.personal = { preference: body.mode, revision: state.personal.revision + 1 }
      return { ok: true, json: async () => structuredClone(state.personal) }
    }
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
  return { state, native, nativeForm, nativeDescribe, events, bridge,
    /** @param {object[]} rows 官方镜像已经采用的合成目录。 @returns {void} 仅通知公开目录订阅，不产生后端读取或写入。 */
    publishNativeRows(rows) {
      nativeSnapshot = Object.freeze({ status: 'ready', view: { namespaces: rows, writable: officialWritable, hasDocument: true }, error: null }) // 模拟原始Settings镜像先于共享GET收到新模型修订。
      for (const listener of nativeListeners) listener()
    },
  }
}

test('官方模型删除后的新修订立即透传，旧镜像和旧直接描述不能回退CAS', async () => {
  const provider = { ns: 'llm-pi-ai', schema: { type: 'object', dict: {} }, value: { providers: { fixture: {} } }, base: {}, user: { providers: { fixture: {} } }, revision: 7, secrets: [] } // 删除前的合成官方供应商目录。
  const { bridge, state, publishNativeRows } = fixture({ mode: 'host', nativeRows: [provider] }) // 双方管理员写权限真实确认后才允许模型描述。
  try {
    await bridge.ready
    const readModel = () => bridge.configForms.describe().getSnapshot().view.namespaces.find(row => row.ns === 'llm-pi-ai') // 官方Models创建卡实际读取的namespace与CAS。
    const initialReads = state.calls.length // 只收到官方镜像时不应追加共享GET或启动任何写入。
    const removed = { ...provider, revision: 8, value: { providers: {} }, user: { providers: {} } } // 官方删除已完成，模型卡应基于8而非旧7创建。
    publishNativeRows([removed])
    await bridge.configForms.describe().ensure()
    assert.equal(readModel().revision, 8)
    assert.deepEqual(readModel().value.providers, {})
    assert.equal(state.calls.length, initialReads)
    publishNativeRows([{ ...provider, revision: 6 }]) // 迟到镜像不能覆盖更新的官方模型删除结果。
    assert.equal(readModel().revision, 8)
    await bridge.refresh() // 模拟在途直接describe仍返回旧7，不能把已确认8降回旧CAS。
    assert.equal(readModel().revision, 8)
    provider.revision = 9
    provider.value = { providers: { newer: {} } }
    await bridge.refresh()
    publishNativeRows([removed]) // 更新的直接describe同样不能被旧镜像回退。
    assert.equal(readModel().revision, 9)
    assert.deepEqual(readModel().value.providers, { newer: {} })
    assert.equal(state.calls.some(call => call.method === 'PUT'), false)
  } finally { bridge.dispose() }
})

test('官方模型镜像更新仍受双方管理员权限和原生namespace白名单限制', async () => {
  const provider = { ns: 'llm-pi-ai', schema: {}, value: { providers: {} }, revision: 7 } // 没有凭据的合成模型描述。
  for (const writable of [false, true]) for (const officialWritable of [false, true]) {
    const { bridge, publishNativeRows } = fixture({ writable, officialWritable, nativeRows: [provider] }) // 四种能力组合分别验证，不能靠镜像显示状态获得管理员权限。
    try {
      await bridge.ready
      publishNativeRows([{ ...provider, revision: 8, rawCredentials: 'synthetic-must-not-appear' }, { ns: 'unknown-hidden', value: { secret: 'synthetic-must-not-appear' }, revision: 9 }])
      const rows = bridge.configForms.describe().getSnapshot().view.namespaces // 只允许既定的官方模型namespace及General。
      assert.equal(rows.some(row => row.ns === 'llm-pi-ai'), writable && officialWritable)
      assert.equal(rows.some(row => row.ns === 'unknown-hidden'), false)
      assert.equal(JSON.stringify(rows).includes('synthetic-must-not-appear'), false)
    } finally { bridge.dispose() }
  }
})

test('连接重置允许新Host模型修订回0，旧镜像与旧在途描述不能污染新代际', async () => {
  const provider = { ns: 'llm-pi-ai', schema: {}, value: { providers: { old: {} } }, revision: 8 } // 旧Host的namespace修订只在该进程内有序。
  const nativeRows = [provider] // 完整Remote描述由Fixture独立替换，不原地改旧回答。
  const { bridge, state, publishNativeRows } = fixture({ mode: 'host', nativeRows }) // General策略CAS持久化，Host namespace CAS可在重启后归0。
  try {
    await bridge.ready
    publishNativeRows([provider]) // 原官方镜像仍暂留旧Host的8，必须等待其真正新快照才能再次采用。
    const gate = deferred() // 扣住旧代际已经捕获的GET，模拟连接重置时仍有在途描述。
    state.beforeGet = () => gate.promise
    const oldRead = bridge.refresh() // 官方描述捕获旧8后，新Host已接管连接。
    await new Promise(resolve => setImmediate(resolve))
    nativeRows.splice(0, 1, { ...provider, revision: 0, value: { providers: { fresh: {} } } })
    state.beforeGet = null
    const reset = bridge.reset() // 正式wrapper的官方connection/reset调用同一公开边界。
    gate.resolve()
    await Promise.all([oldRead, reset])
    const model = bridge.configForms.describe().getSnapshot().view.namespaces.find(row => row.ns === 'llm-pi-ai') // 新创建卡只能看到当前Host的0及真实目录。
    assert.equal(model.revision, 0)
    assert.deepEqual(model.value.providers, { fresh: {} })
    publishNativeRows([{ ...nativeRows[0], revision: 1 }]) // 新Host原镜像完成自己的读取后继续正常热同步。
    assert.equal(bridge.configForms.describe().getSnapshot().view.namespaces.find(row => row.ns === 'llm-pi-ai').revision, 1)
    assert.equal(state.calls.some(call => call.method === 'PUT'), false)
  } finally { bridge.dispose() }
})

test('连接重置撤销旧在途写与排队草稿，迟到失败不覆盖新代际状态', async () => {
  const { bridge, state } = fixture() // 合成通用配置与有界网络替身，不访问实际服务。
  try {
    await bridge.ready
    const gate = deferred() // 第一笔旧连接写入已发送，故意让失败晚于新连接读取。
    state.beforePut = () => gate.promise
    state.failWrite = 503
    const first = bridge.configForms.get('ui-theme').set('fontSize', 20)
    const queued = bridge.configForms.get('ui-chat').set('transcriptView', 'verbose') // reset后旧草稿不能借新CAS重新发出。
    await new Promise(resolve => setImmediate(resolve))
    await bridge.reset()
    gate.resolve()
    assert.deepEqual(await Promise.all([first, queued]), [false, false])
    assert.equal(bridge.getError(), null)
    assert.equal(bridge.getSnapshot().saving, false)
    assert.equal(bridge.configForms.get('ui-theme').getSnapshot().value.fontSize, INITIAL_POLICY.fontSize)
    assert.equal(state.calls.filter(call => call.method === 'PUT').length, 1)
  } finally { bridge.dispose() }
})

test('管理员模型描述需要双方真实写能力，普通用户与不明能力均不能看到原生配置', async () => {
  const provider = { ns: 'llm-pi-ai', schema: { type: 'object', dict: {} }, value: { providers: {} }, base: {}, user: { providers: {} }, revision: 7, secrets: ['providers.*.apiKey'], rawCredentials: 'synthetic-must-not-appear' } // 官方脱敏配置的合成公开描述与恶意额外字段。
  const unknown = { ns: 'unknown-hidden-plugin', schema: {}, value: { credential: 'synthetic-must-not-appear' } } // 未明确列入原生Models白名单的行不能传播。
  for (const writable of [false, true]) for (const officialWritable of [false, true]) {
    const { bridge } = fixture({ writable, officialWritable, nativeRows: [provider, unknown] }) // 四种可信能力组合，不按浏览器hostname决定权限。
    try {
      await bridge.ready
      const rows = bridge.configForms.describe().getSnapshot().view.namespaces // 官方ModelsController实际读取的公开目录。
      const published = rows.find(row => row.ns === 'llm-pi-ai') // 只有双方真值组合能获得该配置。
      assert.equal(Boolean(published), writable && officialWritable)
      assert.equal(rows.some(row => row.ns === unknown.ns), false)
      assert.equal(JSON.stringify(rows).includes('synthetic-must-not-appear'), false)
      if (published) {
        assert.equal(published.revision, 7)
        provider.revision = 8
        bridge.configForms.describe().acceptView({ ns: 'llm-pi-ai' }) // 原生CAS写入回执只能触发权威回读，不直接覆盖Shared策略。
        await bridge.refresh()
        assert.equal(bridge.configForms.describe().getSnapshot().view.namespaces.find(row => row.ns === 'llm-pi-ai').revision, 8)
      }
    } finally { bridge.dispose() }
  }
})

/** @returns {object} 受控异步时序闸，不使用真实服务或长时间等待。 */
function deferred() {
  let resolve // 当前合成异步请求的放行方法。
  const promise = new Promise(done => { resolve = done }) // Fixture明确控制响应先后顺序。
  return { promise, resolve }
}

test('新版 Theme 接收官方安全字体输入，共享八字段仍为真源且补全字段不能写入', async () => {
  const themeMetadata = { // 合成公开 Schema 引用与原生有效值，不读取真实用户字体设置。
    schema: { // 与官方 Config.toJSON 相同的字段/默认值引用契约。
      uid: 1, // 根对象 Schema 的引用身份。
      refs: { // 只提供本测试需要的公开 Schema 节点。
        1: { type: 'object', dict: { codeFontSize: 2, terminalFontSize: 3, textFontFamily: 4, codeFontFamily: 4, terminalFontFamily: 4 } }, // 五项受控展示字段的引用；没有模型或凭据字段。
        2: { type: 'number', meta: { min: 10, max: 16, default: 11 } }, // 合成官方代码字号边界与默认值。
        3: { type: 'number', meta: { min: 10, max: 20, default: 13 } }, // 合成官方终端字号边界与默认值。
        4: { type: 'string', meta: { default: '' } }, // 空字体列表由官方 Theme 选择内置字体栈。
      },
    },
    value: { // 官方有效值只能影响额外字体输入，不能覆盖八字段共享偏好。
      preference: 'light', // 刻意与共享 dark 冲突，确认共享真源优先。
      fontSize: 12, // 刻意与共享内容字号冲突，不可反向采用。
      codeFontSize: 16, // 当前安全代码字号可原样保留。
      terminalFontSize: 999, // 超出官方范围时必须退回公开默认值。
      textFontFamily: 'Arial', // 安全有限字体列表保留并交给原生规范化。
      codeFontFamily: undefined, // 缺失时必须补全为空字符串，避免原生 split 崩溃。
      terminalFontFamily: '<synthetic>', // 非安全展示输入不能进入原生快照。
      credential: 'synthetic-must-not-appear', // 未在白名单中的额外值永远不能转发。
    },
  }
  const { bridge, state } = fixture({ themeMetadata }) // 全程只操作隔离描述和 Fake HTTP。
  try {
    await bridge.ready
    const theme = bridge.configForms.get('ui-theme') // 官方消费者使用与真实产品相同的受管表单。
    assert.deepEqual(theme.getSnapshot().value, {
      preference: 'light', fontSize: 15, codeFontSize: 16, terminalFontSize: 13,
      textFontFamily: 'Arial', codeFontFamily: '', terminalFontFamily: '',
    })
    assert.deepEqual(bridge.configForms.describe().getSnapshot().view.namespaces.find(row => row.ns === 'ui-theme').value, theme.getSnapshot().value)
    const requestCount = state.calls.length // 新字体编辑被拒绝时不能增加任何 Fake 网络请求。
    for (const field of ['codeFontSize', 'terminalFontSize', 'textFontFamily', 'codeFontFamily', 'terminalFontFamily']) {
      assert.equal(await theme.set(field, field.endsWith('Size') ? 12 : 'Fixture'), false)
    }
    assert.equal(state.calls.length, requestCount)
    assert.equal(await theme.set('fontSize', 20), true)
    assert.equal(Object.keys(state.remote.settings).length, 8)
    assert.equal(theme.getSnapshot().value.fontSize, 20)
    assert.equal(JSON.stringify(theme.getSnapshot()).includes('synthetic-must-not-appear'), false)
  } finally { bridge.dispose() }
})

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
    assert.deepEqual(theme.getSnapshot().value, { preference: 'light', fontSize: 15 })
    assert.deepEqual(bridge.configForms.describe().getSnapshot().view.namespaces.filter(row => GENERAL_SETTINGS_NAMESPACES.includes(row.ns)).map(row => row.ns), GENERAL_SETTINGS_NAMESPACES)
    assert.strictEqual(bridge.configForms.get('native-other'), nativeForm)
    assert.equal(typeof bridge.configForms.describe().acceptView, 'function')
    assert.ok(nativeDescribe)
    assert.equal(await theme.set('preference', 'light'), true)
    assert.equal(await bridge.configForms.get('locale').set('preference', 'en'), true)
    await bridge.configForms.developerTools.setEnabled(false)
    assert.equal(state.remote.settings.theme, 'dark', '个人选择不能改写历史General字段')
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
    assert.equal(bridge.configForms.get('ui-theme').getSnapshot().writable, true)
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
