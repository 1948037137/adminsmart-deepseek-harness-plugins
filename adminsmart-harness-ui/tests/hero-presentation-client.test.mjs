/** 原始官方ConversationContent/Hero在真实JSDOM中的展示适配回归；调度、身份和模型均为Fake。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import { originalClientPlatform } from './official-client-boot-fixture.mjs'

const sdkRoot = process.env.ADMINSMART_DSH_ROOT // 与受管检查相同的官方安装，不读取实际用户Runtime。
assert.ok(sdkRoot, '请指定ADMINSMART_DSH_ROOT以执行原始Hero DOM回归')
const sdkRequire = createRequire(resolve(sdkRoot, 'package.json')) // React、ReactDOM及上游公开入口始终来自同一固定安装。
const uiRoot = process.env.ADMINSMART_UI_LIBRARY_ROOT || fileURLToPath(new URL('../../../ui组件库/', import.meta.url)) // 复用现有UI工作区的DOM测试依赖，可通过进程变量移植。
const { JSDOM, VirtualConsole } = createRequire(resolve(uiRoot, 'package.json'))('jsdom') // 已安装的26.1.0，不新增依赖或测试框架。
const { seeds } = await originalClientPlatform() // 官方完整Web入口提供平台种子，第三方源码与构建字节保持原样。
const react = sdkRequire('react') // 本用例所有真实组件与DOM Renderer共享同一React dispatcher。
const jsxRuntime = sdkRequire('react/jsx-runtime') // 官方与自有完整Bundle均使用同一个真实JSX运行时。
const act = react.act ?? sdkRequire('react-dom/test-utils').act // 使用当前固定React公开的act，不模拟Hook或Effect。

/**
 * 原样加载一个公开Client模块，React仅连接到本用例真实DOM Renderer。
 * @param {string} filename 受信公开入口或自有交付文件。
 * @param {Window} browser 当前独立JSDOM窗口。
 * @param {Function} enqueue 本用例可控微任务边界，用于验证卸载后的排队取消。
 * @returns {object} 原始工厂导出的apply/inject等公开接口。
 */
