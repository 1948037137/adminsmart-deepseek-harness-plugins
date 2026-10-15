import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const runtimeRoot = path.resolve(process.env.ADMINSMART_DSH_ROOT || fileURLToPath(new URL('../../../deepseek-harness-runtime/', import.meta.url))) // 与受管服务相同的共享固定版本，不加载私有测试副本。

/** 仅提供 SDK 初始化和样式安装所需的离线节点能力，不渲染页面或启动浏览器。 */
class ElementFixture extends EventTarget {
  /** @param {string} [tag='div'] 合成节点类型。 */
  constructor(tag = 'div') {
    super()
    this.tagName = tag.toUpperCase() // 只识别离线 style 和 link，不读取用户 DOM。
    this.style = { setProperty() {}, removeProperty() {} } // Boot 状态初始化需要的最小样式接口。
    this.dataset = {} // 官方 Boot 容器的数据标记。
    this.children = [] // 用于确认自有样式已经安装。
    this.classList = { add() {}, remove() {}, toggle() {} } // SDK 初始化所需的纯表层操作。
    this.relList = { supports: () => true } // 阻止官方 modulepreload polyfill 发起网络请求。
    this.parentElement = null // 合成节点的父级关系。
  }
  /** @param {...object} nodes 合成子节点 @returns {void} */
  append(...nodes) {
    this.children.push(...nodes)
    for (const node of nodes) if (node && typeof node === 'object') node.parentElement = this
  }
  /** @param {object} node 合成子节点 @returns {object} */
  appendChild(node) { this.append(node); return node }
  /** @param {...object} nodes 替换后的合成子节点 @returns {void} */
  replaceChildren(...nodes) { this.children = []; this.append(...nodes) }
  remove() {}
  setAttribute() {}
  getAttribute() { return null }
  querySelector() { return null }
  querySelectorAll() { return [] }
}

/** @returns {object} 完全离线的 document，所有节点均由本测试创建。 */
function documentFixture() {
  const root = new ElementFixture() // 官方发布包初始化时需要的 root，不用于实际 UI 验收。
  return {
    compatMode: 'CSS1Compat',
    createElement: tag => new ElementFixture(tag),
    createElementNS: (_namespace, tag) => new ElementFixture(tag),
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: id => id === 'root' ? root : null,
    documentElement: new ElementFixture('html'),
    head: new ElementFixture('head'),
    body: new ElementFixture('body')
  }
}

/** @param {string} filename 官方或自有 Lazy-CJS 文件 @param {object} document 离线节点接口 @returns {Function} 原样执行注册契约得到的 factory。 */
function readFactory(filename, document, location = { hostname: 'localhost' }, globals = {}) {
  let declaration // ModuleLoader.load 原样收到的模块定义，不截取或改写第三方函数。
  vm.runInNewContext(readFileSync(filename, 'utf8'), { ...globals, document, window: { ...globals.window, location, __ModuleLoader__: { load: value => { declaration = value } } } }, { filename })
  assert.equal(typeof declaration?.factory, 'function')
  return declaration.factory
}

