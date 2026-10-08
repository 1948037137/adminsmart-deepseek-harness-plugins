/** Verify the authored browser bundle registers the exact Harness client-module contract. */

import { readFileSync, statSync } from 'node:fs'
import vm from 'node:vm'

const bundlePath = new URL('../lib/client.js', import.meta.url) // Package-relative browser bundle under test.
const bundleSource = readFileSync(bundlePath, 'utf8') // Authored source is also checked for public Harness slot-field compatibility.
const packagePath = new URL('../package.json', import.meta.url) // Client composition manifest declaring shipped Harness dependencies.
const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8')) // Parsed plugin manifest used to pin official Tool UI load order.
const logoPath = new URL('../assets/aurasearch-logo.jpg', import.meta.url) // Operator-approved AuraSearch artwork published by the Host plugin.
const logoSize = statSync(logoPath).size // Non-empty binary asset contract without decoding or rewriting the supplied artwork.
if (logoSize < 1024) throw new Error('AuraSearch logo asset is missing or unexpectedly empty')
const registrations = [] // Captured __ModuleLoader__.load handoffs.
let installedStyle = null // Minimal document-owned style node created by the real Client apply lifecycle.
let activeMutationObserver = null // Observer installed by the real Client apply lifecycle for dynamic Chat insertions.
let nextAnimationFrameId = 1 // Deterministic requestAnimationFrame identity for deferred official layout and disclosure actions.
const hookRefsByInstance = new Map() // Minimal per-component-instance React ref storage for one-time Turn-process initialization tests.
const hookStatesByInstance = new Map() // 保留测试组件的真实 useState 更新，验证全选和取消全选交互。
let activeHookInstanceId = null // Component instance currently rendered through the isolated hook fixture.
let activeHookRefIndex = 0 // `useRef` call offset inside the current isolated component render.
let activeHookStateIndex = 0 // 当前组件 useState 调用序号，与 useRef 分别维护。
let modelConfigurationMount = null // 隔离执行模型用途面板的目录读取 effect。
let providerAccessMount = null // 模拟官方卡片仅在管理员私有 Provider 授权成功后显示入口。
let selectedFixtureEffort = '' // 合成后端确认的逐模型默认等级。
let fixtureModelConfigurationPutError = '' // 模拟 Host 拒绝写入的稳定错误，不调用真实后端。
let fixtureModelConfigurationReadError = '' // 模拟写入后的权威 GET 故障，验证不能把 PUT 草稿当成已确认状态。
let modelConfigurationInterceptor = null // 目标测试专用的可控延迟响应，用于卸载、旧响应失效和同步防重验证。
let fixtureHarnessDefault = false // 当前模型是否已成为新会话兜底项，已生效按钮应隐藏。
let fixtureReasoningEfforts = { high: 'reasoning-high' } // 已保存的非同名供应商线值必须原样保留；可切到空目录验证首次配置。
let fixtureNewModelAdded = false // 官方 Provider 设置保存后新增的第二个模型；同一页面必须立即展示。
let fixtureNewModelPublished = false // 后台受管发布完成之前，新模型行仍需一次有界重读。
const pendingModelSyncTimers = [] // 离线捕获面板的短期重读定时器，不依赖真实等待或浏览器。
const modelConfigurationWrites = [] // 捕获模型用途动作，不访问真实后端或凭据。
const modelConfigurationRequests = [] // 捕获每次动作和权威重读的取消信号与方法，验证顺序及作用域。
const modelDefaultsFixture = [{ provider: 'provider-gpt', model: 'gpt-6-sol', effort: 'high' }] // 第二个同 Provider 模型的专属默认档位。
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
const workspaceDeleteMenuItem = createElementFixture('删除工作区') // 官方 Workspace 菜单 portal 中唯一的破坏性行。
workspaceDeleteMenuItem.hidden = false
workspaceDeleteMenuItem.disabled = false
const workspaceMenuItems = [workspaceDeleteMenuItem] // 模拟同一 DOM 节点在 React 更新后被复用为其它菜单动作。
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
    if (selector === '[role="menuitem"]') return workspaceMenuItems // 官方菜单通过 portal 进入 body，不属于工作区行的子节点。
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

