/** 真实固定Web平台、原始ModuleSystem与Cordis Client插件装配；DOM/RPC/存储数据全部合成。 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 当前只读固定SDK，不读取实际运行配置。
const require = createRequire(pathToFileURL(join(runtimeRoot, 'package.json'))) // 所有公开入口使用同一候选固定安装解析锚点。
let platformPromise // 只捕获一次原始发布平台；每次验证仍有独立Context、ModuleSystem和Synthetic数据。

/**
 * 按官方ClientModuleRegistry的公开Manifest约定解析浏览器入口，避免Node条件选中ESM的client.node.js。
 * @param {string} name 当前固定SDK内的官方包身份。
 * @returns {string} 已发布浏览器默认入口的绝对路径，不读取或修改上游源码。
 * @throws {AssertionError} 入口不符合当前官方字符串/单层default约定或越出包目录时拒绝。
 */
function browserClientPath(name) {
  const manifestPath = require.resolve(name + '/package.json') // 公开清单锚定实际官方安装包。
  const manifest = require(manifestPath) // 仅读取公开exports，不导入Node专用Client。
  const client = manifest.exports?.['./client'] // 官方Host同样采用此公开浏览器Bundle声明。
  const target = typeof client === 'string' ? client : client?.default // 与当前官方ClientModuleRegistry的default选择保持一致。
  assert.equal(typeof target, 'string')
  const packageRoot = dirname(manifestPath) // 仅允许当前包内的已发布入口。
  const candidate = resolve(packageRoot, target) // 不猜构建文件名或复制Node实现。
  assert.equal(relative(packageRoot, candidate).startsWith('..'), false)
  assert.doesNotMatch(candidate, /client\.node(?:\.|$)/u)
  return candidate
}

/** 仅支持官方初始化及样式标签写入的合成节点，不控制真实页面。 */
class ElementFixture extends EventTarget {
  constructor(tag = 'div') {
    super()
    this.tagName = tag.toUpperCase() // 官方启动仅根据元素类型处理preload和style。
    this.style = { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } } // 合成样式访问面。
    this.dataset = {} // 记录原始Bundle安装的样式身份。
    this.children = [] // 仅保存测试创建的标签。
    this.classList = { add() {}, remove() {}, toggle() {} } // 官方初始化所需的表层标记。
    this.relList = { supports: () => true } // 禁止modulepreload polyfill发真实请求。
    this.parentElement = null // 合成标签删除与归属。
  }
  append(...nodes) { this.children.push(...nodes); for (const node of nodes) if (node && typeof node === 'object') node.parentElement = this }
  appendChild(node) { this.append(node); return node }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes) }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this) }
  setAttribute() {}
  getAttribute() { return null }
  querySelector() { return null }
  querySelectorAll() { return [] }
}

/** @returns {object} 只包含本测试节点的离线document。 */
function documentFixture() {
  const root = new ElementFixture() // 原Web入口的合成root。
  return {
    compatMode: 'CSS1Compat',
    createElement: tag => new ElementFixture(tag),
    createElementNS: (_, tag) => new ElementFixture(tag),
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: id => id === 'root' ? root : null,
    documentElement: new ElementFixture('html'),
    head: new ElementFixture('head'),
    body: new ElementFixture('body'),
  }
}

/**
 * 从真实Web发布入口在公开ModuleLoader.create边界捕获官方平台种子，不改写第三方字节。
 * @returns {Promise<object>} 固定平台种子与原始Renderer公开SlotRegistry。
 */
