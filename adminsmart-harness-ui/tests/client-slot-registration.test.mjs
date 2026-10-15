import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const runtimeRoot = path.resolve(process.env.ADMINSMART_DSH_ROOT || fileURLToPath(new URL('../../../deepseek-harness-runtime/', import.meta.url))) // 与受管服务相同的共享固定版本，不加载私有测试副本。
const profileFixturePath = process.env.ADMINSMART_DSH_PROFILE_FIXTURE || fileURLToPath(new URL('../../adminsmart-harness-platform/profiles/adminsmart-web/cordis.patch.yml', import.meta.url)) // 隔离镜像可显式引用只读候选 Profile；正式仓库沿用相邻受管 Profile，不复制私有运行状态。

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

test('真实 Cordis 同步激活普通用户语音依赖，管理员导航不被覆盖', async () => {
  for (const role of ['managed-user', 'admin']) {
    const ctx = new official.seeds['@deepseek-ai/cordis'].Context() // 固定 Web 种子的真实依赖容器，不启动 Host 或模型。
    let voiceActivated = false // 只有官方语音所需服务可用时才激活依赖测试插件。
    const adminNavigation = { openBundle() {} } // 管理员原生插件页导航，必须保持对象身份不变。
    if (role === 'admin') ctx.reflect.provide('pluginNavigation', adminNavigation)
    const client = readFactory(
      fileURLToPath(new URL('../lib/client.js', import.meta.url)),
      documentFixture(),
      { hostname: 'localhost' },
      { window: { __ADMINSMART_RUNTIME_ROLE__: role }, fetch: () => { throw new Error('启动角色不得发起网络探测') } },
    )(key => official.seeds[key]) // 原样执行自有 Client，角色在初始化前已有且不得再次走网络。
    const clientFiber = ctx.plugin({
      name: 'adminsmart-voice-dependency-fixture',
      apply(child) {
        const result = client.apply({ // 自有 Client 不得把依赖注册推迟到网络响应或未等待的 effect。
          inject: () => () => {}, // 本测试不装配个人主题服务，依赖保持pending。
          reflect: child.reflect, // 服务提供与释放保留真实 Cordis 生命周期。
          theme: { getTheme: () => ({ preference: 'light', colorScheme: 'light' }) }, // 其它界面 effect 不在本测试范围。
          slots: { inject: () => () => {} }, // 不挂载实际界面，不影响依赖检查。
          effect: () => () => {}, // 其它 DOM、Store 与网络 effect 不参与启动依赖测试。
        })
        assert.equal(typeof child.reflect.get('pluginNavigation', false).openBundle, 'function')
        return result
      },
    })
    const voiceFiber = ctx.plugin({
      name: 'official-voice-inject-fixture',
      inject: ['pluginNavigation'], // 官方语音插件启动失败时报告的真实必需服务。
      apply() { voiceActivated = true },
    })
    try {
      await clientFiber
      await voiceFiber
      assert.equal(voiceActivated, true)
      assert.equal(typeof ctx.get('pluginNavigation').openBundle, 'function')
      if (role === 'admin') assert.strictEqual(ctx.get('pluginNavigation'), adminNavigation)
    } finally {
      await ctx.fiber.dispose()
    }
  }
})