const modelPreferenceWrites = [] // Current user's explicit model selections reaching the Host persistence route.
const workspaceViewWrites = [] // Per-user official sidebar snapshots accepted by the isolated Host fake.
const persistedWorkspaceView = { groupBy: 'flat', orderBy: 'manual', archivedFilter: 'show', groupExpansion: { fixture: true }, sessionOrderByAccount: { fixture: ['existing-session'] } } // Server-side view for this fixture user.
let workspaceViewSnapshot = { groupBy: 'workspace', orderBy: 'updated', archivedFilter: 'default', groupExpansion: {}, sessionOrderByAccount: {} } // Official Store before Host hydration.
const workspaceViewListeners = new Set() // Official view Store subscriptions installed after the authoritative GET.
const workspaceViewInstance = {
  getSnapshot: () => workspaceViewSnapshot,
  subscribe(listener) { workspaceViewListeners.add(listener); return () => workspaceViewListeners.delete(listener) },
  store: { set(value) { workspaceViewSnapshot = value; for (const listener of workspaceViewListeners) listener() } },
} // Shared official Store instance reached through the public sidebar Slot registration.
const workspaceViewHandle = { spec: { init: () => ({ groupBy: 'workspace', orderBy: 'updated', archivedFilter: 'default', groupExpansion: {}, sessionOrderByAccount: {} }) }, create: () => workspaceViewInstance } // Native registration contract.
const sandbox = {
  console,
  Event: class Event { constructor(type) { this.type = type; this.stopPropagation = () => {} } }, // 原生受控输入清空后向 React 发送的合成输入事件。
  fetch: async (url, options = {}) => {
    if (String(url) === './adminsmart/workspace-view') {
      if (options.method === 'PUT') workspaceViewWrites.push(JSON.parse(String(options.body)).view)
      return { ok: true, json: async () => ({ view: options.method === 'PUT' ? workspaceViewWrites.at(-1) : persistedWorkspaceView }) }
    }
    if (String(url).startsWith('./adminsmart/private-model-reasoning')) return { ok: true, json: async () => ({ models: [{ id: 'fixture-model' }] }) } // 私有已保存模型的只读授权替身。
    if (String(url) === './adminsmart/model-defaults') return { ok: true, json: async () => ({ defaults: modelDefaultsFixture }) } // 普通用户只读取公开模型身份与默认档位。
    if (String(url).startsWith('./adminsmart/model-configuration')) {
      const requestRecord = { url: String(url), method: options.method ?? 'GET', signal: options.signal } // 当前离线请求的身份、方法和取消边界。
      modelConfigurationRequests.push(requestRecord)
      if (modelConfigurationInterceptor) {
        const intercepted = modelConfigurationInterceptor(url, options) // 返回 undefined 时仍使用正常假后端，否则接管一次可控响应。
        if (intercepted !== undefined) return intercepted
      }
      if (options.method !== 'PUT' && fixtureModelConfigurationReadError) return { ok: false, json: async () => ({ error: fixtureModelConfigurationReadError }) }
      if (options.method === 'PUT') {
        const body = JSON.parse(String(options.body || '{}')) // 当前 Provider 下明确提交的模型用途动作。
        modelConfigurationWrites.push(body)
        if (fixtureModelConfigurationPutError) return { ok: false, json: async () => ({ error: fixtureModelConfigurationPutError }) }
        if (body.action === 'efforts') {
          fixtureReasoningEfforts = Object.fromEntries(body.reasoningEfforts.map(level => [level, fixtureReasoningEfforts[level] ?? level])) // 多选只切换所选集合，已有供应商线值不能被同名默认值覆盖。
          selectedFixtureEffort = body.reasoningEfforts.includes(selectedFixtureEffort) ? selectedFixtureEffort : body.reasoningEfforts[0] ?? '' // 假后端确认的初始等级始终属于已选集合。
        }
        if (body.action === 'harness') fixtureHarnessDefault = true
      }
      return { ok: true, json: async () => ({ models: [{
        id: 'fixture-model', name: 'Fixture GPT Model', reasoningEfforts: { ...fixtureReasoningEfforts },
        managedPublished: true,
        defaultReasoningEffort: selectedFixtureEffort, isHarnessDefault: fixtureHarnessDefault,
      }, ...(fixtureNewModelAdded ? [{
        id: 'fixture-added-model', name: 'Fixture Added Model', reasoningEfforts: { low: 'low', off: 'none' },
        managedPublished: fixtureNewModelPublished,
        defaultReasoningEffort: 'low', isHarnessDefault: false, isKnowledgeModel: false,
      }] : [])] }) }
    }
    if (String(url) !== './adminsmart/model-preference') throw new Error(`unexpected fetch: ${String(url)}`)
    const selection = options.method === 'PUT' ? JSON.parse(String(options.body || '{}')).selection : null // 默认无历史偏好，PUT 原样确认公开选择。
    if (selection) modelPreferenceWrites.push(selection)
    return { ok: true, json: async () => ({ selection }) }
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
      activeMutationObserver = this
    }

    observe() {}

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
      const timer = { callback, delay, active: true } // 官方保存后的有界 GET 重读任务，测试手动推进。
      pendingModelSyncTimers.push(timer)
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
        if (activeHookInstanceId === 'model-configuration') modelConfigurationMount = callback // 仅测试当前供应商用途面板的目录加载。
        if (activeHookInstanceId === 'model-provider-card') providerAccessMount = callback // 卡片授权只读检查不执行其它组件 effect。
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
if (!clientModule.inject.includes('theme')) throw new Error('AdminSmart client module must wait for the official theme service')
if (clientModule.inject.includes('remote') || packageManifest.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes')) {
  throw new Error('The UI adapter must leave the official voice Bundle and Speech Remote lifecycle untouched')
}
if (!clientModule.inject.includes('layout')) throw new Error('AdminSmart client module must use the official layout service')
if (!clientModule.inject.includes('inputTriggers')
  || !packageManifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-input-trigger')) {
  throw new Error('Knowledge command adaptation must declare the official input-trigger service and loader dependency')
}
if (!clientModule.inject.includes('modelDirectories')
  || !packageManifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-model-selection')) {
  throw new Error('Stale Session model repair must use the official model-selection service and loader dependency')
}
if (!bundleSource.includes("const MODEL_PREFERENCE_URL = './adminsmart/model-preference'")
  || !bundleSource.includes('const shouldInheritPreference = blankSession && !inheritanceEvaluated')
  || !bundleSource.includes('await persistPreference(sessionId, state.current)')) {
  throw new Error('New blank Sessions must inherit the last explicit valid model and persist later user changes')
}
const slotRegistrations = [] // Full Slot options and components installed by the client apply lifecycle.
const mobileSidebarToggles = [] // Mobile overlay must invoke the official layout action only.
const consumeRegistration = (value) => {
  if (value && typeof value.next === 'function') {
    for (const disposer of value) void disposer
  }
  return () => {}
}
const modelSelectionRepairs = [] // Official directory.select calls made only for stale model or reasoning memory.
const modelDirectoryListeners = new Set() // ModelDirectory store subscribers notified after simulated Host projection changes.
const sessionListListeners = new Set() // 官方 Session 列表订阅在主视图切换时通知模型偏好绑定。
let sessionListSnapshot = {
  phase: 'ready', // 列表已经收到 Host 基线。
  ids: ['existing-session'], // 当前可见的普通 Session 身份。
  byId: { 'existing-session': { id: 'existing-session', blank: false, retainedBy: { mainView: 1 } } } // 官方主视图引用，不伪造 current 字段。
} // 与固定 Harness SessionListState 一致的最小快照。
let modelDirectoryLoadCount = 0 // Initial loading state may call load once; repeated ready-state loads indicate a feedback loop.
let modelDirectoryState = {
  current: {
    provider: 'adminsmart-models', // Removed legacy Provider remembered by the Session projection.
    model: 'mimo-v2.5', // Removed model that must not remain selected after catalog refresh.
    reasoningEffort: 'max' // Stale reasoning memory is discarded together with the removed model.
  },
  routable: false,
  groups: [{
    id: 'provider-gpt', // Current AdminSmart dynamic Provider route.
    models: [{
      id: 'gpt-5.6-sol', // Current first available model.
      name: 'GPT-5.6 Sol', // User-visible model name.
      reasoning: {
        efforts: [{ id: 'low', name: 'Low' }] // Current model only exposes Low in this isolated repair fixture.
      }
    }]
  }],
  failures: [],
  status: 'loading',
  error: null
} // Initial directory snapshot reproduces a Session remembering a deleted legacy model.
const fakeModelDirectory = {
  store: {
    getSnapshot() { return modelDirectoryState },
    subscribe(listener) {
      modelDirectoryListeners.add(listener)
      return () => { modelDirectoryListeners.delete(listener) }
    }
  },
  load() {
    modelDirectoryLoadCount += 1
    modelDirectoryState = { ...modelDirectoryState, status: 'ready' }
    for (const listener of modelDirectoryListeners) listener()
    return Promise.resolve(modelDirectoryState)
  },
  select(selection) {
    modelSelectionRepairs.push({ ...selection })
    modelDirectoryState = {
      ...modelDirectoryState,
      current: { ...selection },
      routable: true,
      status: 'ready',
      error: null
    }
    for (const listener of modelDirectoryListeners) listener()
    return Promise.resolve()
  }
} // Minimal official ModelDirectory face used by the AdminSmart repair effect.
const fakeContext = {
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
  modelDirectories: {
    directoryFor(sessionId) {
      if (!['existing-session', 'new-blank-session'].includes(sessionId)) throw new Error('unexpected Session model directory request')
      return fakeModelDirectory
    }
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
    entriesOfSlot(name) { return name === 'sidebar.workspaces' ? [{ store: workspaceViewHandle }] : [] }, // Real public Store seat, not a DOM proxy.
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
if (JSON.stringify(workspaceViewSnapshot) !== JSON.stringify(persistedWorkspaceView)) throw new Error('The official sidebar Store must hydrate from this user Host state')
workspaceViewInstance.store.set({ ...workspaceViewSnapshot, groupBy: 'workspace-tree' })
await new Promise(resolve => setTimeout(resolve, 0))
if (workspaceViewWrites.at(-1)?.groupBy !== 'workspace-tree') throw new Error('Native sidebar changes must persist to this user Host state')
if (!credentialInput.readOnly || credentialInput.value !== ''
  || credentialInput.getAttribute('autocomplete') !== 'new-password' || credentialDraftClearEvents < 1) {
  throw new Error('A newly mounted official API Key field must not retain an unsolicited autofill value')
}
const initialReadOnlyWrites = credentialReadOnlyWrites // 初次挂载只需锁定一次；后续属性观察不应再次写同一状态。
for (let repeat = 0; repeat < 3; repeat += 1) activeMutationObserver?.callback()
if (credentialReadOnlyWrites !== initialReadOnlyWrites) {
  throw new Error('Credential guard must not trigger an endless MutationObserver loop after opening the editor')
}
credentialInput.value = 'another-autofill-decoy'
let blockedAutofill = false // 自动填充事件不得传播到官方 React 的受控 Key 草稿。
credentialEvents.get('input')?.({ stopPropagation() { blockedAutofill = true } })
if (!blockedAutofill || credentialInput.value !== '') throw new Error('Automatic Key input must be ignored before a user edits the field')
credentialEvents.get('pointerdown')?.()
credentialInput.value = 'fixture-user-key'
activeMutationObserver?.callback()
if (credentialInput.readOnly || credentialInput.value !== 'fixture-user-key') {
  throw new Error('An explicitly edited Key must remain available to the native Harness credential form')
}
if (!workspaceDeleteMenuItem.hidden || !workspaceDeleteMenuItem.disabled
  || workspaceDeleteMenuItem.getAttribute('aria-hidden') !== 'true'
  || workspaceDeleteMenuItem.getAttribute('tabindex') !== '-1'
  || workspaceDeleteMenuItem.style.getPropertyValue('display') !== 'none') {
  throw new Error('Internal Workspace deletion must be absent from the official portaled menu and keyboard walk')
}
workspaceDeleteMenuItem.textContent = '重命名'
activeMutationObserver?.callback()
if (workspaceDeleteMenuItem.hidden || workspaceDeleteMenuItem.disabled
  || workspaceDeleteMenuItem.getAttribute('data-adminsmart-hidden-workspace-delete') !== null
  || workspaceDeleteMenuItem.style.getPropertyValue('display') !== '') {
  throw new Error('A reused non-destructive Workspace action must regain its original UI state')
}
if (!bundleSource.includes("const MODAL_OVERLAY_CLOSE_MESSAGE_TYPE = 'adminsmart:agent-modal-overlay-close'")
  || !bundleSource.includes('ResizeObserver')
  || !bundleSource.includes("window.addEventListener?.('resize', reconcile)")
  || !bundleSource.includes("window.addEventListener?.('message', closeModalFromHost)")) {
  throw new Error('Official modal bridge must support close forwarding and viewport remeasurement')
}
if (!postedWindowMessages.some(({ message }) => message?.type === 'adminsmart:agent-modal-overlay' && message.open === false)) {
  throw new Error('Client must clear the host modal overlay during initial reconciliation when no dialog is visible')
}
const officialModalFixture = {
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

const settingsTitleFixture = createElementFixture('设置') // 只读的原生导航标题，不包含配置或用户字段。
const settingsTabsFixture = createElementFixture() // 原生导航命令的容器，测试不替换其事件。
const settingsHeaderFixture = createElementFixture() // 原生打开配置文件和关闭工具栏。
const settingsContentFixture = createElementFixture() // 原生设置正文，标记过程不得读取其字段值。
const settingsNavigationFixture = createElementFixture() // 固定版原生 NAV 的两区语义结构。
settingsNavigationFixture.tagName = 'NAV'
settingsNavigationFixture.children = [settingsTitleFixture, settingsTabsFixture]
const settingsPaneFixture = createElementFixture() // 保留原生标题工具和内容，布局只由自有样式接管。
settingsPaneFixture.tagName = 'DIV'
settingsPaneFixture.children = [settingsHeaderFixture, settingsContentFixture]
const settingsDialogFixture = createElementFixture() // 离线模拟官方已经挂载的 SettingsPanel。
settingsDialogFixture.children = [settingsNavigationFixture, settingsPaneFixture]
settingsDialogFixture.getBoundingClientRect = () => ({ left: 12, top: 12, width: 366, height: 820 })
const settingsParts = [settingsNavigationFixture, settingsTitleFixture, settingsTabsFixture, settingsPaneFixture, settingsHeaderFixture, settingsContentFixture] // 只枚举预期布局标记节点。
settingsDialogFixture.querySelectorAll = selector => selector === '[data-adminsmart-settings-part]' ? settingsParts.filter(part => part.hasAttribute('data-adminsmart-settings-part')) : []
let settingsMarkerWrites = 0 // 相同布局重复观察不得写属性，避免观察器自触发。
for (const part of [settingsDialogFixture, ...settingsParts]) {
  const originalSetAttribute = part.setAttribute.bind(part) // 保留 Fixture 属性行为，只记录实际写次数。
  part.setAttribute = (name, value) => { settingsMarkerWrites += 1; originalSetAttribute(name, value) }
}
modalDialogs.push(settingsDialogFixture)
activeMutationObserver?.callback()
if (settingsDialogFixture.getAttribute('data-adminsmart-settings-dialog') !== 'true'
  || settingsTabsFixture.getAttribute('data-adminsmart-settings-part') !== 'tabs'
  || settingsContentFixture.getAttribute('data-adminsmart-settings-part') !== 'content') {
  throw new Error('原生设置必须通过精确标题和导航结构获得自有手机布局标记')
}
const initialSettingsMarkerWrites = settingsMarkerWrites // 首次识别后已经写入的标记数量。
activeMutationObserver?.callback()
if (settingsMarkerWrites !== initialSettingsMarkerWrites) throw new Error('重复观察不能重复写设置布局属性')
settingsTitleFixture.textContent = '文档预览'
activeMutationObserver?.callback()
if (settingsDialogFixture.hasAttribute('data-adminsmart-settings-dialog') || settingsParts.some(part => part.hasAttribute('data-adminsmart-settings-part'))) {
  throw new Error('非设置弹窗不能继承手机设置布局')
}
settingsTitleFixture.textContent = 'Settings'
activeMutationObserver?.callback()
if (!settingsDialogFixture.hasAttribute('data-adminsmart-settings-dialog')) throw new Error('英文原生设置也必须使用相同语义布局适配')
modalDialogs.pop()
activeMutationObserver?.callback()
if (!installedStyle?.textContent.includes('[data-adminsmart-settings-part="tabs"]')
  || !installedStyle.textContent.includes('grid-template-columns: minmax(0, 1fr) !important;')) {
  throw new Error('手机设置必须通过自有标记提供整行导航和内容区域')
}
if (!/\[data-adminsmart-mobile-sidebar-overlay\]\s*\{\s*display: none;/.test(installedStyle.textContent)
  || !/\[data-adminsmart-mobile-sidebar-overlay\]\s*\{\s*display: block;/.test(installedStyle.textContent)) {
  throw new Error('手机侧栏浮层必须在桌面隐藏，仅在手机媒体范围展示')
}
if (modelDirectoryLoadCount !== 1) {
  throw new Error('Model selection repair must not reload an already-ready directory through its own subscription')
}
if (JSON.stringify(modelSelectionRepairs[0]) !== JSON.stringify({ provider: 'provider-gpt', model: 'gpt-5.6-sol', reasoningEffort: 'low' })) {
  throw new Error('A Session remembering a deleted model must select the first current model through ModelDirectory')
}
modelDirectoryState = {
  ...modelDirectoryState,
  current: {
    provider: 'provider-gpt',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'max'
  },
  routable: true
} // Same valid model with a removed historical reasoning level.
for (const listener of modelDirectoryListeners) listener()
await new Promise(resolve => setTimeout(resolve, 0))
if (JSON.stringify(modelSelectionRepairs[1]) !== JSON.stringify({ provider: 'provider-gpt', model: 'gpt-5.6-sol', reasoningEffort: 'low' })) {
  throw new Error('A removed reasoning level must select a currently configured effort')
}
modelDirectoryState = { ...modelDirectoryState, current: { provider: 'provider-gpt', model: 'gpt-5.6-sol' } }
for (const listener of modelDirectoryListeners) listener()
await new Promise(resolve => setTimeout(resolve, 0))
if (modelSelectionRepairs[2]?.reasoningEffort !== 'low') throw new Error('An unselected effort must choose a configured level')
for (const listener of modelDirectoryListeners) listener()
await new Promise(resolve => setTimeout(resolve, 0))
if (modelSelectionRepairs.length !== 3) throw new Error('A valid remembered effort must not be overwritten')
modelDirectoryState = {
  ...modelDirectoryState,
  groups: [{ ...modelDirectoryState.groups[0], models: [
    ...modelDirectoryState.groups[0].models,
    { id: 'gpt-6-sol', name: 'GPT-6 Sol', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
  ] }],
  current: { provider: 'provider-gpt', model: 'gpt-6-sol', reasoningEffort: 'low' },
} // 官方选择器切到同一 Provider 下另一模型时，Provider 默认 low 不应覆盖该模型配置的 high。
for (const listener of modelDirectoryListeners) listener()
await new Promise(resolve => setTimeout(resolve, 0))
if (modelSelectionRepairs[3]?.model !== 'gpt-6-sol' || modelSelectionRepairs[3]?.reasoningEffort !== 'high') {
  throw new Error('Switching models must apply the selected model-specific default through ModelDirectory')
}
modelDirectoryState = { ...modelDirectoryState, current: { provider: 'provider-gpt', model: 'gpt-6-sol', reasoningEffort: 'low' } } // 同模型下用户主动改档位。
for (const listener of modelDirectoryListeners) listener()
await new Promise(resolve => setTimeout(resolve, 0))
if (modelSelectionRepairs.length !== 4) throw new Error('A manual effort selection must not be overwritten by the model default')
modelDirectoryState = { ...modelDirectoryState, status: 'selecting' } // Official picker announces a user operation before the new projection arrives.
for (const listener of modelDirectoryListeners) listener()
modelDirectoryState = { ...modelDirectoryState, status: 'ready', current: { provider: 'provider-gpt', model: 'gpt-6-sol', reasoningEffort: 'high' } }
for (const listener of modelDirectoryListeners) listener()
await new Promise(resolve => setTimeout(resolve, 0))
if (!modelPreferenceWrites.some(selection => selection.model === 'gpt-6-sol' && selection.reasoningEffort === 'high')) {
  throw new Error('A real picker selection must persist for the current user after the official selecting/ready lifecycle')
}
modelDirectoryState = { ...modelDirectoryState, current: { provider: 'provider-gpt', model: 'gpt-6-sol', reasoningEffort: 'low' } } // Fixed Harness builds may publish a manual choice directly as ready.
for (const listener of modelDirectoryListeners) listener()
await new Promise(resolve => setTimeout(resolve, 0))
if (!modelPreferenceWrites.some(selection => selection.model === 'gpt-6-sol' && selection.reasoningEffort === 'low')) {
  throw new Error('A ready-only official selection must persist even when no selecting snapshot is emitted')
}
modelDirectoryState = {
  ...modelDirectoryState,
  status: 'selecting',
  groups: [{ ...modelDirectoryState.groups[0], models: modelDirectoryState.groups[0].models.map(model => model.id === 'gpt-6-sol'
    ? { ...model, reasoning: { efforts: [...model.reasoning.efforts, { id: 'max', name: 'Max' }] } }
    : model) }]
} // 当前模型公开 Max 档位，用户准备在官方选择器中提交。
for (const listener of modelDirectoryListeners) listener()
modelDirectoryState = { ...modelDirectoryState, status: 'ready', current: { provider: 'provider-gpt', model: 'gpt-6-sol', reasoningEffort: 'max' } }
for (const listener of modelDirectoryListeners) listener()
await new Promise(resolve => setTimeout(resolve, 0))
if (modelPreferenceWrites.at(-1)?.reasoningEffort !== 'max') throw new Error('Max must be saved as the user preference before a new Session starts')
modelDirectoryState = { ...modelDirectoryState, current: { provider: 'provider-gpt', model: 'gpt-6-sol' } } // 新空会话由 Host 初始化为 Provider Default。
sessionListSnapshot = {
  phase: 'ready',
  ids: ['new-blank-session', 'existing-session'],
  byId: {
    'new-blank-session': { id: 'new-blank-session', blank: true, retainedBy: { mainView: 1 } }, // 新会话须继承 Max。
    'existing-session': { id: 'existing-session', blank: false, retainedBy: { mainView: 0 } } // 历史会话不再占据主视图。
  }
}
for (const listener of sessionListListeners) listener()
await new Promise(resolve => setTimeout(resolve, 0))
if (modelSelectionRepairs.at(-1)?.reasoningEffort !== 'max' || modelDirectoryState.current?.reasoningEffort !== 'max') {
  throw new Error('A new blank Session must inherit the last explicit Max through the official ModelDirectory')
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
if (!slotRegistrations.some(item => item.name === 'shell.overlay' && item.id === 'adminsmart-mobile-sidebar')) {
  throw new Error('Mobile navigation must extend the official shell.overlay Slot')
}
const mobileSidebarRegistration = slotRegistrations.find(item => item.name === 'shell.overlay' && item.id === 'adminsmart-mobile-sidebar') // Public overlay renders only the opener and backdrop.
const mobileSidebarSeat = mobileSidebarRegistration.component({}) // The Slot wrapper injects the public layout action.
const mobileSidebarOverlay = renderHookComponent('mobile-sidebar', mobileSidebarSeat.type, mobileSidebarSeat.props)
if (mobileSidebarOverlay.props.children.length !== 3
  || mobileSidebarOverlay.props.children[0].props['aria-label'] !== '打开侧边栏'
  || mobileSidebarOverlay.props.children[1].props['aria-label'] !== '关闭侧边栏'
  || mobileSidebarOverlay.props.children[2].props['aria-label'] !== '退出登录') {
  throw new Error('Mobile sidebar overlay lost its accessible open and close controls')
}
mobileSidebarOverlay.props.children[0].props.onClick()
mobileSidebarOverlay.props.children[1].props.onClick()
if (mobileSidebarToggles.length !== 2) throw new Error('Mobile sidebar must use the official layout toggle')
const mobileLogout = mobileSidebarOverlay.props.children[2] // 自有按钮只通知宿主，不调用认证 API。
const logoutMessageCount = () => postedWindowMessages.filter(item => item.message.type === 'adminsmart:agent-logout-request').length // 只计退出意图，不混入其它浮层消息。
const initialLogoutCount = logoutMessageCount() // 桌面点击前的消息基线。
mobileLogout.props.onClick()
if (logoutMessageCount() !== initialLogoutCount) throw new Error('Desktop must not send mobile logout requests')
mobileViewport = true
mobileLogout.props.onClick()
mobileLogout.props.onClick()
if (logoutMessageCount() !== initialLogoutCount + 1) throw new Error('Repeated mobile clicks must send only one logout request')
const logoutMessage = postedWindowMessages.find(item => item.message.type === 'adminsmart:agent-logout-request') // 退出正文不能包含身份、凭据或任意导航地址。
if (logoutMessage.targetOrigin !== 'https://fixture.example' || Object.keys(logoutMessage.message).length !== 1) throw new Error('Logout bridge must remain same-origin and intent-only')
mobileViewport = false
if (mobileSidebarOverlay.props.children[0].props.children.props.size !== 18) throw new Error('Mobile opener should use a compact 18px icon within a 44px touch target')
if (!installedStyle.textContent.includes('--dsh-frame-leading-clearance: 68px') || !installedStyle.textContent.includes('padding-right: 60px')) throw new Error('Native titles must reserve both mobile controls')
for (const requiredName of ['conversation.hero.brand.mark', 'sidebar.brand.mark', 'sidebar.brand.name', 'conversation.input.left']) {
  if (!registeredNames.has(requiredName)) throw new Error(`AdminSmart client slot missing: ${requiredName}`)
}
if (slotRegistrations.some(item => item.name === 'settings.plugins.tab')) {
  throw new Error('插件清单必须由官方 Inventory 注册，不得重建手写自定义目录页')
}
if (slotRegistrations.some(item => item.name === 'settings.models.footer')) {
  throw new Error('The obsolete administrator model-policy footer must not appear in Settings')
}
const managedModelsSection = slotRegistrations.find(item => item.name === 'settings.section' && item.id === 'models') // 共用管理员模型页的公开 Slot。
if (!managedModelsSection) throw new Error('Managed Models section must be registered')
hookStatesByInstance.set('managed-models', [{ status: 'ready', providers: [], error: '' }]) // 已读取空目录，不访问真实 Host 或凭据。
let managedModelElements = flattenElements(renderHookComponent('managed-models', managedModelsSection.component, {})) // 首次打开管理员模型页。
const addProviderButton = managedModelElements.find(item => item.props?.children === '添加供应商') // 通过界面原有命令打开新供应商表单。
if (!addProviderButton?.props?.onClick) throw new Error('Managed Models page must offer provider creation')
addProviderButton.props.onClick()
managedModelElements = flattenElements(renderHookComponent('managed-models', managedModelsSection.component, {}))
const optionalCapacityField = managedModelElements.find(item => item.type?.name === 'AdminSmartPublicModelField' && item.props?.label === '最大输出 token') // 新模型规格的原生 Input 封装。
const optionalCapacityInput = optionalCapacityField?.type(optionalCapacityField.props)?.props?.children?.find?.(item => item?.props?.['aria-label'] === '最大输出 token') // 验证最终传入官方 Input 的必填属性。
if (!optionalCapacityInput || optionalCapacityInput.props.required !== false) {
  throw new Error('The native output-cap input must allow an empty value')
}
if (slotRegistrations.some(item => item.name === 'conversation.input.activity')
  || bundleSource.includes('AdminSmartVoiceInput')
  || bundleSource.includes('adminsmart-voice-device-entry')) {
  throw new Error('The official voice Bundle alone must own the microphone and waveform Slot')
}
const modelProviderCard = slotRegistrations.find(item => item.name === 'settings.models.provider-card' && item.key === 'llm-pi-ai') // Native editor owns provider creation; our keyed seat handles managed publishing.
if (!modelProviderCard) throw new Error('Private provider card must expose the official keyed model-policy seat')
const providerFixture = { provider: 'fixture-gpt', settingsNs: 'llm-pi-ai' } // 官方保存前稳定的 Provider 目录条目引用。
let modelCardElements = flattenElements(renderHookComponent('model-provider-card', modelProviderCard.component, {
  provider: providerFixture, configured: true,
})) // No HTTP request or real provider Key is required to render the control.
if (modelCardElements.length !== 0) throw new Error('Model administration must remain hidden until the private Provider is verified')
providerAccessMount?.()
await new Promise(resolve => setTimeout(resolve, 0))
modelCardElements = flattenElements(renderHookComponent('model-provider-card', modelProviderCard.component, {
  provider: providerFixture, configured: true,
}))
const modelConfigTrigger = modelCardElements.find(item => item.props?.className === 'adminsmart-model-configuration-seat__trigger') // 官方扩展位紧邻供应商标题下方。
if (modelConfigTrigger?.props?.children !== '配置模型用途与思考等级'
  || modelCardElements.some(item => item.type === 'button' && item.props?.children === '发布到业务模型')
  || modelCardElements.some(item => item.type?.name === 'AdminSmartModelPolicyFooter')) {
  throw new Error('Saved Provider card must show one configuration entry without the obsolete publishing or policy block')
}
modelConfigTrigger.props.onClick()
const expandedProviderCard = flattenElements(renderHookComponent('model-provider-card', modelProviderCard.component, {
  provider: providerFixture, configured: true,
})) // 只有点击后才挂载当前 Provider 的模型配置面板。
const modelConfigSeat = expandedProviderCard.find(item => item.type?.name === 'AdminSmartModelConfiguration')
if (modelConfigSeat?.props?.providerId !== 'fixture-gpt' || modelConfigSeat.props.providerSnapshot !== providerFixture) {
  throw new Error('Provider entry must expand its own model settings and retain the official snapshot identity')
}
renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props)
modelConfigurationMount?.()
await new Promise(resolve => setTimeout(resolve, 0))
let modelConfigElements = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props)) // GET 后展示模型名、官方菜单和用途动作。
/** @param {object[]} elements - Model configuration render tree. @returns {object|undefined} Official reasoning Menu for this fixture. */
const reasoningMenu = elements => elements.find(item => item.props?.className === 'adminsmart-model-configuration__effort-menu') // Menu owns the five items and the official Button trigger.
const officialButtonPrimitive = reasoningMenu(modelConfigElements)?.props?.anchor?.type // 用途动作与等级触发器必须复用同一个官方 Button 原语。
if (!modelConfigElements.some(item => item.type === 'strong' && item.props?.children === 'Fixture GPT Model')
  || reasoningMenu(modelConfigElements)?.props?.anchor?.props?.['aria-label'] !== 'Fixture GPT Model 可用思考等级'
  || reasoningMenu(modelConfigElements)?.props?.anchor?.props?.variant !== 'ghost'
   || !modelConfigElements.some(item => item.type === officialButtonPrimitive && item.props?.children === '设为兜底模型')
   || modelConfigElements.some(item => ['设为知识模型', '知识模型关闭值', '当前知识库模型', '知识模型暂不可用'].includes(item.props?.children))
  || modelConfigElements.some(item => item.type === 'select' || item.type === 'input' && item.props?.type === 'checkbox')) {
  throw new Error('Model configuration must retain official chat Menu and fallback Button without dynamic knowledge controls')
}
if (reasoningMenu(modelConfigElements).props.items[0]?.text !== '推理等级'
  || JSON.stringify(reasoningMenu(modelConfigElements).props.items.slice(1).map(item => item.id)) !== JSON.stringify(['low', 'medium', 'high', 'xhigh', 'max'])
  || reasoningMenu(modelConfigElements).props.items.slice(1).some(item => item.label !== item.id)
  || reasoningMenu(modelConfigElements).props.portal !== true
  || reasoningMenu(modelConfigElements).props.selection !== 'check'
  || reasoningMenu(modelConfigElements).props.listClassName !== 'adminsmart-model-configuration__effort-list'
  || !installedStyle.textContent.includes('.adminsmart-model-configuration__effort-list {\n  box-sizing: border-box;\n  width: 240px;')
  || !installedStyle.textContent.includes('  background: var(--dsw-alias-bg-layer-1);\n  backdrop-filter: none;')
  || installedStyle.textContent.includes('--dsw-specific-menu:')) {
  throw new Error('Reasoning Menu must present five checkable grades with a list matching its trigger width')
}
if (JSON.stringify(reasoningMenu(modelConfigElements).props.selectedIds) !== JSON.stringify(['high'])) throw new Error('Existing effort map, not its default, must determine checked rows')
reasoningMenu(modelConfigElements).props.anchor.props.onClick()
modelConfigElements = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props))
if (reasoningMenu(modelConfigElements).props.open !== true || reasoningMenu(modelConfigElements).props.anchor.props['aria-expanded'] !== true) {
  throw new Error('Reasoning Menu trigger must expand accessibly')
}
reasoningMenu(modelConfigElements).props.onSelect('low')
await new Promise(resolve => setTimeout(resolve, 0))
if (JSON.stringify(modelConfigurationWrites[0]) !== JSON.stringify({ providerId: 'fixture-gpt', modelId: 'fixture-model', action: 'efforts', reasoningEfforts: ['low', 'high'] })) {
  throw new Error('Selecting another grade must preserve the existing grade in one server-confirmed collection')
}
if (fixtureReasoningEfforts.high !== 'reasoning-high') throw new Error('Selecting an existing level must preserve its saved provider wire mapping')
modelConfigElements = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props))
if (JSON.stringify(reasoningMenu(modelConfigElements).props.selectedIds) !== JSON.stringify(['low', 'high'])
  || reasoningMenu(modelConfigElements).props.anchor.props.children[0].props.children !== '已选 2 档'
  || reasoningMenu(modelConfigElements).props.open !== true) throw new Error('Menu must remain open and reflect multiple server-confirmed grades')
reasoningMenu(modelConfigElements).props.onSelect('medium')
await new Promise(resolve => setTimeout(resolve, 0))
if (JSON.stringify(modelConfigurationWrites[1]?.reasoningEfforts) !== JSON.stringify(['low', 'medium', 'high'])) throw new Error('A third grade must not replace previously selected grades')
modelConfigElements = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props))
reasoningMenu(modelConfigElements).props.onSelect('low')
await new Promise(resolve => setTimeout(resolve, 0))
if (JSON.stringify(modelConfigurationWrites[2]?.reasoningEfforts) !== JSON.stringify(['medium', 'high']) || 'low' in fixtureReasoningEfforts) {
  throw new Error('Deselecting one grade must retain the other checked grades')
}
modelConfigElements = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props))
fixtureHarnessDefault = true
modelConfigurationMount?.()
await new Promise(resolve => setTimeout(resolve, 0))
modelConfigElements = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props))
if (modelConfigElements.some(item => item.type === officialButtonPrimitive && ['当前兜底模型', '设为兜底模型'].includes(item.props?.children))) {
  throw new Error('The applied Harness fallback action must disappear')
}
if (!modelConfigElements.some(item => item.props?.children === '当前新会话兜底模型')) {
  throw new Error('The applied chat fallback must remain visible without a dynamic knowledge default')
}
const collapsedModelUses = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, { ...modelConfigSeat.props, showEfforts: false })) // 收起高级思考配置不应隐藏默认模型用途。
if (reasoningMenu(collapsedModelUses) || !collapsedModelUses.some(item => item.props?.children === '当前新会话兜底模型')
  || collapsedModelUses.some(item => ['设为知识模型', '知识模型关闭值'].includes(item.props?.children))) {
  throw new Error('Chat fallback use must remain visible while reasoning grades are collapsed, with no dynamic knowledge entry')
}
fixtureHarnessDefault = false
fixtureReasoningEfforts = {}
selectedFixtureEffort = ''
modelConfigurationMount?.()
await new Promise(resolve => setTimeout(resolve, 0))
modelConfigElements = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props))
const emptyReasoningMenu = reasoningMenu(modelConfigElements) // 未配置的模型仍能从官方 Menu 选择五档。
if (emptyReasoningMenu?.props?.selectedIds?.length !== 0 || emptyReasoningMenu.props.anchor.props.children[0].props.children !== '未设置'
  || modelConfigElements.some(item => item.props?.className === 'adminsmart-model-configuration__wire')) {
  throw new Error('An unconfigured model must not show the old wire-value form')
}
emptyReasoningMenu.props.onSelect('medium')
await new Promise(resolve => setTimeout(resolve, 0))
if (JSON.stringify(modelConfigurationWrites[3]) !== JSON.stringify({ providerId: 'fixture-gpt', modelId: 'fixture-model', action: 'efforts', reasoningEfforts: ['medium'] })
  || fixtureReasoningEfforts.medium !== 'medium') {
  throw new Error('An unconfigured model must enable one literal grade without requesting a separate wire form')
}
modelConfigElements = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props))
reasoningMenu(modelConfigElements).props.onSelect('max')
await new Promise(resolve => setTimeout(resolve, 0))
modelConfigElements = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props))
if (JSON.stringify(reasoningMenu(modelConfigElements).props.selectedIds) !== JSON.stringify(['medium', 'max'])) throw new Error('First-time model configuration must support two checked grades')
reasoningMenu(modelConfigElements).props.onSelect('medium')
await new Promise(resolve => setTimeout(resolve, 0))
modelConfigElements = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props))
if (JSON.stringify(reasoningMenu(modelConfigElements).props.selectedIds) !== JSON.stringify(['max'])) throw new Error('Removing the default grade must retain another enabled grade')
reasoningMenu(modelConfigElements).props.onSelect('max')
await new Promise(resolve => setTimeout(resolve, 0))
modelConfigElements = flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props))
if (reasoningMenu(modelConfigElements).props.selectedIds.length !== 0 || selectedFixtureEffort !== '') throw new Error('Non-knowledge models must allow clearing all enabled grades')
fixtureNewModelAdded = true
const refreshedProviderSnapshot = { ...providerFixture } // 官方 Models store 在同一路由设置保存后重建目录条目。
const refreshedProviderCard = flattenElements(renderHookComponent('model-provider-card', modelProviderCard.component, {
  provider: refreshedProviderSnapshot, configured: true,
})) // Provider ID 不变，卡片保持展开并收到新快照。
const refreshedModelSeat = refreshedProviderCard.find(item => item.type?.name === 'AdminSmartModelConfiguration')
if (refreshedModelSeat?.props?.providerId !== 'fixture-gpt'
  || refreshedModelSeat.props.providerSnapshot !== refreshedProviderSnapshot
  || refreshedModelSeat.props.providerSnapshot === modelConfigSeat.props.providerSnapshot
  || !bundleSource.includes('}, [providerId, providerSnapshot])')) {
  throw new Error('An official Provider snapshot change must invalidate the open model panel without reloading the page')
}
renderHookComponent('model-configuration', refreshedModelSeat.type, refreshedModelSeat.props)
modelConfigurationMount?.()
await new Promise(resolve => setTimeout(resolve, 0))
const refreshedModelElements = flattenElements(renderHookComponent('model-configuration', refreshedModelSeat.type, refreshedModelSeat.props))
if (!refreshedModelElements.some(item => item.type === 'strong' && item.props?.children === 'Fixture Added Model')) {
  throw new Error('The open Provider card must show a newly saved model after the native Settings refresh')
}
const unpublishedRow = refreshedModelElements.find(item => item.props?.className === 'adminsmart-model-configuration__row'
  && flattenElements(item).some(child => child.type === 'strong' && child.props?.children === 'Fixture Added Model')) // 只断言新增行，不误用旧模型的可用按钮。