function loadClient(filename, browser, enqueue = queueMicrotask) {
  let declaration // ModuleLoader.load收到的完整原始模块，不抽取私有函数。
  const loaderWindow = new Proxy(browser, { get(target, key) { if (key === '__ModuleLoader__') return { load: value => { declaration = value } }; const value = Reflect.get(target, key, target); return typeof value === 'function' && ['addEventListener', 'removeEventListener', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia'].includes(key) ? value.bind(target) : value } }) // 只替换测试模块登记面，DOM节点仍属于真实JSDOM。
  vm.runInNewContext(readFileSync(filename, 'utf8'), { window: loaderWindow, document: browser.document, navigator: browser.navigator, location: browser.location, HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, DOMParser: browser.DOMParser, requestAnimationFrame: browser.requestAnimationFrame.bind(browser), cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser), MutationObserver: browser.MutationObserver, ResizeObserver: globalThis.ResizeObserver, queueMicrotask: enqueue, setTimeout, clearTimeout, AbortController, URL, fetch() { throw new Error('离线Hero测试禁止网络') } }, { filename })
  assert.equal(typeof declaration?.factory, 'function')
  return declaration.factory(name => name === 'react' ? react : name === 'react/jsx-runtime' ? jsxRuntime : seeds[name]) // 不修改上游发布字节或伪造组件返回值。
}

/**
 * 经完整官方apply的公开registerFactory捕获正式ConversationContent。
 * @param {Window} browser 独立离线DOM。
 * @returns {Promise<object>} 实际组件、真实Context清理和官方双语字典。
 */
async function officialContent(browser) {
  const module = loadClient(sdkRequire.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), browser) // 原封不动执行官方完整Client注册。
  const ctx = new seeds['@deepseek-ai/cordis'].Context() // Service、注册表与effect使用真实Cordis。
  const stop = new Error('fixture captured official ConversationContent') // 只在公开登记边界停止后续执行器装配，不运行Session或模型。
  const dictionaries = new Map() // 官方apply实际提交的原始中英字典。
  let Content // public registerFactory回调交付的完整正式组件，包含原始私有HeroShell。
  const slots = {
    register: () => () => {}, // 非目标公开席位只接受登记，不执行会话操作。
    registerFactory(options, component) { if (options.name === 'conversation.content') { Content = component; throw stop }; return () => {} },
    inject(_name, install) { const result = install(); if (result && typeof result[Symbol.iterator] === 'function') for (const _dispose of result) {} return () => {} }, // 官方main声明的generator按原顺序触发正式Factory登记。
    entries: () => [], // 无真实用户或会话视图目录。
    subscribe: () => () => {}, // 本Fixture不改变官方Slot目录。
  }
  ctx.provide('slots', slots)
  ctx.provide('sessions', { binding: () => undefined }) // 不保留或读取真实Session。
  ctx.provide('uiWorkspace', { openWorkspace() { throw new Error('离线测试禁止打开真实工作区') } }) // Hero展示不得进入调度动作。
  ctx.provide('uiSession', { provide() {} }) // 只接受官方hook声明，不解析用户会话。
  ctx.provide('locale', { register: (namespace, values) => { dictionaries.set(namespace, values); return () => {} }, bind: () => key => key, subscribe: () => () => {} }) // 记录原始字典，实际渲染下方按语言调用。
  ctx.provide('configForms', { get: () => ({ getSnapshot: () => ({ value: { busyEnter: 'queue' } }), subscribe: () => () => {} }), developerTools: { enabled: { getSnapshot: () => false, subscribe: () => () => {} } } }) // 展示相关公开设置使用合成值，无写入口。
  try { module.apply(ctx) } catch (error) { if (error !== stop) { await ctx.fiber.dispose(); throw error } }
  assert.equal(typeof Content, 'function', '必须经官方公开Factory登记取得原始组件')
  const dictionary = dictionaries.get('conversation') // 官方locale属主身份由当前固定版本定义，未找到时不能自造文案伪装原始Hero。
  assert.ok(dictionary?.zh && dictionary?.en)
  return { Content, dictionary, close: () => ctx.fiber.dispose() }
}

/**
 * 创建原始Hero与自有展示组件的真实DOM挂载。
 * @param {object} options 隔离展示条件。
 * @param {'zh'|'en'} [options.language='zh'] 官方初始语言。
 * @param {boolean} [options.strict=false] 是否执行React StrictMode的重复Effect生命周期。
 * @param {boolean} [options.unknownStructure=false] 是否在官方品牌Outlet额外插入节点使初始结构校验失败。
 * @param {'available'|'missing'|'constructor-fails'|'observe-fails'} [options.observerMode='available'] 有限观察能力故障，验证展示适配失败关闭。
 * @param {string|null} [options.initialHidden=null] 官方badge的既有hidden属性原值。
 * @param {''|'important'} [options.initialDisplayPriority=''] 官方badge原始display优先级。
 * @returns {Promise<object>} DOM、变更、卸载及调度观测；不包含真实业务资源。
 */
async function fixture({ language = 'zh', strict = false, unknownStructure = false, observerMode = 'available', initialHidden = null, initialDisplayPriority = '' } = {}) {
  const console = new VirtualConsole() // 只隔离JSDOM不支持的现代CSS解析噪声，不隐藏测试断言或组件异常。
  console.on('jsdomError', error => { if (error.type !== 'css parsing') throw error })
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="fixture"></div></body></html>', { url: 'http://fixture.invalid/', pretendToBeVisual: true, virtualConsole: console }) // 默认不加载外部资源，不使用用户浏览器或存储。
  const browser = dom.window // 当前Fixture唯一DOM所有者。
  const observed = [] // 检查观察根严格局限为当前headline。
  const disconnected = new Set() // 检查卸载和终态失效会断开观察器。
  const OriginalObserver = browser.MutationObserver // 真实DOM变更通知实现，不伪造MutationRecord。
  browser.MutationObserver = class extends OriginalObserver {
    constructor(callback) { super(callback); if (observerMode === 'constructor-fails') throw new Error('fixture observer construction failed') }
    observe(target, options) { observed.push({ owner: this, target, options }); if (observerMode === 'observe-fails') throw new Error('fixture observer setup failed'); return super.observe(target, options) }
    disconnect() { disconnected.add(this); return super.disconnect() }
  }
  if (observerMode === 'missing') browser.MutationObserver = undefined
  browser.matchMedia = media => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }) // 不启动图标hover动画或读取实际系统主题。
  const globals = { window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, MutationObserver: browser.MutationObserver, getComputedStyle: browser.getComputedStyle.bind(browser), requestAnimationFrame: browser.requestAnimationFrame.bind(browser), cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser), ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true } // 只补DOM运行必需API，不具真实网络和模型能力。
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])) // 完成后恢复每一项Node全局，避免污染后续测试。
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  let native // 真实官方Context创建后统一清理。
  let root // React挂载创建后统一卸载。
  let mounted = false // 防止用例显式卸载后再次卸载产生无关警告。
  let hold = false // 扣住自有适配微任务，测试cleanup是否能取消迟到工作。
  const tasks = [] // 仅本插件的待执行任务，不拦截React、JSDOM或系统全局队列。
  const enqueue = task => hold ? tasks.push(task) : queueMicrotask(task) // 原始代码仍执行自己的调度与active检查。
  try {
    native = await officialContent(browser)
    const product = loadClient(fileURLToPath(new URL('../lib/client.js', import.meta.url)), browser, enqueue) // 原样执行本轮正式自有Client，不抽取内部安装器。
    const entries = [] // 仅记录apply通过公开Slot登记的组件。
    product.apply({ inject() {}, slots: { inject: (_name, install) => install(), register: (options, component) => { entries.push({ options, component }); return () => {} } }, effect() {} }) // 品牌外的Host/主题/遮罩不属于此展示Fixture，不装配其effect。
    const Mark = entries.find(entry => entry.options.name === 'conversation.hero.brand.mark')?.component // 正式Hero组件通过真实ref/effect执行局部适配。
    assert.equal(typeof Mark, 'function')
    const host = browser.document.getElementById('fixture') // 本Fixture唯一React根。
    let locale = language // 重新渲染时使用官方原始字典，不重造原生文案。
    let hero = true // 离开Hero模拟正常会话显示，旧DOM适配不能继续运行。
    const translations = key => native.dictionary[locale][key] ?? key // 官方登记的完整字典拥有原始标题与badge。
    const selector = value => select => select(value) // 合成只读hooks仅提供无Session展示输入，不模拟Agent引擎。
    const renderSlot = (name, _props) => {
      if (name === 'conversation.hero.brand.mark') return react.createElement('div', { 'data-slot': name }, react.createElement(Mark), unknownStructure ? react.createElement('i', { 'data-fixture-unknown': '' }) : null) // 按官方RootEntry的data-slot外壳交付原始HeroDOM结构。
      if (name === 'conversation.composer.bar') return react.createElement('textarea', { 'data-fixture-input': '', defaultValue: '探索未至之境 预览版' }) // Composer调度为明确Fake，提供禁止误改的输入canary。
      return null
    }
    function Harness() {
      react.useLayoutEffect(() => {
        const anchor = host.querySelector('[data-adminsmart-hero-presentation]') // 在自有组件passiveEffect前设置可控原生badge样式基线。
        const badge = anchor?.parentElement?.parentElement?.parentElement?.lastChild?.lastChild // 原始Hero两个span组的局部位置，只用于测试输入，不替代产品探测算法。
        badge?.style?.setProperty('display', 'inline-flex', initialDisplayPriority)
        badge?.style?.setProperty('color', 'rgb(1, 2, 3)')
        if (badge && initialHidden !== null) badge.setAttribute('hidden', initialHidden)
      }, [])
      return react.createElement(react.Fragment, null,
        react.createElement('aside', { 'data-fixture-canary': '' }, '探索未至之境 预览版 Into the Unknown Preview'),
        react.createElement(native.Content, { sessionId: undefined, phase: hero ? 'hero' : 'active', hero, useSession: selector(undefined), useSessions: selector({ byId: {} }), useSessionStatus: selector(new Map()), useWorkspaces: selector({ phase: 'ready', items: [] }), useInput: selector(undefined), useComposerBlock: selector(undefined), useFactorySlot: (_name, fallback) => fallback, renderSlot, renderSlotChain: (_name, _owner, options) => options.fallback, selectWorkspace() { throw new Error('不得执行真实工作区动作') }, t: translations })) // HeroShell及其标题/徽标是完整官方Content的真实内部组件。
    }
    const createElement = () => strict ? react.createElement(react.StrictMode, null, react.createElement(Harness)) : react.createElement(Harness) // StrictMode保留真实重复effect语义。
    const { createRoot } = sdkRequire('react-dom/client') // 在DOM装配后加载真正事件与提交系统。
    root = createRoot(host)
    await act(async () => { root.render(createElement()); await Promise.resolve() })
    mounted = true
    const nodes = () => {
      const anchor = host.querySelector('[data-adminsmart-hero-presentation]') // 只取得本用例正式锚点，不扫描用户内容。
      const headline = anchor?.parentElement?.parentElement?.parentElement
      const group = headline?.lastChild
      return {
        anchor, // 当前隐藏语义锚点。
        headline, // 原始官方Hero唯一局部观察根。
        title: group?.firstChild, // 原始官方标题span。
        badge: group?.lastChild, // 原始官方预览徽标span。
      }
    }
    return { browser, host, entries, observed, disconnected, tasks, nodes,
      holdTasks() { hold = true },
      async flushTasks() { hold = false; await act(async () => { for (const task of tasks.splice(0)) task(); await Promise.resolve() }) },
      async flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) },
      async language(next) { locale = next; await act(async () => { root.render(createElement()); await Promise.resolve() }) },
      async showConversation() { hero = false; await act(async () => { root.render(createElement()); await Promise.resolve() }) },
      async showHero() { hero = true; await act(async () => { root.render(createElement()); await Promise.resolve() }) },
      async unmount() { if (mounted) { await act(async () => { root.unmount(); await Promise.resolve() }); mounted = false } },
      async close() { if (mounted) await act(async () => { root.unmount() }); mounted = false; await native.close(); browser.close(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } },
    }
  } catch (error) {
    if (mounted) await act(async () => root.unmount())
    await native?.close()
    browser.close()
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
    throw error
  }
}