/** @returns {Promise<object>} 从实际固定版本 Web 发布包取得平台种子，再原样执行官方 Renderer factory。 */
async function loadOfficialRegistry() {
  const frontendRoot = path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-web-frontend/dist') // 只读官方发布产物，绝不创建补丁或重新生成第三方包。
  const rendererPath = path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js') // 当前服务使用的真实 SlotRegistry 实现。
  const html = readFileSync(path.join(frontendRoot, 'index.html'), 'utf8') // 当前固定发布包的入口，不硬编码构建哈希。
  const script = /<script\b[^>]*\bsrc="([^"]+)"/.exec(html)?.[1] // 固定静态 HTML 中唯一的 module script。
  assert.ok(script)
  const entryPath = path.resolve(frontendRoot, `.${new URL(script, 'http://fixture.test/').pathname}`) // 把公开入口路径限制在官方发布目录内。
  assert.ok(!path.relative(frontendRoot, entryPath).startsWith('..'))
  const document = documentFixture() // SDK 初始化只使用本测试合成节点。
  let resolveSeeds // 官方 Loader.create 到达平台种子准备阶段时释放等待。
  const captured = new Promise(resolve => { resolveSeeds = resolve }) // 不执行应用插件、网络装载或 React 挂载。
  const stop = new Error('offline SDK capture completed') // 在公开 Loader.create 边界中断应用启动，而非修改发布包。
  const fields = {
    window: globalThis, document, HTMLElement: ElementFixture, Element: ElementFixture, Node: ElementFixture, SVGElement: ElementFixture,
    location: { href: 'http://fixture.test/', origin: 'http://fixture.test' },
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    fetch: () => { throw new Error('network is forbidden in Slot contract tests') },
    __ModuleLoader__: { create(options) { resolveSeeds(options.staticModules); throw stop } }
  } // 所有外部交互均离线；官方注册语义和平台种子本身保持真实。
  const previous = new Map(Object.keys(fields).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])) // 测试结束恢复每个 Node 全局描述符。
  const originalError = console.error // 只隐藏预期停止信号，意外 SDK 错误仍输出。
  try {
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    console.error = error => { if (error !== stop) originalError(error) }
    await import(pathToFileURL(entryPath).href)
    const seeds = await captured // 实际发布包通过公开 Loader.create 提供的 React、Cordis 与 SlotCore。
    const renderer = readFactory(rendererPath, document)(key => seeds[key]) // 原样执行官方注册器，不用接受任意重复声明的 Fake 替代。
    return { seeds, SlotRegistry: renderer.SlotRegistry }
  } finally {
    console.error = originalError
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

const official = await loadOfficialRegistry() // 单次加载平台种子，各测试仍使用独立 Context 和真实注册器。
const runtimeRequire = createRequire(path.join(runtimeRoot, 'package.json')) // 离线渲染只使用固定发行版已有的 ReactDOM Server。

test('保留的历史品牌图片原件与压缩副本不被展示适配覆盖或删除', async () => {
  const original = readFileSync(new URL('../assets/aurasearch-logo.jpg', import.meta.url)) // 保留的批准原件，压缩流程不能覆盖它。
  const optimized = readFileSync(new URL('../assets/aurasearch-logo.webp', import.meta.url)) // Host实际发送的有限压缩实体。
  assert.equal(createHash('sha256').update(original).digest('hex'), '8cb9dd1ec066f7bdd8a1b2552468b266e5dc7e35c485c09100593773d6f517bc')
  assert.equal(optimized.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(optimized.subarray(8, 12).toString('ascii'), 'WEBP')
  assert.ok(optimized.length < 16 * 1024)
  assert.ok(optimized.length < original.length * 0.03)
  const sharp = createRequire(runtimeRequire.resolve('@deepseek-ai/dsh-attachment-local'))('sharp') // 只用固定SDK已有图片解码器，不下载依赖或实现新的解析引擎。
  const metadata = await sharp(optimized).metadata() // 实际图片尺寸而非后缀或Fixture自述。
  assert.equal(metadata.width, 256)
  assert.equal(metadata.height, 256)
  for (const edge of [24, 34, 256]) {
    const approvedPixels = await sharp(original).rotate().resize(edge, edge, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer() // 原批准画面按实际显示尺寸取样。
    const webpPixels = await sharp(optimized).resize(edge, edge, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer() // 新实体按相同显示尺寸解码，不改变裁切或比例。
    assert.equal(webpPixels.length, approvedPixels.length)
    let absoluteError = 0 // 所有RGB像素差的总量；明显重绘、裁切或文字位置变化不能通过。
    for (let index = 0; index < webpPixels.length; index += 1) absoluteError += Math.abs(webpPixels[index] - approvedPixels[index])
    assert.ok(absoluteError / webpPixels.length < 6, '品牌压缩偏离批准原画面，显示边长=' + edge)
  }
})


test('sidebar为空且Hero仅含隐藏锚点，AuraSearch名称及原始界面账本保留', async () => {
  const ctx = new official.seeds['@deepseek-ai/cordis'].Context() // 真实固定SDK账本，不模拟重复注册规则。
  new official.SlotRegistry(ctx)
  ctx.slots.register({ name: 'root', children: { 'sidebar.brand.mark': { kind: 'single', scope: 'root' }, 'sidebar.brand.name': { kind: 'single', scope: 'root' }, 'conversation.input.left': { kind: 'list', scope: 'session' } } }, () => null)
  const document = documentFixture() // 只给原始SDK提供离线style生命周期。
  const branded = readFactory(runtimeRequire.resolve('@deepseek-ai/dsh-client-ui-brand-official/client'), document)(key => official.seeds[key]) // 原始官方Brand完整Bundle保持账本。
  branded.apply(ctx)
  const originalMark = ctx.slots.entriesOfSlot('sidebar.brand.mark')[0].component // 原始单席位内容在授权优先级覆盖之前存在。
  const rootCount = ctx.slots.entries('root').length // 不声明另一个根或sidebar组件。
  try {
    for (const revision of [undefined, 'bad', 'b'.repeat(64)]) {
      const other = new official.seeds['@deepseek-ai/cordis'].Context() // 不让前一轮登记影响唯一品牌优先级。
      new official.SlotRegistry(other)
      other.slots.register({ name: 'root', children: { 'sidebar.brand.mark': { kind: 'single', scope: 'root' }, 'sidebar.brand.name': { kind: 'single', scope: 'root' }, 'conversation.hero.brand.mark': { kind: 'single', scope: 'root' }, 'conversation.input.left': { kind: 'list', scope: 'session' } } }, () => null)
      branded.apply(other)
      const client = readFactory(fileURLToPath(new URL('../lib/client.js', import.meta.url)), documentFixture(), { hostname: 'fixture.test' }, { window: { __ADMINSMART_BRAND_LOGO_REVISION__: revision } })(key => key === 'react' || key === 'react/jsx-runtime' ? runtimeRequire(key) : official.seeds[key]) // 真实React Hook与本用例SSR单例一致，不直接调用组件函数。
      try {
        client.apply({ inject() {}, slots: other.slots, effect: () => () => {} })
        const marker = other.slots.entriesOfSlot('sidebar.brand.mark')[0] // 原始single选择较低优先级-1，不覆写官方组件字节。
        const name = other.slots.entriesOfSlot('sidebar.brand.name')[0] // 排版与点击由外层官方控件所有。
        assert.equal(other.slots.entries('sidebar.brand.mark').length, 2)
        assert.notEqual(marker.component, originalMark)
        assert.equal(marker.options.priority, -1)
        assert.equal(marker.component({ size: 32 }), null)
        assert.equal(marker.component({}), null)
        assert.equal(name.component({}).props.children, 'AuraSearch')
        assert.equal(other.slots.entries('root').length, rootCount)
        assert.equal(other.slots.entries('sidebar').length, 0)
        assert.equal(other.slots.entries('conversation.chat.node').length, 0)
        const hero = other.slots.entriesOfSlot('conversation.hero.brand.mark')[0] // 原始SlotRegistry选中的Hero只返回隐藏语义锚点，sidebar仍为空。
        assert.equal(other.slots.entries('conversation.hero.brand.mark').length, 1)
        assert.notStrictEqual(hero.component, marker.component)
        assert.equal(marker.component({ size: 24, wide: false }), null)
        assert.equal(marker.component({ size: 24, wide: true }), null)
        const { renderToStaticMarkup } = runtimeRequire('react-dom/server') // 原始ReactDOM确认两个空组件不输出SVG、图片或自行补位DOM。
        const markup = renderToStaticMarkup(runtimeRequire('react').createElement(hero.component, { size: 34, className: 'fixture-hero-geometry' })) // 无DOM的SSR只检查隐藏锚点，实际官方Hero文案回归使用JSDOM。
        assert.match(markup, /data-adminsmart-hero-presentation="v1"/u)
        assert.match(markup, /hidden=""/u)
        assert.match(markup, /aria-hidden="true"/u)
        assert.doesNotMatch(markup, /<svg\b|<img\b/u)
        assert.equal(markup.replace(/<[^>]*>/gu, '').trim(), '')
        assert.equal(renderToStaticMarkup(marker.component({ size: 24 })), '')
      } finally { await other.fiber.dispose() }
    }
  } finally { await ctx.fiber.dispose() }
})

test('原始官方single renderer的无图形品牌占位不恢复Fish fallback，收起状态及文字保留', async () => {
  const ctx = new official.seeds['@deepseek-ai/cordis'].Context() // 独立真实上下文，不复用上一个测试的Slot账本。
  const document = documentFixture() // 原始品牌包与renderer只取得离线节点，不创建实际页面。
  const react = runtimeRequire('react') // SSR和官方Outlet必须使用同一真实React dispatcher；浏览器发布包的内嵌React不是Node SSR身份。
  const serverReact = { ...react,
    /** @param {Function} subscribe 官方浏览器状态订阅。 @param {Function} getSnapshot 当前官方只读快照。 @param {Function|undefined} getServerSnapshot 原生可选SSR快照。 @returns {unknown} 同一真实React hook采样结果。 */
    useSyncExternalStore: (subscribe, getSnapshot, getServerSnapshot) => react.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot ?? getSnapshot), // 浏览器renderer未声明SSR getter；离线只补同一快照，不改变官方选举或fallback算法。
  }
  const rendererModule = readFactory(runtimeRequire.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), document)(key => key === 'react' ? serverReact : key === 'react/jsx-runtime' ? runtimeRequire(key) : official.seeds[key]) // 原样执行官方完整字节，SSR仅补真实React的服务端快照入口。
  const renderer = ctx.plugin({ name: 'official-empty-brand-renderer-fixture', apply: rendererModule.apply }) // 完整原始renderer公开入口安装实际Outlet，禁止手写fallback算法。
  await renderer.await()
  const absentBinding = { hooks: {}, keyedHooks: {}, props: {} } // 无真实会话的官方session-maybe投影，只满足根renderer公开前置条件。
  const absentSource = { getSnapshot: () => absentBinding, subscribe: () => () => {} } // 稳定只读Observable，不连接Session或用户存储。
  ctx.slots.installScope('session', { current: absentSource, bindingSource: () => absentSource }) // 使用公开scope接口，不伪造Slot选举或fallback。
  const { FishLogo } = official.seeds['@deepseek-ai/dsh-client-ui-primitives'] // 真实官方fallback图形，不能用空Fake掩盖回退。
  const { renderToStaticMarkup } = runtimeRequire('react-dom/server') // SSR实际经过原始single选举、RootEntry和Null品牌组件。
  let collapsed = false // 合成根只提供布局状态，业务插件不得改写它。
  const root = ({ renderSlot }) => react.createElement('main', { 'data-fixture-collapsed': String(collapsed) },
    react.createElement('aside', null,
      renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: react.createElement(FishLogo, { size: 24 }) }),
      renderSlot('sidebar.brand.name', {})),
    react.createElement('section', null, renderSlot('conversation.hero.brand.mark', { size: 34 }, { fallback: react.createElement(FishLogo, { size: 34 }) }))) // 显式提供官方Fish，两处Null都必须压住回退。
  ctx.slots.register({ name: 'root', children: { 'sidebar.brand.mark': { kind: 'single', scope: 'root' }, 'sidebar.brand.name': { kind: 'single', scope: 'root' }, 'conversation.hero.brand.mark': { kind: 'single', scope: 'root' } } }, root)
  const officialBrand = readFactory(runtimeRequire.resolve('@deepseek-ai/dsh-client-ui-brand-official/client'), document)(key => official.seeds[key]) // 账本保留原版Fish occupant。
  officialBrand.apply(ctx)
  const client = readFactory(fileURLToPath(new URL('../lib/client.js', import.meta.url)), document)(key => key === 'react' || key === 'react/jsx-runtime' ? runtimeRequire(key) : official.seeds[key]) // 以同一真实React单例执行带Hook的隐藏Hero锚点，不修改原始组件。
  client.apply({ inject() {}, slots: ctx.slots, effect() {} })
  try {
    assert.equal(ctx.slots.entries('sidebar.brand.mark').length, 2, '不能删除官方原始注册来达到隐藏')
    assert.equal(ctx.slots.entriesOfSlot('sidebar.brand.mark')[0].options.priority, -1)
    for (collapsed of [false, true]) {
      const markup = renderToStaticMarkup(ctx.slots.renderSlot('root', {})) // 真正走官方Outlet，return null也不能触发opts.fallback。
      assert.match(markup, /AuraSearch/u)
      assert.ok(markup.includes(`data-fixture-collapsed="${collapsed}"`))
      assert.doesNotMatch(markup, /<svg\b|<img\b|aurasearch-logo|<button\b|<a\b/u)
      assert.equal(ctx.slots.entriesOfSlot('root')[0].component, root)
    }
  } finally { await ctx.fiber.dispose() }
})
