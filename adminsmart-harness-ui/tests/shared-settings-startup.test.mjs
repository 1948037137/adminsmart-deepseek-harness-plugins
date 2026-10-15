/** 正式wrapper启动时序与失败回归；仅传输/资源载入为合成Fixture，fiber使用固定SDK真实实现。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 明确选定的固定SDK安装，不访问浏览器或真实服务。

/**
 * 用产品原始wrapper代码构造受控启动边界。
 * @param {object} options 当前隔离时序。
 * @param {boolean} options.holdScript 是否让script载入保持pending。
 * @param {boolean} options.holdAdapter 是否扣住与官方资源并行的自有模块导入。
 * @param {boolean} options.rejectAdapter 是否模拟自有模块加载失败，不允许创建官方服务。
 * @param {boolean} options.fastTimeout 是否用合成时钟证明总预算不能在阶段间重置。
 * @param {unknown} options.adapterRevision 官方初始化表的纯模块哈希；缺失或非法时使用 legacy 不缓存入口。
 * @returns {Promise<object>} 真实Context/fiber和合成响应释放能力。
 */
async function fixture({ holdScript = false, holdAdapter = false, fastTimeout = false, rejectAdapter = false, adapterRevision } = {}) {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 同一固定官方SDK。
  const cordis = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href) // 真实公开fiber生命周期。
  const ctx = new cordis.Context() // 测试提供方拥有自己的服务和生命周期。
  let resolveImport // 放行未知或迟到官方模块回答的能力。
  let resolveAdapter // 放行迟到自有适配器回答的能力。
  let imports = 0 // 产品不应在经典script登记之前调用import。
  let adapterImports = 0 // 自有纯模块必须在官方资源仍 pending 时并行启动。
  const adapterSpecifiers = [] // 只观察固定模块URL及公开代码哈希，不记录策略响应或用户数据。
  let applied = 0 // 迟到官方exports不能执行apply。
  let installed = 0 // 卸载后的迟到自有module不能创建GeneralController。
  let now = 1_000 // 合成绝对时间，首阶段已消耗预算时不能重新给后续五秒。
  const timeouts = [] // 实际传给各阶段的剩余预算。
  const pendingImport = new Promise(resolve => { resolveImport = resolve }) // 明确保持pending，不以立即throw代替真实页面可能发生的等待。
  const pendingAdapter = new Promise(resolve => { resolveAdapter = resolve }) // 自有纯模块的迟到回答。
  const native = { get() {}, describe() {} } // 只用于取消后的提供方卸载，不执行任何业务持久化。
  const official = { apply(owner) { applied += 1; owner.provide('configForms', native) } } // 受控公开提供方合同，不改写官方源码。
  const documentState = { appended: false, removed: false, listeners: new Map() } // 合成经典script资源生命周期。
  const document = {
    createElement() {
      return { src: '', async: true, addEventListener(name, callback) { documentState.listeners.set(name, callback) }, removeEventListener(name) { documentState.listeners.delete(name) }, remove() { documentState.removed = true } }
    },
    head: { append() { documentState.appended = true; if (fastTimeout) now = 5_500; if (!holdScript) queueMicrotask(() => documentState.listeners.get('load')?.()) } },
  }
  ctx.provide('modules', { loadCache: new Map(), import() { assert.equal(documentState.appended, true); imports += 1; return holdAdapter ? Promise.resolve(official) : pendingImport } })
  ctx.provide('remote', { settings: {} })
  ctx.provide('remote.settings', {})
  ctx.provide('slots', {})
  let record // 正式原始Lazy-CJS工厂登记。
  const file = new URL('../shared-settings/client.js', import.meta.url) // 只读产品代码，不抽取或改写内部函数。
  runInNewContext(await readFile(file, 'utf8'), {
    window: { location: { href: 'http://fixture.example/runtime/?rev=untrusted-page-query' }, __ADMINSMART_UI_POLICY_CLIENT_REVISION__: adapterRevision, __ModuleLoader__: { load(value) { record = value } } },
    document, URL, AbortController,
    Date: fastTimeout ? { now: () => now } : Date, // 只在预算测试中使用合成时钟。
    setTimeout: (callback, delay) => { timeouts.push(delay); return setTimeout(callback, fastTimeout ? 10 : delay) },
    clearTimeout, setInterval, clearInterval,
  }, { filename: file.pathname, importModuleDynamically: specifier => {
    adapterSpecifiers.push(specifier)
    adapterImports += 1
    if (rejectAdapter) return Promise.reject(new Error('synthetic-module-failure'))
    return fastTimeout
      ? import(specifier.includes('/native-policy-client.mjs') ? '../src/native-policy-client.mjs' : '../src/ui-policy-client.mjs')
      : pendingAdapter // 预算用例让两个纯模块正常完成，只扣住官方未知导入；VM必须收到真实模块命名空间。
  } })
  const module = record.factory(name => { assert.equal(name, 'react/jsx-runtime'); return require(name) }) // 官方React平台单例。
  const fiber = ctx.plugin(module) // 真正提供方启动，而非直接模拟apply成功。
  return { ctx, fiber, official, documentState, timeouts, adapterSpecifiers, resolveImport: () => resolveImport(official), resolveAdapter: () => resolveAdapter({ installUiPolicyClient() { installed += 1; throw new Error('卸载后的模块不得执行') } }), get imports() { return imports }, get adapterImports() { return adapterImports }, get applied() { return applied }, get installed() { return installed } }
}