for (const language of ['zh', 'en']) test(`原始官方Hero的${language}标题和预览仅在局部适配，输入及聊天canary不变`, async () => {
  const current = await fixture({ language }) // 原始官方文案来自实际apply注册字典。
  try {
    const {
      anchor, // 当前实例自己的隐藏语义锚点，不作为全局查找入口。
      headline, // 原始官方Hero标题区域，也是唯一允许观察的根。
      title, // 官方标题span，测试只允许既有Text的有限文案替换。
      badge, // 官方预览徽标span，验证隐藏、样式和恢复边界。
    } = current.nodes()
    assert.equal(title.textContent, '今天想解决什么问题？')
    assert.equal(anchor.hidden, true)
    assert.equal(anchor.getAttribute('aria-hidden'), 'true')
    assert.equal(badge.hidden, true)
    assert.equal(badge.style.getPropertyValue('display'), 'none')
    assert.equal(badge.style.getPropertyPriority('display'), 'important')
    assert.equal(current.browser.getComputedStyle(badge).display, 'none')
    assert.equal(badge.style.color, 'rgb(1, 2, 3)')
    assert.equal(current.host.querySelector('[data-fixture-canary]').textContent, '探索未至之境 预览版 Into the Unknown Preview')
    assert.equal(current.host.querySelector('[data-fixture-input]').value, '探索未至之境 预览版')
    assert.ok(current.observed.length > 0)
    assert.ok(current.observed.every(record => record.target === headline && record.options.attributeFilter.includes('data-slot') && record.options.attributeFilter.includes('aria-hidden')))
    assert.equal(anchor.querySelector('svg,img') === null, true)
    assert.equal(current.entries.find(entry => entry.options.name === 'sidebar.brand.mark').component() === null, true)
  } finally { await current.close() }
})

