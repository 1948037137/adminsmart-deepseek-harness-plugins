/** 官方 General 八项设置的离线持久化与同步回归；所有 HTTP、时间和原生设置都使用 Fake。 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { applyGeneralSettings, captureGeneralSettings, installSharedUiPolicy } from '../src/shared-ui-policy.mjs'

const DEFAULT_POLICY = Object.freeze({
  locale: null, // 官方未指定语言，不将浏览器解析结果当作保存值。
  theme: 'system', // 官方默认外观偏好。
  fontSize: 14, // 官方默认字号。
  transcriptView: null, // RC2 Host 可以未指定，由官方 Web Client 显示 detailed。
  performanceUsage: 'detailed', // 官方默认性能统计详情。
  developerTools: true, // 官方默认诊断开关。
  busyEnter: 'queue', // 官方默认忙碌 Enter 行为。
  linkOpening: 'sidebar', // 官方默认链接目的地。
})

const SUPPORTED_VALUES = Object.freeze({
  locale: [null, 'zh', 'en', 'zh-Hans-CN', 'en-US'], // 两种内建语言、未指定与官方合法区域标签样本。
  theme: ['light', 'dark', 'system'], // 全部官方外观选项。
  fontSize: Array.from({ length: 13 }, (_, index) => index + 10), // 全部 RC2 整数字号 10-22。
  transcriptView: ['compact', 'standard', 'detailed', 'verbose', 'normal', 'expanded', null], // 四种当前模式、两种兼容旧值和未指定。
  performanceUsage: ['compact', 'detailed'], // 全部统计详情选项。
  developerTools: [false, true], // 关闭不能被默认开启覆盖。
  busyEnter: ['queue', 'steer'], // 全部忙碌 Enter 行为。
  linkOpening: ['sidebar', 'new-tab'], // 全部链接目的地。
})

const FIELD_TARGETS = Object.freeze({
  locale: ['locale', 'preference'], // 语言偏好的原生命名空间与字段。
  theme: ['ui-theme', 'preference'], // 外观偏好的原生归属。
  fontSize: ['ui-theme', 'fontSize'], // 字号的原生归属。
  transcriptView: ['ui-chat', 'transcriptView'], // 工作细节的原生归属。
  performanceUsage: ['ui-chat', 'performanceUsage'], // 性能统计的原生归属。
  developerTools: ['ui-settings', 'enabled'], // 诊断工具的原生归属。
  busyEnter: ['ui-conversation', 'busyEnter'], // Enter 行为的原生归属。
  linkOpening: ['ui-chat', 'linkOpening'], // 链接目的地的原生归属。
})

/**
 * 建立仅含官方展示字段的 SettingsForms Fake。
 * @param {object} policy 完整非敏感策略。
 * @param {string} generalNamespace 原生旧 ui-settings 或固定自有 wrapper 的实际 entry ID。
 * @returns {object} 支持官方 describe/update/mutate、修订号和可控错误的原生服务 Fake。
 */