test('纯模块导入只采纳Host格式合法哈希，缺失/非法元数据使用固定legacy入口，卸载后不激活', { skip: !runtimeRoot, timeout: 2_000 }, async () => {
  for (const adapterRevision of [undefined, '', '../other.mjs?rev=1', 'B'.repeat(64), 'b'.repeat(64)]) {
    const state = await fixture({ holdScript: true, adapterRevision }) // 代码下载并行pending时直接观察实际动态import URL。
    try {
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(state.adapterSpecifiers, [
        `http://fixture.example/runtime/adminsmart/ui-policy-client.mjs${adapterRevision === 'b'.repeat(64) ? `?rev=${adapterRevision}` : ''}`,
        'http://fixture.example/runtime/adminsmart/native-policy-client.mjs',
      ])
    } finally { await state.fiber.dispose(); state.resolveAdapter(); state.resolveImport() }
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(state.applied, 0)
    assert.equal(state.installed, 0)
    assert.equal(state.ctx.get('configForms'), undefined)
  }
})

test('script先消耗4.5秒后，未知官方import只能使用剩余500毫秒预算并明确失败', { skip: !runtimeRoot, timeout: 2_000 }, async () => {
  const state = await fixture({ fastTimeout: true }) // 定时器以合成10ms触发，不真实阻塞五秒。
  try {
    await assert.rejects(() => state.fiber.await(), /官方共享设置模块解析失败或超时/u)
    assert.deepEqual(state.timeouts, [5_000, 5_000, 5_000, 500])
    assert.equal(state.imports, 1)
    assert.equal(state.documentState.removed, true)
    assert.equal(state.ctx.get('configForms'), undefined)
  } finally { await state.fiber.dispose() }
})

test('官方 script 尚未完成时已启动自有模块读取，任何失败仍不创建服务', { skip: !runtimeRoot, timeout: 2_000 }, async () => {
  const state = await fixture({ holdScript: true }) // 三条代码获取链都保持pending，只验证真实启动顺序。
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(state.documentState.appended, true)
    assert.equal(state.adapterImports, 2)
    assert.equal(state.imports, 0)
    assert.equal(state.applied, 0)
    assert.equal(state.installed, 0)
  } finally { await state.fiber.dispose(); state.resolveAdapter(); state.resolveImport() }
  const failed = await fixture({ rejectAdapter: true }) // 官方注册可以完成，适配模块失败不能激活任何 ConfigForms。
  try {
    await assert.rejects(() => failed.fiber.await(), /共享设置适配模块加载失败或超时/u)
    failed.resolveImport()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(failed.applied, 0)
    assert.equal(failed.installed, 0)
    assert.equal(failed.ctx.get('configForms'), undefined)
  } finally { await failed.fiber.dispose() }
})

for (const phase of ['script', 'official-import', 'adapter-import']) test(phase + 'pending期间公开dispose及时取消，迟到模块不能提供服务', { skip: !runtimeRoot, timeout: 2_000 }, async () => {
  const state = await fixture({ holdScript: phase === 'script', holdAdapter: phase === 'adapter-import', adapterRevision: 'b'.repeat(64) }) // 版本化URL的三个阶段分别验证卸载取消边界。
  await new Promise(resolve => setImmediate(resolve))
  const started = Date.now() // 验证真正fiber.dispose不等待五秒预算耗尽。
  await state.fiber.dispose()
  assert.ok(Date.now() - started < 1_000)
  state.resolveImport()
  state.resolveAdapter()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.documentState.removed, true)
  assert.equal(state.ctx.get('configForms'), undefined)
  assert.equal(state.installed, 0)
  if (phase === 'script') assert.equal(state.imports, 0)
  if (phase === 'official-import') assert.equal(state.applied, 0)
})