test('StrictMode与官方语言重渲染保留Text身份，卸载恢复最新官方语言和样式基线', async () => {
  const current = await fixture({ strict: true }) // 真正执行重复setup/cleanup，而不是手工调用安装器。
  try {
    const {
      title, // 官方标题span，测试只允许既有Text的有限文案替换。
      badge, // 官方预览徽标span，验证隐藏、样式和恢复边界。
    } = current.nodes()
    const text = title.firstChild // 官方React更新必须沿用原Text，不能被自有适配替换。
    await current.language('en')
    assert.equal(current.nodes().title.firstChild === text, true)
    assert.equal(title.textContent, '今天想解决什么问题？')
    assert.equal(badge.textContent, 'Preview')
    await current.unmount()
    assert.equal(title.textContent, 'Into the Unknown')
    assert.equal(badge.hasAttribute('hidden'), false)
    assert.equal(badge.style.display, 'inline-flex')
    assert.equal(badge.style.getPropertyPriority('display'), '')
    assert.equal(current.disconnected.size, current.observed.length)
  } finally { await current.close() }
})

test('卸载准确恢复原始hidden属性值和important优先级，只还原display而保留其他样式', async () => {
  const current = await fixture({ initialHidden: 'until-found', initialDisplayPriority: 'important' }) // 不能把hidden当布尔或把important丢弃。
  try {
    const {
      title, // 官方标题span，测试只允许既有Text的有限文案替换。
      badge, // 官方预览徽标span，验证隐藏、样式和恢复边界。
    } = current.nodes()
    assert.equal(title.textContent, '今天想解决什么问题？')
    assert.equal(badge.getAttribute('hidden'), '')
    assert.equal(badge.style.display, 'none')
    await current.unmount()
    assert.equal(badge.getAttribute('hidden'), 'until-found')
    assert.equal(badge.style.getPropertyValue('display'), 'inline-flex')
    assert.equal(badge.style.getPropertyPriority('display'), 'important')
    assert.equal(badge.style.color, 'rgb(1, 2, 3)')
  } finally { await current.close() }
})