export function originalClientPlatform() {
  platformPromise ??= (async () => {
    const frontendRoot = dirname(require.resolve('@deepseek-ai/dsh-web-frontend/package.json')) // 真实发布包根。
    const dist = join(frontendRoot, 'dist') // 只读编译产物，不修改或生成第三方文件。
    const html = await readFile(join(dist, 'index.html'), 'utf8') // 当前官方HTML决定实际构建入口。
    const script = /<script\b[^>]*\bsrc="([^"]+)"/u.exec(html)?.[1] // 不硬编码发布哈希。
    assert.ok(script)
    const entryPath = resolve(dist, '.' + new URL(script, 'http://fixture.invalid').pathname) // 仅解析固定发布HTML指向的当前JS。
    assert.equal(relative(dist, entryPath).startsWith('..'), false)
    const document = documentFixture() // 官方入口初始化只得到合成节点。
    let resolveSeeds // 公开create边界到达后释放等待。
    const captured = new Promise(resolve => { resolveSeeds = resolve }) // 不执行React挂载、插件启动或网络。
    const stop = new Error('fixture platform capture complete') // 仅在官方公开入口边界停止。
    const globals = {
      window: globalThis, document,
      HTMLElement: ElementFixture, Element: ElementFixture, Node: ElementFixture, SVGElement: ElementFixture,
      location: { href: 'http://fixture.invalid/', origin: 'http://fixture.invalid' },
      addEventListener() {}, removeEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      fetch: () => { throw new Error('平台捕获禁止网络') },
      __ModuleLoader__: { create(options) { resolveSeeds(options.staticModules); throw stop } },
    } // 外部能力全合成，平台种子与原始Module代码保留真实。
    const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])) // 保存需恢复的合成全局描述符。
    const originalError = console.error // 只抑制预期停止信号，其它错误仍报告。
    try {
      for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
      console.error = error => { if (error !== stop) originalError(error) }
      await import(pathToFileURL(entryPath).href)
      const seeds = await captured // 原封不动的React/Cordis/Store/Primitives/Loader种子。
      let renderer // 原Renderer完整Classic Script注册。
      const file = browserClientPath('@deepseek-ai/dsh-client-ui-renderer') // 当前官方Manifest的浏览器入口，不抽取私有类。
      const sandbox = createContext({ document, window: { __ModuleLoader__: { load(value) { renderer = value } } } }) // 官方registration只进入测试外壳。
      runInContext(await readFile(file, 'utf8'), sandbox, { filename: file })
      const rendererExports = renderer.factory(key => { assert.ok(Object.hasOwn(seeds, key)); return seeds[key] }) // 整体工厂只采用原平台种子。
      return { seeds, SlotRegistry: rendererExports.SlotRegistry }
    } finally {
      console.error = originalError
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    }
  })()
  return platformPromise
}

/** @returns {Promise<void>} 等待官方Store与真实Loader微任务，无后台长期运行。 */
async function tick() { for (let index = 0; index < 6; index += 1) await new Promise(resolve => setImmediate(resolve)) }

/**
 * 使用实际Host Graph和typed script-src预注册原Client，再由真实Cordis装配wrapper及两个消费者。
 * @param {object} options 合成Host实际产物，不手工增加原包Graph行。
 * @param {object} options.graph 真实ClientModuleRegistry.graph返回值。
 * @param {object[]} options.table 真实webserver/index-inject表。
 * @param {Map} options.routes 实际Host登记的有限HTTP处理器。
 * @param {Function} options.fetchBundle 原ClientRegistry.fetchBundle公开服务。
 * @param {boolean} options.isAdmin 当前Fixture身份，仅作为Synthetic页面角色。
 * @returns {Promise<void>} 原Session/Workspace及消费者活动、状态读与卸载验证通过。
 */
