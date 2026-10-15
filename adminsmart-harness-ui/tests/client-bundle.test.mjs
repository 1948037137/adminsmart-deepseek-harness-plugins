/** Verify the authored browser bundle registers the exact Harness client-module contract. */

import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { join } from 'node:path'

const bundlePath = process.env.ADMINSMART_DSH_UI_CLIENT_BUNDLE || new URL('../lib/client.js', import.meta.url) // Package-relative browser bundle under test.
const bundleSource = readFileSync(bundlePath, 'utf8') // Authored source is also checked for public Harness slot-field compatibility.
const packagePath = process.env.ADMINSMART_UI_SOURCE_ROOT ? join(process.env.ADMINSMART_UI_SOURCE_ROOT, 'package.json') : new URL('../package.json', import.meta.url) // Client composition manifest declaring shipped Harness dependencies.
const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) // Parsed plugin manifest used to pin official Tool UI load order.
const registrations = [] // Captured __ModuleLoader__.load handoffs.
let installedStyle = null // Minimal document-owned style node created by the real Client apply lifecycle.
let activeMutationObserver = null // Observer installed by the real Client apply lifecycle for dynamic Chat insertions.
let nextAnimationFrameId = 1 // Deterministic requestAnimationFrame identity for deferred official layout and disclosure actions.
const hookRefsByInstance = new Map() // Minimal per-component-instance React ref storage for one-time Turn-process initialization tests.
const hookStatesByInstance = new Map() // 保留测试组件的真实 useState 更新，验证全选和取消全选交互。
let activeHookInstanceId = null // Component instance currently rendered through the isolated hook fixture.
let activeHookRefIndex = 0 // `useRef` call offset inside the current isolated component render.
let activeHookStateIndex = 0 // 当前组件 useState 调用序号，与 useRef 分别维护。
const navigationServices = [] // 普通用户语音 Client 的只读插件导航依赖，不注册管理页。

/**
 * Render one function component while preserving its `useRef` state across rerenders of the same fixture instance.
 *
 * @param {string} instanceId - Stable test-only component instance identity.
 * @param {Function} component - Registered Harness Slot component under test.
 * @param {object} props - Current owner props supplied by the simulated Slot renderer.
 * @returns {unknown} Component result produced by the authored bundle.
 */
function renderHookComponent(instanceId, component, props) {
  activeHookInstanceId = instanceId
  activeHookRefIndex = 0
  activeHookStateIndex = 0
  try {
    return component(props)
  } finally {
    activeHookInstanceId = null
    activeHookRefIndex = 0
    activeHookStateIndex = 0
  }
}

/**
 * Create the CSS declaration subset used by the DOM compatibility adapter.
 *
 * @returns {object} Mutable style fixture supporting value, priority, and writes.
 */
function createStyleFixture() {
  const properties = new Map() // Current property value and priority keyed by CSS property name.
  return {
    getPropertyValue(name) {
      return properties.get(name)?.value ?? ''
    },
    getPropertyPriority(name) {
      return properties.get(name)?.priority ?? ''
    },
    setProperty(name, value, priority = '') {
      properties.set(name, { value: String(value), priority: String(priority) })
    },
    removeProperty(name) {
      properties.delete(name)
    }
  }
}

/**
 * Create one minimal DOM element with mutable text, attributes, and inline style.
 *
 * @param {string} text - Initial rendered text exposed through textContent and TreeWalker.
 * @returns {object} DOM-compatible element fixture used only by the isolated client contract test.
 */
