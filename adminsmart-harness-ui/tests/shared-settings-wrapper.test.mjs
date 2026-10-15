/** 使用固定SDK、真实Loader/fiber及正式wrapper源码验证装配；HTTP、DOM载入与策略均为合成Fixture。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { gunzipSync } from 'node:zlib'
import { GENERAL_SETTINGS_NAMESPACES } from '../src/ui-policy-client.mjs'
import { UI_POLICY_CLIENT_REVISION_GLOBAL, installUiPolicyHttp } from '../src/ui-policy-http.mjs'
import './shared-settings-startup.test.mjs' // 同一正式wrapper检查入口必须覆盖总预算、卸载及迟到响应。
import './shared-settings-policy-startup.test.mjs' // 权威General读取必须先于真实Cordis消费者与原始Theme首个快照。

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 只从任务明确指定的固定安装读SDK，不硬编码机器路径。

/** @param {unknown} initial 合成状态。 @returns {object} 符合官方稳定Observable协议的内存Store。 */
function snapshotStore(initial) {
  let value = initial // 接受新值之前始终返回同一引用。
  const listeners = new Set() // 公开订阅者。
  return { getSnapshot: () => value, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }, set(next) { value = next; for (const listener of listeners) listener() }, update(edit) { const next = structuredClone(value); edit(next); this.set(next) } }
}

test('nested Host保留官方Config/apply，固定资源GET字节不变、HEAD无正文、禁止任意方法', { skip: !runtimeRoot }, async () => {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 本次SDK公开包入口。
  const host = await import('../shared-settings/index.mjs') // 产品正式nested Host入口。
  const official = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-ui-settings')).href) // 原始公开Host导出。
  assert.strictEqual(host.Config, official.Config)
  const routes = [] // 公开webServer.register的原样路由。
  let configured = 0 // 官方apply应负责真实Schema注册行为。
  let injectRevision // 官方 index 的可信公开代码哈希注入回调。
  const ctx = { fiber: { id: 'adminsmart-shared-settings' }, on(event, listener) { assert.equal(event, 'webserver/index-inject'); injectRevision = listener; return () => {} }, inject(_names, register) { register({ effect: callback => callback(), settings: { configure(options, owner) { assert.deepEqual(options, { auto: false }); assert.strictEqual(owner, ctx.fiber); assert.equal(owner.id, 'adminsmart-shared-settings'); configured += 1 } } }) }, effect: callback => callback(), webServer: { register(route) { routes.push(route); return () => {} } } } // 官方configure直接使用真实owned提供方，不冒用ui-settings身份。
  host.apply(ctx, {})
  assert.equal(configured, 1)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/adminsmart/shared-settings/official-client.js')
  const original = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-settings/client')) // 固定官方发布字节，无文件写入。
  const bootTable = [] // 只允许公开源码身份进入页面，不包含策略或当前用户信息。
  injectRevision(bootTable)
  assert.deepEqual(bootTable, [{ kind: 'script-preload', src: '.' + host.OFFICIAL_SETTINGS_CLIENT_ROUTE + '?rev=' + host.OFFICIAL_SETTINGS_CLIENT_REVISION }, { kind: 'global', name: '__ADMINSMART_SHARED_SETTINGS_CLIENT_REVISION__', value: host.OFFICIAL_SETTINGS_CLIENT_REVISION }]) // 下载提示不能执行官方factory或夹带策略/身份。
  for (const method of ['GET', 'HEAD', 'PUT']) {
    const response = { status: undefined, body: undefined, writeHead(status) { this.status = status }, end(body) { this.body = body } } // 隔离HTTP响应。
    await routes[0].handler({ method }, response)
    assert.equal(response.status, method === 'PUT' ? 405 : 200)
    if (method === 'GET') assert.deepEqual(response.body, original)
    else assert.equal(response.body, undefined)
  }
  for (const encoding of ['gzip', 'gzip;q=0']) {
    const response = { headers: {}, writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = body } } // 检查可信版本资源真实编码和缓存头。
    await routes[0].handler({ method: 'GET', url: `${routes[0].path}?rev=${host.OFFICIAL_SETTINGS_CLIENT_REVISION}`, headers: { 'accept-encoding': encoding } }, response)
    assert.equal(response.headers['cache-control'], 'private, max-age=31536000, immutable')
    assert.equal(response.headers.vary, 'Accept-Encoding')
    assert.deepEqual(encoding === 'gzip' ? gunzipSync(response.body) : response.body, original)
    assert.equal(response.headers['content-encoding'], encoding === 'gzip' ? 'gzip' : undefined)
  }
  const stale = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = body } } // 旧版本 URL 不得拿到新字节并被永久缓存。
  await routes[0].handler({ method: 'GET', url: `${routes[0].path}?rev=${'a'.repeat(64)}` }, stale)
  assert.equal(stale.status, 410)
  assert.equal(stale.headers['cache-control'], 'no-store')
  const manifest = JSON.parse(await readFile(new URL('../shared-settings/package.json', import.meta.url), 'utf8')) // 正式包根必须具有独立module身份。
  assert.equal(manifest.name, '@adminsmart/dsh-shared-settings')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
})

