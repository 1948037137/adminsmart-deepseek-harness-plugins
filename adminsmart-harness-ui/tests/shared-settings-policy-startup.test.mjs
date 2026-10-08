/** 正式Settings提供方的首次策略门禁；SDK字节保持原样，网络、DOM和时钟均为合成Fixture。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { GENERAL_SETTINGS_NAMESPACES } from '../src/ui-policy-client.mjs'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 只读当前明确选定的固定SDK，不保存本机安装路径。
const noOperation = () => () => {} // 未涉及真实渲染或远端事件的公开订阅边界。

/** @param {unknown} initial 合成初值。 @returns {object} 官方Settings依赖的稳定快照Store。 */
function snapshotStore(initial) {
  let value = initial // 只有显式接受时才替换公开引用。
  const listeners = new Set() // 当前公开订阅者，卸载时释放各自监听。
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    set(next) { value = next; for (const listener of listeners) listener() },
    update(edit) { const next = structuredClone(value); edit(next); this.set(next) },
  }
}

/** @returns {object} 仅供测试放行响应的Promise及幂等resolve，避免真实网络和计时等待。 */
function deferred() {
  let release // 当前合成响应唯一的放行能力。
  const promise = new Promise(resolve => { release = resolve }) // 未放行时明确保持pending。
  return { promise, release }
}

/**
 * 在真正提供方fiber里执行完整wrapper、原始官方Settings服务和公开ThemeRuntime。
 * @param {import('node:test').TestContext} t 当前测试拥有的全局fetch替身。
 * @param {object} options 合成启动和响应条件。
 * @param {'light'|'dark'} [options.theme] 管理员已发布的权威主题。
 * @param {boolean} [options.systemDark] 与权威值相反的操作系统主题。
 * @param {boolean} [options.holdPolicy] 扣住共享GET的回答。
 * @param {boolean} [options.holdSchema] 扣住官方Schema describe的回答。
 * @param {boolean} [options.expirePolicy] 合成前三阶段消耗预算，仅缩短最后门禁的测试定时器。
 * @param {boolean} [options.empty] 返回合法revision 0/settings null，表示尚未发布共享策略。
 * @param {number} [options.responseStatus] 共享GET的合成HTTP状态码。
 * @param {boolean} [options.corrupt] 返回非法策略，验证失败结算不能冒充ready。
 * @param {boolean} [options.missingSchema] 省略一个必需General Schema。
 * @returns {Promise<object>} 原始fiber、消费者和可控响应；无真实用户或外部服务。
 */