function nativeSettings(policy = DEFAULT_POLICY, generalNamespace = 'ui-settings') {
  const entries = new Map([
    ['locale', policy.locale === null ? {} : { preference: policy.locale }],
    ['ui-theme', { preference: policy.theme, fontSize: policy.fontSize }],
    ['ui-chat', { transcriptView: policy.transcriptView, performanceUsage: policy.performanceUsage, linkOpening: policy.linkOpening }],
    ['ui-conversation', { busyEnter: policy.busyEnter }],
    [generalNamespace, { enabled: policy.developerTools }],
  ]) // 官方五个字段属主，未读任何磁盘用户配置。
  const revisions = new Map([...entries.keys()].map(ns => [ns, 0])) // 各原生命名空间自己的 CAS 修订。
  const writes = [] // 观察 Host 采用策略的原生写入，不是真实 Profile 文件。
  const state = {
    failNamespace: null, // 下一次对该原生命名空间写入时失败，模拟采用中途失败。
    changed: () => {}, // Cordis Fake 绑定的官方变化回调。
  }
  return {
    entries, revisions, writes, state,
    describe: () => [...entries].map(([ns, value]) => ({ ns, value: structuredClone(value), revision: revisions.get(ns) })),
    /** @param {string} ns 白名单命名空间。 @param {object} fields 固定展示字段。 @param {number} expected 原生修订。 @returns {Promise<void>} Fake 提交完成。 */
    async update(ns, fields, expected) {
      assert.equal(expected, revisions.get(ns), '采用必须携带本次 describe 的官方原生修订')
      assert.ok(entries.has(ns))
      if (state.failNamespace === ns) { state.failNamespace = null; throw new Error('fixture native failure') }
      writes.push({ ns, fields: structuredClone(fields), expected })
      entries.set(ns, { ...entries.get(ns), ...fields })
      revisions.set(ns, expected + 1)
      state.changed(ns)
    },
    /** @param {string} ns 语言命名空间。 @param {Array<object>} ops 官方 unset 操作。 @param {number} expected 原生修订。 @returns {Promise<void>} Fake 取消语言偏好。 */
    async mutate(ns, ops, expected) {
      assert.equal(ns, 'locale')
      assert.deepEqual(ops, [{ op: 'unset', path: ['preference'] }])
      assert.equal(expected, revisions.get(ns))
      const next = { ...entries.get(ns) } // unset 不能清除该命名空间的其它字段。
      delete next.preference
      entries.set(ns, next)
      revisions.set(ns, expected + 1)
      writes.push({ ns, ops: structuredClone(ops), expected })
      state.changed(ns)
    },
    /** @param {string} alias 稳定 API 字段。 @param {unknown} value 原生管理员选择。 @param {boolean} notify 是否发官方事件。 @returns {void} 更新 Fake 原生值。 */
    edit(alias, value, notify = true) {
      const [canonicalNs, field] = FIELD_TARGETS[alias] // API 字段对应的 canonical 命名空间与原生字段，禁止任意 JSON。
      const ns = canonicalNs === 'ui-settings' ? generalNamespace : canonicalNs // 自有 wrapper 使用实际 Host entry ID发事件，不能伪造旧官方 ID。
      const next = { ...entries.get(ns), [field]: value } // 模拟官方表单已提交的有效值。
      if (alias === 'locale' && value === null) delete next.preference
      entries.set(ns, next)
      revisions.set(ns, revisions.get(ns) + 1)
      if (notify) state.changed(ns)
    },
  }
}

/** @param {object} settings 原生设置 Fake。 @returns {object} 自动清理的 Cordis 事件与生命周期 Fake。 */
function hostContext(settings) {
  const listeners = new Set() // 只模拟公开 settings/document-updated 事件。
  const warnings = [] // 验证日志不携带响应正文或身份能力。
  let dispose = null // effect 注册的清理函数。
  settings.state.changed = ns => { for (const listener of listeners) listener(ns) }
  return {
    settings, listeners, warnings,
    logger: { warn: (...args) => warnings.push(args) },
    on(name, listener) { assert.equal(name, 'settings/document-updated'); listeners.add(listener); return () => listeners.delete(listener) },
    effect(register) { dispose = register() },
    close() { dispose?.(); dispose = null },
  }
}

/**
 * 安装隔离 Fake HTTP 与时钟，所有请求都在进程内处理。
 * @param {object} t Node 测试上下文，自动恢复 mock 与时钟。
 * @param {object} remote 初始化的持久化策略信封。
 * @returns {object} 可控制外部管理员更新、请求失败和 PUT 时序的 Fake 后端。
 */
function backendFixture(t, remote = { revision: 0, settings: null }) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const state = {
    remote: structuredClone(remote), // 独立后端真源，与原生设置没有共享对象引用。
    puts: [], // 所有 PUT 尝试，包括 CAS 拒绝。
    gets: 0, // 观察未就绪时是否出现微任务忙循环。
    beforePut: null, // 在 GET 与 PUT 之间插入竞态或等待点。
    reply: null, // 注入非法或不同键序的 GET 响应。
    status: null, // 注入请求失败，不打开任何套接字。
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'http://ui-policy.invalid/internal/agent-model/v1/ui-policy/events') {
      return { ok: true, body: { async *[Symbol.asyncIterator]() {
        if (options.signal.aborted) return
        await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }))
      } } } // 普通字段/CAS 回归不推送通知；独立 push 测试覆盖 ready/change/resync 与卸载。
    }
    assert.equal(url, 'http://ui-policy.invalid/internal/agent-model/v1/ui-policy')
    assert.equal(options.redirect, 'error')
    if (state.status !== null) return { ok: false, status: state.status }
    if (options.method === 'PUT') {
      assert.equal(options.headers['X-AdminSmart-User-Id'], '7', '普通用户不能发起策略 PUT')
      const body = JSON.parse(options.body) // 唯一受限 CAS 请求，里面只有展示字段与修订。
      state.puts.push(structuredClone(body))
      await state.beforePut?.(body)
      if (body.expectedRevision !== state.remote.revision) return { ok: false, status: 409 }
      assert.deepEqual(Object.keys(body.settings).sort(), Object.keys(DEFAULT_POLICY).sort())
      state.remote = { revision: state.remote.revision + 1, settings: structuredClone(body.settings) }
    } else {
      assert.equal(options.method, 'GET')
      state.gets += 1
    }
    const payload = structuredClone(state.reply ?? state.remote) // 快照模拟真实 JSON 响应，不与后续远端更新串改。
    return { ok: true, json: async () => payload }
  })
  return state
}

