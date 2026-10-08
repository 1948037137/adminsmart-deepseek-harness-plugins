import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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

test('AdminSmart consumes icon exports that exist in the fixed official primitives seed', () => {
  const primitives = official.seeds['@deepseek-ai/dsh-client-ui-primitives'] // Current Web platform seed, not the permissive bundle-test Fake.
  for (const name of [
    'IconCheckOutlineRegular', 'IconChecklistOutlineRegular', 'IconChevronLeftOutlineRegular',
    'IconCloseFillRegular', 'IconCloseOutlineRegular', 'IconEditOutlineRegular',
    'IconEllipsisOutlineRegular', 'IconNewChatOutlineRegular', 'IconGlobeOutlineRegular',
    'IconPanelLeftOutlineRegular', 'IconSearchOutlineRegular', 'IconTrashOutlineRegular',
    'IconChevronDownOutlineRegular', 'IconMicrophoneOutlineRegular',
    'IconSettingsOutlineRegular', 'IconRefreshOutlineRegular', 'IconStopFillRegular',
    'IconPlusOutlineRegular', 'IconRefreshOutlineRegular', 'Input', 'Modal'
  ]) assert.ok(
    typeof primitives?.[name] === 'function'
      || primitives?.[name] !== null && typeof primitives?.[name] === 'object',
    `${name} must exist in the official Web seed`
  )
})

test('public model inputs keep the official primitive as the sole border owner', () => {
  const nativeCss = readFileSync(path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/Input.module.css'), 'utf8') // 固定 Harness Input 外壳持有唯一边框。
  const clientSource = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8') // 自有样式只能约束外壳宽度。
  assert.match(nativeCss, /\.wrap\s*\{[^}]*border:\s*0\.5px solid/u)
  assert.match(nativeCss, /\.input\s*\{[^}]*border:\s*none/u)
  assert.doesNotMatch(clientSource, /\.adminsmart-public-models__input\s+input\s*\{/u)
})

/** @returns {object} 声明官方 Header、品牌和 Hero 品牌 Slot 的独立离线上下文。 */
function nativeHeaderFixture() {
  const ctx = new official.seeds['@deepseek-ai/cordis'].Context() // 不启动 Host、Session、模型或业务服务。
  new official.SlotRegistry(ctx)
  const nativeHeader = () => null // 只用于确认原始 Header 注册身份仍被保留。
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
  } }, () => null)
  return { ctx, nativeHeader }
}

test('real official SlotRegistry rejects the duplicate Header child declaration from the reported regression', async () => {
  const { ctx } = nativeHeaderFixture() // 复现官方已拥有 lineage，而自有覆盖又重复声明的加载顺序。
  try {
    assert.throws(() => ctx.slots.register({ name: 'conversation.session.header', priority: -100, children: {
      'conversation.session.header.lineage': { kind: 'single', scope: 'session' }
    } }, () => null), /conversation\.session\.header\.lineage.*already declared/)
  } finally { await ctx.fiber.dispose() }
})