if (!flattenElements(unpublishedRow).some(item => item.props?.role === 'status' && item.props?.children === '同步中…')
  || !pendingModelSyncTimers.some(timer => timer.active && timer.delay === 400)) {
  throw new Error('An unpublished new model must display a bounded synchronization state instead of a permanent disabled action')
}
fixtureNewModelPublished = true
const syncTimer = pendingModelSyncTimers.find(timer => timer.active && timer.delay === 400) // 后台发布完成后只推进本次有界重读。
syncTimer.active = false
syncTimer.callback()
await new Promise(resolve => setTimeout(resolve, 0))
const synchronizedElements = flattenElements(renderHookComponent('model-configuration', refreshedModelSeat.type, refreshedModelSeat.props))
const synchronizedRow = synchronizedElements.find(item => item.props?.className === 'adminsmart-model-configuration__row'
  && flattenElements(item).some(child => child.type === 'strong' && child.props?.children === 'Fixture Added Model')) // 同一面板、同一 Provider 无页面刷新后的权威行。
if (!flattenElements(synchronizedRow).some(item => item.type === officialButtonPrimitive && item.props?.children === '设为兜底模型' && item.props?.disabled === false)
  || pendingModelSyncTimers.some(timer => timer.active && timer.delay === 800)) {
  throw new Error('The newly published model must become selectable without page reload or continuing polling')
}
fixtureNewModelPublished = false
renderHookComponent('model-configuration', refreshedModelSeat.type, refreshedModelSeat.props)
modelConfigurationMount?.()
await new Promise(resolve => setTimeout(resolve, 0))
for (const delay of [400, 800, 1200, 1800, 2500]) {
  const timer = pendingModelSyncTimers.find(item => item.active && item.delay === delay) // 逐项推进有界重读，不等待真实定时器。
  if (!timer) throw new Error(`Expected model synchronization retry after ${delay}ms`)
  timer.active = false
  timer.callback()
  await new Promise(resolve => setTimeout(resolve, 0))
}
const failedSyncElements = flattenElements(renderHookComponent('model-configuration', refreshedModelSeat.type, refreshedModelSeat.props)) // 假后端持续无模型时展示最终状态。
const failedRow = failedSyncElements.find(item => item.props?.className === 'adminsmart-model-configuration__row'
  && flattenElements(item).some(child => child.type === 'strong' && child.props?.children === 'Fixture Added Model')) // 不影响已发布旧模型行。
