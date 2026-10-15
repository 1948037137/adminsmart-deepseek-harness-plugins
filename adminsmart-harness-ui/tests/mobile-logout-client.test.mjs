import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8') // 原样执行当前交付的Lazy-CJS，不复制业务判断到测试实现。

/**
 * 创建只包含公开Slot和React生命周期替身的离线客户端。
 * @param {object} [options] 当前用例的合成浏览器边界。
 * @param {boolean} [options.mobile=true] 媒体查询是否匹配手机画布。
 * @param {boolean} [options.embedded=true] 是否存在独立父页面。
 * @param {string} [options.userAgent=''] 合成设备标识，不读取测试机器浏览器。
 * @param {boolean} [options.clientHintMobile=false] 合成Client Hint手机标识。
 * @param {object} [options.jsxRuntime] 真实官方平台JSX种子，用于完整Button的离线SSR验证。
 * @param {object|Function} [options.officialButton] 真实官方Primitive；未提供时只观察组件交付的属性。
 * @returns {object} 注册、渲染、点击和卸载检查所需的受限Fixture。
 */
function fixture({ mobile = true, embedded = true, userAgent = '', clientHintMobile = false, jsxRuntime, officialButton } = {}) {
  const registrations = [] // 只记录真实apply提交的Slot，不自己提供业务条目。
  const messages = [] // 只记录固定注销意图，不接触Token或真实Cookie。
  const mediaListeners = new Set() // 断点变化通知用于验证旋转后的可见性。
  const resizeListeners = new Set() // 窗口尺寸监听必须随组件卸载清理。
  const state = [] // 单个合成组件实例跨渲染保留的React状态。
  const refs = [] // 同步点击锁使用的真实组件ref单元。
  const mountedEffects = [] // 组件首次提交后执行的effect及其清理函数。
  const media = {
    matches: mobile, // 用例显式变更视口，不请求系统真实屏幕状态。
    addEventListener(_type, listener) { mediaListeners.add(listener) },
    removeEventListener(_type, listener) { mediaListeners.delete(listener) },
  }
  let declaration // 原始ModuleLoader公开注册结果。
  let stateIndex = 0 // 当前渲染内的状态Hook位置。
  let refIndex = 0 // 当前渲染内的ref Hook位置。
  let effectIndex = 0 // 每个[]依赖effect在首次提交后只挂载一次。
  const buttonPrimitive = officialButton ?? (() => null) // SSR用真实官方Button，其余事件用例只识别控件身份。
  const browser = {
    __ADMINSMART_RUNTIME_ROLE__: 'admin', // 启动导航依赖不属于本组手机退出测试。
    navigator: { userAgent, userAgentData: { mobile: clientHintMobile } }, // 完全合成的设备输入。
    location: { origin: 'https://fixture.example.test' }, // 消息目标只能由当前文档来源决定。
    matchMedia: () => media,
    addEventListener(type, listener) { if (type === 'resize') resizeListeners.add(listener) },
    removeEventListener(type, listener) { if (type === 'resize') resizeListeners.delete(listener) },
    __ModuleLoader__: { load(value) { declaration = value } },
  }
  browser.parent = embedded ? { postMessage(message, origin) { messages.push({ message, origin }) } } : browser
  vm.runInNewContext(source, { window: browser, fetch() { throw new Error('手机退出不得读取认证或调用服务') } })
  const client = declaration.factory(specifier => {
    if (specifier === 'react/jsx-runtime') return jsxRuntime ?? { jsx: (type, props) => ({ type, props }) }
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { Button: buttonPrimitive }
    if (specifier === 'react') return {
      useState(initial) {
        const index = stateIndex++ // 每轮渲染定位同一状态单元，不模拟业务状态规则。
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
        return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
      },
      useRef(initial) {
        const index = refIndex++ // 防重复点击必须经过交付组件自身的ref锁。
        return refs[index] ??= { current: initial }
      },
      useEffect(effect) {
        const index = effectIndex++ // 保存React []依赖效果的首次挂载及释放。
        if (!(index in mountedEffects)) mountedEffects[index] = { effect, mounted: false, cleanup: null }
      },
    }
    throw new Error(`unexpected dependency: ${specifier}`)
  })
  client.apply({
    inject() {}, // 本目标不装配主题服务，公开依赖保持pending。
    slots: {
      inject(_name, install) { install() },
      register(options, component) { registrations.push({ ...options, component }) },
    },
    effect() {}, // 不运行与手机退出无关的官方弹窗DOM适配。
  })
  const header = registrations.find(entry => entry.name === 'conversation.session.header.utilities') // 直接取得真实公开Slot中的交付组件。
  const sidebar = registrations.find(entry => entry.name === 'sidebar.footer.action') // 无Session时仍存在的官方root列表位。
  return {
    registrations,
    messages,
    header,
    sidebar,
    buttonPrimitive,
    render(props, region = 'header') {
      stateIndex = 0
      refIndex = 0
      effectIndex = 0
      const result = (region === 'sidebar' ? sidebar : header).component(props) // 真实Slot分别使用各自公开参数；Hook状态由替身持有。
      for (const item of mountedEffects) {
        if (item.mounted) continue
        item.mounted = true
        item.cleanup = item.effect()
      }
      return result
    },
    resize(matches) {
      media.matches = matches
      for (const listener of mediaListeners) listener()
      for (const listener of resizeListeners) listener()
    },
    dispose() { for (const item of mountedEffects) item.cleanup?.() },
    listenerCounts: () => ({ media: mediaListeners.size, resize: resizeListeners.size }),
  }
}