/** @param {object} t 测试上下文。 @param {object} settings 原生 Fake。 @param {boolean} admin 可信管理员角色。 @returns {object} 已注册清理的 Runtime Fake。 */
function startHost(t, settings, admin = true) {
  const ctx = hostContext(settings) // 每次启动独立 Host 生命周期，没有真实 Runtime。
  t.after(() => ctx.close())
  installSharedUiPolicy(ctx, {
    apiBase: 'http://ui-policy.invalid', // 不可用于真实业务的离线域名，fetch 被完全替换。
    readToken: async () => 'fixture-capability', // 合成标记，不加载任何凭据文件。
    userId: admin ? '7' : '8', // Fake 签名身份，用于检测普通用户误写。
    modeId: 'knowledge', // 固定白名单业务模式 Fixture。
    presetId: 'adminsmart-knowledge', // 固定业务能力 Fixture。
    isAdmin: admin, // 来自 Fake 签名租约，不是浏览器参数。
  })
  return ctx
}

/** @returns {Promise<void>} 排空实际微任务，不等待真实低频补偿轮询或 200ms 去抖。 */
async function flush() { await new Promise(resolve => setImmediate(resolve)) }

// alias 是独立 API 字段；values 是该字段全部官方有限选项或语言标签代表样本。
for (const [alias, values] of Object.entries(SUPPORTED_VALUES)) {
  for (const value of values) {
    test(`General ${alias}=${String(value)} Fake 保存 -> 重载 -> 普通用户只读采用`, async t => {
      const alternate = values.find(candidate => candidate !== value) // 确保本轮是实际选择，而不是沿用同一默认值。
      const baseline = { ...DEFAULT_POLICY, [alias]: alternate } // 管理员实际采用的修订一快照。
      const chosen = { ...DEFAULT_POLICY, [alias]: value } // 要完整保存并跨启动采用的目标选项。
      const backend = backendFixture(t, { revision: 1, settings: baseline }) // 只有内存持久化，没有数据库。
      const admin = startHost(t, nativeSettings(baseline)) // 已采用 baseline 的管理员 Runtime。
      await flush()
      admin.settings.edit(alias, value)
      t.mock.timers.tick(200)
      await flush()
      assert.deepEqual(backend.remote, { revision: 2, settings: chosen })
      assert.equal(backend.puts.length, 1)
      assert.equal(backend.puts[0].expectedRevision, 1)
      admin.close()
      const reloaded = startHost(t, nativeSettings()) // 冷启动/刷新以不同原生默认值启动，必须采用持久化选择。
      await flush()
      assert.deepEqual(captureGeneralSettings(reloaded.settings), chosen)
      const ordinary = startHost(t, nativeSettings(baseline), false) // 普通用户仅有只读 General 投影。
      await flush()
      assert.deepEqual(captureGeneralSettings(ordinary.settings), chosen)
      assert.equal(ordinary.listeners.size, 0)
      ordinary.settings.edit(alias, alternate)
      t.mock.timers.tick(30_000)
      await flush()
      assert.deepEqual(captureGeneralSettings(ordinary.settings), chosen, '普通用户本地变化不能覆盖共享策略')
      assert.equal(backend.puts.length, 1, '刷新、重载、普通用户采用不能产生额外策略 PUT')
    })
  }
}