async function fixture(t, {
  theme = 'light', systemDark = true, holdPolicy = false, holdSchema = false,
  expirePolicy = false, empty = false, responseStatus = 200, corrupt = false, missingSchema = false,
} = {}) {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 固定SDK的公开包入口解析器。
  const cordis = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href) // 真正的服务归属、pending状态和卸载生命周期。
  const ctx = new cordis.Context() // 当前测试独占的官方根上下文。
  const policyGate = deferred() // 合成共享GET的独立响应门。
  const schemaGate = deferred() // 合成官方describe的独立响应门。
  const policy = { // 与系统主题刻意相反的完整非敏感共享设置。
    revision: empty ? 0 : 4, // 零只与合法null共同出现，不表示读取还未开始。
    settings: empty ? null : { // 五个官方General命名空间的八项真实协议字段；空态不补入共享默认值。
      locale: null, // 未指定共享语言，保留官方浏览器语言选择。
      theme, // 与合成系统偏好相反的管理员明暗选择。
      fontSize: 17, // 与官方14px默认不同的共享字号。
      transcriptView: 'verbose', // 官方工作步骤详细模式。
      performanceUsage: 'detailed', // 官方性能与Token用量明细。
      developerTools: false, // 普通用户首次读取前后均不开放代码工作视图。
      busyEnter: 'queue', // 运行期间按Enter的官方排队行为。
      linkOpening: 'sidebar', // 官方链接默认在右侧预览。
    },
    writable: false, // 测试消费者始终只读，不执行任何真实写操作。
  }
  let reads = 0 // 证明等待期间只进行一次策略读取。
  let schemas = 0 // 证明权威策略和Schema必须各自回答。
  let activated = 0 // 真实Cordis消费者的激活次数，不用手工调用apply代替依赖门禁。
  let firstTheme // 消费者第一次取得的原始官方主题快照。
  let now = 1_000 // 仅预算用例使用的绝对启动时钟。
  const timeouts = [] // 正式bounded实际使用的共同截止时间剩余预算。
  const document = { // 官方boot脚本已完成的非敏感DOM状态与资源载入边界。
    documentElement: { dataset: { dsThemeSource: theme } }, // 浅/深主题取自官方boot，ThemeRuntime不会读取此偏好。
    body: { style: { getPropertyValue: () => '17px' } }, // 原始官方Theme读取首屏字号，避免Fixture掩盖默认字号问题。
    querySelector: () => null, // 原始模块CSS可按公开生命周期注册，不依赖任何哈希选择器。
    createElement: () => ({ dataset: {} }), // CSS元素仅作为生命周期对象，不创建浏览器。
    head: { appendChild() {} }, // 原始CSS注册不影响本测试主题状态断言。
  }

  /** @param {string} name 官方包名。 @returns {Promise<object>} 原封不动的公开Client Bundle导出。 */
  async function loadOriginal(name) {
    assert.equal(require(name + '/package.json').version, '0.2.1-alpha.1')
    const file = require.resolve(name + '/client') // 固定SDK公开Client subpath，禁止抽取或改写内部类。
    let record // 原始Bundle的官方load登记。
    runInNewContext(await readFile(file, 'utf8'), {
      window: { __ModuleLoader__: { load(value) { record = value } } },
      document, structuredClone, console, queueMicrotask,
      matchMedia: () => ({ matches: systemDark, addEventListener() {}, removeEventListener() {} }), // 合成系统主题不读取真实浏览器或系统配置。
    }, { filename: file })
    return record.factory(dependency => {
      if (dependency === '@deepseek-ai/cordis') return cordis
      if (dependency === '@deepseek-ai/dsh-client-store') return { createSnapshotStore: snapshotStore, defineStore: spec => spec }
      if (dependency === '@deepseek-ai/dsh-client-ui-primitives') return new Proxy({}, { get: () => () => null })
      if (['react', 'react/jsx-runtime', 'react-dom'].includes(dependency)) return require(dependency)
      throw new Error('Fixture未声明依赖：' + dependency)
    })
  }

  const official = await loadOriginal('@deepseek-ai/dsh-client-ui-settings') // 原始服务必须由wrapper同一fiber执行apply。
  const themeModule = await loadOriginal('@deepseek-ai/dsh-client-ui-theme') // 实际ThemeRuntime，而非仿造主题默认或adopt实现。
  const remote = { // 官方Settings读取合同与原始memory条件保持真实，不伪造loopback能力。
    $host: { isLoopback: false }, // 合成公网事实，用来证明受管facade跨环境一致。
    $on: noOperation, // 只由显式Fixture回答触发启动，不连接真实事件服务。
    settings: {
      async describe() {
        schemas += 1
        await schemaGate.promise
        return { ok: true, value: { writable: false, hasDocument: false, namespaces: GENERAL_SETTINGS_NAMESPACES.filter(ns => !missingSchema || ns !== 'ui-chat').map(ns => ({ ns: ns === 'ui-settings' ? 'adminsmart-shared-settings' : ns, schema: { type: 'object', dict: {} }, value: {}, revision: 1, applies: 'live', secrets: [] })) } }
      },
    },
  }
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url, './adminsmart/ui-policy')
    assert.equal(request.method, 'GET')
    reads += 1
    await policyGate.promise
    return { ok: responseStatus === 200, status: responseStatus, json: async () => corrupt ? { ...policy, settings: { theme: 'invalid' } } : structuredClone(policy) }
  })
  ctx.provide('modules', {
    loadCache: new Map([['@deepseek-ai/dsh-client-ui-settings', official]]), // 本组专测权威读取；经典script及真实ModuleSystem由既有wrapper测试覆盖。
    import: async () => { if (expirePolicy) now = 5_500; return official }, // 已消耗4.5秒后，后续两个阶段只能共用剩余500ms。
  })
  ctx.provide('remote', remote)
  ctx.provide('remote.settings', remote.settings)
  ctx.provide('slots', { inject: (_name, register) => register(), register: noOperation })
  let record // 正式wrapper原始load登记，动态导入只映射到正式自有模块。
  const file = new URL('../shared-settings/client.js', import.meta.url) // 唯一正式提供方源文件。
  runInNewContext(await readFile(file, 'utf8'), {
    window: { location: { href: 'http://fixture.example/runtime/' }, __ModuleLoader__: { load(value) { record = value } } },
    document, URL, AbortController,
    Date: expirePolicy ? { now: () => now } : Date, // 仅超时用例控制绝对时间，正常用例使用真实有界时钟。
    setTimeout(callback, delay) { timeouts.push(delay); return setTimeout(callback, expirePolicy && timeouts.length === 3 ? 10 : delay) }, // 只缩短最后pending门禁，不给前两个阶段虚假失败。
    clearTimeout, setInterval, clearInterval,
  }, { filename: file.pathname, importModuleDynamically: async specifier => { assert.equal(specifier, 'http://fixture.example/runtime/adminsmart/ui-policy-client.mjs'); return import('../src/ui-policy-client.mjs') } })
  const module = record.factory(dependency => { assert.equal(dependency, 'react/jsx-runtime'); return require(dependency) }) // 使用固定SDK同一React平台实例。
  const consumer = ctx.plugin({
    inject: ['configForms'], // 真正的官方服务依赖门，不手动等待bridge.ready来掩盖正式竞态。
    apply(owner) { activated += 1; const theme = new themeModule.ThemeRuntime(owner, owner.configForms.get('ui-theme')); firstTheme = theme.getTheme() },
  })
  const fiber = ctx.plugin(module) // 正式wrapper在真实提供方fiber中启动。
  if (!holdPolicy) policyGate.release()
  if (!holdSchema) schemaGate.release()
  return {
    ctx, fiber, consumer, timeouts, releasePolicy: policyGate.release, releaseSchema: schemaGate.release,
    get activated() { return activated }, get firstTheme() { return firstTheme }, get reads() { return reads }, get schemas() { return schemas },
    async dispose() { await consumer.dispose(); await fiber.dispose() },
  }
}

