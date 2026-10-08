/** 使用当前固定alpha.1公开protocol和内存Fake存储验证桥，不启动浏览器/网络或触碰用户数据。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { installSharedShortcutsClient, mergeShortcutChanges } from '../src/shared-shortcuts-client.mjs'
import { installShortcutPolicyHttp, requestShortcutPolicy, validateShortcutDocument } from '../src/shortcut-policy-http.mjs'

const runtimeRoot = path.resolve(process.env.ADMINSMART_DSH_ROOT || fileURLToPath(new URL('../../../../deepseek-harness-runtime/', import.meta.url))) // 与受管Runtime同一固定安装，路径相对项目或可信测试环境。
const harnessRequire = createRequire(pathToFileURL(path.join(runtimeRoot, 'package.json'))) // 仅作为官方公开包解析锚点。
const protocol = await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-client-shortcuts/protocol')).href) // 原样加载真实alpha.1纯协议，不复制或截取第三方源码。
const PROFILE = 'web:windows' // 测试设备固定，不从真实navigator或localStorage推断。
const binding = code => ({ code, modifiers: ['control', 'alt'] }) // 合法Windows Web组合，code是用例明确指定的物理键。
const clone = value => JSON.parse(JSON.stringify(value)) // 只复制合成JSON偏好。
const document = overrides => ({ schemaVersion: 1, profiles: { [PROFILE]: overrides } }) // 当前设备的合成文档，overrides只含受控id。
const noTimer = () => ({ unref() {} }) // 离线计时器不创建后台任务；显式事件驱动所有测试。

/** @param {object} initial 初始合成快照 @returns {object} 公开Observable最小实现。 */
function observable(initial) {
  let value = initial // 当前内存快照，无浏览器Store。
  const listeners = new Set() // 当前测试订阅者。
  return { getSnapshot: () => value, subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback) },
    set(next) { value = next; for (const callback of [...listeners]) callback() } }
}

/**
 * 用官方ShortcutPersistence/effectiveShortcuts实现同一公开service契约，存储完全在内存。
 * @param {object|null} initial 初始合成偏好。
 * @returns {Promise<object>} 可编辑、延迟挂载和可观测结果的公开Fake。
 */
async function shortcutsFixture(initial = null) {
  let raw = initial === null ? null : JSON.stringify(initial) // 官方协议读写的内存原始文档。
  let definitions = [
    { id: 'session.new', defaults: { [PROFILE]: binding('KeyA') } }, // 第一个真实官方id的合成默认。
    { id: 'session.search', defaults: { [PROFILE]: binding('KeyB') } }, // 第二个id的合成默认，供交换键位复现。
  ] // 不声明任何未挂载指令默认，保持官方catalog生命周期。
  const config = observable(protocol.initialShortcutConfig()) // 公开accepted偏好状态。
  const catalog = observable([]) // 公开当前可编辑命令结果。
  const fixedCatalog = observable([]) // 固定动作公开目录，与editable分开。
  const edits = [] // 记录公开edit操作，断言不调用private configure或reset-all。
  const persistence = new protocol.ShortcutPersistence({ read: () => raw, write: next => { raw = next } }, 'web', 'windows', true, snapshot => {
    config.set(snapshot)
    catalog.set(protocol.effectiveShortcuts(definitions, snapshot.document, 'web', 'windows'))
  }) // 所有准入、CAS、冲突、保存结果来自真实官方协议。
  persistence.setDefinitions(definitions)
  await persistence.readCurrent()
  return {
    runtime: 'web', platform: 'windows', config, catalog, fixedCatalog,
    async edit(operation, revision) { edits.push(clone(operation)); return persistence.edit(protocol.parseShortcutEdit(operation), revision) },
    describeBinding(candidate) {
      const normalized = candidate === null ? null : protocol.normalizeBinding(candidate, 'windows') // 官方物理键规范化。
      return { binding: normalized, issue: normalized === null ? null : protocol.bindingIssue(normalized, 'web', 'windows'),
        conflicts: normalized === null ? [] : catalog.getSnapshot().filter(row => row.binding && protocol.overlappingBindings(row.binding, normalized)).map(row => row.id) }
    },
    mount(id) { definitions = [...definitions, { id, defaults: {} }]; persistence.setDefinitions(definitions) },
    receiveStorage(next) { raw = JSON.stringify(next); return persistence.readCurrent() }, // 模拟官方同origin storage通知只触发公开协议重新读入，接收窗口没有用户edit动作。
    edits,
    value: () => clone(config.getSnapshot().document),
  }
}