test('业务退出按钮只消费固定官方Primitives，品牌位置不再导入图形', () => {
  const primitives = official.seeds['@deepseek-ai/dsh-client-ui-primitives'] // Current Web platform seed, not the permissive bundle-test Fake.
  const clientSource = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8') // 手机退出只使用当前官方按钮，不继续要求退役联网或页面覆盖的Primitive。
  for (const name of [
    'Button',
  ]) {
    assert.ok(clientSource.includes(name), `${name} must be consumed by the actual Client`)
    assert.ok(
      typeof primitives?.[name] === 'function'
        || primitives?.[name] !== null && typeof primitives?.[name] === 'object',
      `${name} must exist in the official Web seed`
    )
  }
  assert.doesNotMatch(clientSource, /IconSparkleMedium|aurasearch-logo|jsx\('img'/u)
})

test('official Models keep the native Input border without a business input replacement', () => {
  const nativeCss = readFileSync(path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/Input.module.css'), 'utf8') // 固定 Harness Input 外壳持有唯一边框。
  const clientSource = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8') // 自有样式只能约束外壳宽度。
  assert.match(nativeCss, /\.wrap\s*\{[^}]*border:\s*0\.5px solid/u)
  assert.match(nativeCss, /\.input\s*\{[^}]*border:\s*none/u)
  assert.doesNotMatch(clientSource, /adminsmart-public-models/u)
})

/** @returns {object} 声明官方 Header、品牌和 Hero 品牌 Slot 的独立离线上下文。 */
function nativeHeaderFixture() {
  const ctx = new official.seeds['@deepseek-ai/cordis'].Context() // 不启动 Host、Session、模型或业务服务。
  new official.SlotRegistry(ctx)
  const nativeHeader = () => null // 只用于确认原始 Header 注册身份仍被保留。
  const nativeSidebar = () => null // 授权品牌内容不能接管官方侧栏父节点或点击行为。
  const nativeBrandMark = () => null // 官方默认品牌必须保留在公开账本中。
  const nativeBrandName = () => null // 官方默认品牌名称保持独立内容所有者。
  ctx.slots.register({ name: 'root', children: {
    'conversation.session.header': { kind: 'single', scope: 'session' },
    sidebar: { kind: 'single', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
    'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
    'settings.plugins.tab': { kind: 'list', scope: 'root' },
    'settings.section': { kind: 'list', scope: 'root' },
    'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
    'settings.onboarding': { kind: 'list', scope: 'root' },
  } }, () => null)
  ctx.slots.register({ name: 'conversation.session.header', children: {
    'conversation.session.header.lineage': { kind: 'single', scope: 'session' },
    'conversation.session.header.actions': { kind: 'list', scope: 'session' },
    'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    'conversation.session.header.corner': { kind: 'single', scope: 'session' }
  } }, nativeHeader)
  ctx.slots.register({ name: 'sidebar', children: {
    'sidebar.brand.mark': { kind: 'single', scope: 'root' },
    'sidebar.brand.name': { kind: 'single', scope: 'root' },
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
  } }, nativeSidebar)
  ctx.slots.register({ name: 'sidebar.brand.mark' }, nativeBrandMark)
  ctx.slots.register({ name: 'sidebar.brand.name' }, nativeBrandName)
  return { ctx, nativeHeader, nativeSidebar, nativeBrandMark, nativeBrandName }
}

test('real official SlotRegistry rejects the duplicate Header child declaration from the reported regression', async () => {
  const { ctx } = nativeHeaderFixture() // 复现官方已拥有 lineage，而自有覆盖又重复声明的加载顺序。
  try {
    assert.throws(() => ctx.slots.register({ name: 'conversation.session.header', priority: -100, children: {
      'conversation.session.header.lineage': { kind: 'single', scope: 'session' }
    } }, () => null), /conversation\.session\.header\.lineage.*already declared/)
  } finally { await ctx.fiber.dispose() }
})

test('the actual AdminSmart plugin preserves native Header/sidebar and contributes only brand plus mobile logout list entries', async () => {
  const { ctx, nativeHeader, nativeSidebar, nativeBrandMark, nativeBrandName } = nativeHeaderFixture() // 原始声明和组件身份保持真实；品牌占位和业务退出只进入各自公开席位。
  const document = documentFixture() // 只捕获插件样式，不执行浏览器页面或框架 Hook。
  const client = readFactory(fileURLToPath(new URL('../lib/client.js', import.meta.url)), document)(key => key === 'react' || key === 'react/jsx-runtime' ? runtimeRequire(key) : official.seeds[key]) // 实际交付包的React接到相同固定SDK的SSR实例，真实Hook只在组件渲染中调用。
  try {
    assert.doesNotThrow(() => client.apply({ theme: { getTheme: () => ({ preference: 'light', colorScheme: 'light' }) }, effect: () => () => {}, slots: ctx.slots, inject: () => () => {} }))
    assert.equal(ctx.slots.entries('conversation.session.header').length, 1)
    assert.equal(ctx.slots.entries('conversation.session.header')[0].component, nativeHeader)
    assert.equal(ctx.slots.entries('sidebar').length, 1)
    assert.strictEqual(ctx.slots.entries('sidebar')[0].component, nativeSidebar)
    const logoutHeader = ctx.slots.entries('conversation.session.header.utilities') // 手机退出通过list追加，绝不覆盖右侧栏corner单占位。
    const logoutSidebar = ctx.slots.entries('sidebar.footer.action') // 官方blank Session隐藏utilities，root侧栏保留退出兜底。
    assert.equal(logoutHeader.length, 1)
    assert.equal(logoutHeader[0].options.id, 'adminsmart-mobile-logout')
    assert.equal(logoutSidebar.length, 1)
    assert.strictEqual(logoutSidebar[0].component, logoutHeader[0].component)
    assert.deepEqual(ctx.slots.entries('conversation.session.header.corner'), [])
    for (const [name, original] of [['sidebar.brand.mark', nativeBrandMark], ['sidebar.brand.name', nativeBrandName]]) {
      const entries = ctx.slots.entries(name) // 原始默认和业务品牌并存，不删除或重声明父席位。
      assert.equal(entries.length, 2)
      assert.equal(entries.filter(entry => entry.component === original).length, 1)
      const brand = entries.find(entry => entry.component !== original) // 唯一授权内容必须通过公开优先级赢得选择。
      assert.equal(brand.options.priority, -1)
      assert.strictEqual(ctx.slots.entriesOfSlot(name)[0].component, brand.component)
    }
    assert.deepEqual(ctx.slots.entries('shell.overlay'), [])
    assert.equal(ctx.slots.entries('conversation.hero.brand.mark').length, 1)
    const heroBrand = ctx.slots.entriesOfSlot('conversation.hero.brand.mark')[0] // 真实官方single选择独立Hero席位，不覆盖Conversation父组件。
    const sidebarBrand = ctx.slots.entriesOfSlot('sidebar.brand.mark')[0] // 收起及展开sidebar共用同一公开mark组件。
    assert.notStrictEqual(heroBrand.component, sidebarBrand.component)
    assert.equal(sidebarBrand.component({ size: 24 }), null, '展开及收起侧栏都不显示品牌图形')
    assert.equal(ctx.slots.entriesOfSlot('sidebar.brand.name')[0].component({}).props.children, 'AuraSearch')
    const { renderToStaticMarkup } = runtimeRequire('react-dom/server') // 含Hook的Hero组件必须通过真实React渲染，不直接调用函数绕过生命周期。
    const markup = renderToStaticMarkup(runtimeRequire('react').createElement(heroBrand.component, { size: 34 })) // passiveEffect不在SSR执行，DOM交互由独立JSDOM回归覆盖。
    assert.match(markup, /<span\b[^>]*hidden=""[^>]*data-adminsmart-hero-presentation="v1"[^>]*aria-hidden="true"/u)
    assert.doesNotMatch(markup, /<svg\b|<img\b/u)
    assert.equal(markup.replace(/<[^>]*>/gu, '').trim(), '')
    assert.deepEqual(
      ctx.slots.entries('settings.plugins.tab').map(entry => ({ id: entry.options.id, order: entry.options.order, label: entry.options.label?.() })),
      [],
    )
    assert.deepEqual(ctx.slots.entries('settings.models.provider-card'), [])
    const css = document.head.children.find(node => node.tagName === 'STYLE')?.textContent ?? '' // 无业务样式同样合法，官方Header不得被任何残留自有CSS隐藏。
    assert.doesNotMatch(css, /\[data-slot="conversation\.session\.header"\]\s*\{\s*display: none !important;/)
  } finally { await ctx.fiber.dispose() }
})

test('all origins keep official Models without custom provider cards or reasoning selection overrides', async () => {
  const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8') // 实际自有 Bundle，不能保留退役第二套供应商页面。
  const platformSource = readFileSync(profileFixturePath, 'utf8') // 角色来自验签 Runtime，不能按 hostname 分叉；镜像测试读取调用方明确指定的只读候选。
  assert.match(platformSource, /- id: ui-settings-models\s+disabled: !!js "process.env.ADMINSMART_AGENT_IS_ADMIN !== '1'"\s+config:\s+#[^\n]*\s+credentialOnboarding: false/u)
  assert.match(platformSource, /- id: client-hmr\s+disabled: false/u)
  assert.match(platformSource, /- id: ui-brand-official\s+disabled: false/u)
  assert.doesNotMatch(source, /AdminSmartManagedModelsSection|requestAdminModelDiscovery|ADMIN_MODELS_DISCOVER_URL|AdminSmartProviderPolicy|AdminSmartPrivateReasoning|AdminSmartModelConfiguration|MODEL_REASONING_URL|MODEL_DEFAULTS_URL|modelDirectories|requestModelPreference/u)
  for (const hostname of ['localhost', 'www.example.test']) {
    const { ctx } = nativeHeaderFixture() // 与实际官方 SlotRegistry 相同的公开账本。
    const nativeModels = () => null // 官方 Models 的原席位，在两种顺序都必须唯一保留。
    ctx.slots.register({ name: 'settings.section', id: 'models', order: 10 }, nativeModels)
    const client = readFactory(fileURLToPath(new URL('../lib/client.js', import.meta.url)), documentFixture(), { hostname })(key => official.seeds[key])
    try {
      client.apply({ inject: () => () => {}, effect: () => () => {}, slots: ctx.slots })
      const entries = ctx.slots.entries('settings.section').filter(entry => entry.options.id === 'models') // 自有应用只能补增量，不能替换官方Models。
      assert.equal(entries.length, 1)
      assert.strictEqual(entries[0].component, nativeModels)
      assert.deepEqual(ctx.slots.entries('settings.models.provider-card'), [])
    } finally { await ctx.fiber.dispose() }
  }
})

test('the actual SlotRegistry preserves official onboarding without a business replacement', async () => {
  const { ctx } = nativeHeaderFixture() // Same fixed-version registry used by the Web Client.
  const officialModelsSource = readFileSync(path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js'), 'utf8') // Fixed official bundle owns the notice cell being shadowed.
  assert.match(officialModelsSource, /name: "settings\.onboarding",\s+id: "welcome-notice",\s+order: -100/) // If upstream changes its ID, the product must re-evaluate this public Slot composition.
  const officialWelcome = () => null // Official Models package registers this list cell at default priority 0.
  ctx.slots.register({ name: 'settings.onboarding', id: 'welcome-notice', order: -100 }, officialWelcome)
  const document = documentFixture() // Client styling is isolated from user pages and credentials.
  const client = readFactory(fileURLToPath(new URL('../lib/client.js', import.meta.url)), document)(key => official.seeds[key])
  try {
    client.apply({ theme: { getTheme: () => ({ preference: 'light', colorScheme: 'light' }) }, effect: () => () => {}, slots: ctx.slots, inject: () => () => {} })
    const entries = ctx.slots.entries('settings.onboarding').filter(entry => entry.options.id === 'welcome-notice') // Raw ledger retains both compatible contributions.
    const winner = ctx.slots.entriesOfSlot('settings.onboarding').find(entry => entry.options.id === 'welcome-notice') // Renderer uses the lower-priority public contribution.
    assert.equal(entries.length, 1)
    assert.strictEqual(winner?.component, officialWelcome)
  } finally { await ctx.fiber.dispose() }
})

test('the official voice Bundle alone owns the microphone and waveform Slot', async () => {
  const ctx = new official.seeds['@deepseek-ai/cordis'].Context() // Isolated fixed-version Client scope.
  new official.SlotRegistry(ctx)
  const officialVoice = () => null // 官方 Bundle 在默认优先级注册录音、波形与转写。
  ctx.slots.register({ name: 'root', children: {
    'conversation.input.activity': { kind: 'single', scope: 'session' },
  } }, () => null)
  ctx.slots.register({ name: 'conversation.input.activity' }, officialVoice)
  const document = documentFixture() // 业务样式与 Slot 的离线文档，不打开麦克风。
  const client = readFactory(fileURLToPath(new URL('../lib/client.js', import.meta.url)), document)(key => official.seeds[key])
  const officialSource = readFileSync(path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-experimental-client-ui-voice-input/lib/client.js'), 'utf8') // 固定发布包的官方 VoiceInput 与 Waveform 真实组成。
  try {
    client.apply({ inject: () => () => {}, theme: { getTheme: () => ({ preference: 'light', colorScheme: 'light' }) }, effect: () => () => {}, slots: ctx.slots })
    assert.equal(ctx.slots.entries('conversation.input.activity').length, 1)
    assert.equal(ctx.slots.entriesOfSlot('conversation.input.activity')[0]?.component, officialVoice)
    assert.match(officialSource, /conversation\.input\.activity/)
    assert.match(officialSource, /function Waveform\(/)
  } finally { await ctx.fiber.dispose() }
})