if (!failedSyncElements.some(item => item.props?.role === 'alert' && String(item.props?.children).includes('未同步到业务目录'))
   || !flattenElements(failedRow).some(item => item.props?.role === 'status' && item.props?.children === '未同步')
  || !flattenElements(failedRow).some(item => item.type === officialButtonPrimitive && item.props?.children === '设为兜底模型' && item.props?.disabled)
  || pendingModelSyncTimers.some(timer => timer.active)) {
  throw new Error('A real backend publication failure must stop bounded retries and disable model defaults')
}

// 聊天模型保存使用同步防重、权威重读和作用域取消；固定知识处理不进入聊天目录。
fixtureNewModelAdded = false
fixtureReasoningEfforts = { high: 'reasoning-high' }
selectedFixtureEffort = 'high'
fixtureHarnessDefault = false
/** @returns {object[]} 当前聊天模型配置面板的实际渲染树，不读取凭据或执行真实网络。 */
const renderChatConfiguration = () => flattenElements(renderHookComponent('model-configuration', modelConfigSeat.type, modelConfigSeat.props))
renderChatConfiguration()
let chatConfigurationCleanup = modelConfigurationMount?.() // 当前测试面板的卸载取消函数。
await new Promise(resolve => setTimeout(resolve, 0))
let chatConfigurationElements = renderChatConfiguration() // 从权威假后端取得初始聊天能力。
const duplicateWriteBaseline = modelConfigurationWrites.length // 统计重绘前双击只能产生一次写入。
const chatSaveRequestBaseline = modelConfigurationRequests.length // 一次聊天保存必须按 PUT、GET 顺序确认。
const doubleClickMenu = reasoningMenu(chatConfigurationElements) // 保留同一旧渲染处理器，覆盖 React 尚未重绘的防重窗口。
doubleClickMenu.props.onSelect('low')
doubleClickMenu.props.onSelect('low')
chatConfigurationElements = renderChatConfiguration()
if (!reasoningMenu(chatConfigurationElements).props.items.slice(1).every(item => item.disabled)
  || chatConfigurationElements.find(item => item.props?.children === '设为兜底模型')?.props.disabled !== true) {
  throw new Error('A pending chat write must disable reasoning choices and the fallback action')
}
await new Promise(resolve => setTimeout(resolve, 0))
chatConfigurationElements = renderChatConfiguration()
if (modelConfigurationWrites.length !== duplicateWriteBaseline + 1
  || JSON.stringify(modelConfigurationWrites.at(-1)) !== JSON.stringify({ providerId: 'fixture-gpt', modelId: 'fixture-model', action: 'efforts', reasoningEfforts: ['low', 'high'] })
  || JSON.stringify(modelConfigurationRequests.slice(chatSaveRequestBaseline).map(item => item.method)) !== JSON.stringify(['PUT', 'GET'])
  || JSON.stringify(reasoningMenu(chatConfigurationElements).props.selectedIds) !== JSON.stringify(['low', 'high'])
  || fixtureHarnessDefault) throw new Error('Chat effort saving must be deduplicated, reread authority, and leave the default model unchanged')