/** @param {object} envelope 合成后端真源 @returns {object} 无网络的CAS fetch、状态与请求观测。 */
function serverFixture(envelope) {
  let remote = clone(envelope) // 后端内存权威文档，与官方本地内存存储分离。
  const writes = [] // 已发送的管理员CAS请求，仅合成数据。
  let mode = 'normal' // 可控一次传输失败或另一个管理员更新。
  return {
    async fetch(_url, options) {
      if (options.method === 'PUT') {
        const update = JSON.parse(options.body) // 受测桥发送的非敏感偏好文档。
        writes.push(update)
        if (mode === 'fail') { mode = 'normal'; return new Response('{}', { status: 503 }) }
        if (mode === 'conflict') {
          mode = 'normal'
          remote = { revision: remote.revision + 1, document: document({ 'session.new': binding('KeyZ') }), writable: true }
          return new Response('{}', { status: 409 })
        }
        if (update.expectedRevision !== remote.revision) return new Response('{}', { status: 409 }) // 模拟真正数据库CAS，不把重复窗口发布误写成测试断言故障。
        remote = { revision: remote.revision + 1, document: clone(update.document), writable: true }
      }
      return Response.json(clone(remote))
    },
    writes,
    set(next) { remote = clone(next) },
    failNext() { mode = 'fail' },
    conflictNext() { mode = 'conflict' },
    value: () => clone(remote),
  }
}

/** @param {object} shortcuts 公开Fake @param {object} server 假后端 @param {object} [options] 用例覆盖 @returns {object} 不启动流/后台计时器的桥。 */
const bridgeFixture = (shortcuts, server, options = {}) => installSharedShortcutsClient({ shortcuts, fetchImpl: server.fetch, events: false, schedule: noTimer, cancelSchedule() {}, ...options })

test('官方protocol接受受控偏好，拒绝固定、任意动作、平台违规和显式冲突', () => {
  assert.equal(harnessRequire('@deepseek-ai/dsh-client-shortcuts/package.json').version, '0.2.1-alpha.1')
  assert.deepEqual(validateShortcutDocument(document({ 'session.new': binding('KeyJ'), 'page.refresh': null }), protocol), document({ 'session.new': binding('KeyJ'), 'page.refresh': null }))
  for (const overrides of [
    { 'response.stop': null }, // 固定停止动作虽无fixed前缀仍不得编辑。
    { 'arbitrary.execute': null }, // 未授权任意动作。
    { 'session.new': { code: 'KeyC', modifiers: ['control'] } }, // 官方浏览器拒绝组合。
    { 'session.new': { code: 'Enter', modifiers: [] } }, // 固定输入组合。
    { 'session.new': binding('KeyJ'), 'session.search': binding('KeyJ') }, // 两个显式override冲突。
  ]) assert.throws(() => validateShortcutDocument(document(overrides), protocol))
})

test('差异合并保留休眠和其他profile，明确区分null与unset', () => {
  const remote = { schemaVersion: 1, profiles: { [PROFILE]: { 'browser.new': binding('KeyL'), 'session.new': null }, 'web:macos': { 'session.search': null } } } // 服务端完整合成文档。
  const changes = new Map([['session.new', { present: false }], ['session.search', { present: true, binding: null }]]) // 恢复默认与显式关闭是不同操作。
  const merged = mergeShortcutChanges(remote, document({}), PROFILE, changes) // 不按本地catalog重建整份文档。
  assert.deepEqual(merged.profiles[PROFILE], { 'browser.new': binding('KeyL'), 'session.search': null })
  assert.deepEqual(merged.profiles['web:macos'], { 'session.search': null })
  const desktop = { schemaVersion: 2, profiles: { 'desktop:windows': {} } } // 官方首次双键编辑会升级本地文档版本。
  const upgraded = mergeShortcutChanges(document({}), desktop, 'desktop:windows', new Map([['session.new', { present: true, binding: { code: 'KeyJ', secondCode: 'KeyL', modifiers: [] } }]])) // 只增加同一受控指令组合，不降级或删除其他profile。
  assert.equal(upgraded.schemaVersion, 2)
  assert.deepEqual(upgraded.profiles[PROFILE], {})
})