test('RC2 未指定 transcript 与语言可播种，不补入猜测默认模式', async t => {
  const backend = backendFixture(t) // 未配置环境只允许第一个管理员播种。
  const settings = nativeSettings() // 所有官方必需字段已生效。
  delete settings.entries.get('ui-chat').transcriptView
  startHost(t, settings)
  await flush()
  assert.deepEqual(backend.remote, { revision: 1, settings: DEFAULT_POLICY })
  assert.equal(backend.puts.length, 1)
})

test('缺命名空间或必需字段时等待就绪，不发布部分设置或忙循环', async t => {
  const backend = backendFixture(t) // 无策略时不能用启动中的缺字段值播种。
  const settings = nativeSettings() // 逐步模拟插件表单就绪。
  const chat = settings.entries.get('ui-chat') // 暂时移除的完整聊天表单 Fixture。
  settings.entries.delete('ui-chat')
  startHost(t, settings)
  await flush()
  assert.equal(backend.gets, 1)
  assert.equal(backend.puts.length, 0)
  settings.entries.set('ui-chat', chat)
  delete settings.entries.get('ui-theme').fontSize
  assert.equal(captureGeneralSettings(settings), null)
  t.mock.timers.tick(30_000)
  await flush()
  assert.equal(backend.puts.length, 0)
  settings.edit('fontSize', 22)
  t.mock.timers.tick(30_000)
  await flush()
  assert.equal(backend.puts.length, 1)
  assert.equal(backend.remote.settings.fontSize, 22)
})

test('远端 JSON 键序变化不制造管理员编辑或额外 PUT', async t => {
  const backend = backendFixture(t, { revision: 1, settings: DEFAULT_POLICY }) // 与本地相同的持久化策略。
  backend.reply = { revision: 1, settings: Object.fromEntries(Object.entries(DEFAULT_POLICY).reverse()) }
  const admin = startHost(t, nativeSettings()) // 原生捕获始终使用自己的字段顺序。
  await flush()
  t.mock.timers.tick(30_000)
  await flush()
  assert.equal(backend.puts.length, 0)
  assert.deepEqual(captureGeneralSettings(admin.settings), DEFAULT_POLICY)
})

test('GET 已发现新修订时，旧管理员编辑不能冒用新修订覆盖胜出策略', async t => {
  const backend = backendFixture(t, { revision: 1, settings: DEFAULT_POLICY }) // 管理员启动时采用修订一。
  const admin = startHost(t, nativeSettings()) // 陈旧管理员的独立原生状态。
  await flush()
  backend.remote = { revision: 2, settings: { ...DEFAULT_POLICY, theme: 'dark', fontSize: 22 } }
  admin.settings.edit('transcriptView', 'verbose')
  t.mock.timers.tick(200)
  await flush()
  assert.deepEqual(captureGeneralSettings(admin.settings), backend.remote.settings)
  assert.equal(backend.puts.length, 0, '不能用刚 GET 的修订二为陈旧编辑开通写入')
})

test('GET 后的 PUT CAS 冲突只采用胜出策略，不重发丢失的旧编辑', async t => {
  const backend = backendFixture(t, { revision: 1, settings: DEFAULT_POLICY }) // 原先共享修订。
  const admin = startHost(t, nativeSettings()) // 此 Runtime 的编辑稍后输掉 CAS。
  await flush()
  backend.beforePut = () => { backend.remote = { revision: 2, settings: { ...DEFAULT_POLICY, theme: 'dark' } } }
  admin.settings.edit('transcriptView', 'verbose')
  t.mock.timers.tick(200)
  await flush()
  assert.equal(backend.puts.length, 1)
  assert.equal(backend.puts[0].expectedRevision, 1)
  t.mock.timers.tick(30_000)
  await flush()
  assert.deepEqual(captureGeneralSettings(admin.settings), backend.remote.settings)
  assert.equal(backend.puts.length, 1)
})

test('原生事件遗漏仍可保存管理员选择', async t => {
  const backend = backendFixture(t, { revision: 1, settings: DEFAULT_POLICY }) // 已确认同步基线。
  const admin = startHost(t, nativeSettings()) // 仅靠周期快照也应捕获编辑。
  await flush()
  admin.settings.edit('busyEnter', 'steer', false)
  t.mock.timers.tick(30_000)
  await flush()
  assert.equal(backend.puts.length, 1)
  assert.equal(backend.remote.settings.busyEnter, 'steer')
})