for (const choice of [{ theme: 'light', systemDark: true }, { theme: 'dark', systemDark: false }]) {
  test(`共享${choice.theme}与系统相反时，GET及Schema均确认后才激活原始Theme首个快照`, { skip: !runtimeRoot, timeout: 2_000 }, async t => {
    const state = await fixture(t, { ...choice, holdPolicy: true, holdSchema: true }) // 两个相互独立的必需回答分别扣住。
    try {
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(state.reads, 1)
      assert.equal(state.schemas, 1)
      assert.equal(state.activated, 0)
      assert.equal(state.ctx.get('configForms'), undefined)
      if (choice.theme === 'light') state.releasePolicy()
      else state.releaseSchema()
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(state.activated, 0)
      assert.equal(state.ctx.get('configForms'), undefined)
      state.releasePolicy()
      state.releaseSchema()
      await state.fiber.await()
      await state.consumer.await()
      assert.equal(state.activated, 1)
      assert.equal(state.firstTheme.preference, choice.theme)
      assert.equal(state.firstTheme.active.colorScheme, choice.theme)
      assert.equal(state.firstTheme.fontSize, 17)
      assert.equal(state.ctx.get('configForms').get('ui-theme').getSnapshot().status, 'ready')
    } finally { state.releasePolicy(); state.releaseSchema(); await state.dispose() }
  })
}

for (const failure of [{ responseStatus: 503 }, { corrupt: true }, { missingSchema: true }]) {
  test('首次HTTP/策略/Schema失败正常结算Promise也不能放行消费者：' + JSON.stringify(failure), { skip: !runtimeRoot, timeout: 2_000 }, async t => {
    const state = await fixture(t, failure) // 各故障仅修改自己的公开传输边界。
    try {
      await assert.rejects(() => state.fiber.await(), /共享设置首次读取未完成/u)
      assert.equal(state.activated, 0)
      assert.equal(state.ctx.get('configForms'), undefined)
    } finally { await state.dispose() }
  })
}

test('合法未发布revision 0/null确认后保留官方默认状态且不阻塞首次装配', { skip: !runtimeRoot, timeout: 2_000 }, async t => {
  const state = await fixture(t, { empty: true }) // 空策略不是传输失败，也不能虚报已采用共享值。
  try {
    await state.fiber.await()
    await state.consumer.await()
    assert.equal(state.activated, 1)
    assert.equal(state.firstTheme.preference, 'system')
    const form = state.ctx.get('configForms').get('ui-theme').getSnapshot() // 保留既有空策略的loading/value undefined/writable false协议。
    assert.equal(form.status, 'loading')
    assert.equal(form.value, undefined)
    assert.equal(form.revision, 0)
    assert.equal(form.writable, false)
  } finally { await state.dispose() }
})

test('首次GET门禁沿用剩余500ms预算，超时与迟到回答不能提供服务', { skip: !runtimeRoot, timeout: 2_000 }, async t => {
  const state = await fixture(t, { holdPolicy: true, expirePolicy: true }) // 最后一段预算由合成10ms触发，无需真实等待五秒。
  try {
    await assert.rejects(() => state.fiber.await(), /共享设置首次读取失败或超时/u)
    assert.deepEqual(state.timeouts, [5_000, 500, 500])
    assert.equal(state.activated, 0)
    assert.equal(state.ctx.get('configForms'), undefined)
    state.releasePolicy()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(state.activated, 0)
    assert.equal(state.ctx.get('configForms'), undefined)
  } finally { state.releasePolicy(); await state.dispose() }
})

for (const hold of [{ holdPolicy: true }, { holdSchema: true }]) {
  test('首次权威读取pending期间dispose及时清理且迟到回答不能激活消费者：' + JSON.stringify(hold), { skip: !runtimeRoot, timeout: 2_000 }, async t => {
    const state = await fixture(t, hold) // GET和Schema的取消分别验证。
    try {
      await new Promise(resolve => setImmediate(resolve))
      const started = Date.now() // 取消应即时响应，不能等待共同五秒预算用尽。
      await state.fiber.dispose()
      assert.ok(Date.now() - started < 1_000)
      state.releasePolicy()
      state.releaseSchema()
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(state.activated, 0)
      assert.equal(state.ctx.get('configForms'), undefined)
    } finally { state.releasePolicy(); state.releaseSchema(); await state.dispose() }
  })
}