fixtureModelConfigurationPutError = 'Fixture Host 拒绝聊天档位'
reasoningMenu(chatConfigurationElements).props.onSelect('max')
await new Promise(resolve => setTimeout(resolve, 0))
chatConfigurationElements = renderChatConfiguration()
if (!chatConfigurationElements.some(item => item.props?.role === 'alert' && item.props.children === fixtureModelConfigurationPutError)
  || JSON.stringify(reasoningMenu(chatConfigurationElements).props.selectedIds) !== JSON.stringify(['low', 'high'])
  || reasoningMenu(chatConfigurationElements).props.items.slice(1).some(item => item.disabled)) {
  throw new Error('A rejected chat write must display its error, retain confirmed grades, and release the write lock')
}
fixtureModelConfigurationPutError = ''
fixtureModelConfigurationReadError = 'Fixture 权威聊天能力重读失败'
reasoningMenu(chatConfigurationElements).props.onSelect('max')
await new Promise(resolve => setTimeout(resolve, 0))
chatConfigurationElements = renderChatConfiguration()
if (!chatConfigurationElements.some(item => item.props?.role === 'alert' && item.props.children === fixtureModelConfigurationReadError)
  || reasoningMenu(chatConfigurationElements).props.selectedIds.includes('max')) {
  throw new Error('PUT success without an authoritative GET must not replace the last confirmed chat grades')
}
fixtureModelConfigurationReadError = ''