test('采用新策略中途失败时，混合状态不能被管理员反向发布', async t => {
  const backend = backendFixture(t, { revision: 1, settings: DEFAULT_POLICY }) // 初始完整策略已采用。
  const admin = startHost(t, nativeSettings()) // 模拟活跃管理员在回读时部分采用失败。
  await flush()
  backend.remote = { revision: 2, settings: { ...DEFAULT_POLICY, theme: 'dark', transcriptView: 'verbose' } }
  admin.settings.state.failNamespace = 'ui-chat'
  t.mock.timers.tick(30_000)
  await flush()
  assert.equal(captureGeneralSettings(admin.settings).theme, 'dark')
  assert.equal(captureGeneralSettings(admin.settings).transcriptView, null)
  t.mock.timers.tick(30_000)
  await flush()
  assert.deepEqual(captureGeneralSettings(admin.settings), backend.remote.settings)
  assert.equal(backend.puts.length, 0)
})

test('采用仅写固定展示字段，并携带原生修订，unset 不清空其它字段', async () => {
  const settings = nativeSettings({ ...DEFAULT_POLICY, locale: 'zh', theme: 'light' }) // 有待清除语言和变更主题。
  settings.entries.get('locale').futurePresentation = 'keep-locale'
  settings.entries.get('ui-theme').futurePresentation = 'keep-theme'
  settings.entries.set('non-general', { marker: 'keep-unrelated' })
  await applyGeneralSettings(settings, DEFAULT_POLICY)
  assert.equal(settings.entries.get('locale').futurePresentation, 'keep-locale')
  assert.equal(settings.entries.get('ui-theme').futurePresentation, 'keep-theme')
  assert.deepEqual(settings.entries.get('non-general'), { marker: 'keep-unrelated' })
  assert.deepEqual(settings.writes.map(write => write.ns), ['locale', 'ui-theme'])
  assert.deepEqual(captureGeneralSettings(settings), DEFAULT_POLICY)
})

test('固定owned Settings entry可捕获false，实际写入只命中新entry并保留未来字段', async () => {
  const owned = 'adminsmart-shared-settings' // Profile 中唯一自有 wrapper entry，不与旧 id重复。
  const settings = nativeSettings(DEFAULT_POLICY, owned) // 使用真实源 namespace 形状的公开 SettingsForms Fake。
  settings.entries.get(owned).futurePresentation = 'keep-owned-field'
  assert.equal(captureGeneralSettings(settings).developerTools, true)
  await applyGeneralSettings(settings, { ...DEFAULT_POLICY, developerTools: false })
  assert.deepEqual(settings.writes, [{ ns: owned, fields: { enabled: false }, expected: 0 }])
  assert.equal(settings.entries.has('ui-settings'), false)
  assert.equal(settings.entries.get(owned).futurePresentation, 'keep-owned-field')
  assert.equal(captureGeneralSettings(settings).developerTools, false)
})

test('owned文档事件管理员立即发布；普通用户只GET采用false而不发布', async t => {
  const backend = backendFixture(t, { revision: 1, settings: DEFAULT_POLICY }) // 真源仅在内存，不能访问真实用户策略。
  const owned = 'adminsmart-shared-settings' // 当前候选 Profile 的固定 wrapper身份。
  const admin = startHost(t, nativeSettings(DEFAULT_POLICY, owned)) // 旧 ui-settings不挂载，仅保留自有 entry。
  await flush()
  admin.settings.edit('developerTools', false)
  t.mock.timers.tick(200)
  await flush()
  assert.equal(backend.puts.length, 1, 'owned事件必须触发即时提交，不能等30秒补偿')
  assert.equal(backend.remote.settings.developerTools, false)
  const ordinary = startHost(t, nativeSettings(DEFAULT_POLICY, owned), false) // 普通用户独立Runtime只有回读与采用能力。
  await flush()
  assert.equal(captureGeneralSettings(ordinary.settings).developerTools, false)
  assert.deepEqual(ordinary.settings.writes, [{ ns: owned, fields: { enabled: false }, expected: 0 }])
  assert.equal(backend.puts.length, 1, '普通用户只能GET和本地采用，不能发布策略')
})