function createElementFixture(text = '') {
  const attributes = new Map() // Element attributes observed by the compatibility adapter.
  const textNodes = [{ nodeValue: text }] // Text-node sequence traversed without flattening Markdown structure.
  return {
    isConnected: true,
    parentElement: null,
    style: createStyleFixture(),
    textNodes,
    get textContent() {
      return textNodes.map(node => String(node.nodeValue ?? '')).join('')
    },
    set textContent(value) {
      textNodes.splice(0, textNodes.length, { nodeValue: String(value) })
    },
    getAttribute(name) {
      return attributes.get(name) ?? null
    },
    setAttribute(name, value) {
      attributes.set(name, String(value))
    },
    removeAttribute(name) {
      attributes.delete(name)
    },
    hasAttribute(name) {
      return attributes.has(name)
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    closest() {
      return null
    }
  }
}

/**
 * Create one official reasoning root and its semantic DisclosureRow control.
 *
 * @param {object} options - Reasoning presentation state exercised by the DOM adapter.
 * @param {string} options.text - Rendered reasoning text exposed through mutable text nodes.
 * @param {'running'|'ok'} options.state - Official streaming or settled reasoning state.
 * @param {boolean} options.expanded - Initial official disclosure state.
 * @param {boolean} [options.clickExpands=true] - Whether the simulated Harness click commits expansion.
 * @returns {{surface:object, disclosure:object, clickCount:() => number}} Reasoning root, official control, and click counter.
 */
function createReasoningDisclosureFixture({ text, state, expanded, clickExpands = true }) {
  const surface = createElementFixture(text) // Official `[data-variant="think"]` root carrying plugin-owned state only after reconciliation.
  const disclosure = createElementFixture() // Official DisclosureRow target is a role=button DIV, not a descendant button element.
  let disclosureClickCount = 0 // Actual automatic clicks received by this one reasoning step.
  surface.setAttribute('data-variant', 'think')
  surface.setAttribute('data-state', state)
  disclosure.setAttribute('data-disclosure-row', '')
  disclosure.setAttribute('data-expandable', 'true')
  disclosure.setAttribute('role', 'button')
  disclosure.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  disclosure.click = () => {
    disclosureClickCount += 1
    if (clickExpands) disclosure.setAttribute('aria-expanded', 'true')
  }
  surface.querySelector = selector => {
    if (selector === '[data-disclosure-row][data-expandable="true"][aria-expanded="true"]') {
      return disclosure.getAttribute('aria-expanded') === 'true' ? disclosure : null
    }
    if (selector === '[data-disclosure-row][data-expandable="true"][aria-expanded="false"]') {
      return disclosure.getAttribute('aria-expanded') === 'false' ? disclosure : null
    }
    return null
  }
  return {
    surface,
    disclosure,
    clickCount: () => disclosureClickCount
  }
}

/**
 * Create one fenced-code fixture and the complete Markdown wrapper hidden with it.
 *
 * @param {string} codeText - Rendered fenced-code content inspected by the compatibility adapter.
 * @returns {{code: object, container: object}} Code node and its owning Markdown wrapper.
 */
function createCodeBlockFixture(codeText) {
  const container = createElementFixture() // Markdown wrapper owning language chrome, copy action, and code body.
  const code = createElementFixture(codeText) // Rendered fenced-code node inspected for the exact legacy envelope.
  code.closest = selector => selector === '.md-code-block' || selector === 'pre' ? container : null
  return { code, container }
}

/**
 * Create one official Chat flow wrapper for settled or streaming Assistant content.
 *
 * @param {object} options - Assistant row surfaces published through semantic selectors.
 * @param {object[]} options.paragraphs - Paragraphs rendered inside the Assistant Markdown body.
 * @param {object[]} options.codeNodes - Fenced-code nodes rendered inside the Assistant Markdown body.
 * @param {object[]} options.reasoningSurfaces - Official reasoning roots rendered inside this Assistant row.
 * @param {boolean} [options.streaming=false] - Whether the official live-stream marker is present.
 * @returns {object} Assistant flow wrapper implementing the selectors used by production code.
 */
function createAssistantMessageFixture({ paragraphs, codeNodes, reasoningSurfaces, streaming = false }) {
  const streamingSurface = streaming ? createElementFixture() : null // Official Assistant Markdown marker present only while output is live.
  return {
    querySelector(selector) {
      return selector === '[data-streaming="true"]' ? streamingSurface : null
    },
    querySelectorAll(selector) {
      if (selector === 'p') return paragraphs
      if (selector === 'pre code') return codeNodes
      if (selector === '[data-variant="think"]') return reasoningSurfaces
      return []
    }
  }
}

const assistantHistoryParagraph = createElementFixture('历史答案</think>保留正文') // Settled Assistant artifact that must be cleaned.
const assistantFinalAnswerParagraph = createElementFixture('最终回答保留 search_knowledge 与 scope="all_sources" 示例') // Ordinary final-answer prose remains outside reasoning-label fallback.
const userExampleParagraph = createElementFixture('用户示例保留 </think>、search_knowledge 和 scope="all_sources" 标记') // User-authored literal markers and identifiers must remain untouched.
const streamingAssistantParagraph = createElementFixture('流式内容暂留 </think> 标记') // Live normalized surface excluded from historical cleanup.
const assistantProtocolFixture = createCodeBlockFixture('{"tool":"search_knowledge","args":{"query":"历史问题"}}') // Exact legacy Assistant Tool envelope hidden with its wrapper.
const userProtocolFixture = createCodeBlockFixture('{"tool":"search_knowledge","args":{"query":"用户示例"}}') // Exact user-authored example that must remain visible.
const ordinaryAssistantJsonFixture = createCodeBlockFixture('{"tool":"search_knowledge","args":{"query":"普通示例"},"note":"documentation"}') // Similar Assistant JSON with an extra field that is not an internal envelope.
const streamingProtocolFixture = createCodeBlockFixture('{"tool":"search_knowledge","args":{"query":"流式问题"}}') // Live Assistant envelope left to the structured renderer.
const initialSettledReasoning = createReasoningDisclosureFixture({
  text: '先调用 search_knowledge 工具，使用 scope="all_sources"，truncated=false，completeCoverage=true，knowledgeFound 是 true，sourceCount=4，chunkCount=7，rank 1-4:，结果完整程度和结果完整状态字段，answerBoundary，ready 文档，共7个切片。',
  state: 'ok',
  expanded: false
}) // First settled reasoning step must open through the official DisclosureRow control.
const pinnedReasoningScrollport = {
  scrollHeight: 1_000, // Pre-expansion flow height while the reader is exactly pinned to the official bottom floor.
  clientHeight: 300, // Visible conversation viewport height.
  scrollTop: 700, // Current floor: scrollHeight - clientHeight.
  isConnected: true,
} // Plugin expansion must preserve this already-owned bottom-follow state.
initialSettledReasoning.surface.closest = selector => selector === '[data-conversation-scroll]' ? pinnedReasoningScrollport : null
const expandPinnedReasoning = initialSettledReasoning.disclosure.click
initialSettledReasoning.disclosure.click = () => {
  pinnedReasoningScrollport.scrollHeight = 1_200 // Expanding the reasoning row adds dynamic flow height after Harness's first follow write.
  expandPinnedReasoning()
}
const initialStreamingReasoning = createReasoningDisclosureFixture({
  text: '正在调用 search_knowledge，范围是 all_sources。',
  state: 'running',
  expanded: false
}) // First streaming reasoning step follows the same one-time default-open policy.
const awayReasoning = createReasoningDisclosureFixture({
  text: '用户已主动上翻时仍默认展开思考，但不能强制回到底部。',
  state: 'ok',
  expanded: false,
}) // A reader outside the official follow threshold keeps their chosen scroll position.
const awayReasoningScrollport = {
  scrollHeight: 1_000,
  clientHeight: 300,
  scrollTop: 100,
  isConnected: true,
}
awayReasoning.surface.closest = selector => selector === '[data-conversation-scroll]' ? awayReasoningScrollport : null
const expandAwayReasoning = awayReasoning.disclosure.click
awayReasoning.disclosure.click = () => {
  awayReasoningScrollport.scrollHeight = 1_200
  expandAwayReasoning()
}
const alreadyExpandedReasoning = createReasoningDisclosureFixture({
  text: '已经展开的单行思考',
  state: 'ok',
  expanded: true
}) // Existing open state must never be clicked in the opposite direction.
const settledReasoningSurfaces = [initialSettledReasoning.surface, awayReasoning.surface, alreadyExpandedReasoning.surface] // Mutable settled surfaces receive later dynamically inserted rounds.
const streamingReasoningSurfaces = [initialStreamingReasoning.surface] // Current streaming Assistant reasoning roots.
const assistantHistoryMessage = createAssistantMessageFixture({
  paragraphs: [assistantHistoryParagraph, assistantFinalAnswerParagraph],
  codeNodes: [assistantProtocolFixture.code, ordinaryAssistantJsonFixture.code],
  reasoningSurfaces: settledReasoningSurfaces
}) // Settled Assistant row eligible for compatibility cleanup.
const streamingAssistantMessage = createAssistantMessageFixture({
  paragraphs: [streamingAssistantParagraph],
  codeNodes: [streamingProtocolFixture.code],
  reasoningSurfaces: streamingReasoningSurfaces,
  streaming: true
}) // Active Assistant row excluded from historical cleanup.
const assistantMessages = [assistantHistoryMessage, streamingAssistantMessage] // Semantic Assistant wrappers visible to every reconciliation pass.
const reasoningSurfaces = [
  initialSettledReasoning.surface,
  initialStreamingReasoning.surface,
  awayReasoning.surface,
  alreadyExpandedReasoning.surface
] // Page-level official reasoning roots used by default-expansion reconciliation.
let conversationScrollListener = null // Scroll listener installed by the plugin's official conversation follow adapter.
let conversationClickListener = null // Captured official “回到底部” button listener installed by the plugin.
let modalCloseClickListener = null // 只拦截官方弹窗明确的关闭按钮，不接管会话正文点击。
let commandKeyListener = null // 知识指令菜单的捕获阶段按键处理器。
const tableScrollFixture = createElementFixture() // 官方宽表格容器，只校验插件标记与样式，不打开浏览器。
const tableFixture = createElementFixture() // 表格正文不允许被插件替换或重写。
tableFixture.closest = selector => selector === '.md-table-wide' ? tableScrollFixture : null
const commandOptions = ['feedback', 'permission', 'free-search-engine', 'attach', 'model'].map(name => {
  const option = createElementFixture(name) // 每个候选项只提供官方独立的名称 span。
  option.querySelectorAll = selector => selector === 'span' ? [{ get textContent() { return option.textContent } }] : []
  return option
})
let commandMenu = { open: false, hit: null, groups: [], highlight: null } // 测试拥有的官方菜单快照替身。
const commandPicks = [] // 记录官方 pick 收到的原始组名与索引。
const commandController = {
  menu: { getSnapshot: () => commandMenu },
  hover(source, index) { commandMenu = { ...commandMenu, highlight: { source, index } } },
  pick(source, index) { commandPicks.push({ source, index }) },
  dismiss() { commandMenu = { ...commandMenu, open: false } }
} // 自有插件只能调用这些公开方法，不可直接更改测试快照。
const conversationScrollport = {
  scrollHeight: 1_000, // Initial conversation content height.
  clientHeight: 300, // Visible conversation viewport height.
  scrollTop: 700, // Reader starts exactly at the official floor.
  isConnected: true,
  addEventListener(type, listener) {
    if (type === 'scroll') conversationScrollListener = listener
  },
  removeEventListener(type, listener) {
    if (type === 'scroll' && conversationScrollListener === listener) conversationScrollListener = null
  }
} // Assistant completion should continue following this viewport only while the reader remains pinned.
const credentialEvents = new Map() // 原生密码框上的用户输入与浏览器填充事件替身。
const credentialInput = createElementFixture() // 只模拟官方 API 密钥控件，不读取实际 Credentials。
credentialInput.value = 'autofill-decoy' // 代表同源登录管理器误填的合成短值。
let credentialReadOnly = false // 官方密码框当前可编辑状态，模拟 DOM 属性读写。
let credentialReadOnlyWrites = 0 // 每次写入都会被真实 MutationObserver 观察，重复写意味着无限循环。
Object.defineProperty(credentialInput, 'readOnly', {
  get() { return credentialReadOnly },
  set(value) { credentialReadOnly = Boolean(value); credentialReadOnlyWrites += 1 },
})
credentialInput.addEventListener = (type, listener) => credentialEvents.set(type, listener)
let credentialDraftClearEvents = 0 // React 受控输入实际收到的清空事件次数。
credentialInput.dispatchEvent = event => {
  if (event.type === 'input') credentialDraftClearEvents += 1
  credentialEvents.get(event.type)?.(event)
}
const documentBody = {
  addEventListener(type, listener, capture) {
    if (type === 'click' && capture === true) {
      if (listener.name === 'prepareModalClose') modalCloseClickListener = listener
      else conversationClickListener = listener
    }
    if (type === 'keydown' && capture === true) commandKeyListener = listener
  },
  removeEventListener(type, listener, capture) {
    if (type === 'click' && capture === true && conversationClickListener === listener) conversationClickListener = null
    if (type === 'click' && capture === true && modalCloseClickListener === listener) modalCloseClickListener = null
    if (type === 'keydown' && capture === true && commandKeyListener === listener) commandKeyListener = null
  },
  querySelectorAll(selector) {
    if (selector === 'input[type="password"][aria-label="API 密钥"]') return [credentialInput]
    if (selector === '[data-chat-flow-kind="assistant-step"] table') return [tableFixture]
    if (selector === '[data-trigger-menu] [role="option"]') return commandOptions
    if (selector === '[data-chat-flow-kind="assistant-step"]') {
      return assistantMessages
    }
    if (selector === '[data-variant="think"]') {
      return reasoningSurfaces
    }
    if (selector === '[data-conversation-scroll]') {
      return [conversationScrollport]
    }
    if (selector === 'p') {
      return [assistantHistoryParagraph, userExampleParagraph, streamingAssistantParagraph]
    }
    if (selector === 'pre code') {
      return [
        assistantProtocolFixture.code,
        userProtocolFixture.code,
        ordinaryAssistantJsonFixture.code,
        streamingProtocolFixture.code
      ]
    }
    return []
  }
} // Root exposes global paragraph/code fixtures as a regression trap while semantic Assistant queries remain precise.

const modalDialogs = [] // Official mounted dialog candidates used to exercise modal visibility without layout timing.
const postedWindowMessages = [] // 捕获跨 iframe 几何桥接，不记录任何业务文本或凭据。
let mobileViewport = false // 切换手机断点以验证退出意图不能由桌面触发。
const windowListeners = new Map() // 捕获主页面回执，验证关闭握手只恢复官方按钮。
const parentWindow = {
  postMessage(message, targetOrigin) {
    postedWindowMessages.push({ message, targetOrigin })
  }
} // 主应用窗口替身；官方 Client 在生产中只向同源父窗口发送无敏感几何。

const sandbox = {
  console,
  Event: class Event { constructor(type) { this.type = type; this.stopPropagation = () => {} } }, // 原生受控输入清空后向 React 发送的合成输入事件。
  fetch: async (url, options = {}) => {
    throw new Error(`Retired UI must not fetch model or Workspace overrides: ${String(url)}`)
  },
  AbortController: class AbortController {
    constructor() { this.signal = { aborted: false } }
    abort() { this.signal.aborted = true }
  },
  KeyboardEvent: class KeyboardEvent {
    constructor(type, options) { this.type = type; Object.assign(this, options) }
  }, // Escape 回执只重放原生键盘语义，不携带业务字段。
  btoa(value) { return Buffer.from(value, 'binary').toString('base64') }, // Browser base64 substitute for a synthetic, non-user recording.
  clearInterval() {},
  queueMicrotask(callback) {
    callback()
  },
  requestAnimationFrame(callback) {
    const animationFrameId = nextAnimationFrameId // Stable frame identity returned before the deterministic callback completes.
    nextAnimationFrameId += 1
    callback()
    return animationFrameId
  },
  cancelAnimationFrame() {},
  MutationObserver: class MutationObserver {
    constructor(callback) {
      this.callback = callback
    }

    observe(target) { if (target === documentBody) activeMutationObserver = this } // 根只用于发现 chrome 区域；局部观察器不能覆盖本测试触发入口。

    disconnect() {
      if (activeMutationObserver === this) activeMutationObserver = null
    }
  },
  NodeFilter: { SHOW_TEXT: 4 },
  document: {
    head: {
      appendChild(node) {
        installedStyle = node
        node.isConnected = true
      }
    },
    body: documentBody,
    querySelector(selector) {
      return selector.includes('data-adminsmart-style') ? installedStyle : null
    },
    querySelectorAll(selector) {
      if (selector === '[data-conversation-region="composer"],[role="dialog"],[role="menu"],[data-trigger-menu]') return [documentBody] // Fixture 的丰富控件仅模拟确认的 chrome 区域，不作为生产 body fallback。
      if (selector === '[role="dialog"][aria-modal="true"], dialog[open]') return modalDialogs // Official Modal is mounted before layout can report client rectangles.
      return [] // 其它 DOM 搜索没有目标节点；官方侧栏由独立插件测试。
    },
    createElement(tagName) {
      if (tagName !== 'style') throw new Error(`unexpected element creation: ${tagName}`)
      return {
        isConnected: false,
        textContent: '',
        setAttribute() {},
        remove() { this.isConnected = false }
      }
    },
    createTreeWalker(node) {
      const textNodes = Array.isArray(node?.textNodes) ? node.textNodes : [] // Element-local text sequence used by exact marker replacement.
      let nextTextNodeIndex = 0 // Current traversal offset for the minimal TreeWalker contract.
      return {
        nextNode() {
          const nextTextNode = textNodes[nextTextNodeIndex] ?? null // Next mutable text node, or traversal completion.
          nextTextNodeIndex += 1
          return nextTextNode
        }
      }
    }
  },
  window: {
    __ADMINSMART_RUNTIME_ROLE__: 'managed-user', // Host 在 Web boot 前提供的非敏感角色枚举。
    parent: parentWindow,
    location: { origin: 'https://fixture.example' },
    matchMedia() { return { matches: mobileViewport } },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set())
      windowListeners.get(type).add(listener)
    },
    removeEventListener(type, listener) { windowListeners.get(type)?.delete(listener) },
    setTimeout(callback, delay) {
      const timer = { callback, delay, active: true } // 官方 modal 关闭握手的有界计时器；本测试只断言取消状态。
      return timer
    },
    clearTimeout(timer) { timer.active = false },
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration)
      }
    }
  }
} // Minimal browser global; the factory body is not executed during registration validation.
sandbox.globalThis = sandbox.window
vm.runInNewContext(bundleSource, sandbox, { filename: bundlePath.pathname })