let releaseOldModelRead = null // 晚于聊天保存返回的旧 GET，不能覆盖写入后的能力。
let interceptNextModelRead = true // 只阻塞一次旧 GET，写入后的权威 GET 仍使用正常假后端。
modelConfigurationInterceptor = (_url, options) => {
  if (options.method === 'PUT' || !interceptNextModelRead) return undefined
  interceptNextModelRead = false
  return new Promise(resolve => { releaseOldModelRead = resolve })
}
chatConfigurationCleanup = modelConfigurationMount?.() // 新读取作用域持有一次未完成 GET。
chatConfigurationElements = renderChatConfiguration()
reasoningMenu(chatConfigurationElements).props.onSelect('max')
await new Promise(resolve => setTimeout(resolve, 0))
releaseOldModelRead({ ok: true, json: async () => ({ models: [{ id: 'fixture-model', name: 'Fixture GPT Model', reasoningEfforts: { high: 'obsolete' }, isHarnessDefault: true }] }) })
await new Promise(resolve => setTimeout(resolve, 0))
modelConfigurationInterceptor = null
chatConfigurationElements = renderChatConfiguration()
if (JSON.stringify(reasoningMenu(chatConfigurationElements).props.selectedIds) !== JSON.stringify(['low', 'high', 'max'])
  || chatConfigurationElements.some(item => item.props?.children === '当前新会话兜底模型')) {
  throw new Error('A late old GET must not replace newly confirmed chat grades or invent a fallback selection')
}