for (const observerMode of ['missing', 'constructor-fails', 'observe-fails']) test(`观察能力${observerMode}时保留原始Hero且隐藏锚点不退位`, async () => {
  const current = await fixture({ observerMode }) // 故障仅注入浏览器观察能力，真实组件Effect必须自行处理。
  try {
    const {
      anchor, // 当前实例自己的隐藏语义锚点，不作为全局查找入口。
      title, // 官方标题span，测试只允许既有Text的有限文案替换。
      badge, // 官方预览徽标span，验证隐藏、样式和恢复边界。
    } = current.nodes()
    assert.equal(title.textContent, '探索未至之境')
    assert.equal(badge.hidden, false)
    assert.equal(badge.style.display, 'inline-flex')
    assert.equal(anchor.hidden, true)
    assert.equal(anchor.getAttribute('data-adminsmart-hero-presentation'), 'v1')
    assert.equal(anchor.parentElement.parentElement.querySelector('svg,img') === null, true, '展示异常不能导致Hero品牌entry退位恢复官方图形；其它官方控件的SVG保留')
  } finally { await current.close() }
})

test('未知结构保留官方原样且不安装Observer，不全局查找相似标题', async () => {
  const current = await fixture({ unknownStructure: true }) // 原始Hero之外只在Outlet添加一项明确不兼容结构。
  try {
    const {
      title, // 官方标题span，测试只允许既有Text的有限文案替换。
      badge, // 官方预览徽标span，验证隐藏、样式和恢复边界。
    } = current.nodes()
    assert.equal(title.textContent, '探索未至之境')
    assert.equal(badge.hidden, false)
    assert.equal(current.browser.getComputedStyle(badge).display, 'inline-flex')
    assert.equal(current.observed.length, 0)
    assert.equal(current.host.querySelector('[data-fixture-canary]').textContent, '探索未至之境 预览版 Into the Unknown Preview')
  } finally { await current.close() }
})