test('远端交换键位通过公开edit释放占用，未知已知指令挂载后采用，不反向发布', async () => {
  const shortcuts = await shortcutsFixture() // 两条官方id的内存默认目录。
  const server = serverFixture({ revision: 2, document: document({ 'session.new': binding('KeyB'), 'session.search': binding('KeyA'), 'browser.new': binding('KeyL') }), writable: false }) // 合法交换与未挂载目标。
  const bridge = bridgeFixture(shortcuts, server) // 普通用户只采用。
  await bridge.ready
  assert.deepEqual(shortcuts.value().profiles[PROFILE], { 'session.new': binding('KeyB'), 'session.search': binding('KeyA') })
  assert.deepEqual(shortcuts.edits.slice(0, 2).map(operation => operation.binding), [null, null])
  assert.ok(shortcuts.edits.every(operation => operation.type !== 'reset-all'))
  shortcuts.mount('browser.new')
  await bridge.idle()
  assert.deepEqual(shortcuts.value().profiles[PROFILE]['browser.new'], binding('KeyL'))
  assert.equal(server.writes.length, 0)
  bridge.dispose()
})

test('管理员公开已接受编辑经串行CAS全局保存，保留后端休眠与其他设备', async () => {
  const shortcuts = await shortcutsFixture() // 纯内存官方服务。
  const server = serverFixture({ revision: 4, document: { schemaVersion: 1, profiles: { [PROFILE]: { 'browser.new': binding('KeyL') }, 'web:macos': { 'session.search': null } } }, writable: true }) // 管理员可写与休眠偏好。
  const bridge = bridgeFixture(shortcuts, server)
  await bridge.ready
  await shortcuts.edit({ type: 'set', id: 'session.new', binding: binding('KeyJ') }, shortcuts.config.getSnapshot().revision)
  await bridge.idle()
  assert.equal(server.writes.length, 1)
  assert.equal(server.writes[0].expectedRevision, 4)
  assert.deepEqual(server.value().document.profiles[PROFILE], { 'browser.new': binding('KeyL'), 'session.new': binding('KeyJ') })
  assert.deepEqual(server.value().document.profiles['web:macos'], { 'session.search': null })
  bridge.dispose()
})

test('普通用户即使产生本地accepted差异也不发布，恢复管理员权威偏好', async () => {
  const shortcuts = await shortcutsFixture()
  const server = serverFixture({ revision: 1, document: document({ 'session.new': null }), writable: false }) // 真实权限由同源Host提示，后端仍会验签。
  const bridge = bridgeFixture(shortcuts, server)
  await bridge.ready
  await shortcuts.edit({ type: 'reset', id: 'session.new' }, shortcuts.config.getSnapshot().revision)
  await bridge.idle()
  assert.equal(shortcuts.value().profiles[PROFILE]['session.new'], null)
  assert.equal(server.writes.length, 0)
  bridge.dispose()
})

test('CAS冲突回读新策略并显示重新编辑提示，不自动覆盖新管理员', async () => {
  const shortcuts = await shortcutsFixture()
  const server = serverFixture({ revision: 1, document: document({}), writable: true })
  const errors = [] // 用户可见安全错误，不捕获内部日志或真实数据。
  const bridge = bridgeFixture(shortcuts, server, { notifyError: message => errors.push(message) })
  await bridge.ready
  server.conflictNext()
  await shortcuts.edit({ type: 'set', id: 'session.new', binding: binding('KeyJ') }, shortcuts.config.getSnapshot().revision)
  await bridge.idle()
  assert.equal(server.writes.length, 1)
  assert.deepEqual(shortcuts.value().profiles[PROFILE]['session.new'], binding('KeyZ'))
  assert.ok(errors.some(message => message.includes('其他管理员')))
  bridge.dispose()
})

