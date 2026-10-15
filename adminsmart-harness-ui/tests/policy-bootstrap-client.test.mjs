/** HTML启动包的一次消费、真实回读和管理员完整目录门禁；全部传输均为合成Fake。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPolicyBootstrapReads, GENERAL_SETTINGS_NAMESPACES, installUiPolicyClient } from '../src/ui-policy-client.mjs'
import { emptyNativePolicy, installNativePolicyClient, isNativePolicy } from '../src/native-policy-client.mjs'

/** @returns {object} 当前用例独占的安全启动包和可控真实读取替身。 */
function fixture(admin = false) {
  const general = { revision: 4, writable: admin, settings: { locale: 'zh', theme: 'light', fontSize: 14, transcriptView: 'standard', performanceUsage: 'compact', busyEnter: 'queue', linkOpening: 'sidebar', developerTools: false } } // 八字段现有协议，不含任何身份或凭据。
  const native = { revision: 7, writable: admin, settings: { ...emptyNativePolicy(), namespaces: { 'ui-theme': { codeFontSize: 11 } } } } // 与General独立修订，不从raw namespace修订推断。
  const described = { ok: true, value: { writable: admin, hasDocument: false, namespaces: [...new Set([...GENERAL_SETTINGS_NAMESPACES, 'subagent', 'agent-loop', 'ui-settings-general'])].map(ns => ({ ns, schema: { type: 'object', dict: {} }, value: ns === 'ui-theme' ? { codeFontSize: 10 } : {}, base: {}, revision: 1, applies: 'live', secrets: [] })) } } // 精确安全行；不存在模型提供方或任意headers。
  const bootstrap = { version: 1, harnessVersion: '0.2.1-alpha.3', general, native, described } // 单个已确认Host包供两个独立读取者消费。
  const reads = { general: 0, native: 0, describe: 0, writes: 0 } // 只记录固定操作次数，不记录URL参数或请求正文。
  let liveDescription = structuredClone(described) // 后续读取可以返回完整原生模型目录，不写入启动包。
  let descriptionGate = Promise.resolve() // 用例可以扣住完整目录，确认ensure真正等待。
  let liveNative = structuredClone(native) // 模拟启动之后管理员已提交的更高Native政策。
  const remoteEvents = new Map() // 官方文档失效监听，不启动真实WebSocket。
  const remote = {
    $on(name, listener) { remoteEvents.set(name, listener); return () => remoteEvents.delete(name) },
    settings: { async describe() { reads.describe += 1; await descriptionGate; return structuredClone(liveDescription) } },
  } // 仅使用正式Adapter实际消费的公开Remote形状。
  const fetchImpl = async (url, request) => {
    if (request.method !== 'GET') { reads.writes += 1; throw new Error('Fixture禁止写入') }
    const region = url === './adminsmart/ui-policy' ? 'general' : 'native' // 只允许两个固定策略入口。
    reads[region] += 1
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => structuredClone(region === 'general' ? general : liveNative) }
  }
  const original = {
    get: () => ({ getSnapshot: () => ({ value: {} }), subscribe: () => () => {} }), // 未接管namespace的原生接口替身。
    describe: () => ({ getSnapshot: () => ({ status: 'ready', view: described.value }), subscribe: () => () => {}, acceptView() {} }), // 正式Adapter只读公开目录face。
  }
  return { bootstrap, reads, remote, fetchImpl, original, remoteEvents,
    setDescription(value, gate = Promise.resolve()) { liveDescription = value; descriptionGate = gate }, // 控制后续真正描述的返回和时序。
    setNative(value) { liveNative = value }, // 只改变合成后端回答，不修改启动副本。
  }
}

/** @param {object} state 当前独立Fixture。 @returns {object} 真实General Adapter与一次启动读取。 */
function installGeneral(state) {
  const reads = createPolicyBootstrapReads(state.bootstrap, { isNativePolicy, remote: state.remote, fetchImpl: state.fetchImpl }) // 产品解析器与产品接线同样参与测试。
  assert.ok(reads)
  const general = installUiPolicyClient({ configForms: state.original, remote: state.remote, recoveryIntervalMs: 0, ...reads.general }) // 不启动补偿计时器或真实网络。
  return { reads, general }
}