test('退出入口只追加官方Header工具列表与无会话侧栏兜底，不覆盖官方导航', () => {
  const client = fixture() // 默认嵌入式手机画布，不需要Session或任何认证数据。
  assert.equal(client.header.id, 'adminsmart-mobile-logout')
  assert.strictEqual(client.sidebar.component, client.header.component)
  assert.equal(client.registrations.some(entry => ['conversation.session.header', 'conversation.session.header.corner', 'sidebar'].includes(entry.name)), false)
  const button = client.render() // Header退出图标位于官方右侧栏corner之前，完整含义由可访问名称提供。
  assert.strictEqual(button.type, client.buttonPrimitive)
  assert.equal(button.props.children, undefined)
  assert.equal(client.render({ wide: false }).props.children, undefined)
  assert.equal(client.render({ wide: true }).props.children, undefined)
  assert.equal(button.props.icon.type, 'svg')
  assert.equal(button.props.icon.props['aria-hidden'], 'true')
  assert.equal(button.props.icon.props.focusable, 'false')
  assert.equal(button.props.icon.props.stroke, 'currentColor')
  assert.equal(button.props.style.width, 44)
  assert.equal(button.props['aria-label'], '退出登录')
  assert.ok(button.props.style.minHeight >= 44)
  client.dispose()
})

test('点击只向同源父页面发送一次固定意图，主应用拥有真实注销', () => {
  const client = fixture() // Fake父页面只接收消息，不请求真实服务或退出当前账号。
  const button = client.render() // 使用真实交付按钮事件，连续点击发生在同一渲染周期。
  button.props.onClick()
  button.props.onClick()
  assert.equal(client.messages.length, 1)
  assert.equal(client.messages[0].origin, 'https://fixture.example.test')
  assert.equal(JSON.stringify(client.messages[0].message), JSON.stringify({ type: 'adminsmart:agent-logout-request' }))
  assert.equal(client.render().props.disabled, true)
  assert.equal(client.render().props['aria-busy'], true)
  client.dispose()
})

test('桌面和独立Harness隐藏入口，手机横屏仍可退出', () => {
  for (const options of [{ mobile: false }, { embedded: false }]) {
    const client = fixture(options) // 两种无权展示的边界分别使用独立组件实例。
    assert.equal(client.render(), null)
    assert.deepEqual(client.messages, [])
    client.dispose()
  }
  for (const options of [{ mobile: false, userAgent: 'Synthetic iPhone' }, { mobile: false, clientHintMobile: true }]) {
    const client = fixture(options) // 手机UA或Client Hint保证横屏仍与主壳隐藏行为一致。
    assert.equal(client.render().props['aria-label'], '退出登录')
    assert.equal(client.render().props.icon.type, 'svg')
    client.dispose()
  }
})

test('手机断点变化更新可见性并在卸载时释放监听', () => {
  const client = fixture({ mobile: false }) // 桌面缩到手机宽度后无需重新登录或刷新。
  assert.equal(client.render(), null)
  client.resize(true)
  const button = client.render() // 当前断点已有退出能力，保存节点用于检查迟到点击。
  assert.equal(button.props['aria-label'], '退出登录')
  assert.equal(button.props.children, undefined)
  client.resize(false)
  button.props.onClick() // 回到桌面后旧事件闭包也不能发送手机退出。
  assert.equal(client.render(), null)
  assert.deepEqual(client.messages, [])
  assert.deepEqual(client.listenerCounts(), { media: 1, resize: 1 })
  client.dispose()
  assert.deepEqual(client.listenerCounts(), { media: 0, resize: 0 })
})

test('固定官方Button完整SSR在Header及展开侧栏都输出可见退出SVG且无文字', async () => {
  const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 完整SDK验收显式使用同一受管安装，不从用户Runtime取数据。
  assert.ok(runtimeRoot, '请指定ADMINSMART_DSH_ROOT以验证原始官方Button')
  const { originalClientPlatform } = await import('./official-client-boot-fixture.mjs') // 复用已有离线平台捕获，不解析或抽取Button源码。
  const { seeds } = await originalClientPlatform() // 官方React/JSX/Primitives原始种子，没有第二套控件实现。
  const require = createRequire(resolve(runtimeRoot, 'package.json')) // SSR依赖与当前官方固定安装一致。
  const { renderToStaticMarkup } = require('react-dom/server') // 真实SSR递归执行官方Button，不能只断言icon属性存在。
  const client = fixture({ officialButton: seeds['@deepseek-ai/dsh-client-ui-primitives'].Button, jsxRuntime: seeds['react/jsx-runtime'] }) // 只有ReactHook生命周期是隔离替身，最终DOM由原始Button渲染。
  try {
    for (const [region, props] of [['header', {}], ['sidebar', { wide: true }]]) {
      const markup = renderToStaticMarkup(client.render(props, region)) // 覆盖官方Header空参数及侧栏展开参数两个真实分支。
      assert.match(markup, /^<button\b/u)
      assert.match(markup, /aria-label="退出登录"/u)
      assert.match(markup, /<svg\b[^>]*aria-hidden="true"[^>]*>/u)
      assert.match(markup, /<path\b[^>]*d="M9 21H5/u)
      assert.match(markup, /min-width:44px;min-height:44px;width:44px/u)
      assert.equal(markup.replace(/<[^>]*>/gu, '').trim(), '', `${region}不得留下可见退出文字`)
    }
    const button = client.render({}, 'header') // 实际退出动作后仍使用图标，读屏名称明确反映等待状态。
    button.props.onClick()
    const pendingMarkup = renderToStaticMarkup(client.render({ wide: true }, 'sidebar')) // 等待时不能恢复“退出中”等文字挤占手机空间。
    assert.match(pendingMarkup, /aria-label="正在退出登录"/u)
    assert.match(pendingMarkup, /disabled=""/u)
    assert.equal(pendingMarkup.replace(/<[^>]*>/gu, '').trim(), '')
  } finally { client.dispose() }
})