test('同origin两个管理员窗口原生storage重复发布同文档时收敛，不产生虚假409提示', async () => {
  const original = { schemaVersion: 2, profiles: { [PROFILE]: {}, 'web:macos': { 'page.refresh': null } } } // 原文档保留其他设备偏好，版本二来自合成Fixture而非共享设置默认。
  const firstShortcuts = await shortcutsFixture(original) // 第一个官方协议窗口。
  const secondShortcuts = await shortcutsFixture(original) // 第二窗口有独立accepted本地revision，但接收同origin存储文档。
  firstShortcuts.mount('settings.open')
  secondShortcuts.mount('settings.open')
  const server = serverFixture({ revision: 1, document: original, writable: true }) // 同一个后端CAS真源。
  const firstErrors = [] // 第一个窗口安全提示。
  const secondErrors = [] // 第二窗口重复发布不能误报为不同管理员修改。
  const first = bridgeFixture(firstShortcuts, server, { notifyError: message => firstErrors.push(message) })
  const second = bridgeFixture(secondShortcuts, server, { notifyError: message => secondErrors.push(message) })
  await Promise.all([first.ready, second.ready])
  await firstShortcuts.edit({ type: 'set', id: 'settings.open', binding: binding('KeyY') }, firstShortcuts.config.getSnapshot().revision)
  await secondShortcuts.receiveStorage(firstShortcuts.value()) // 唯一接收动作是原生storage重新读入，第二窗口没有执行用户编辑。
  await Promise.all([first.idle(), second.idle()])
  assert.equal(server.writes.length, 2, '两个窗口的旧CAS均提交一次，409窗口不能再次重发')
  assert.equal(server.value().revision, 2)
  assert.deepEqual(secondShortcuts.value().profiles[PROFILE]['settings.open'], binding('KeyY'))
  assert.deepEqual(server.value().document.profiles['web:macos'], original.profiles['web:macos'])
  assert.deepEqual(firstErrors.filter(Boolean), [])
  assert.deepEqual(secondErrors.filter(Boolean), [])
  await second.retry()
  assert.equal(server.writes.length, 2, '重复发布草稿已清除，重试不再产生额外保存')
  await firstShortcuts.edit({ type: 'reset', id: 'settings.open' }, firstShortcuts.config.getSnapshot().revision)
  await first.idle()
  assert.deepEqual(server.value().document, original, '官方恢复默认必须把显式删除发布后台并保留其他profile')
  first.dispose()
  second.dispose()
})

test('同一指令值相同但胜出完整文档不同仍提示409，不能掩盖其他profile修改', async () => {
  const shortcuts = await shortcutsFixture()
  const server = serverFixture({ revision: 1, document: document({}), writable: true })
  const errors = [] // 不同完整文档必须继续给管理员明确提示。
  let conflicted = false // 只合成一次另一个管理员的并发保存。
  const fetchImpl = async (url, options) => {
    if (options.method === 'PUT' && !conflicted) {
      conflicted = true
      const attempted = JSON.parse(options.body) // 当前被测窗口的完整候选。
      const winner = clone(attempted.document) // 当前指令保持相同，但其他设备有真正修改。
      winner.profiles['web:macos'] = { 'page.refresh': null }
      server.set({ revision: 2, document: winner, writable: true })
      return new Response('{}', { status: 409 })
    }
    return server.fetch(url, options)
  }
  const bridge = bridgeFixture(shortcuts, server, { fetchImpl, notifyError: message => errors.push(message) })
  await bridge.ready
  await shortcuts.edit({ type: 'set', id: 'session.new', binding: binding('KeyJ') }, shortcuts.config.getSnapshot().revision)
  await bridge.idle()
  assert.ok(errors.some(message => message.includes('其他管理员')))
  await bridge.retry()
  assert.equal(server.writes.length, 0, '陈旧草稿已撤销，不能在重试中覆盖其他profile')
  bridge.dispose()
})

test('重复保存收敛只清除旧草稿，请求期间同指令后续真实编辑继续按新CAS保存', async () => {
  const shortcuts = await shortcutsFixture()
  const server = serverFixture({ revision: 1, document: document({}), writable: true })
  const errors = [] // 同文档旧请求冲突不产生错误，新草稿仍有独立生命周期。
  const submitted = [] // 全部合成PUT候选，核对旧请求之后只有一次真实新保存。
  let releaseConflict // 延迟释放第一条重复发布的409结果。
  let firstStarted // 确认旧请求已经进入等待，后续编辑才开始。
  const conflictResponse = new Promise(resolve => { releaseConflict = resolve }) // 不依赖真实网络时序的屏障。
  const started = new Promise(resolve => { firstStarted = resolve }) // 第一条PUT可观测启动屏障。
  const fetchImpl = async (url, options) => {
    if (options.method === 'PUT') {
      const update = JSON.parse(options.body) // 受测桥的固定完整候选。
      submitted.push(update)
      if (submitted.length === 1) {
        server.set({ revision: 2, document: update.document, writable: true }) // 另一窗口已经保存同一旧候选。
        firstStarted()
        await conflictResponse
        return new Response('{}', { status: 409 })
      }
    }
    return server.fetch(url, options)
  }
  const bridge = bridgeFixture(shortcuts, server, { fetchImpl, notifyError: message => errors.push(message) })
  await bridge.ready
  await shortcuts.edit({ type: 'set', id: 'session.new', binding: binding('KeyJ') }, shortcuts.config.getSnapshot().revision)
  await started
  await shortcuts.edit({ type: 'set', id: 'session.new', binding: binding('KeyK') }, shortcuts.config.getSnapshot().revision)
  releaseConflict()
  await bridge.idle()
  assert.equal(submitted.length, 2)
  assert.equal(submitted[1].expectedRevision, 2)
  assert.deepEqual(server.value().document.profiles[PROFILE]['session.new'], binding('KeyK'))
  assert.deepEqual(errors.filter(Boolean), [])
  bridge.dispose()
})