test('正式wrapper先script登记真实ModuleSystem，未知导入pending时仍激活消费者并反馈保存状态', { skip: !runtimeRoot, timeout: 2_000 }, async t => {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 同一固定SDK。
  const cordis = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href) // 真实fiber所有权与ctx.set检查。
  const originals = new Map() // 原封不动官方client bundle记录。
  for (const name of ['@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-client-ui-settings']) {
    const file = require.resolve(name + '/client') // 唯一官方公开Client入口。
    let record // 官方Bundle通过load登记的原始工厂。
    runInNewContext(await readFile(file, 'utf8'), { window: { __ModuleLoader__: { load(value) { record = value } } }, structuredClone, console, queueMicrotask }, { filename: file })
    originals.set(name, record)
  }
  const seed = { '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': { createSnapshotStore: snapshotStore } } // 原始Settings工厂只使用官方平台能力。
  const moduleExports = originals.get('@deepseek-ai/dsh-client-modules').factory(() => { throw new Error('模块基础设施不得请求外部服务') }) // 真实ModuleSystem没有传输依赖。
  const target = { mode: 'queue', pendingQueue: [], load() {} } // 官方经典script登记目标。
  const modules = moduleExports.createClientModuleSystem(target, { id: '@deepseek-ai/dsh-client-modules', exports: moduleExports }, { boot: { rev: 'fixture', entries: [], batches: [] }, staticModules: seed, loadBundle: async () => { throw new Error('禁止真实网络') } }) // 原ui-settings没有plugin graph row。
  assert.equal(modules.loadCache.has('@deepseek-ai/dsh-client-ui-settings'), false) // 页面开始时原始factory从未登记或物化。
  let registered = false // 原始固定资源执行之前保持未知模块状态。
  const waitingImports = [] // 合成公开传输面对未知模块保持pending；登记后交给真正ModuleSystem解析。
  const transport = {
    loadCache: modules.loadCache, // 公开已物化目录仍由真实ModuleSystem拥有。
    import(specifier, parentURL, attributes) {
      if (!registered) return new Promise((resolve, reject) => waitingImports.push(() => modules.import(specifier, parentURL, attributes).then(resolve, reject)))
      return modules.import(specifier, parentURL, attributes)
    },
  }
  let unknownSettled = false // 验证Fixture不是立即throw的unknown import假阳性。
  const unknownBeforeScript = transport.import('@deepseek-ai/dsh-client-ui-settings/client', '', {}).then(() => { unknownSettled = true }) // 只在测试边界制造启动前等待，不登记任何factory。
  await Promise.resolve()
  assert.equal(unknownSettled, false)
  const policy = { revision: 4, settings: { locale: null, theme: 'dark', fontSize: 16, transcriptView: 'verbose', performanceUsage: 'detailed', developerTools: false, busyEnter: 'queue', linkOpening: 'sidebar' }, writable: true } // 合成共享真源。
  let writeStatus = 200 // 当前管理员PUT的隔离结果。
  let delivery = 'delivered' // 后端commit成功之后的合成推送确认。
  let puts = 0 // 拒绝把delayed提交再次重发。
  let nativeRevision = 0 // Native独立CAS，不能使用General的修订4。
  let nativeSettings = null // 未发布策略不播种默认，第一次原始Theme操作才提交明确region。
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    if (url === './adminsmart/native-policy') {
      if (request.method === 'PUT') {
        puts += 1
        if (writeStatus !== 200) return { ok: false, status: writeStatus }
        const body = JSON.parse(request.body) // 同一个原始Theme操作必须是一个Native请求带两个独立CAS。
        assert.equal(body.expectedRevision, nativeRevision)
        assert.equal(body.legacyGeneralUpdate.expectedRevision, policy.revision)
        nativeRevision += 1
        nativeSettings = body.settings
        policy.revision += 1
        policy.settings = body.legacyGeneralUpdate.settings
        return { ok: true, headers: { get: () => delivery }, json: async () => ({ revision: nativeRevision, settings: nativeSettings, writable: true, general: { revision: policy.revision, settings: policy.settings } }) }
      }
      assert.equal(request.method, 'GET')
      return { ok: true, status: 200, json: async () => ({ revision: nativeRevision, settings: nativeSettings, writable: true }) } // 新桥没有原生覆盖时仍保留旧General真源，绝不发两次保存。
    }
    assert.equal(url, './adminsmart/ui-policy')
    if (request.method === 'PUT') {
      puts += 1
      if (writeStatus !== 200) return { ok: false, status: writeStatus }
      const body = JSON.parse(request.body) // 合成CAS请求。
      assert.equal(body.expectedRevision, policy.revision)
      policy.revision += 1
      policy.settings = body.settings
    }
    return { ok: true, headers: { get: () => delivery }, json: async () => structuredClone(policy) }
  })
  const registrations = new Map() // 正式wrapper的公开status Slot。
  const remote = { $host: { isLoopback: false }, $on: () => () => {}, settings: { describe: async () => ({ ok: true, value: { writable: true, hasDocument: false, namespaces: GENERAL_SETTINGS_NAMESPACES.map(ns => ({ ns: ns === 'ui-settings' ? 'adminsmart-shared-settings' : ns, value: { extra: 'fixture-private-extra' }, schema: { type: 'object', dict: {} }, revision: 1, secrets: [], extra: 'fixture-private-extra' })) } }) } } // 管理员可信描述与策略角色一致；额外源字段仍不属于共享DTO。
  const ctx = new cordis.Context() // 实际Cordis根上下文。
  ctx.provide('modules', transport)
  ctx.provide('remote', remote)
  ctx.provide('remote.settings', remote.settings)
  ctx.provide('slots', { inject: (_name, register) => register(), register: (options, component) => { registrations.set(options.id, { options, component }); return () => {} }, subscribe: () => () => {}, entries: () => [] }) // 只声明公开Slot形状，不伪造原始collapse控件。
  let scripts = 0 // 原始Client被固定经典script装载的次数。
  const document = { createElement() {
    const listeners = new Map() // 合成脚本load/error回调。
    return { src: '', async: true, remove() {}, addEventListener(name, callback) { listeners.set(name, callback) }, listeners }
  }, head: { append(script) {
    assert.equal(script.src, 'http://fixture.example/runtime/adminsmart/shared-settings/official-client.js')
    scripts += 1
    target.load(originals.get('@deepseek-ai/dsh-client-ui-settings')) // 模拟固定Host资源执行原始SDK的load，没有更改其身份或工厂。
    registered = true
    for (const release of waitingImports.splice(0)) release() // 原始script完成登记后由真实ModuleSystem解决此前等待。
    queueMicrotask(() => script.listeners.get('load')())
  } } } // 不启动浏览器或HTTP服务。
  const file = new URL('../shared-settings/client.js', import.meta.url) // 正式wrapper原始源文件。
  const adapterBoot = [] // 正式 Host 注入的纯模块哈希，不手写版本或读取真实页面。
  installUiPolicyHttp({ effect: register => register(), on(event, listener) { assert.equal(event, 'webserver/index-inject'); listener(adapterBoot); return () => {} }, webServer: { register: () => () => {} } }, {}, { clientModuleSource: await readFile(new URL('../src/ui-policy-client.mjs', import.meta.url)) })
  const adapterRevision = adapterBoot.find(row => row.name === UI_POLICY_CLIENT_REVISION_GLOBAL).value // Wrapper 必须使用实际 Host index-inject 的代码身份。
  let record // 正式自有Lazy-CJS工厂，不抽取内部实现。
  runInNewContext(await readFile(file, 'utf8'), { window: { location: { href: 'http://fixture.example/runtime/?rev=untrusted-page-query' }, [UI_POLICY_CLIENT_REVISION_GLOBAL]: adapterRevision, __ModuleLoader__: { load(value) { record = value } } }, document, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval }, {
    filename: file.pathname,
    importModuleDynamically: async specifier => {
      if (specifier === 'http://fixture.example/runtime/adminsmart/native-policy-client.mjs') return import('../src/native-policy-client.mjs')
      assert.equal(specifier, `http://fixture.example/runtime/adminsmart/ui-policy-client.mjs?rev=${adapterRevision}`)
      return import('../src/ui-policy-client.mjs')
    }, // 三模块均保持固定同源资源，页面查询不能污染导入。
  })
  assert.equal(record.id, '@adminsmart/dsh-shared-settings')
  const wrapperModule = record.factory(name => { assert.equal(name, 'react/jsx-runtime'); return require(name) }) // 使用实际React平台实例。
  let consumerActivated = false // 对应实际页面等待configForms的官方消费fiber。
  const consumer = ctx.plugin({ inject: ['configForms'], apply(owner) { assert.equal(typeof owner.configForms.get, 'function'); consumerActivated = true } })
  assert.equal(consumerActivated, false)
  const fiber = ctx.plugin(wrapperModule) // 正式apply运行在真实提供方fiber内。
  try {
    await fiber.await()
    await consumer.await()
    await unknownBeforeScript
    assert.equal(fiber.state, 2)
    assert.equal(consumerActivated, true)
    assert.equal(unknownSettled, true)
    assert.equal(scripts, 1)
    assert.equal(modules.manifest.plugins.length, 0)
    const facade = ctx.get('configForms') // 真正已提供的General共享服务。
    await facade.describe().ensure()
    assert.equal(facade.get('ui-theme').getSnapshot().value.fontSize, 16)
    assert.equal(Object.hasOwn(facade.get('locale').getSnapshot().value, 'preference'), false)
    assert.deepEqual(facade.get('ui-settings').getSnapshot().value, { enabled: false })
    assert.equal(facade.describe().getSnapshot().view.namespaces.filter(row => row.ns === 'ui-settings').length, 1)
    assert.equal(facade.describe().getSnapshot().view.namespaces.some(row => row.ns === 'adminsmart-shared-settings'), false)
    assert.equal(facade.describe().getSnapshot().view.namespaces.find(row => row.ns === 'ui-settings').extra, undefined)
    const feedback = registrations.get('adminsmart-shared-policy-status') // 产品实际错误反馈席位。
    assert.ok(feedback)
    const { policyStatusGeneral, policyStatusNative } = feedback.options.inject().hooks // 两个真实公开Observable分别负责General和Native/mixed region反馈。
    writeStatus = 503
    await assert.rejects(() => facade.get('ui-theme').set('fontSize', 18), /保存失败/u)
    let rendered = feedback.component({ usePolicyStatusGeneral: selector => selector(policyStatusGeneral.getSnapshot()), usePolicyStatusNative: selector => selector(policyStatusNative.getSnapshot()) }) // 读取正式组件输出而非仅检查内部error字段。
    assert.equal(rendered.props.role, 'alert')
    assert.match(rendered.props.children, /保存失败/u)
    writeStatus = 200
    delivery = 'delayed'
    assert.equal(await facade.get('ui-theme').set('fontSize', 20), true)
    assert.equal(policy.settings.fontSize, 20)
    assert.equal(policyStatusNative.getSnapshot().error, null)
    rendered = feedback.component({ usePolicyStatusGeneral: selector => selector(policyStatusGeneral.getSnapshot()), usePolicyStatusNative: selector => selector(policyStatusNative.getSnapshot()) })
    assert.equal(rendered.props.role, 'status')
    assert.equal(rendered.props.children, '设置已保存，实时同步暂不可用')
    assert.equal(puts, 2)
  } finally { await consumer.dispose(); await fiber.dispose() }
})