test('非法响应及额外 Profile 字段不能覆盖有效选择，恢复合法响应后可继续采用', async t => {
  const backend = backendFixture(t, { revision: 1, settings: DEFAULT_POLICY }) // 真实 API 被完整替换为内存 Fake。
  backend.reply = { revision: 1, settings: { ...DEFAULT_POLICY, profile: { arbitrary: true } } }
  const admin = startHost(t, nativeSettings()) // 响应损坏时不能重置为猜测默认设置。
  await flush()
  assert.equal(admin.settings.writes.length, 0)
  assert.equal(backend.puts.length, 0)
  assert.deepEqual(admin.warnings, [['AdminSmart 全局界面设置同步暂不可用']])
  backend.reply = { revision: -1, settings: DEFAULT_POLICY }
  t.mock.timers.tick(30_000)
  await flush()
  assert.equal(admin.settings.writes.length, 0)
  backend.reply = null
  t.mock.timers.tick(30_000)
  await flush()
  admin.settings.edit('fontSize', 10)
  t.mock.timers.tick(200)
  await flush()
  assert.equal(backend.puts.length, 1)
  assert.equal(backend.remote.settings.fontSize, 10)
  await assert.rejects(applyGeneralSettings(admin.settings, { ...DEFAULT_POLICY, arbitrary: true }))
})

test('卸载后不再执行轮询或事件写入', async t => {
  const backend = backendFixture(t, { revision: 1, settings: DEFAULT_POLICY }) // 用计数确认卸载边界。
  const admin = startHost(t, nativeSettings()) // 即将结束的 Host 生命周期。
  await flush()
  admin.settings.edit('fontSize', 22)
  admin.close()
  t.mock.timers.tick(20_000)
  await flush()
  assert.equal(backend.gets, 1)
  assert.equal(backend.puts.length, 0)
})

test('PUT 请求期间的后续原生编辑在下一轮保存，不被较早响应覆盖', async t => {
  const backend = backendFixture(t, { revision: 1, settings: DEFAULT_POLICY }) // 同一 Runtime 的连续编辑采用同一已确认修订。
  const admin = startHost(t, nativeSettings()) // 第一个编辑请求期间还会出现第二次选择。
  await flush()
  let release = null // 控制 Fake PUT 何时返回，不等待真实 HTTP。
  backend.beforePut = () => new Promise(resolve => { release = resolve })
  admin.settings.edit('transcriptView', 'verbose')
  t.mock.timers.tick(200)
  await flush()
  assert.equal(backend.puts.length, 1)
  admin.settings.edit('fontSize', 22)
  t.mock.timers.tick(200)
  await flush()
  assert.equal(backend.puts.length, 1, '同一 Runtime 的第二次请求不能与 PUT 并行')
  backend.beforePut = null
  release()
  await flush()
  assert.equal(backend.puts.length, 2)
  assert.equal(backend.puts[1].expectedRevision, 2)
  assert.equal(backend.remote.settings.transcriptView, 'verbose')
  assert.equal(backend.remote.settings.fontSize, 22)
})

test('临时请求失败不抹掉管理员未保存选择，恢复后仍按已确认修订提交', async t => {
  const backend = backendFixture(t, { revision: 1, settings: DEFAULT_POLICY }) // 正常基线先成功初始化。
  const admin = startHost(t, nativeSettings()) // 待提交选择必须留在原生有效值中。
  await flush()
  backend.status = 503
  admin.settings.edit('transcriptView', 'verbose')
  t.mock.timers.tick(200)
  await flush()
  assert.equal(backend.puts.length, 0)
  assert.equal(captureGeneralSettings(admin.settings).transcriptView, 'verbose')
  backend.status = null
  t.mock.timers.tick(30_000)
  await flush()
  assert.equal(backend.puts.length, 1)
  assert.equal(backend.puts[0].expectedRevision, 1)
  assert.equal(backend.remote.settings.transcriptView, 'verbose')
})

test('普通用户在尚无策略时不播种，管理员配置出现后才只读采用', async t => {
  const backend = backendFixture(t) // 环境暂时没有管理员策略。
  const ordinary = startHost(t, nativeSettings({ ...DEFAULT_POLICY, theme: 'light' }), false) // 普通用户不能发布本地默认值。
  await flush()
  assert.equal(backend.puts.length, 0)
  backend.remote = { revision: 1, settings: { ...DEFAULT_POLICY, theme: 'dark' } }
  t.mock.timers.tick(30_000)
  await flush()
  assert.deepEqual(captureGeneralSettings(ordinary.settings), backend.remote.settings)
  assert.equal(backend.puts.length, 0)
})