test('全局保存失败保留明确草稿，可显式重试，不把本地成功伪装成共享成功', async () => {
  const shortcuts = await shortcutsFixture()
  const server = serverFixture({ revision: 1, document: document({}), writable: true })
  const errors = [] // 合成可见提示观测。
  const bridge = bridgeFixture(shortcuts, server, { notifyError: message => errors.push(message) })
  await bridge.ready
  server.failNext()
  await shortcuts.edit({ type: 'set', id: 'session.new', binding: binding('KeyJ') }, shortcuts.config.getSnapshot().revision)
  await bridge.idle()
  assert.equal(server.value().revision, 1)
  assert.ok(errors.some(message => message.includes('保存失败')))
  await bridge.retry()
  assert.equal(server.value().revision, 2)
  assert.deepEqual(server.value().document.profiles[PROFILE]['session.new'], binding('KeyJ'))
  bridge.dispose()
})

test('旧GET修订不会回退已采用新策略，卸载后迟到GET不能产生edit', async () => {
  const shortcuts = await shortcutsFixture()
  const server = serverFixture({ revision: 10, document: document({ 'session.new': binding('KeyJ') }), writable: false })
  const bridge = bridgeFixture(shortcuts, server)
  await bridge.ready
  server.set({ revision: 9, document: document({ 'session.new': binding('KeyZ') }), writable: false })
  await bridge.refresh()
  assert.deepEqual(shortcuts.value().profiles[PROFILE]['session.new'], binding('KeyJ'))
  bridge.dispose()
  const delayedShortcuts = await shortcutsFixture() // 独立用例窗口，不继承上一个本地偏好。
  let resolveResponse // 合成网络延迟释放器，不阻塞真实资源。
  const delayedResponse = new Promise(resolve => { resolveResponse = resolve }) // 明确由测试控制的响应。
  const delayed = bridgeFixture(delayedShortcuts, { fetch: () => delayedResponse })
  await Promise.resolve()
  delayed.dispose()
  resolveResponse(Response.json({ revision: 1, document: document({ 'session.new': binding('KeyJ') }), writable: false }))
  await delayed.ready
  assert.equal(delayedShortcuts.edits.length, 0)
})

test('同源SSE失效后立即回读，新订阅和恢复均不依赖用户打开设置', async () => {
  const shortcuts = await shortcutsFixture()
  const server = serverFixture({ revision: 1, document: document({}), writable: false })
  let stream // 合成事件流controller，不建立真实socket。
  let cancelled = false // 卸载必须取消正在等待的标准reader，不能留下假流等待。
  const body = new ReadableStream({ start(controller) { stream = controller }, cancel() { cancelled = true } }) // 标准Web Stream只承载测试失效消息。
  const fetchImpl = (url, options) => url.endsWith('/events') ? Promise.resolve(new Response(body)) : server.fetch(url, options) // 两条固定同源路由的内存Fake。
  const bridge = bridgeFixture(shortcuts, server, { events: true, fetchImpl })
  await bridge.ready
  server.set({ revision: 2, document: document({ 'session.new': binding('KeyJ') }), writable: false })
  stream.enqueue(new TextEncoder().encode('event: policy-invalidated\ndata: {"kind":"shortcuts","revision":2}\n\n'))
  await new Promise(resolve => setImmediate(resolve))
  await bridge.idle()
  assert.deepEqual(shortcuts.value().profiles[PROFILE]['session.new'], binding('KeyJ'))
  bridge.dispose()
  assert.equal(cancelled, true)
})