export async function verifyOfficialRemoteClientBoot({ graph, table, routes, fetchBundle, isAdmin }) {
  const platform = await originalClientPlatform() // 真实官方Web种子。
  const document = documentFixture() // 此验证唯一的合成文档。
  const local = new Map() // 所有持久浏览器状态均为隔离Synthetic值。
  const localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, String(value)), removeItem: key => local.delete(key) } // 原WorkspaceStore可使用公开持久化协议。
  const window = { __ADMINSMART_RUNTIME_ROLE__: isAdmin ? 'admin' : 'managed-user', location: { href: 'http://fixture.invalid/runtime/' } } // 不冒充真实权限事实。
  const sandbox = createContext({ window, document, localStorage, console, structuredClone, queueMicrotask, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, AbortSignal, URL, requestAnimationFrame: callback => setImmediate(callback), cancelAnimationFrame: clearImmediate }) // 原Bundle仅使用合成UI/计时器边界。
  const queue = table.find(row => row.kind === 'script' && row.text.includes('pendingQueue')) // 来自原始bootInjections的真实经典script注册队列。
  assert.ok(queue)
  runInContext(queue.text, sandbox)
  for (const row of table.filter(row => row.kind === 'global')) runInContext('globalThis[' + JSON.stringify(row.name) + '] = ' + JSON.stringify(row.value), sandbox) // typed global的JSON语义由合成page解释。
  const scripts = table.filter(row => row.kind === 'script-src' && row.src.includes('/official-remotes/')) // 两个实际预注册资源，不能直接用FakeFactory。
  assert.equal(scripts.length, 2)
  for (const row of scripts) {
    const url = new URL(row.src, 'http://fixture.invalid/runtime/') // 同源当前实际固定资源路径。
    const path = url.pathname.slice('/runtime'.length) // Runtime挂载前缀只用于定位合成Host路由。
    let status // 原Host处理器实际HTTP结果。
    let body // 原SDK完整原字节，不重写或抽取。
    await routes.get(path).handler({ method: 'GET', url: path + url.search, headers: {} }, { writeHead(value) { status = value }, end(value) { body = value } })
    assert.equal(status, 200)
    runInContext(Buffer.from(body).toString('utf8'), sandbox, { filename: row.src })
  }
  for (const name of ['@deepseek-ai/dsh-client-modules', '@deepseek-ai/dsh-api-gateway', '@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-api-remote-access']) {
    const file = browserClientPath(name) // 测试基础设施使用真实浏览器Module/Stream/Registry，不Mock或执行Node实现。
    runInContext(await readFile(file, 'utf8'), sandbox, { filename: file })
  }
  const modules = window.__ModuleLoader__.create({
    boot: graph, // 同一完整Host Graph，原WS/Session仍无插件行，只有独立自有wrapper贡献。
    staticModules: platform.seeds, // 原官方Web平台种子，无替代React/Store/Slot/Loader。
    async loadBundle(url) {
      const response = await fetchBundle(new Request(new URL(url, 'http://fixture.invalid/'))) // 原实际ClientRegistry提供已版本化combo，绝不发网络。
      assert.equal(response.status, 200)
      runInContext(await response.text(), sandbox, { filename: url })
    },
  })
  assert.equal(modules.manifest.plugins.some(row => row.id === '@deepseek-ai/dsh-api-workspace-controller'), false)
  assert.equal(modules.manifest.plugins.some(row => row.id === '@deepseek-ai/dsh-api-session-controller'), false)
  assert.equal(modules.manifest.plugins.filter(row => row.id === '@adminsmart/dsh-official-remotes').length, 1)
  const sdk = platform.seeds['@deepseek-ai/cordis'] // 真正同一Web平台的服务符号与Context。
  const ctx = new sdk.Context() // 两role各自独立Context和官方Client对象层。
  const makeStore = platform.seeds['@deepseek-ai/dsh-client-store'].createSnapshotStore // 实际官方observable，不能镜像状态算法。
  const gateway = await modules.import('@deepseek-ai/dsh-api-gateway/client', '', {}) // 原RemoteStream/SnapshotStream完整实现。
  const typert = await modules.import('@deepseek-ai/dsh-typert-registry/client', '', {}) // 原Client Registry生命周期。
  const access = await modules.import('@deepseek-ai/dsh-api-remote-access/client', '', {}) // 新版Workspace消费方依赖的真实官方访问状态，不使用全允许服务替身。
  const events = new Map() // 仅记录Synthetic Remote事件订阅，卸载必须归零。
  const streams = new Set() // 原Stream实际打开的Synthetic生成周期。
  const generation = makeStore({ id: 1, host: { home: 'fixture-home' } }) // 合成连接处于ready，测试不连接真实Gateway。
  const connection = { generation } // RemoteStream使用公开GenerationSource，不MockStream本体。
  const catalog = { default: { provider: 'fixture-chat', model: 'fixture-chat-model' }, routableProviders: ['fixture-chat'], groups: [{ id: 'fixture-chat', name: 'Fixture', models: [{ id: 'fixture-chat-model', name: 'Fixture Model' }] }], failures: [] } // 只用于原模型目录成功加载。
  /** @param {object} baseline Synthetic公开帧。 @param {AbortSignal} signal 原Stream生命周期。 @returns {AsyncGenerator} 首帧后等待原取消完成。 */
  async function* follow(baseline, signal) {
    const marker = {} // 每个原逻辑Stream的Synthetic物理生成标记。
    streams.add(marker)
    try {
      yield baseline
      if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    } finally { streams.delete(marker) }
  }
  class FixtureRemote extends sdk.Service {
    constructor(owner) {
      super(owner, 'remote')
      this.workspace = { follow: signal => follow({ type: 'baseline', value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] } }, signal), initializeDefault: async () => ({ ok: true, value: undefined }) } // 空SyntheticWorkspace列表可就绪，不自动写数据。
      this.session = { list: async () => ({ ok: true, value: { items: [] } }), control: signal => follow({ type: 'baseline', value: { projections: {} } }, signal), modelCatalog: async () => ({ ok: true, value: catalog }), initializeDefaultModel: async () => ({ ok: true, value: undefined }) } // 原Client冷读与模型目录；没有Agent/模型调用。
      this.commands = {} // 当前无活动Session，不触发命令执行。
      this.subagents = {} // 当前无子代理，不伪造私有协议。
      this.directoryPicker = {} // UI不启动目录流，仅验证原consumer注册。
      this.remoteAccess = { follow: signal => follow({ type: 'baseline', owner: true }, signal) } // 与两角色独立Host的官方Owner基线一致；全站管理角色仍在真实Host目标验证。
      this.$host = { isLoopback: false, home: 'fixture-home' } // 保留公网协议分支，不以角色改变Host事实。
    }
    $stream(options) { return new gateway.RemoteStream(connection, options) }
    async $mount(contribution) {
      assert.equal(contribution.spec.package, '@deepseek-ai/dsh-api-remote-access')
      const dispose = this.ctx.provide('remote.remoteAccess', this.remoteAccess) // 仅外围合成transport命名空间，访问状态和流生命周期由原模块处理。
      return () => dispose()
    }
    $on(name, listener) {
      return this.ctx.effect(() => {
        const subscribers = events.get(name) ?? new Set() // 同一公开事件当前已登记回调。
        subscribers.add(listener)
        events.set(name, subscribers)
        return () => { subscribers.delete(listener); if (!subscribers.size) events.delete(name) }
      }, 'fixture Remote event ownership')
    }
  }
  const remote = new FixtureRemote(ctx) // 可追踪Service使原Client$on按调用fiber清理，不能靠finally手工删订阅冒充。
  ctx.provide('modules', modules)
  ctx.provide('connection', connection)
  ctx.provide('fileUpload', {}) // 原Session公开依赖，测试不执行上传。
  for (const name of ['session', 'workspace', 'commands', 'subagents', 'directoryPicker']) ctx.provide('remote.' + name, remote[name]) // 合成公开命名空间，原apply仍实际执行。
  const registry = ctx.plugin(typert) // 真正Client Registry的公开apply/inject，与全部原始Client共享同一Web Cordis。
  await registry.await()
  new platform.SlotRegistry(ctx) // 原始Slot声明、provider ownership与卸载算法。
  ctx.provide('locale', { register: () => () => {}, bind: () => key => key, getSnapshot: () => ({ revision: 1 }), subscribe: () => () => {} }) // 合成词典数据，不调用真实浏览器。
  const shortcutRows = new Set() // 原Workspace注册的快捷键，可回收的Synthetic外部数据服务。
  ctx.provide('shortcuts', { catalog: makeStore([]), register(command) { shortcutRows.add(command); return () => shortcutRows.delete(command) } }) // 外部UI依赖保留公开注册/释放契约。
  const modelCommands = new Set() // 原Model UI注册的命令回调。
  ctx.provide('commandUi', { register(command) { modelCommands.add(command); return () => modelCommands.delete(command) } }) // 原consumer主动贡献，不Fake consumer apply。
  ctx.provide('layout', { panelInfo: makeStore({ activePanelId: null }), beginNavigation: () => new AbortController().signal, selectPanel() {} }) // 原Workspace导航只得到合成布局状态。
  const root = ctx.plugin({ apply(owner) {
    owner.slots.register({ name: 'root', children: {
      'sidebar.workspaces': { kind: 'single', scope: 'root' }, // 原Workspace浏览器席位。
      'shell.overlay': { kind: 'list', scope: 'root' }, // 原Workspace/Session对话框。
      'conversation.hero.workspace': { kind: 'single', scope: 'root' }, // 原Workspace空会话选择席位。
      'conversation.input.model': { kind: 'single', scope: 'root' }, // 原模型选择席位。
    } }, () => null)
  } })
  await root.await()
  const accessFiber = ctx.plugin(access) // 使用原生Client状态机接受基线，保留没有基线时默认拒绝的行为。
  await accessFiber.await()
  let wrapperFiber // 实际自有Client fiber，同一Context发布两个原始服务。
  let workspaceFiber // 原Workspace消费方fiber，缺服务时必须真实pending。
  let modelFiber // 原模型选择消费方fiber，不能替代其apply或服务。
  const previousGlobals = new Map(['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])) // 原平台持久Store读取的合成全局生命周期。
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: localStorage, configurable: true, writable: true })
  try {
    const workspace = await modules.import('@deepseek-ai/dsh-client-ui-workspace/client', '', {}) // 真实Manifest消费者通过原ModuleSystem加载。
    const model = await modules.import('@deepseek-ai/dsh-client-ui-model-selection/client', '', {}) // 原模型消费者完整bundle，不抽取内部类。
    workspaceFiber = ctx.plugin(workspace)
    modelFiber = ctx.plugin(model)
    await workspaceFiber.await()
    await modelFiber.await()
    assert.equal(workspaceFiber.state, 0)
    assert.equal(modelFiber.state, 0)
    const wrapper = await modules.import('@adminsmart/dsh-official-remotes/client', '', {}) // 自有wrapper必须来自实际Host Graph对应原Combo。
    wrapperFiber = ctx.plugin(wrapper) // 官方公开Cordis插件装配，主Node Host仍独立经真实Loader row验证。
    await wrapperFiber.await()
    await tick()
    assert.equal(wrapperFiber.state, 2)
    assert.equal(workspaceFiber.state, 2)
    assert.equal(modelFiber.state, 2)
    assert.ok(ctx.get('workspaces'))
    assert.ok(ctx.get('sessions'))
    assert.ok(ctx.get('uiWorkspace'))
    assert.ok(ctx.get('modelDirectories'))
    assert.equal(ctx.workspaces.list.getSnapshot().phase, 'ready')
    assert.equal(ctx.sessions.list.getSnapshot().phase, 'ready')
    assert.equal(ctx.slots.entries('conversation.input.model').length, 1)
    assert.equal(ctx.slots.entries('sidebar.workspaces').length, 1)
    assert.equal(modelCommands.size, 1)
    const originalWorkspace = await modules.import('@deepseek-ai/dsh-api-workspace-controller/client', '', {}) // 原始模块memoized身份必须保留。
    assert.ok(ctx.get('workspaces') instanceof originalWorkspace.WorkspaceController)
    const provided = Reflect.ownKeys(ctx.reflect.store).map(key => ctx.reflect.store[key]).filter(value => ['sessions', 'workspaces'].includes(value.name)) // 官方公开反射Store证明两个原服务由同一wrapper fiber拥有。
    assert.equal(provided.length, 2)
    assert.equal(provided.every(value => value.fiber.uid === wrapperFiber.uid), true) // Cordis反射读取含traceable代理，公开uid代表实际同一fiber身份。
    await wrapperFiber.dispose() // 原同fiber服务卸载，消费者按真实依赖生命周期主动退出。
    await tick()
    assert.equal(ctx.get('workspaces'), undefined)
    assert.equal(ctx.get('sessions'), undefined)
    assert.equal(ctx.get('uiWorkspace'), undefined)
    assert.equal(ctx.get('modelDirectories'), undefined)
    assert.equal(workspaceFiber.state, 0)
    assert.equal(modelFiber.state, 0)
    assert.equal(events.size, 0)
    assert.ok(ctx.get('remoteAccess'), '独立官方访问服务不能随Remote wrapper被误卸载')
    await accessFiber.dispose() // 访问follow流由它自己的官方fiber持有，必须独立释放后再检查全部流清空。
    await tick()
    assert.equal(ctx.get('remoteAccess'), undefined)
    assert.equal(streams.size, 0)
    assert.equal(modelCommands.size, 0)
    assert.equal(shortcutRows.size, 0)
  } finally {
    await wrapperFiber?.dispose()
    await workspaceFiber?.dispose()
    await modelFiber?.dispose()
    await accessFiber.dispose()
    await root.dispose()
    await registry.dispose()
    await ctx.fiber.dispose()
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}