if (registrations.length !== 1) throw new Error('AdminSmart client bundle must register exactly once')
const [registration] = registrations
if (registration.id !== '@adminsmart/dsh-client-ui') throw new Error('AdminSmart client bundle id is invalid')
if (typeof registration.factory !== 'function') throw new Error('AdminSmart client bundle factory is missing')
const clientModule = registration.factory((specifier) => {
  if (specifier === 'react/jsx-runtime') {
    const render = (type, props) => ({ type, props })
    return { jsx: render, jsxs: render }
  }
  if (specifier === 'react') {
    return {
      useEffect(callback, dependencies) {
        if (activeHookInstanceId === 'managed-welcome') callback() // Simulate mounting the public onboarding Slot occupant.
      },
      useLayoutEffect(callback) { callback() },
      useMemo(factory) { return factory() },
      useRef(value) {
        if (activeHookInstanceId === null) return { current: value }
        let instanceRefs = hookRefsByInstance.get(activeHookInstanceId) // Ref cells retained for the current simulated component instance.
        if (instanceRefs === undefined) {
          instanceRefs = []
          hookRefsByInstance.set(activeHookInstanceId, instanceRefs)
        }
        const refIndex = activeHookRefIndex // Hook-order position matching React's stable call-order contract.
        activeHookRefIndex += 1
        if (instanceRefs[refIndex] === undefined) instanceRefs[refIndex] = { current: value }
        return instanceRefs[refIndex]
      },
      useState(value) {
        if (activeHookInstanceId === null) return [value, () => {}]
        let cells = hookStatesByInstance.get(activeHookInstanceId) // 当前组件实例的独立状态单元。
        if (!cells) { cells = []; hookStatesByInstance.set(activeHookInstanceId, cells) }
        const stateIndex = activeHookStateIndex++ // 本轮 Hook 顺序定位相同状态单元。
        if (!(stateIndex in cells)) cells[stateIndex] = typeof value === 'function' ? value() : value
        return [cells[stateIndex], nextValue => {
          cells[stateIndex] = typeof nextValue === 'function' ? nextValue(cells[stateIndex]) : nextValue
        }]
      },
      useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() }
    }
  }
  if (specifier === '@deepseek-ai/dsh-client-store') {
    return {
      defineStore(declaration) { return declaration }
    }
  }
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
    const primitive = props => ({ type: 'primitive', props }) // Minimal callable stand-in for official buttons, modals, and glyphs.
    return {
      Button: primitive,
      Input: primitive,
      IconPlusOutlineRegular: primitive,
      IconRefreshOutlineRegular: primitive,
      IconCheckOutlineRegular: primitive,
      IconChecklistOutlineRegular: primitive,
      IconChevronDownOutlineRegular: primitive,
      IconChevronLeftOutlineRegular: primitive,
      IconCloseFillRegular: primitive,
      IconCloseOutlineRegular: primitive,
      IconEditOutlineRegular: primitive,
      IconEllipsisOutlineRegular: primitive,
      IconGlobeOutlineRegular: primitive,
      IconMicrophoneOutlineRegular: primitive,
      IconNewChatOutlineRegular: primitive,
      IconPanelLeftOutlineRegular: primitive,
      IconRefreshOutlineRegular: primitive,
      IconSearchOutlineRegular: primitive,
      IconSettingsOutlineRegular: primitive,
      IconStopFillRegular: primitive,
      IconTrashOutlineRegular: primitive,
      Menu: primitive,
      Modal: primitive
    }
  }
  throw new Error(`unexpected client external: ${specifier}`)
}) // Execute the real lazy-CJS factory with the one platform seed it consumes.
if (!Array.isArray(clientModule.inject) || typeof clientModule.apply !== 'function') {
  throw new Error('AdminSmart client module exports are invalid')
}
if (!packageManifest.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-tool')) {
  throw new Error('AdminSmart client composition must load the official Tool UI package before taking over its public Slots')
}
for (const officialSettingsPackage of ['@adminsmart/dsh-shared-settings', '@deepseek-ai/dsh-client-ui-settings-plugins']) {
  if (!packageManifest.dsh?.client?.inject?.includes(officialSettingsPackage)) {
    throw new Error(`AdminSmart client composition must load ${officialSettingsPackage} for the official custom-plugin tab Slot`)
  }
}
if (JSON.stringify(Array.from(clientModule.inject)) !== JSON.stringify(['slots'])) throw new Error('业务 Client 只依赖必要的官方公开 Slot，不接管官方模型、主题或工作区服务')
const slotRegistrations = [] // Full Slot options and components installed by the client apply lifecycle.
const mobileSidebarToggles = [] // Mobile overlay must invoke the official layout action only.
const consumeRegistration = (value) => {
  if (value && typeof value.next === 'function') {
    for (const disposer of value) void disposer
  }
  return () => {}
}
const fakeContext = {
  inject() {}, // 本目标不装配主题服务，保持公开依赖pending。
  reflect: {
    get(name) { return name === 'pluginNavigation' ? navigationServices.at(-1) : undefined },
    provide(name, service) {
      if (name !== 'pluginNavigation') throw new Error('unexpected client service')
      navigationServices.push(service)
      return () => { navigationServices.pop() }
    },
  },
  layout: {
    toggleSidebar() {},
    closeDetails() {}
  },
  theme: {
    getTheme() { return { preference: 'dark', colorScheme: 'dark' } },
    setTheme(id) {
      if (id !== 'light') throw new Error('AdminSmart client must force the light theme')
    }
  },
  workspaces: {
    list: {
      getSnapshot() { return { phase: 'ready', items: [], archivedSessionIds: [] } },
      subscribe() { return () => {} }
    },
    archiveSession() { return Promise.resolve() }
  },
  sessions: {
    scope() { return {} },
    list: {
      getSnapshot() { return sessionListSnapshot },
      subscribe(listener) { sessionListListeners.add(listener); return () => { sessionListListeners.delete(listener) } }
    },
    create() { return Promise.resolve('new-session') },
    open() {},
    clear() {}
  },
  uiWorkspace: {
    startSession() {},
    connectWorkspace() { return Promise.resolve('existing-session') },
    archiveSession() { return Promise.resolve() }
  },
  layout: {
    toggleSidebar() { mobileSidebarToggles.push(true) }
  },
  conversation: {
    createDraftImages() { return [] },
    releaseDraftImages() {}
  },
  inputTriggers: {
    sessionOf() { return commandController }
  },
  slots: {
    subscribe() { return () => {} }, // Official Slot ledger changes drive the per-user Workspace-view bridge.
    entries(name) { return slotRegistrations.filter(entry => entry.name === name).map(entry => ({ options: entry, component: entry.component })) }, // 模拟公开原始账本以识别过渡期的原生 Models 项。
    entriesOfSlot() { throw new Error('退役适配不得读取或修改官方侧栏 Store') }, // 读写旧 Workspace 状态会立即触发目标回归失败。
    inject(_name, callback) {
      return consumeRegistration(callback())
    },
    register(options, component) {
      slotRegistrations.push({ ...options, component })
      return () => {}
    }
  },
  effect(callback) {
    return callback()
  }
} // Minimal Harness client context exercising slot registration and DOM adapter setup.
clientModule.apply(fakeContext)
await new Promise(resolve => setTimeout(resolve, 0))
if (navigationServices.length !== 1 || typeof navigationServices[0].openBundle !== 'function') throw new Error('Non-admin voice boot must receive a read-only plugin navigation service')
navigationServices[0].openBundle('@deepseek-ai/dsh-experimental-voice-input-bundle')
if (slotRegistrations.some(entry => entry.id === 'plugins')) throw new Error('Non-admin voice dependency must not expose the Plugins launcher')
if (credentialInput.readOnly || credentialInput.value !== 'autofill-decoy' || credentialEvents.size !== 0) throw new Error('官方Credentials输入和事件不得被自有DOM改写')
if (!/const MODAL_OVERLAY_CLOSE_MESSAGE_TYPE\s*=\s*'adminsmart:agent-modal-overlay-close'/u.test(bundleSource)
  || !bundleSource.includes('ResizeObserver')
  || !bundleSource.includes("window.addEventListener?.('resize', scheduleReconcile)")
  || !bundleSource.includes("window.addEventListener?.('message', closeModalFromHost)")) {
  throw new Error('Official modal bridge must support close forwarding and viewport remeasurement')
}
if (!postedWindowMessages.some(({ message }) => message?.type === 'adminsmart:agent-modal-overlay' && message.open === false)) {
  throw new Error('Client must clear the host modal overlay during initial reconciliation when no dialog is visible')
}
const officialModalFixture = {
  querySelectorAll() { return [] }, // 官方模态框只有其局部兼容控件会被枚举，不继承聊天正文 Fake。
  getClientRects() { return [] }, // The first React portal mutation may precede visible layout measurement.
  getBoundingClientRect() { return { left: 250, top: 140, width: 400, height: 260 } }, // Legacy host receives geometry without any form data.
  closest() { return null }, // The official dialog is not inside a hidden or external-search surface.
  contains(target) { return target === officialCloseButton || target === officialEscapeTarget }, // 关闭手势只作用于当前最上层弹窗。
  isConnected: true // 宿主回执到达前弹窗仍然挂载。
} // Same semantic dialog selected from the official Modal portal, without relying on CSS hashes.
let nativeModalCloseClicks = 0 // 原生按钮实际执行次数；准备消息不得提前调用。
const officialCloseButton = {
  isConnected: true, // 回执前按钮保持在当前官方弹窗内。
  textContent: '关闭', // 官方设置弹窗的明确关闭语义。
  getAttribute() { return null }, // 无 aria-label 时使用可见按钮文案。
  closest(selector) { return selector === 'button' ? this : null }, // 捕获阶段从实际点击目标定位按钮。
  click() {
    nativeModalCloseClicks += 1
    modalCloseClickListener?.({ target: this, preventDefault() {}, stopImmediatePropagation() {} }) // 重放不能再次触发握手。
  }
}
let nativeModalEscapeEvents = 0 // 主页面遮罩就绪后，官方 Escape 监听最多收到一次重放。
const officialEscapeTarget = {
  isConnected: true, // 当前官方弹窗内的键盘焦点目标。
  dispatchEvent(event) {
    nativeModalEscapeEvents += 1
    event.target = this
    for (const listener of windowListeners.get('keydown') ?? []) listener(event) // 重放不得触发第二轮关闭准备。
  }
}
modalDialogs.push(officialModalFixture)
activeMutationObserver?.callback()
if (!postedWindowMessages.some(({ message }) => message?.type === 'adminsmart:agent-modal-overlay' && message.open === true)) {
  throw new Error('Mounted official modal must dim the outer shell even before its first visible layout')
}
let legacyCloseIntercepted = false // 旧生产主页面没有新协议能力时，按钮必须保持 Harness 原有时序。
modalCloseClickListener?.({
  target: officialCloseButton,
  preventDefault() { legacyCloseIntercepted = true },
  stopImmediatePropagation() {}
})
if (legacyCloseIntercepted || postedWindowMessages.at(-1)?.message?.type !== 'adminsmart:agent-modal-overlay') {
  throw new Error('A host without explicit close-handshake support must keep the native modal behavior')
}
for (const listener of windowListeners.get('message') ?? []) {
  listener({ source: parentWindow, origin: 'https://fixture.example', data: { type: 'adminsmart:agent-modal-overlay-close-supported' } })
}
let interceptedModalClose = false // 验证捕获阶段阻止原生按钮早于宿主遮罩执行。
modalCloseClickListener?.({
  target: officialCloseButton,
  preventDefault() { interceptedModalClose = true },
  stopImmediatePropagation() {}
})
if (!interceptedModalClose || nativeModalCloseClicks !== 0
  || postedWindowMessages.at(-1)?.message?.type !== 'adminsmart:agent-modal-overlay-prepare-close') {
  throw new Error('Official close button must wait for the full-screen host mask before running')
}
for (const listener of windowListeners.get('message') ?? []) {
  listener({ source: parentWindow, origin: 'https://fixture.example', data: { type: 'adminsmart:agent-modal-overlay-close-ready' } })
}
if (nativeModalCloseClicks !== 1) throw new Error('A trusted host acknowledgement must replay the native close button exactly once')
let interceptedModalEscape = false // Escape 同样必须等待宿主完整遮罩，而非直接卸载 iframe mask。
for (const listener of windowListeners.get('keydown') ?? []) {
  listener({
    key: 'Escape', isComposing: false, target: officialEscapeTarget,
    preventDefault() { interceptedModalEscape = true }, stopImmediatePropagation() {}
  })
}
if (!interceptedModalEscape || nativeModalEscapeEvents !== 0
  || postedWindowMessages.at(-1)?.message?.type !== 'adminsmart:agent-modal-overlay-prepare-close') {
  throw new Error('Escape must wait for the full-screen host mask before reaching Harness')
}
for (const listener of windowListeners.get('message') ?? []) {
  listener({ source: parentWindow, origin: 'https://fixture.example', data: { type: 'adminsmart:agent-modal-overlay-close-ready' } })
}
if (nativeModalEscapeEvents !== 1) throw new Error('A trusted host acknowledgement must replay Escape exactly once')
modalDialogs.pop()
activeMutationObserver?.callback()
if (postedWindowMessages.at(-1)?.message?.open !== false) {
  throw new Error('Removing the official modal must release the host overlay')
}

