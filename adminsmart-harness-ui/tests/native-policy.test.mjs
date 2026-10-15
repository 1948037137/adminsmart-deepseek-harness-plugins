/** 候选原生共享桥目标回归；策略、官方服务、HTTP 与事件均为合成 Fake。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  installNativePolicyClient,
  emptyNativePolicy,
  isNativePolicy,
  withNativeRequest,
} from '../src/native-policy-client.mjs'
import {
  installNativePolicy,
  applyNativeNamespaces,
} from '../src/native-policy-host.mjs'

const BASELINE = Object.freeze({
  subagent: Object.freeze({ maxDepth: 1, maxActiveSubagents: 2 }),
}) // 冻结业务模板提供的合成继承，不以SDK上游8猜值。
const GENERAL = Object.freeze({
  locale: null,
  theme: 'light',
  fontSize: 14,
  transcriptView: 'standard',
  performanceUsage: 'compact',
  busyEnter: 'queue',
  linkOpening: 'sidebar',
  developerTools: false,
}) // 独立既有八字段协议。
const FONT_DEFAULTS = Object.freeze({
  codeFontSize: 11,
  terminalFontSize: 13,
  textFontFamily: '',
  codeFontFamily: '',
  terminalFontFamily: '',
}) // 合成官方描述值。
const tick = () => new Promise((resolve) => setImmediate(resolve)) // 仅排队回调，不等待真实模型或外部服务。

/**
 * 创建独立政策、旧Controller和固定描述Fake，无真实服务。
 * @param {boolean} admin 合成可信角色。
 * @param {object} options 控制公开HTTP/SSE回答的目标时序。
 * @param {boolean} [options.initialAvailable=true] 第一份GET是否存在，用来验证真正首次404。
 * @param {boolean} [options.beforeAck=false] 自有SSE是否先于PUT确认到达。
 * @param {Promise<void>} [options.getGate] 扣住已捕获GET快照，模拟在途响应与更高SSE竞态。
 * @param {number} [options.initialEventRevision] 注册监听器时立即发送的已提交修订，不能先GET再伪装初始事件。
 * @param {boolean} [options.describeEvents=false] 首describe异步发布官方八namespace的revision0事件，不代表发生写入。
 * @param {Promise<void>} [options.describeGate] 扣住已捕获metadata快照，模拟更高raw namespace修订到达。
 * @param {Function} [options.afterPut] 扣住提交时已捕获的合成ACK，验证跨连接代际的迟到回执。
 * @returns {object} 完整桥、实际GET/describe计数与受限事件能力。
 */