test('替换Text终态停用，恢复仍owned的badge字段且不覆盖外部新文本', async () => {
  const current = await fixture() // 自有适配初始已经成功。
  try {
    const {
      title, // 官方标题span，测试只允许既有Text的有限文案替换。
      badge, // 官方预览徽标span，验证隐藏、样式和恢复边界。
    } = current.nodes()
    title.replaceChild(current.browser.document.createTextNode('外部新标题'), title.firstChild)
    await current.flush()
    assert.equal(title.textContent, '外部新标题')
    assert.equal(badge.hidden, false)
    assert.equal(badge.style.display, 'inline-flex')
    assert.equal(current.disconnected.size, current.observed.length)
    title.firstChild.nodeValue = '探索未至之境'
    await current.flush()
    assert.equal(title.textContent, '探索未至之境', '终态停用后不能沿新Text恢复覆盖')
  } finally { await current.close() }
})

test('原Text身份不变但出现未知欢迎语时保留外部文字并终态停止', async () => {
  const current = await fixture() // 模拟官方升级仅更新Text.nodeValue，不替换节点。
  try {
    const {
      title, // 官方标题span，测试只允许既有Text的有限文案替换。
      badge, // 官方预览徽标span，验证隐藏、样式和恢复边界。
    } = current.nodes()
    const originalText = title.firstChild // 身份保持不变不能成为无限覆盖未知文案的理由。
    originalText.nodeValue = '官方新增的欢迎说明'
    await current.flush()
    assert.equal(title.firstChild === originalText, true)
    assert.equal(title.textContent, '官方新增的欢迎说明')
    assert.equal(badge.hidden, false)
    assert.equal(badge.style.display, 'inline-flex')
    assert.equal(current.disconnected.size, current.observed.length)
    originalText.nodeValue = 'Into the Unknown'
    badge.firstChild.nodeValue = 'Preview'
    await current.flush()
    assert.equal(title.textContent, 'Into the Unknown', '文案重新匹配也不能重新启动已终止的展示覆盖')
  } finally { await current.close() }
})

test('升级在headline追加官方按钮时停止适配，新增按钮及祖先可见且能点击', async () => {
  const current = await fixture() // 新增功能位只在本合成DOM创建，不调用真实外部系统。
  try {
    const {
      headline, // 原始官方Hero标题区域，也是唯一允许观察的根。
      title, // 官方标题span，测试只允许既有Text的有限文案替换。
      badge, // 官方预览徽标span，验证隐藏、样式和恢复边界。
    } = current.nodes()
    const button = current.browser.document.createElement('button') // 模拟上游新增可交互内容，不能被隐藏旧预览的逻辑覆盖。
    button.textContent = '官方新功能'
    let clicks = 0 // 只记录本测试按钮的原生事件是否仍然可用。
    button.addEventListener('click', () => { clicks += 1 })
    headline.appendChild(button)
    await current.flush()
    assert.equal(title.textContent, '探索未至之境')
    assert.equal(badge.hidden, false)
    assert.equal(badge.style.display, 'inline-flex')
    assert.equal(button.hidden, false)
    assert.equal(button.closest('[hidden]') === null, true)
    assert.notEqual(current.browser.getComputedStyle(button).display, 'none')
    assert.notEqual(current.browser.getComputedStyle(headline).display, 'none')
    assert.equal(button.parentElement === headline, true)
    button.click()
    assert.equal(clicks, 1)
    assert.equal(current.disconnected.size, current.observed.length)
  } finally { await current.close() }
})