test('the actual AdminSmart plugin keeps the native Header and fills official AuraSearch brand Slots', async () => {
  const { ctx, nativeHeader } = nativeHeaderFixture() // 原始声明保持真实，自有插件必须在此基础上加载成功。
  const document = documentFixture() // 只捕获插件样式，不执行浏览器页面或框架 Hook。
  const client = readFactory(fileURLToPath(new URL('../lib/client.js', import.meta.url)), document)(key => official.seeds[key]) // 执行实际交付的自有 Client 包。
  try {
    assert.doesNotThrow(() => client.apply({ theme: { getTheme: () => ({ preference: 'light', colorScheme: 'light' }) }, effect: () => () => {}, slots: ctx.slots, inject: () => () => {} }))
    assert.equal(ctx.slots.entries('conversation.session.header').length, 1)
    assert.equal(ctx.slots.entries('conversation.session.header')[0].component, nativeHeader)
    assert.equal(ctx.slots.entries('sidebar.brand.mark').length, 1)
    assert.equal(ctx.slots.entries('sidebar.brand.name').length, 1)
    assert.deepEqual(ctx.slots.entries('shell.overlay').map(entry => entry.options.id), ['adminsmart-mobile-sidebar'])
    assert.equal(ctx.slots.entries('conversation.hero.brand.mark').length, 1)
    assert.deepEqual(
      ctx.slots.entries('settings.plugins.tab').map(entry => ({ id: entry.options.id, order: entry.options.order, label: entry.options.label?.() })),
      [],
    )
    assert.deepEqual(ctx.slots.entries('settings.models.provider-card').map(entry => entry.options.key).sort(), ['llm-deepseek', 'llm-pi-ai'])
    const css = document.head.children.find(node => node.tagName === 'STYLE')?.textContent // 官方 Header 不再被自有样式隐藏。
    assert.doesNotMatch(css, /\[data-slot="conversation\.session\.header"\]\s*\{\s*display: none !important;/)
  } finally { await ctx.fiber.dispose() }
})

test('local and public administrators mount the same managed Models section once', async () => {
  const settingsSource = readFileSync(path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js'), 'utf8') // 固定版官方导航读取原始 Slot 条目。
  const platformSource = readFileSync(fileURLToPath(new URL('../../adminsmart-harness-platform/profiles/adminsmart-web/cordis.patch.yml', import.meta.url)), 'utf8') // 两个环境都停用原生 Models 设置页。
  assert.match(settingsSource, /ctx\.slots\.entries\("settings\.section"\)\.map/u)
  assert.match(platformSource, /- id: ui-settings-models\s+disabled: true/u)
  for (const hostname of ['localhost', 'www.example.test']) {
    const { ctx } = nativeHeaderFixture() // 每个来源独立注册一次相同的插件页面。
    const client = readFactory(fileURLToPath(new URL('../lib/client.js', import.meta.url)), documentFixture(), { hostname })(key => official.seeds[key])
    try {
      client.apply({ theme: { getTheme: () => ({ preference: 'light', colorScheme: 'light' }) }, effect: () => () => {}, slots: ctx.slots, inject: () => () => {} })
      const entries = ctx.slots.entries('settings.section').filter(entry => entry.options.id === 'models') // 官方导航读取原始列表，两个环境均只能有一项。
      assert.equal(entries.length, 1, hostname)
      assert.equal(entries[0].component.name, 'AdminSmartManagedModelsSection', hostname)
      assert.equal(entries[0].options.label?.(), '模型')
    } finally { await ctx.fiber.dispose() }
  }
})

test('stale native Models profiles cannot block client boot during a rolling restart', async () => {
  const pluginPath = fileURLToPath(new URL('../lib/client.js', import.meta.url)) // 当前交付 Client，不模拟另一份业务实现。
  for (const nativeFirst of [true, false]) {
    const { ctx } = nativeHeaderFixture() // 两种合法 Loader 挂载顺序各使用独立官方 SlotRegistry。
    const nativeModels = () => null // 旧用户 Runtime 中仍启用的官方 Models 页面。
    if (nativeFirst) ctx.slots.register({ name: 'settings.section', id: 'models', order: 10 }, nativeModels)
    const client = readFactory(pluginPath, documentFixture(), { hostname: 'localhost' })(key => official.seeds[key])
    try {
      assert.doesNotThrow(() => client.apply({ theme: { getTheme: () => ({ preference: 'light', colorScheme: 'light' }) }, effect: () => () => {}, slots: ctx.slots, inject: () => () => {} }))
      if (!nativeFirst) assert.doesNotThrow(() => ctx.slots.register({ name: 'settings.section', id: 'models', order: 10 }, nativeModels))
      const entries = ctx.slots.entries('settings.section').filter(entry => entry.options.id === 'models') // 过渡期可有两个不同优先级账本项，但不能启动失败。
      assert.equal(entries.length, nativeFirst ? 1 : 2)
      if (nativeFirst) assert.equal(entries[0].component, nativeModels) // 已在运行的旧页不被中途切走。
    } finally { await ctx.fiber.dispose() }
  }
})

test('public Models renders native-style provider cards and an in-place editor', async () => {
  const provider = {
    routeId: 'fixture-gpt', fingerprint: 'a'.repeat(64), displayName: 'GPT',
    api: 'openai-responses', baseURL: 'https://models.example.test/v1', credentialConfigured: true,
    models: [{ id: 'gpt-6-sol', name: 'GPT-6 Sol', contextWindow: 128000, maxTokens: 8192, input: ['text'] }],
  } // 只含非敏感模型元数据的管理员目录替身。
  const renderPage = async draft => {
    const { ctx } = nativeHeaderFixture() // 每轮渲染独立注册同一官方 Slot，避免测试之间复用账本。
    let index = 0 // 将当前页面已确认状态注入原组件，其它状态保持初始值。
    const states = [{ status: 'ready', providers: [provider], error: '' }, draft] // 列表和展开表单各渲染一次。
    const reactServer = runtimeRequire('react') // 只供本项结构测试渲染基础 DOM，不替换生产 React。
    const react = {
      ...official.seeds.react,
      useState(initial) { const value = index < states.length ? states[index] : initial; index += 1; return [value, () => {}] },
      useEffect() {},
      useRef() { return { current: null } },
    } // 服务端离线渲染不启动请求或浏览器 effect。
    const primitiveFixture = {
      ...official.seeds['@deepseek-ai/dsh-client-ui-primitives'],
      Button: ({ icon, children, variant: _variant, size: _size, ...props }) => reactServer.createElement('button', props, icon, children),
      Input: ({ icon: _icon, ...props }) => reactServer.createElement('input', props),
      Menu: ({ anchor }) => anchor,
      Modal: ({ open }) => open ? reactServer.createElement('div') : null,
    } // 原语真实导出另有契约测试；此处只隔离 bundled React 的服务端 Hook dispatcher。
    const client = readFactory(fileURLToPath(new URL('../lib/client.js', import.meta.url)), documentFixture(), { hostname: 'www.example.test' })(key => {
      if (key === 'react') return react
      if (key === '@deepseek-ai/dsh-client-ui-primitives') return primitiveFixture
      return official.seeds[key]
    })
    try {
      client.apply({ theme: { getTheme: () => ({ preference: 'light', colorScheme: 'light' }) }, effect: () => () => {}, slots: ctx.slots, inject: () => () => {} })
      const section = ctx.slots.entriesOfSlot('settings.section').find(entry => entry.options.id === 'models')?.component // 公网唯一的 Models 页面。
      return runtimeRequire('react-dom/server').renderToStaticMarkup(reactServer.createElement(section))
    } finally { await ctx.fiber.dispose() }
  }
  const cards = await renderPage(null)
  assert.match(cards, /adminsmart-public-models__provider-card/u)
  assert.match(cards, /GPT-6 Sol|配置思考等级/u)
  assert.match(cards, /正在读取模型/u, '模型用途面板不应藏在思考配置折叠区内')
  assert.match(cards, /密钥已配置/u)
  const editor = await renderPage({
    routeId: provider.routeId, fingerprint: provider.fingerprint, displayName: provider.displayName,
    api: provider.api, baseURL: provider.baseURL, apiKey: '',
    models: [{ id: 'gpt-6-sol', name: 'GPT-6 Sol', contextWindow: '128000', maxTokens: '8192', input: ['text'] }],
  })
  assert.match(editor, /adminsmart-public-models__form/u)
  assert.match(editor, /已配置，输入新值可替换/u)
  assert.match(editor, /获取可用模型/u)
})

test('candidate selection survives a deferred React state update after the browser event is released', async () => {
  const { ctx } = nativeHeaderFixture() // 只调用页面组件的渲染函数，不向浏览器或供应商发请求。
  const selectedState = { open: true, status: 'ready', models: [{ id: 'gpt-6-sol', name: 'GPT-6 Sol' }], selected: [], error: '' } // 已返回的单个候选。
  const snapshots = [
    { status: 'ready', providers: [], error: '' }, // 已加载的管理员 Provider 目录。
    { routeId: 'gpt', fingerprint: 'a'.repeat(64), displayName: 'GPT', api: 'openai-responses', baseURL: 'https://models.example.test/v1', apiKey: '', models: [] }, // 当前编辑草稿。
    false, '', false, true, '', -1, selectedState,
  ] // 与组件 useState 声明顺序对应的离线快照。
  const deferredUpdates = [] // React 可能在浏览器事件释放之后才执行此函数式更新。
  let stateIndex = 0 // 区分候选选择状态的 setter，其它状态不提交。
  const react = {
    ...official.seeds.react,
    useState(initial) {
      const index = stateIndex++
      return [index < snapshots.length ? snapshots[index] : initial, update => { if (index === 8) deferredUpdates.push(update) }]
    },
    useEffect() {},
    useRef() { return { current: null } },
  } // 保留实际 JSX 树，仅延后 React 的候选状态提交。
  const client = readFactory(fileURLToPath(new URL('../lib/client.js', import.meta.url)), documentFixture(), { hostname: 'www.example.test' })(key => key === 'react' ? react : official.seeds[key])
  try {
    client.apply({ theme: { getTheme: () => ({ preference: 'light', colorScheme: 'light' }) }, effect: () => () => {}, slots: ctx.slots, inject: () => () => {} })
    const section = ctx.slots.entriesOfSlot('settings.section').find(entry => entry.options.id === 'models')?.component // 实际公网 Models 组件。
    const tree = section() // Hook 由本测试的受控状态替身提供。
    const findCandidateCheckbox = node => {
      if (!node || typeof node !== 'object') return null
      if (Array.isArray(node)) return node.map(findCandidateCheckbox).find(Boolean) ?? null
      if (node.type === 'input' && node.props?.type === 'checkbox' && node.props?.disabled === false) return node
      return findCandidateCheckbox(node.props?.children)
    } // 只查当前发现弹窗的真实 input 事件回调。
    const checkbox = findCandidateCheckbox(tree) // 当前候选项未在 Provider 草稿中，应该可勾选。
    assert.ok(checkbox)
    const event = { currentTarget: { checked: true } } // React 事件对象只在回调同步阶段有效。
    checkbox.props.onChange(event)
    event.currentTarget = null // 模拟 React 延后执行函数式更新时释放 currentTarget。
    assert.equal(deferredUpdates.length, 1)
    assert.deepEqual(Array.from(deferredUpdates[0](selectedState).selected), ['gpt-6-sol'])
  } finally { await ctx.fiber.dispose() }
})

test('the actual SlotRegistry shadows only the official developer notice without removing Models', async () => {
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
    assert.equal(entries.length, 2)
    assert.equal(winner?.options.priority, -1)
    assert.notEqual(winner?.component, officialWelcome)
    assert.throws(() => ctx.slots.register({ name: 'settings.onboarding', id: 'welcome-notice', priority: -1 }, () => null), /welcome-notice.*already|already.*welcome-notice/)
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
    client.apply({ theme: { getTheme: () => ({ preference: 'light', colorScheme: 'light' }) }, effect: () => () => {}, slots: ctx.slots })
    assert.equal(ctx.slots.entries('conversation.input.activity').length, 1)
    assert.equal(ctx.slots.entriesOfSlot('conversation.input.activity')[0]?.component, officialVoice)
    assert.match(officialSource, /conversation\.input\.activity/)
    assert.match(officialSource, /function Waveform\(/)
  } finally { await ctx.fiber.dispose() }
})