test('安全启动包只消费一次，后续General及Native刷新都恢复真实GET和Schema', async t => {
  const state = fixture() // 普通用户权限下的独立合成数据。
  const { reads, general } = installGeneral(state) // 使用生产的General初始化路径。
  const native = installNativePolicyClient({ general, remote: state.remote, eventSourceFactory: null, ...reads.native }) // 使用生产的Native初始化路径。
  t.after(() => { native.dispose(); general.dispose() })
  await Promise.all([general.ready, native.ready])
  assert.deepEqual(state.reads, { general: 0, native: 0, describe: 0, writes: 0 })
  assert.equal(native.configForms.get('ui-theme').getSnapshot().value.codeFontSize, 11)
  assert.equal(native.configForms.get('ui-theme').getSnapshot().value.preference, 'light')
  await Promise.all([general.refresh(), native.refresh()]) // 真实失效不允许再次播放HTML包。
  assert.deepEqual(state.reads, { general: 1, native: 1, describe: 2, writes: 0 })
})

test('管理员Models目录ensure等待真实完整描述，启动包不会被当作空模型配置', async t => {
  const state = fixture(true) // 管理员仍不把Provider元数据放进HTML。
  const { general } = installGeneral(state)
  t.after(() => general.dispose())
  await general.ready
  let release // 用例明确放行完整目录，不能靠任意sleep猜测顺序。
  const gate = new Promise(resolve => { release = resolve }) // 扣住后续HTTP描述而非插件apply生命周期。
  state.setDescription({ ...state.bootstrap.described, value: { ...state.bootstrap.described.value, namespaces: [...state.bootstrap.described.value.namespaces, { ns: 'llm-pi-ai', schema: { type: 'object' }, value: { providers: { synthetic: { models: [] } } }, base: {}, user: {}, revision: 2, secrets: [] }] } }, gate)
  let completed = false // Models调用的ensure必须等真正目录通过Adapter校验。
  const ensured = general.configForms.describe().ensure().then(() => { completed = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(completed, false)
  assert.equal(general.getSnapshot().status, 'ready') // 局部Models异步读取不撤回已确认的Theme/Locale初始能力。
  release()
  await ensured
  assert.equal(state.reads.describe, 1)
  assert.ok(general.configForms.describe().getSnapshot().view.namespaces.some(row => row.ns === 'llm-pi-ai'))
})

test('Native复合目录ensure仍等待管理员完整Models描述，已就绪启动包不能跳过下层门禁', async t => {
  const state = fixture(true) // 安全启动包不含管理员供应商目录，仍可先显示通用设置。
  const { reads, general } = installGeneral(state) // 两层桥使用同一受管初始化实现。
  const native = installNativePolicyClient({ general, remote: state.remote, eventSourceFactory: null, ...reads.native }) // 复合目录是官方Models最终依赖，不能只测下层。
  t.after(() => { native.dispose(); general.dispose() })
  await Promise.all([general.ready, native.ready])
  assert.deepEqual(state.reads, { general: 0, native: 0, describe: 0, writes: 0 })
  let release // 隔离Fixture的完整目录响应放行函数，不等待真实服务。
  const gate = new Promise(resolve => { release = resolve }) // 强制完整目录晚于复合目录的初始ready。
  state.setDescription({ ...state.bootstrap.described, value: { ...state.bootstrap.described.value, namespaces: [...state.bootstrap.described.value.namespaces, { ns: 'llm-pi-ai', schema: { type: 'object' }, value: { providers: {} }, base: {}, user: {}, revision: 8, secrets: [] }] } }, gate)
  let completed = false // 下层完整模型目录未确认之前，Models不得使用安全启动包里的空目录。
  const ensured = native.configForms.describe().ensure().then(() => { completed = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(completed, false)
  release()
  await ensured
  assert.equal(state.reads.describe, 1)
  assert.equal(state.reads.writes, 0)
  assert.equal(native.configForms.describe().getSnapshot().view.namespaces.find(row => row.ns === 'llm-pi-ai').revision, 8)
})

test('管理员完整目录损坏时ensure失败，不能用旧安全包生成假未配置onboarding', async t => {
  const state = fixture(true)
  const { general } = installGeneral(state)
  t.after(() => general.dispose())
  await general.ready
  state.setDescription({ ok: true, value: { writable: true, hasDocument: false, namespaces: [] } }) // 传输成功但General Schema缺失仍是非法完整目录。
  await assert.rejects(general.configForms.describe().ensure(), /官方模型设置描述尚未确认/u)
  assert.equal(state.reads.describe, 1)
  assert.equal(state.reads.writes, 0)
})

test('Native启动时更高SSE修订仍回读并采用，不被已消费HTML旧修订覆盖', async t => {
  const state = fixture()
  const { reads, general } = installGeneral(state)
  await general.ready
  state.setNative({ ...state.bootstrap.native, revision: 8, settings: { ...state.bootstrap.native.settings, namespaces: { 'ui-theme': { codeFontSize: 12 } } } }) // 启动快照生成后实际已提交的新政策。
  const native = installNativePolicyClient({ general, remote: state.remote, ...reads.native, eventSourceFactory: () => ({
    addEventListener(_name, callback) { callback({ data: JSON.stringify({ revision: 8 }) }) }, // 真实更高失效早于首次ready结算。
    removeEventListener() {}, close() {},
  }) })
  t.after(() => { native.dispose(); general.dispose() })
  await native.ready
  assert.equal(native.getPolicySnapshot().revision, 8)
  assert.equal(native.configForms.get('ui-theme').getSnapshot().value.codeFontSize, 12)
  assert.equal(state.reads.native, 1)
  assert.equal(state.reads.describe, 1)
  assert.equal(state.reads.writes, 0)
})

test('损坏版本、双region角色、重复描述、Provider行和超大包均拒绝并保留网络回退', () => {
  for (const edit of [
    value => { value.version = 2 },
    value => { value.harnessVersion = '0.2.0' },
    value => { value.general.revision = -1 },
    value => { value.native.writable = true },
    value => { value.described.value.namespaces.push(value.described.value.namespaces[0]) },
    value => { value.described.value.namespaces.push({ ns: 'llm-pi-ai', schema: {}, value: {}, revision: 1, secrets: [] }) },
    value => { value.described.value.namespaces[0].schema.large = 'x'.repeat(131_072) },
  ]) {
    const state = fixture() // 每个损坏样本保持独立，避免前一个编辑影响下一项。
    edit(state.bootstrap)
    assert.equal(createPolicyBootstrapReads(state.bootstrap, { isNativePolicy, remote: state.remote, fetchImpl: state.fetchImpl }), null)
    assert.deepEqual(state.reads, { general: 0, native: 0, describe: 0, writes: 0 })
  }
})

test('revision0无配置仍按原有null协议处理，不伪造持久化或默认策略', () => {
  const state = fixture()
  state.bootstrap.general = { revision: 0, settings: null, writable: false } // 明确未配置状态不能当revision1管理员设置。
  state.bootstrap.native = { revision: 0, settings: null, writable: false } // 两region分别保持零状态，不互相填默认值。
  assert.ok(createPolicyBootstrapReads(state.bootstrap, { isNativePolicy, remote: state.remote, fetchImpl: state.fetchImpl }))
  assert.equal(state.reads.writes, 0)
})

test('首reset早于首次消费时撤销全部HTML票据，两个策略与描述都真正回读', async t => {
  const state = fixture() // 起始包本身合法，失效仅来自真实连接代际。
  const reads = createPolicyBootstrapReads(state.bootstrap, { isNativePolicy, remote: state.remote, fetchImpl: state.fetchImpl })
  reads.expire() // 在任何Adapter开始消费前模拟首代际边界。
  const general = installUiPolicyClient({ configForms: state.original, remote: state.remote, recoveryIntervalMs: 0, ...reads.general })
  const native = installNativePolicyClient({ general, remote: state.remote, eventSourceFactory: null, ...reads.native })
  t.after(() => { native.dispose(); general.dispose() })
  await Promise.all([general.ready, native.ready])
  assert.deepEqual(state.reads, { general: 1, native: 1, describe: 2, writes: 0 })
})