test('排队微任务随cleanup取消，外部hidden/display/标题新值不被还原覆盖', async () => {
  const current = await fixture() // 本Fixture只扣住插件自己的微任务。
  try {
    const {
      title, // 官方标题span，测试只允许既有Text的有限文案替换。
      badge, // 官方预览徽标span，验证隐藏、样式和恢复边界。
    } = current.nodes()
    current.holdTasks()
    title.firstChild.nodeValue = '外部新标题'
    badge.setAttribute('hidden', 'until-found')
    badge.style.setProperty('display', 'grid', 'important')
    await current.flush()
    assert.ok(current.tasks.length > 0)
    await current.unmount()
    await current.flushTasks()
    assert.equal(title.textContent, '外部新标题')
    assert.equal(badge.getAttribute('hidden'), 'until-found')
    assert.equal(badge.style.getPropertyValue('display'), 'grid')
    assert.equal(badge.style.getPropertyPriority('display'), 'important')
  } finally { await current.close() }
})

for (const attribute of ['data-slot', 'data-slot-error', 'data-adminsmart-hero-presentation', 'aria-hidden']) test(`守卫属性${attribute}变更会恢复owned字段并终态停止`, async () => {
  const current = await fixture() // 每个属性用独立真实Hero实例，不借用前一轮失效状态。
  try {
    const {
      anchor, // 当前实例自己的隐藏语义锚点，不作为全局查找入口。
      title, // 官方标题span，测试只允许既有Text的有限文案替换。
      badge, // 官方预览徽标span，验证隐藏、样式和恢复边界。
    } = current.nodes()
    const target = attribute === 'data-slot' || attribute === 'data-slot-error' ? anchor.parentElement : anchor // 两个官方Outlet身份属性与两个自有锚点身份属性分别覆盖。
    const previous = target.getAttribute(attribute) // 用于恢复外部输入后验证旧适配仍处于终态。
    target.setAttribute(attribute, attribute === 'aria-hidden' ? 'false' : 'fixture-invalid')
    await current.flush()
    assert.equal(title.textContent, '探索未至之境')
    assert.equal(badge.hidden, false)
    assert.equal(badge.style.display, 'inline-flex')
    assert.equal(current.disconnected.size, current.observed.length)
    if (previous === null) target.removeAttribute(attribute)
    else target.setAttribute(attribute, previous)
    await current.flush()
    assert.equal(title.textContent, '探索未至之境', '身份恢复不能偷偷重新启动已终止实例')
    assert.equal(badge.hidden, false)
  } finally { await current.close() }
})

test('退出Hero恢复并断开旧实例，重新进入只修改新Hero而不触碰对话输入', async () => {
  const current = await fixture() // 真实原始Content从hero切到active再返回。
  try {
    const previous = current.nodes() // 保留已卸载实例用于确认恢复与迟到事件隔离。
    await current.showConversation()
    assert.equal(current.host.querySelector('[data-adminsmart-hero-presentation]') === null, true)
    assert.equal(previous.title.textContent, '探索未至之境')
    assert.equal(previous.badge.hidden, false)
    assert.equal(current.disconnected.size, current.observed.length)
    await current.showHero()
    const next = current.nodes() // 新一次React挂载获得不同锚点和局部观察实例。
    assert.equal(next.anchor === previous.anchor, false)
    assert.equal(next.title.textContent, '今天想解决什么问题？')
    assert.equal(next.badge.hidden, true)
    assert.equal(current.host.querySelector('[data-fixture-input]').value, '探索未至之境 预览版')
    previous.title.firstChild.nodeValue = '旧实例外部更新'
    await current.flush()
    assert.equal(previous.title.textContent, '旧实例外部更新')
    assert.equal(next.title.textContent, '今天想解决什么问题？')
  } finally { await current.close() }
})