/** @param {unknown} node JSX 测试树 @returns {object[]} 所有子元素，不挂载 DOM 或执行服务调用。 */
function flattenElements(node) {
  if (Array.isArray(node)) return node.flatMap(flattenElements)
  if (!node || typeof node !== 'object') return []
  return [node, ...flattenElements(node.props?.children)]
}
const sidebarRegistration = slotRegistrations.find(item => item.name === 'sidebar') // 官方 sidebar 应由 Harness 自己注册；自有插件不再替换它。
if (sidebarRegistration !== undefined) throw new Error('AdminSmart must not replace the official sidebar Slot')
if (bundleSource.includes("ctx.slots.inject('sidebar'") || bundleSource.includes("id: 'adminsmart-sidebar'")) {
  throw new Error('AdminSmart must not register a replacement sidebar shell')
}
// 官方 ui-sidebar/ui-workspace/ui-settings 由 Harness 原生契约测试覆盖；旧自定义侧栏测试已移除。
const registeredNames = new Set(slotRegistrations.map(item => item.name))
if (registeredNames.has('conversation.input.left')) throw new Error('输入工具栏使用官方实现，不再插入自有联网开关')
for (const nativeSeat of ['sidebar.workspace', 'shell.overlay']) {
  if (registeredNames.has(nativeSeat)) throw new Error(`官方展示席位不能被自有适配覆盖: ${nativeSeat}`)
}
if (slotRegistrations.some(item => item.name === 'settings.plugins.tab')) {
  throw new Error('插件清单必须由官方 Inventory 注册，不得重建手写自定义目录页')
}
if (slotRegistrations.some(item => item.name === 'settings.models.footer')) {
  throw new Error('The obsolete administrator model-policy footer must not appear in Settings')
}
if (slotRegistrations.some(item => item.name === 'settings.section' && item.id === 'models') || bundleSource.includes('AdminSmartManagedModelsSection') || bundleSource.includes('ADMIN_MODELS_DISCOVER_URL')) {
  throw new Error('Provider CRUD, Key and model discovery must remain exclusively in the official Models page')
}
if (slotRegistrations.some(item => item.name === 'conversation.input.activity')
  || bundleSource.includes('AdminSmartVoiceInput')
  || bundleSource.includes('adminsmart-voice-device-entry')) {
  throw new Error('The official voice Bundle alone must own the microphone and waveform Slot')
}
if (slotRegistrations.some(item => item.name.startsWith('settings.'))) throw new Error('设置、模型和插件入口及内容必须由官方 UI 注册')
if (bundleSource.includes('ADMINSMART_CUSTOM_PLUGIN_CATALOG') || bundleSource.includes('AdminSmartCustomPluginsTab')) {
  throw new Error('手写插件目录与渲染组件必须退役，保持官方清单的真实状态')
}
for (const retiredControl of ['AdminSmartModelConfiguration', 'AdminSmartModelPolicyFooter', 'MODEL_CONFIGURATION_URL', 'MODEL_DEFAULTS_URL', 'MODEL_PREFERENCE_URL', 'installModelSelectionRepair', 'installUserWorkspaceView', 'data-adminsmart-settings-part']) {
  if (bundleSource.includes(retiredControl)) throw new Error(`已退役 UI 不能继续覆盖官方实现: ${retiredControl}`)
}
if (bundleSource.includes('workspace/cleanup') || bundleSource.includes('adminsmart-workspace-cleanup')) {
  throw new Error('Legacy workspace cleanup UI and route must be removed')
}
for (const nativeSeat of ['tool.call.toolview', 'details', 'conversation.session.header']) {
  if (registeredNames.has(nativeSeat)) throw new Error(`Conversation presentation must remain native: ${nativeSeat}`)
}
const titleVisibilityRule = '[data-slot="conversation.session.header"]' // 官方 Header 由 Harness 原生渲染，自有样式不得隐藏它。
if (installedStyle?.textContent.includes(titleVisibilityRule) || slotRegistrations.some(item => item.name === 'conversation.session.header.corner')) throw new Error('官方 Session Header 和详情入口必须保持原生')
if (bundleSource.includes("ctx.theme.setTheme('light')")) throw new Error('An administrator theme must not be reset during Client startup')
if (slotRegistrations.some(item => item.name === 'conversation.chat.node')) throw new Error('系统节点、正文和工具继续由官方原样呈现')
const brandMark = slotRegistrations.find(item => item.name === 'sidebar.brand.mark') // 只允许已授权的品牌内容，不替换原生侧栏。
const brandName = slotRegistrations.find(item => item.name === 'sidebar.brand.name') // 文字继承官方父节点排版。
const heroBrandMark = slotRegistrations.find(item => item.name === 'conversation.hero.brand.mark') // 空会话标志通过官方独立品牌孔接入，不复制Hero。
if (!brandMark || !brandName || !heroBrandMark || brandMark.priority !== -1 || brandName.priority !== -1 || heroBrandMark.priority !== -1) throw new Error('品牌必须只使用3个公开品牌席位')
const renderedMark = brandMark.component({ size: 32 }) // 品牌图形明确为空，合法Slot登记继续压住官方fallback。
const heroAnchor = renderHookComponent('hero-presentation-anchor', heroBrandMark.component, { size: 34 }) // 生命周期协议Fixture只验证登记与隐藏ref；真实effect由原始Hero+JSDOM回归覆盖。
if (renderedMark !== null || heroAnchor.type !== 'span' || heroAnchor.props.hidden !== true || heroAnchor.props['aria-hidden'] !== 'true' || heroAnchor.props['data-adminsmart-hero-presentation'] !== 'v1') throw new Error('侧栏必须为空，Hero只允许无可见图形的隐藏语义锚点')
if (brandName.component({}).props.children !== 'AuraSearch') throw new Error('品牌名称不一致')
if (initialSettledReasoning.clickCount() !== 0 || initialStreamingReasoning.clickCount() !== 0) {
  throw new Error('The plugin must never auto-expand official reasoning disclosures')
}
if (assistantHistoryParagraph.textContent !== '历史答案</think>保留正文'
  || assistantProtocolFixture.container.style.getPropertyValue('display') === 'none'
  || !initialSettledReasoning.surface.textContent.includes('search_knowledge')) {
  throw new Error('Assistant text, prompts and tool output must not be hidden or rewritten by the UI plugin')
}
if (conversationScrollListener !== null || conversationClickListener !== null) {
  throw new Error('The official conversation must own scrolling without extra plugin listeners')
}
if (bundleSource.includes('JSON.parse(codeText)')) {
  throw new Error('Historical DOM compatibility must not parse business Tool JSON')
}
if (bundleSource.includes('function AdminSmartSidebar(')
  || bundleSource.includes('function AdminSmartHistoryRow(')
  || bundleSource.includes('function searchSessionHistory(')
  || bundleSource.includes('.adminsmart-search__dialog')) {
  throw new Error('The unused custom sidebar and search dialog must stay removed')
}
if (/SESSION_WEB_ACCESS|adminsmart-web-toggle|AdminSmartComposerTools/u.test(bundleSource)) {
  throw new Error('退役联网开关不得继续装配或影响官方工具可用性')
}
if (bundleSource.includes('INTERNAL_RUNTIME_WORKSPACE_TITLE') || bundleSource.includes('ctx.uiWorkspace.openSession(sessionId)')) throw new Error('官方工作区导航不得由业务 Client 自动改选')
if (
  bundleSource.includes('KnowledgeScopeSelector')
  || bundleSource.includes('KNOWLEDGE_SCOPE_URL')
  || bundleSource.includes("className: 'adminsmart-knowledge-popover'")
) {
  throw new Error('Official query API has no document scope filter, so the composer must not expose a knowledge-range selector')
}
if (
  bundleSource.includes("accept: 'image/png,image/jpeg,image/webp,image/gif'")
  || bundleSource.includes('createDraftImages(selectedFiles)')
  || bundleSource.includes('inputActions.addImages(draftImages.map(image => image.id))')
  || bundleSource.includes('dsh-file-resource')
  || bundleSource.includes('read_uploaded_resource')
  || bundleSource.includes('requestKnowledgeUpload')
  || bundleSource.includes('上传知识文件')
) {
  throw new Error('AdminSmart client must leave generic Session file intake to the native Harness composer')
}
navigationServices.pop()
sandbox.window.__ADMINSMART_RUNTIME_ROLE__ = 'admin'
clientModule.apply(fakeContext)
await new Promise(resolve => setTimeout(resolve, 0))
if (navigationServices.length !== 0) throw new Error('Administrator must retain the official plugin navigation service')
process.stdout.write('client_bundle_contract=ok\n')