function clientFixture(
  admin = true,
  {
    initialAvailable = true,
    beforeAck = false,
    getGate,
    initialEventRevision,
    describeEvents = false,
    describeGate,
    afterPut,
  } = {},
) {
  const listeners = new Set() // 旧 General 的公开反馈订阅者。
  const requests = [] // 新桥发出的实际请求，不访问网络。
  const events = new Map() // 每个模拟浏览器的自有非敏感事件处理。
  let descriptions = 0 // 验证SSE合并同时避免重复官方describe，而非只省略GET。
  let available = initialAvailable // 构造Controller之前确定404，不能用第二次读取假装首次兼容。
  let version = { revision: 1, settings: emptyNativePolicy(), writable: admin } // native独立CAS，既有 General 修订故意为4。
  let legacy = { revision: 4, settings: { ...GENERAL }, writable: admin } // 不把两套CAS号码混用。
  const form = {
    getSnapshot: () => ({
      status: 'ready',
      value: {
        preference: legacy.settings.theme,
        fontSize: legacy.settings.fontSize,
        ...FONT_DEFAULTS,
      },
      base: { preference: 'system', fontSize: 14 },
      user: {},
      revision: legacy.revision,
      writable: admin,
      mode: 'host',
    }),
    subscribe: () => () => {},
    async mutate(ops, expected) {
      assert.equal(expected, legacy.revision)
      for (const op of ops)
        legacy.settings[op.path[0] === 'fontSize' ? 'fontSize' : 'theme'] =
          op.value
      legacy.revision += 1
      for (const listener of listeners) listener()
      return true
    },
  } // 旧API窗口仍可保存旧字段。
  const directory = {
    getSnapshot: () => ({
      status: 'ready',
      view: {
        writable: admin,
        namespaces: [{ ns: 'ui-theme', value: form.getSnapshot().value }],
      },
    }),
    acceptView() {},
    subscribe: () => () => {},
  } // 原始描述只在候选接线中扩展安全namespace。
  const general = {
    configForms: {
      get: () => form,
      describe: () => directory,
      developerTools: {},
    },
    getPolicySnapshot: () => structuredClone(legacy),
    acceptPolicySnapshot(value) {
      assert.equal(Object.keys(value.settings).length, 8)
      if (value.revision < legacy.revision) return false
      legacy = structuredClone(value)
      for (const listener of listeners) listener()
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } // 不触碰真实SharedController或数据库。
  const metadata = [
    {
      ns: 'ui-theme',
      revision: 0,
      schema: { type: 'object' },
      value: FONT_DEFAULTS,
      base: FONT_DEFAULTS,
    }, // 官方字体Schema会由真实SDK目标另验，raw修订独立于policy1。
    {
      ns: 'subagent',
      revision: 0, // 原始配置首见修订，并非Native策略CAS。
      schema: { type: 'object' },
      value: { maxDepth: 1, maxActiveSubagents: 2 },
      base: { maxDepth: 1, maxActiveSubagents: 8 },
    }, // 故意模拟上游8，桥必须使用可信业务baseline2。
    {
      ns: 'ui-settings-general',
      revision: 0,
      schema: { type: 'object' },
      value: { welcomeNoticeVersion: '' },
      base: {},
    }, // 欢迎确认无身份状态。
    {
      ns: 'agent-loop',
      revision: 0,
      schema: { type: 'object' },
      value: { maxParallelToolCalls: 2 },
      base: { maxParallelToolCalls: 10 },
    }, // 官方并行配置的合成raw描述。
  ]
  const controller = installNativePolicyClient({
    general,
    ctx: { on(name, listener) { events.set(name, listener); return () => events.delete(name) } }, // 使用既有官方connection/reset事件，不创建替代连接协议。
    nativeBaseline: BASELINE,
    remote: {
      $on(name, callback) {
        assert.equal(name, 'settings/document-updated')
        events.set(name, callback)
        return () => events.delete(name)
      }, // 真实事件签名是namespace/revision，异步接线不伪装连接重置。
      settings: {
        describe: async () => {
          descriptions += 1
          const snapshot = structuredClone(metadata) // 已发起描述的raw快照，不借后续更高事件伪造已覆盖。
          if (describeEvents && descriptions === 1)
            for (const namespace of [
              'locale',
              'ui-theme',
              'ui-chat',
              'ui-conversation',
              'adminsmart-shared-settings',
              'subagent',
              'agent-loop',
              'ui-settings-general',
            ])
              queueMicrotask(() =>
                events.get('settings/document-updated')?.(namespace, 0),
              ) // 与实际Host→Client异步边界相同，首次观测无写也发事件。
          if (describeGate) await describeGate
          return { ok: true, value: { writable: admin, namespaces: snapshot } }
        },
      },
    },
    eventSourceFactory: (url) => {
      assert.equal(url, './adminsmart/native-policy/events')
      return {
        addEventListener(name, callback) {
          events.set(name, callback)
          if (initialEventRevision !== undefined)
            callback({
              data: JSON.stringify({ revision: initialEventRevision }),
            }) // 同实际SSE建立连接立即补当前revision，不等首次GET完成。
        },
        close() {
          events.clear()
        },
      }
    },
    fetchImpl: async (url, options) => {
      assert.equal(url, './adminsmart/native-policy')
      requests.push(options)
      if (!available) return { ok: false, status: 404 }
      if (options.method === 'GET') {
        const snapshot = structuredClone(version) // 请求开始时的已提交快照，与后来SSE真实新修订区分。
        if (getGate) await getGate
        return { ok: true, json: async () => snapshot }
      }
      const body = JSON.parse(options.body) // 标准完整region，不采纳任意字段。
      if (
        body.expectedRevision !== version.revision ||
        (body.legacyGeneralUpdate &&
          body.legacyGeneralUpdate.expectedRevision !== legacy.revision)
      )
        return { ok: false, status: 409 }
      version = {
        revision: version.revision + 1,
        settings: body.settings,
        writable: admin,
      }
      const ack = body.legacyGeneralUpdate
        ? {
            revision: legacy.revision + 1,
            settings: body.legacyGeneralUpdate.settings,
          }
        : undefined // 同事务确认两套修订，正式后端目标验证原子保存。
      if (beforeAck) {
        events.get('native-policy-changed')?.({
          data: JSON.stringify({ revision: version.revision }),
        }) // 模拟先于HTTP回执的真实失效通知。
        await tick()
      }
      const saved = { ...structuredClone(version), ...(ack ? { general: ack } : {}) } // 捕获提交时ACK，后续连接或其它更新不得追改旧请求结果。
      if (afterPut) await afterPut()
      return {
        ok: true,
        json: async () => saved,
      }
    },
  })
  return {
    controller,
    requests,
    events,
    get descriptions() {
      return descriptions
    }, // 官方describe实际次数，不把手动检查目录当作网络读取。
    setAvailable(value) {
      available = value
    },
    external(settings) {
      version = { ...version, revision: version.revision + 1, settings }
      events.get('native-policy-changed')?.({
        data: JSON.stringify({ revision: version.revision }),
      })
    },
    externalMetadata(namespace, revision, value) {
      const row = metadata.find((candidate) => candidate.ns === namespace) // 只改当前合成官方namespace，不修改政策CAS。
      row.revision = revision
      row.value = { ...row.value, ...value }
      events.get('settings/document-updated')?.(namespace, revision)
    },
    get legacy() {
      return legacy
    },
    get version() {
      return version
    },
  }
}

test('Native连接重置使旧在途PUT与排队草稿失效，迟到ACK不污染新代际', async () => {
  let release // 精确控制旧连接PUT完成时间，所有数据均为合成政策。
  const gate = new Promise(resolve => { release = resolve }) // 不依赖定时sleep或真实网络。
  const state = clientFixture(true, { afterPut: () => gate }) // 旧PUT先提交，在重连完成后才返回。
  try {
    await state.controller.ready
    const first = state.controller.configForms.get('subagent').set('maxActiveSubagents', 3)
    const queued = state.controller.configForms.get('agent-loop').set('maxParallelToolCalls', 3) // 旧连接排队动作不得借重连后的确认状态执行。
    await tick()
    state.events.get('connection/reset')()
    await state.controller.refresh()
    release()
    assert.deepEqual(await Promise.all([first, queued]), [false, false])
    assert.equal(state.controller.getSnapshot().notice, null)
    assert.equal(state.controller.getSnapshot().error, null)
    assert.equal(state.requests.filter(request => request.method === 'PUT').length, 1)
  } finally { release(); state.controller.dispose() }
})

test('批准的官方字段与安全开关边界拒绝未知配置、升权、密钥和新版本', () => {
  assert.equal(isNativePolicy(emptyNativePolicy()), true)
  for (const change of [
    { harnessVersion: '0.9.0' },
    { namespaces: { subagent: { maxDepth: 2 } } },
    { namespaces: { subagent: { maxActiveSubagents: 0 } } },
    { namespaces: { 'ui-theme': { apiKey: 'fixture' } } },
    { namespaces: { 'ui-theme': { textFontFamily: '<script>' } } },
    { plugins: { '../client-hmr': true } }, // 策略只校验稳定语法；真正核心/官方可管理库存由Host保存前复核，不把三项名单继续当协议。
    { clientPreferences: { collapseTiming: 'never' } },
  ])
    assert.equal(isNativePolicy({ ...emptyNativePolicy(), ...change }), false)
})

test('官方theme复合接口一次提交独立native/General双CAS，其他旧字段保持确认值', async () => {
  const state = clientFixture() // 完整bridge实例，不抽取内部mutator。
  try {
    await state.controller.ready
    const form = state.controller.configForms.get('ui-theme') // 官方ThemeRuntime使用的标准接口。
    assert.equal(
      await form.mutate(
        [
          { op: 'set', path: ['fontSize'], value: 18 },
          { op: 'set', path: ['codeFontSize'], value: 13 },
          { op: 'set', path: ['terminalFontSize'], value: 16 },
        ],
        form.getSnapshot().revision,
      ),
      true,
    )
    const put = state.requests.filter((request) => request.method === 'PUT') // 实际只发一个完整保存请求。
    assert.equal(put.length, 1)
    const body = JSON.parse(put[0].body) // 确认发出的CAS与分离真源，不凭组件草稿推断成功。
    assert.equal(body.expectedRevision, 1)
    assert.equal(body.legacyGeneralUpdate.expectedRevision, 4)
    assert.equal(state.legacy.revision, 5)
    assert.equal(state.version.revision, 2)
    assert.equal(state.legacy.settings.fontSize, 18)
    assert.equal(state.legacy.settings.theme, 'light')
    assert.equal(form.getSnapshot().value.codeFontSize, 13)
    assert.equal(form.getSnapshot().value.fontSize, 18)
  } finally {
    state.controller.dispose()
  }
})

test('普通角色只能采用明确政策，SSE独立修订立即触发受权GET而不保存', async () => {
  const state = clientFixture(false) // 普通页没有管理写能力。
  try {
    await state.controller.ready
    assert.equal(
      await state.controller.configForms.get('subagent').set('maxDepth', 0),
      false,
    )
    assert.equal(
      state.requests.some((request) => request.method === 'PUT'),
      false,
    )
    state.external({
      ...emptyNativePolicy(),
      namespaces: {
        'ui-theme': { textFontFamily: 'Fixture Font' },
        subagent: { maxDepth: 0 },
      },
    })
    await tick()
    assert.equal(
      state.controller.configForms.get('ui-theme').getSnapshot().value
        .textFontFamily,
      'Fixture Font',
    )
    assert.equal(
      state.controller.configForms.get('subagent').getSnapshot().value.maxDepth,
      0,
    )
    assert.equal(
      state.controller.configForms.get('subagent').getSnapshot().base
        .maxActiveSubagents,
      2,
    )
  } finally {
    state.controller.dispose()
  }
})

test('初始SSE相同revision与在途GET合并为一轮GET/describe，已采用相同或旧事件不回读，手动刷新仍真实读取', async () => {
  let release // 本测试唯一拥有的在途GET放行能力。
  const gate = new Promise((resolve) => {
    release = resolve
  }) // 响应保持pending，确保SSE在accepted=null阶段到达。
  const state = clientFixture(false, { getGate: gate, initialEventRevision: 1 }) // 监听刚注册就补当前修订，比ready显式启动更早。
  try {
    await tick()
    assert.equal(
      state.requests.filter((request) => request.method === 'GET').length,
      1,
    )
    assert.equal(state.descriptions, 1)
    assert.equal(state.controller.getPolicySnapshot(), null)
    for (const revision of [1, 1, 0])
      state.events.get('native-policy-changed')({
        data: JSON.stringify({ revision }),
      }) // 重复/更旧初始回声不能排第二轮。
    release()
    await state.controller.ready
    await tick()
    assert.equal(state.controller.getPolicySnapshot().revision, 1)
    assert.equal(
      state.requests.filter((request) => request.method === 'GET').length,
      1,
    )
    assert.equal(state.descriptions, 1)
    for (const revision of [1, 0])
      state.events.get('native-policy-changed')({
        data: JSON.stringify({ revision }),
      })
    await tick()
    assert.equal(
      state.requests.filter((request) => request.method === 'GET').length,
      1,
    )
    await state.controller.refresh() // 管理员手动/重连/补偿使用同一强制入口，不能被SSE去重省略。
    assert.equal(
      state.requests.filter((request) => request.method === 'GET').length,
      2,
    )
    assert.equal(state.descriptions, 2)
    assert.equal(
      state.requests.some((request) => request.method === 'PUT'),
      false,
    )
  } finally {
    release()
    state.controller.dispose()
  }
})

test('初读在途多个更高SSE只记最高revision，响应落后才补一轮并在ready前采用最高值', async () => {
  let release // 当前迟到初读的放行能力，不操作真实网络。
  const gate = new Promise((resolve) => {
    release = resolve
  }) // 第一份GET已捕获revision1，之后管理员确实提交新值。
  const state = clientFixture(false, { getGate: gate }) // 普通用户必须只采用，不能为补偿发PUT。
  try {
    await tick()
    state.external({
      ...emptyNativePolicy(),
      namespaces: { 'ui-theme': { codeFontSize: 12 } },
    }) // 已提交revision2。
    state.external({
      ...emptyNativePolicy(),
      namespaces: { 'ui-theme': { codeFontSize: 13 } },
    }) // 更高revision3在同一次初读期间到达。
    state.events.get('native-policy-changed')({
      data: JSON.stringify({ revision: 2 }),
    }) // 乱序旧通知不能降低最高wanted。
    assert.equal(
      state.requests.filter((request) => request.method === 'GET').length,
      1,
    )
    assert.equal(state.descriptions, 1)
    release()
    await state.controller.ready
    await tick()
    assert.equal(
      state.requests.filter((request) => request.method === 'GET').length,
      2,
    )
    assert.equal(state.descriptions, 2)
    assert.equal(state.controller.getPolicySnapshot().revision, 3)
    assert.equal(
      state.controller.configForms.get('ui-theme').getSnapshot().value
        .codeFontSize,
      13,
    )
    for (const revision of [3, 2])
      state.events.get('native-policy-changed')({
        data: JSON.stringify({ revision }),
      })
    await tick()
    assert.equal(
      state.requests.filter((request) => request.method === 'GET').length,
      2,
    )
    assert.equal(
      state.requests.some((request) => request.method === 'PUT'),
      false,
    )
  } finally {
    release()
    state.controller.dispose()
  }
})

test('首次describe自身八个raw revision0事件被当前metadata覆盖，不增加GET/describe或写入', async () => {
  const state = clientFixture(false, { describeEvents: true }) // 没有SSE、没有连接reset、没有配置修改，只发送真实描述首见事件。
  try {
    await state.controller.ready
    await tick()
    assert.equal(
      state.requests.filter((request) => request.method === 'GET').length,
      1,
    )
    assert.equal(state.descriptions, 1)
    assert.equal(
      state.requests.some((request) => request.method === 'PUT'),
      false,
    )
    state.events.get('settings/document-updated')('ui-theme', 0)
    state.events.get('settings/document-updated')('llm-pi-ai', 99) // 模型自己的raw修订由原模型facade负责，Native不能混用政策CAS去比较。
    await tick()
    assert.equal(state.descriptions, 1)
    state.events.get('settings/document-updated')() // 不完整事件没有覆盖证明，保守真实回读。
    await tick()
    assert.equal(state.descriptions, 2)
  } finally {
    state.controller.dispose()
  }
})

test('更高namespace raw revision在初描述期间到达，只补最高一轮且不与policy revision混用', async () => {
  let release // 本测试迟到metadata的独占放行能力。
  const gate = new Promise((resolve) => {
    release = resolve
  }) // 首描述捕获raw0，政策CAS保持1不变。
  const state = clientFixture(false, { describeGate: gate })
  try {
    await tick()
    state.externalMetadata('ui-theme', 4, { codeFontSize: 12 })
    state.externalMetadata('ui-theme', 9, { codeFontSize: 13 }) // raw9是同namespace真实新值，不是政策revision9。
    state.events.get('settings/document-updated')('ui-theme', 4) // 乱序旧通知不能降低最高待见修订。
    assert.equal(state.descriptions, 1)
    release()
    await state.controller.ready
    await tick()
    assert.equal(state.controller.getPolicySnapshot().revision, 1)
    assert.equal(
      state.controller.configForms.get('ui-theme').getSnapshot().value
        .codeFontSize,
      13,
    )
    assert.equal(state.descriptions, 2)
    assert.equal(
      state.requests.filter((request) => request.method === 'GET').length,
      2,
    )
    state.events.get('settings/document-updated')('ui-theme', 9)
    await tick()
    assert.equal(state.descriptions, 2)
    assert.equal(
      state.requests.some((request) => request.method === 'PUT'),
      false,
    )
  } finally {
    release()
    state.controller.dispose()
  }
})

test('404发布窗口保持同一Theme基线、不写默认，接口恢复后同一scope采用新值', async () => {
  const state = clientFixture() // 第一轮会完成，下一轮模拟API暂未发布。
  await state.controller.ready
  state.controller.dispose()
  const legacyState = clientFixture(true, { initialAvailable: false }) // 第一份HTTP回答就是404，不使用已经确认的native政策。
  try {
    await legacyState.controller.ready
    assert.equal(legacyState.controller.getPolicySnapshot(), null)
    await legacyState.controller.refresh()
    const theme = legacyState.controller.configForms.get('ui-theme') // 持久消费者不能因为恢复而换scope对象。
    assert.equal(legacyState.controller.getSnapshot().status, 'unsupported')
    assert.equal(theme.getSnapshot().value.preference, 'light')
    assert.equal(
      legacyState.requests.filter((request) => request.method === 'PUT').length,
      0,
    )
    legacyState.setAvailable(true)
    await legacyState.controller.refresh()
    assert.strictEqual(
      legacyState.controller.configForms.get('ui-theme'),
      theme,
    )
    assert.equal(legacyState.controller.getSnapshot().status, 'ready')
    assert.equal(await theme.set('codeFontSize', 14), true)
  } finally {
    legacyState.controller.dispose()
  }
})

test('自己的native事件先于PUT回执不撤销下一项排队编辑，两次保存按确认修订顺序提交', async () => {
  const state = clientFixture(true, { beforeAck: true }) // 两次HTTP回执都晚于自己的政策失效事件。
  try {
    await state.controller.ready
    const theme = state.controller.configForms.get('ui-theme') // 同一稳定官方表单。
    const first = theme.set('codeFontSize', 13) // 不等待ACK即收到下一项明确用户操作。
    const second = theme.set('textFontFamily', 'Fixture Family') // 先到事件不是外部管理员提交。
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    assert.deepEqual(
      state.requests
        .filter((request) => request.method === 'PUT')
        .map((request) => JSON.parse(request.body).expectedRevision),
      [1, 2],
    )
    assert.equal(state.version.settings.namespaces['ui-theme'].codeFontSize, 13)
    assert.equal(
      state.version.settings.namespaces['ui-theme'].textFontFamily,
      'Fixture Family',
    )
  } finally {
    state.controller.dispose()
  }
})

test('连接与迟到JSON共同使用一个总预算，卸载即时取消而不等待不响应signal的下层', async () => {
  let resolveBody // 自建迟到JSON回答，不访问真实接口。
  const body = new Promise((resolve) => {
    resolveBody = resolve
  }) // Body保持pending，用真实总预算结算。
  const started = Date.now() // 目标只缩短到20ms，不让测试等待生产五秒。
  await assert.rejects(
    () =>
      withNativeRequest(
        async () => {
          await tick()
          return body
        },
        { timeoutMs: 20 },
      ),
    /超时或已停止/u,
  )
  assert.ok(Date.now() - started < 500)
  resolveBody({ fixture: true })
  const controller = new AbortController() // 父生命周期取消独立的下一条请求。
  const pending = withNativeRequest(() => new Promise(() => {}), {
    signal: controller.signal,
    timeoutMs: 100,
  }) // 故意Fake不响应signal，外层仍立即结算。
  controller.abort()
  await assert.rejects(() => pending, /超时或已停止/u)
})

test('已卸载复合scope不能经旧General路径继续保存，未知prototype namespace拒绝不崩溃', async () => {
  const state = clientFixture(true, { initialAvailable: false }) // 曾因旧API而合法保持General基线。
  await state.controller.ready
  const theme = state.controller.configForms.get('ui-theme') // 卸载前保存公开引用。
  state.controller.dispose()
  assert.equal(await theme.set('fontSize', 18), false)
  assert.equal(state.legacy.revision, 4)
  assert.equal(
    isNativePolicy({
      ...emptyNativePolicy(),
      namespaces: JSON.parse('{"__proto__":{"maxDepth":1}}'),
    }),
    false,
  )
  assert.equal(
    isNativePolicy({ ...emptyNativePolicy(), namespaces: { toString: {} } }),
    false,
  )
})

test('可信subagent基线恢复不使用上游8，缺失基线失败保持旧值且不伪造完成', async () => {
  const writes = [] // 仅记录官方公开mutate，不访问ConfigEditor文件。
  const settings = {
    describe: () => [
      {
        ns: 'subagent',
        revision: 3,
        value: { maxDepth: 0, maxActiveSubagents: 1 },
        user: { maxDepth: 0, maxActiveSubagents: 1 },
        base: { maxDepth: 1, maxActiveSubagents: 8 },
      },
    ],
    async mutate(ns, ops, revision) {
      writes.push({ ns, ops, revision })
    },
  } // 显示两层继承差异的合成官方描述。
  await assert.rejects(
    () => applyNativeNamespaces(settings, emptyNativePolicy()),
    /基线未确认/u,
  )
  assert.equal(writes.length, 0)
  await applyNativeNamespaces(settings, emptyNativePolicy(), BASELINE)
  assert.deepEqual(writes[0].ops, [
    { op: 'set', path: ['maxDepth'], value: 1 },
    { op: 'set', path: ['maxActiveSubagents'], value: 2 },
  ])
  assert.equal(writes[0].revision, 3)
})

test('Host signed确认与静态hash/HEAD边界，clientPreferences-only写入推送所有浏览器且普通写入先拒绝', async () => {
  const routes = new Map() // 自有准确HTTP路径，不启动网络服务。
  const cleanups = [] // 确保候选周期任务结束，无后台残留。
  const injections = [] // 仅代码SHA与安全业务baseline进入页面。
  let policy = { revision: 1, settings: emptyNativePolicy() } // Fake 后端的唯一政策真源。
  let bodyReads = 0 // 普通用户必须在读正文之前拒绝。
  const callbacks = [] // 模拟signed native通知触发每个Runtime回读。
  const browsers = [] // 三个已开页面只收revision，不收设置或用户信息。
  const create = async (admin) =>
    installNativePolicy(
      {
        settings: { describe: () => [] },
        logger: { warn() {} },
        on(_event, callback) {
          callback(injections)
          return () => {}
        },
        effect(register) {
          cleanups.push(register())
          return () => {}
        },
        webServer: {
          register(route) {
            routes.set(route.path, route)
            return () => routes.delete(route.path)
          },
        },
      },
      {
        apiBase: 'http://fixture.invalid',
        readToken: async () => 'fixture-capability',
        userId: '7',
        modeId: 'knowledge',
        presetId: 'fixture',
        isAdmin: admin,
      },
      {
        nativeBaseline: BASELINE,
        clientModuleSource: Buffer.from('export const fixture=true'),
        assertSameOrigin(request) {
          if (request.headers?.origin === 'foreign') throw new Error('origin')
        },
        readJsonBody: async (request) => {
          bodyReads += 1
          return request.body
        },
        watchEvents: (_options, callback) => {
          callbacks.push(callback)
          return () => {}
        },
        fetchImpl: async (url, options) => {
          assert.equal(
            url,
            'http://fixture.invalid/internal/agent-model/v1/native-policy',
          )
          assert.equal(
            options.headers.Authorization,
            'Bearer fixture-capability',
          )
          if (options.method === 'PUT') {
            const body = JSON.parse(options.body)
            assert.equal(body.expectedRevision, policy.revision)
            policy = { revision: policy.revision + 1, settings: body.settings }
          }
          return { ok: true, json: async () => structuredClone(policy) }
        },
      },
    ) // 请求与任何凭据均为Fake。
  const response = () => ({
    status: null,
    headers: {},
    body: undefined,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }) // 最小HTTP实体观察。
  try {
    const admin = await create(true) // 管理员only写入，全员回读。
    await admin.refresh()
    const rev = injections.find(
      (row) => row.name === '__ADMINSMART_NATIVE_POLICY_CLIENT_REVISION__',
    ).value // 实际Host代码哈希，不能拿政策revision代替。
    for (const method of ['GET', 'HEAD']) {
      const output = response()
      await routes
        .get('/adminsmart/native-policy-client.mjs')
        .handler(
          { method, url: `/adminsmart/native-policy-client.mjs?rev=${rev}` },
          output,
        )
      assert.equal(
        output.headers['cache-control'],
        'private, max-age=31536000, immutable',
      )
      assert.equal(output.headers['content-length'], '25')
      if (method === 'HEAD') assert.equal(output.body, undefined)
    }
    const stale = response() // 错误版本不能用当前字节冒充旧版本缓存。
    await routes
      .get('/adminsmart/native-policy-client.mjs')
      .handler(
        { method: 'GET', url: '/adminsmart/native-policy-client.mjs?rev=bad' },
        stale,
      )
    assert.equal(stale.status, 410)
    for (let index = 0; index < 3; index += 1) {
      const output = {
        chunks: [],
        writeHead() {},
        write(chunk) {
          this.chunks.push(chunk)
        },
        on() {},
        end() {},
      }
      browsers.push(output)
      routes
        .get('/adminsmart/native-policy/events')
        .handler({ method: 'GET', headers: {} }, output)
    } // 三个HTTP流不使用真实用户或浏览器。
    const output = response() // 只更新独立clientPreferences，Hostnamespace保持空。
    await routes.get('/adminsmart/native-policy').handler(
      {
        method: 'PUT',
        headers: {},
        body: {
          expectedRevision: 1,
          settings: {
            ...emptyNativePolicy(),
            clientPreferences: { collapseTiming: 'next-input' },
          },
        },
      },
      output,
    )
    assert.equal(output.status, 200)
    for (const browser of browsers) {
      assert.match(browser.chunks.at(-1), /"revision":2/u)
      assert.doesNotMatch(
        browser.chunks.join(''),
        /collapseTiming|fixture-capability|settings/u,
      )
    }
    await create(false)
    const reads = bodyReads // 普通写入前捕获，后面不能再解析正文。
    const denied = response()
    await routes
      .get('/adminsmart/native-policy')
      .handler({ method: 'PUT', headers: {}, body: {} }, denied)
    assert.equal(denied.status, 403)
    assert.equal(bodyReads, reads)
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup?.()
  }
})