test('Host桥使用签名身份、官方协议及管理员限制，返回文档不暴露能力值', async () => {
  const requests = [] // 仅捕获合成传输字段，不打印敏感信息。
  const options = { apiBase: 'http://127.0.0.1:9098', readToken: async () => 'fixture-capability', userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge', isAdmin: true } // 完全合成可信Runtime配置。
  const helpers = { protocol, fetchImpl: async (url, request) => { requests.push({ url, request }); return Response.json({ revision: 1, document: document({ 'session.new': null }) }) } } // 固定回环API Fake。
  const result = await requestShortcutPolicy(options, 'PUT', { expectedRevision: 0, document: document({ 'session.new': null }) }, helpers)
  assert.equal(result.writable, true)
  assert.equal(requests[0].url, 'http://127.0.0.1:9098/internal/agent-model/v1/shortcut-policy')
  assert.equal(requests[0].request.headers['X-AdminSmart-User-Id'], '7')
  assert.ok(!JSON.stringify(result).includes('fixture-capability'))
  await assert.rejects(requestShortcutPolicy({ ...options, isAdmin: false }, 'PUT', { expectedRevision: 0, document: document({}) }, helpers), error => error.status === 403)
  const routes = [] // Host公开webServer.register装配观测，不开启HTTP监听。
  installShortcutPolicyHttp({ effect: callback => callback(), webServer: { register: route => { routes.push(route); return () => {} } } }, options, { ...helpers, assertSameOrigin() {}, readJsonBody: async () => ({}), readClientModule: async () => 'export {}' })
  assert.deepEqual(routes.map(route => route.path), ['/adminsmart/shortcut-policy', '/adminsmart/shared-shortcuts-client.mjs', '/adminsmart/shortcut-policy/events'])
})

test('独立Client consumer使用官方唯一ModuleLoader身份和shortcut注入，不复制canonical factory', () => {
  let declaration // 当前版本化消费模块的公开Loader声明。
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8') // 只读取本任务自有Client文件。
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { declaration = value } } } })
  assert.equal(declaration.id, '@adminsmart/dsh-client-shared-shortcuts')
  const consumer = declaration.factory() // 只验证官方Lazy-CJS contract，不执行真实DOM或动态网络import。
  assert.deepEqual([...consumer.inject], ['shortcuts'])
  assert.equal(typeof consumer.apply, 'function')
  assert.ok(source.includes('new URL(\'./adminsmart/shared-shortcuts-client.mjs\', window.location.href)'))
  assert.ok(!source.includes('mergeShortcutChanges'))
})

test('consumer收到空清除信号删除已有错误，不创建只有重试按钮的空框', () => {
  const consumerPath = fileURLToPath(new URL('../lib/client.js', import.meta.url)) // 本任务实际消费模块，原样执行而非截取通知函数。
  const script = `
import fs from 'node:fs';
import vm from 'node:vm';
const nodes = [];
let declaration;
let resolveRemoved;
const removed = new Promise(resolve => { resolveRemoved = resolve; });
const document = {
 body: { appendChild(node) { nodes.push(node); } },
 createElement() { return { style: {}, children: [], setAttribute() {}, addEventListener() {},
  appendChild(node) { this.children.push(node); }, replaceChildren() { this.children = []; },
  remove() { const index = nodes.indexOf(this); if (index >= 0) nodes.splice(index, 1); resolveRemoved(); } }; }
};
const fixture = 'data:text/javascript,' + encodeURIComponent('export function installSharedShortcutsClient({notifyError}) { notifyError("合成错误"); notifyError(""); return { dispose() {} }; }');
vm.runInNewContext(fs.readFileSync(process.argv[1], 'utf8'), {
 window: { location: { href: 'http://fixture.test/runtime/' }, __ModuleLoader__: { load(value) { declaration = value; } } }, document, URL
}, { importModuleDynamically: () => import(fixture) });
declaration.factory().apply({ shortcuts: {}, effect(callback) { callback(); } });
let timer;
await Promise.race([removed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('fixture did not clear')), 1000); })]);
clearTimeout(timer);
process.stdout.write(JSON.stringify({ remainingAlerts: nodes.length }));
` // 只用合成DOM与内存data模块模拟canonical factory的公开clear信号，不操作浏览器或网络。
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', script, consumerPath], { encoding: 'utf8', timeout: 10_000 }) // 标志只用于当前隔离VM测试，不改项目或机器配置。
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { remainingAlerts: 0 })
})

test('Host拒绝超限回环响应，读取期间停止，不向浏览器转发正文', async () => {
  const options = { apiBase: 'http://127.0.0.1:9098', readToken: async () => 'fixture-capability', userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge', isAdmin: false } // 合成只读Runtime。
  const helpers = { protocol, fetchImpl: async () => new Response('X'.repeat(32_769)) } // 明确超过受限JSON预算的合成响应。
  await assert.rejects(requestShortcutPolicy(options, 'GET', undefined, helpers), error => error.code === 'agent_shortcut_policy_unavailable')
})