fixtureNewModelAdded = true
fixtureNewModelPublished = false
chatConfigurationCleanup = modelConfigurationMount?.()
await new Promise(resolve => setTimeout(resolve, 0))
chatConfigurationElements = renderChatConfiguration()
reasoningMenu(chatConfigurationElements).props.onSelect('medium') // 修改已有聊天模型时，另一个模型仍在后台发布。
await new Promise(resolve => setTimeout(resolve, 0))
const resumedSyncTimer = pendingModelSyncTimers.find(timer => timer.active && timer.delay === 400) // 写入结束后恢复有界发布重读。
if (!resumedSyncTimer) throw new Error('Chat saving must not strand another unpublished model in a permanent syncing state')
fixtureNewModelPublished = true
resumedSyncTimer.active = false
resumedSyncTimer.callback()
await new Promise(resolve => setTimeout(resolve, 0))
const resumedModelElements = renderChatConfiguration() // 后台发布后无需刷新整页即可选择聊天兜底。
const resumedModelRow = resumedModelElements.find(item => item.props?.className === 'adminsmart-model-configuration__row'
  && flattenElements(item).some(child => child.type === 'strong' && child.props?.children === 'Fixture Added Model'))
if (!flattenElements(resumedModelRow).some(item => item.props?.children === '设为兜底模型' && item.props.disabled === false)) {
  throw new Error('Model publication retries must converge after an independent chat capability save')
}
fixtureNewModelAdded = false
chatConfigurationCleanup = modelConfigurationMount?.()
await new Promise(resolve => setTimeout(resolve, 0))
chatConfigurationElements = renderChatConfiguration()

let releaseUnmountedChatWrite = null // 卸载后才到达的聊天 PUT 返回，不得补发 GET 或写回 React。
modelConfigurationInterceptor = (_url, options) => options.method === 'PUT'
  ? new Promise(resolve => { releaseUnmountedChatWrite = resolve }) : undefined
reasoningMenu(chatConfigurationElements).props.onSelect('medium')
const unmountedChatRequest = modelConfigurationRequests.at(-1) // 卸载必须取消已经发出的聊天请求。
chatConfigurationCleanup?.()
const unmountedStateBaseline = JSON.stringify(hookStatesByInstance.get('model-configuration')) // 卸载后的状态不允许接受迟到更新。
const unmountedRequestBaseline = modelConfigurationRequests.length // 卸载后不得继续读取模型目录。
releaseUnmountedChatWrite({ ok: true, json: async () => ({ models: [] }) })
await new Promise(resolve => setTimeout(resolve, 0))
modelConfigurationInterceptor = null
if (!unmountedChatRequest.signal?.aborted
  || modelConfigurationRequests.length !== unmountedRequestBaseline
  || JSON.stringify(hookStatesByInstance.get('model-configuration')) !== unmountedStateBaseline) {
  throw new Error('Unmounting must abort a chat write and suppress late reads or state changes')
}
if (bundleSource.includes('adminsmart-model-configuration__off-wire')
  || bundleSource.includes("children: '设为知识模型'")
  || modelConfigurationWrites.some(item => ['knowledge', 'off-wire'].includes(item.action))) {
  throw new Error('Dynamic knowledge controls and requests must be retired while chat model management remains usable')
}

const managedWelcomeNotice = slotRegistrations.find(item => item.name === 'settings.onboarding' && item.id === 'welcome-notice') // Public list-slot override of the upstream developer notice.
if (managedWelcomeNotice?.priority !== -1 || managedWelcomeNotice.order !== -100) {
  throw new Error('AdminSmart must shadow only the official welcome notice through its public onboarding Slot')
}
let welcomeCompletions = 0 // Official Settings coordinator completions requested by the mounted replacement.
activeHookInstanceId = 'managed-welcome'
const welcomeRender = managedWelcomeNotice.component({ complete: () => { welcomeCompletions += 1 } }) // No developer notice DOM is rendered.
activeHookInstanceId = null
if (welcomeRender !== null || welcomeCompletions !== 1) {
  throw new Error('Managed welcome step must render nothing and complete the official onboarding flow once')
}
if (bundleSource.includes('ADMINSMART_CUSTOM_PLUGIN_CATALOG') || bundleSource.includes('AdminSmartCustomPluginsTab')) {
  throw new Error('手写插件目录与渲染组件必须退役，保持官方清单的真实状态')
}
if (
  !bundleSource.includes("const MODEL_CONFIGURATION_URL = './adminsmart/model-configuration'")
  || !bundleSource.includes('reasoningEfforts')
  || !bundleSource.includes('defaultReasoningEffort')
  || !bundleSource.includes("method: 'PUT'")
) {
  throw new Error('Official Models extension must expose the admin model policy and reasoning contract')
}
if (bundleSource.includes('workspace/cleanup') || bundleSource.includes('adminsmart-workspace-cleanup')) {
  throw new Error('Legacy workspace cleanup UI and route must be removed')
}
for (const nativeSeat of ['tool.call.toolview', 'details', 'conversation.session.header']) {
  if (registeredNames.has(nativeSeat)) throw new Error(`Conversation presentation must remain native: ${nativeSeat}`)
}
const titleVisibilityRule = '[data-slot="conversation.session.header"]' // 官方 Header 由 Harness 原生渲染，自有样式不得隐藏它。
if (bundleSource.includes('AdminSmartHiddenSessionHeader')
  || installedStyle.textContent.includes(titleVisibilityRule)
  || slotRegistrations.filter(item => item.name === 'conversation.session.header.corner').length !== 1
  || slotRegistrations.find(item => item.name === 'conversation.session.header.corner')?.priority !== -1
  || slotRegistrations.find(item => item.name === 'conversation.session.header.corner')?.component({}) !== null) {
  throw new Error('Keep the native Session Header but hide only the right-sidebar trigger through its public Slot')
}
if (bundleSource.includes("ctx.theme.setTheme('light')")) throw new Error('An administrator theme must not be reset during Client startup')
const chatNodeOverrides = slotRegistrations.filter(item => item.name === 'conversation.chat.node') // 唯一允许的原生消息节点覆盖。
if (chatNodeOverrides.length !== 1 || chatNodeOverrides[0].key !== 'system-prompt' || chatNodeOverrides[0].component({}) !== null) {
  throw new Error('Only the standalone system prompt may be hidden through the public Slot')
}
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
const webToggleRegistration = slotRegistrations.find(item => item.id === 'adminsmart-web-access-toggle') // 真实 Slot 注册定义必须提供官方会话身份。
if (webToggleRegistration.inject('fixture-web-session').sessionId !== 'fixture-web-session') {
  throw new Error('The session-scoped input Slot must pass its id through public inject')
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
if (
  bundleSource.includes("ctx.slots.inject('sidebar'")
  || bundleSource.includes("id: 'adminsmart-sidebar'")
  || !bundleSource.includes('data-adminsmart-composer-tools')
  || !bundleSource.includes("const SESSION_WEB_ACCESS_URL = './adminsmart/sessions/web-access'")
  || !bundleSource.includes("className: 'adminsmart-web-toggle'")
  || !bundleSource.includes("'aria-pressed': webEnabled === true")
  || !bundleSource.includes('SESSION_WEB_ACCESS_TIMEOUT_MS')
  || !bundleSource.includes('useState(null)')
  || !bundleSource.includes('children: jsx(IconGlobeOutline14')
  || !bundleSource.includes("children: jsx(IconGlobeOutline14, { size: 14")
  || !/@media \$\{MOBILE_SHELL_MEDIA_QUERY\}\s*\{[\s\S]*?\.adminsmart-web-toggle\s*\{\s*width: 28px;\s*height: 28px;\s*flex-basis: 28px;/.test(bundleSource)
  || !bundleSource.includes('.adminsmart-web-toggle[data-state="on"]:hover:not(:disabled)')
  || !bundleSource.includes("const ADMINSMART_PRIMARY_COLOR = '#409eff'")
) {
  throw new Error('AdminSmart web access and host-brand controls are incomplete')
}
if (bundleSource.includes('AdminSmartHiddenWorkspaceSeat')
  || bundleSource.includes("workspaceButton.style.setProperty('display', 'none', 'important')")
  || !bundleSource.includes("workspace.title === INTERNAL_RUNTIME_WORKSPACE_TITLE")) {
  throw new Error('AuraSearch must keep the official Workspace Picker and select only the current business Workspace')
}
if (!bundleSource.includes('ctx.uiWorkspace.openSession(sessionId)')) {
  throw new Error('Workspace Session activation must use the official uiWorkspace navigation service')
}
if (
  bundleSource.includes('KnowledgeScopeSelector')
  || bundleSource.includes('KNOWLEDGE_SCOPE_URL')
  || bundleSource.includes("className: 'adminsmart-knowledge-popover'")
) {
  throw new Error('Official query API has no document scope filter, so the composer must not expose a knowledge-range selector')
}
if (!bundleSource.includes('const MOBILE_SHELL_MAX_WIDTH_PX = 767')
  || !bundleSource.includes('[data-slot="conversation.composer.bar"] > *')
  || bundleSource.includes('reconcileAdminSmartMobileFrame')) {
  throw new Error('Mobile composer spacing remains, but the obsolete custom drawer must stay removed')
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
  throw new Error('AdminSmart client must leave generic Session file intake to the native Harness 0.1.7 composer')
}
navigationServices.pop()
sandbox.window.__ADMINSMART_RUNTIME_ROLE__ = 'admin'
clientModule.apply(fakeContext)
await new Promise(resolve => setTimeout(resolve, 0))
if (navigationServices.length !== 0) throw new Error('Administrator must retain the official plugin navigation service')
process.stdout.write('client_bundle_contract=ok\n')
