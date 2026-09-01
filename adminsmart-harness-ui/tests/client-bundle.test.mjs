/** Verify the authored browser bundle registers the exact Harness client-module contract. */

import { readFileSync, statSync } from 'node:fs'
import vm from 'node:vm'

const bundlePath = new URL('../lib/client.js', import.meta.url) // Package-relative browser bundle under test.
const bundleSource = readFileSync(bundlePath, 'utf8') // Authored source is also checked for public Harness slot-field compatibility.
const logoPath = new URL('../assets/aurasearch-logo.jpg', import.meta.url) // Operator-approved AuraSearch artwork published by the Host plugin.
const logoSize = statSync(logoPath).size // Non-empty binary asset contract without decoding or rewriting the supplied artwork.
if (logoSize < 1024) throw new Error('AuraSearch logo asset is missing or unexpectedly empty')
const registrations = [] // Captured __ModuleLoader__.load handoffs.
let installedStyle = null // Minimal document-owned style node created by the real Client apply lifecycle.
const sandbox = {
  console,
  queueMicrotask(callback) {
    callback()
  },
  NodeFilter: { SHOW_TEXT: 4 },
  MutationObserver: class MutationObserver {
    constructor(callback) {
      this.callback = callback
    }

    observe() {}

    disconnect() {}
  },
  document: {
    head: {
      appendChild(node) {
        installedStyle = node
        node.isConnected = true
      }
    },
    body: {
      querySelectorAll() {
        return []
      }
    },
    querySelector(selector) {
      return selector.includes('data-adminsmart-style') ? installedStyle : null
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
    createTreeWalker() {
      return { nextNode: () => null }
    }
  },
  window: {
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
      useEffect() {},
      useRef(value) { return { current: value } },
      useState(value) { return [value, () => {}] }
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
      IconCheckOutline16: primitive,
      IconChecklistOutline14: primitive,
      IconChevronDownOutline14: primitive,
      IconCloseFill14: primitive,
      IconEditOutline16: primitive,
      IconEllipsisOutline16: primitive,
      IconNewChatOutline16: primitive,
      IconPanelLeftOutline16: primitive,
      IconPlusOutline16: primitive,
      IconSearchOutline16: primitive,
      IconTrashOutline16: primitive,
      Menu: primitive,
      Modal: primitive
    }
  }
  throw new Error(`unexpected client external: ${specifier}`)
}) // Execute the real lazy-CJS factory with the one platform seed it consumes.
if (!Array.isArray(clientModule.inject) || typeof clientModule.apply !== 'function') {
  throw new Error('AdminSmart client module exports are invalid')
}
if (!clientModule.inject.includes('theme')) throw new Error('AdminSmart client module must wait for the official theme service')
if (!clientModule.inject.includes('layout')) throw new Error('AdminSmart client module must use the official layout service')
const slotRegistrations = [] // Slot names installed by the client apply lifecycle.
const consumeRegistration = (value) => {
  if (value && typeof value.next === 'function') {
    for (const disposer of value) void disposer
  }
  return () => {}
}
const fakeContext = {
  theme: {
    getTheme() { return { preference: 'dark', colorScheme: 'dark' } },
    setTheme(id) {
      if (id !== 'light') throw new Error('AdminSmart client must force the light theme')
    }
  },
  workspaces: {
    list: {
      getSnapshot() { return { phase: 'ready', items: [{ workspaceId: 'knowledge-workspace' }] } },
      subscribe() { return () => {} }
    }
  },
  sessions: {
    list: {
      getSnapshot() { return { phase: 'ready', current: 'existing-session' } },
      subscribe() { return () => {} }
    },
    open() {}
  },
  uiWorkspace: {
    connectWorkspace() { return Promise.resolve('existing-session') }
  },
  conversation: {
    createDraftImages() { return [] },
    releaseDraftImages() {}
  },
  slots: {
    inject(_name, callback) {
      return consumeRegistration(callback())
    },
    register(options, component) {
      slotRegistrations.push({ name: options.name, component })
      return () => {}
    }
  },
  effect(callback) {
    return callback()
  }
} // Minimal Harness client context exercising slot registration and DOM adapter setup.
clientModule.apply(fakeContext)
const registeredNames = new Set(slotRegistrations.map(item => item.name))
for (const requiredName of ['sidebar', 'conversation.hero.brand.mark', 'conversation.session.header', 'conversation.input.left']) {
  if (!registeredNames.has(requiredName)) throw new Error(`AdminSmart client slot missing: ${requiredName}`)
}
if (!bundleSource.includes('session?.sessionId') || bundleSource.includes('session?.id ??')) {
  throw new Error('Knowledge scope selector must use the public SessionSnapshot.sessionId field')
}
if (
  !bundleSource.includes("getAttribute('data-placeholder')")
  || !bundleSource.includes("[data-composer-placeholder=\"true\"]")
  || !bundleSource.includes('button[aria-label^="访问模式"]')
  || !bundleSource.includes('button[aria-label="指令"]')
  || !bundleSource.includes('alreadyRemovedFromLayout')
  || !bundleSource.includes("key: 'turn-process'")
  || !bundleSource.includes("'system-prompt', 'context'")
  || !bundleSource.includes('data-adminsmart-auto-expanded')
  || !bundleSource.includes('data-adminsmart-protocol-hidden')
  || !bundleSource.includes("style.setProperty('display', 'none', 'important')")
) {
  throw new Error('AdminSmart DOM adapter must cover the real Lexical placeholder and enforced Workspace-picker hiding')
}
if (
  !bundleSource.includes('AdminSmartSidebar')
  || !bundleSource.includes('AdminSmartHiddenSessionHeader')
  || !bundleSource.includes('createAdminSmartSidebarStore')
  || !bundleSource.includes("persist: 'adminsmart.sidebar.view.v1'")
  || !bundleSource.includes("ctx.slots.inject('sidebar'")
  || !bundleSource.includes("name: 'sidebar'")
  || !bundleSource.includes('data-adminsmart-history')
  || !bundleSource.includes('data-adminsmart-sidebar')
  || !bundleSource.includes('priority: -100')
  || !bundleSource.includes('searchSessionHistory(query, signal)')
  || !bundleSource.includes('loadOlderSession: async sessionId =>')
  || !bundleSource.includes('findRenderedSearchMatch(pendingSearchJump.seq, pendingSearchJump.terms)')
  || !bundleSource.includes("const SEARCH_OVERLAY_MESSAGE_TYPE = 'adminsmart:agent-search-overlay'")
  || !bundleSource.includes("const SEARCH_OVERLAY_CLOSE_MESSAGE_TYPE = 'adminsmart:agent-search-overlay-close'")
  || !bundleSource.includes('ctx.sessions.binding(sessionId)?.session')
  || !bundleSource.includes("label: pinned ? '取消置顶' : '置顶'")
  || !bundleSource.includes("icon: jsx(AdminSmartPinIcon, { size: 14 })")
  || !bundleSource.includes("label: '多选'")
  || !bundleSource.includes("children: '开启新对话'")
  || !bundleSource.includes("placeholder: '搜索对话内容...'")
  || !bundleSource.includes("children: 'AuraSearch'")
  || !bundleSource.includes("aurasearch-logo.jpg?v=20260901-2")
  || !bundleSource.includes("borderRadius: '7px'")
  || !bundleSource.includes("clipPath: 'inset(0 round 7px)'")
  || !bundleSource.includes("children: selectedSessionIds.length === 0")
  || !bundleSource.includes("? '选择对话'")
  || !bundleSource.includes('actions.pinMany(selectedSessionIds)')
  || !bundleSource.includes("'aria-label': '批量选择会话'")
  || !bundleSource.includes('data-adminsmart-composer-tools')
  || !bundleSource.includes('draftSelectedIds')
  || !bundleSource.includes("className: 'adminsmart-knowledge-popover'")
  || !bundleSource.includes("className: 'adminsmart-knowledge-option'")
  || !bundleSource.includes("children: loading ? '保存中...' : '应用'")
  || !bundleSource.includes('width: min(360px, calc(100vw - 32px));')
  || !bundleSource.includes("'aria-label': '上传图片'")
  || !bundleSource.includes('IconTrashOutline16')
  || !bundleSource.includes('IconEllipsisOutline16')
  || !bundleSource.includes("{ id: 'week', label: '7 天内' }")
  || !bundleSource.includes("{ id: 'month', label: '30 天内' }")
  || !bundleSource.includes('archiveSession: sessionId => ctx.uiWorkspace.archiveSession(sessionId)')
  || !bundleSource.includes("const ADMINSMART_PRIMARY_COLOR = '#409eff'")
  || !bundleSource.includes("replaceAll('推理等级', '思考模式')")
) {
  throw new Error('AdminSmart history, upload, spacing, and host-brand controls are incomplete')
}
if (bundleSource.includes('未勾选文档时默认检索全部知识') || bundleSource.includes("type: 'checkbox'")) {
  throw new Error('Knowledge scope must use the compact draft-selection menu instead of explanatory copy or native checkboxes')
}
if (
  !bundleSource.includes('padding: 6px 12px 0;')
  || !bundleSource.includes('background: #f9fafb;')
  || !bundleSource.includes('margin: 12px 0 28px;')
  || !bundleSource.includes('border-radius: 100px;')
  || !bundleSource.includes('height: 22px;')
  || !bundleSource.includes('background: #e4edfd;')
  || !bundleSource.includes('color: #3964fe;')
  || !bundleSource.includes('const DEEPSEEK_REFERENCE_SIDEBAR_WIDTH = 261')
  || !bundleSource.includes("'--adminsmart-sidebar-visual-tail': `${visualSidebarTail}px`")
  || !bundleSource.includes('width: min(660px, calc(100vw - 32px));')
  || !bundleSource.includes('height: min(72vh, 916px);')
  || !bundleSource.includes('border-radius: 20px;')
  || !bundleSource.includes('padding: 14vh 16px 16px;')
  || !bundleSource.includes("className: 'adminsmart-search__result-icon'")
  || !bundleSource.includes("className: 'adminsmart-search__result-content'")
  || !bundleSource.includes('className: \'adminsmart-search__result-date\'')
  || !bundleSource.includes("if (elapsedCalendarDays === 1) return '昨天'")
  || bundleSource.includes('box-shadow: 0 0 0 2px #3964fe;')
) {
  throw new Error('AdminSmart sidebar must preserve the measured DeepSeek spacing and selected-row colors')
}
if (
  !bundleSource.includes("accept: 'image/png,image/jpeg,image/webp,image/gif'")
  || !bundleSource.includes('createDraftImages(selectedFiles)')
  || !bundleSource.includes('inputActions.addImages(draftImages.map(image => image.id))')
  || bundleSource.includes('requestKnowledgeUpload')
  || bundleSource.includes('adminsmart:agent-bridge-request')
  || bundleSource.includes('上传知识文件')
) {
  throw new Error('Chat attachments must remain image-only Harness draft context and must not upload knowledge resources')
}
process.stdout.write('client_bundle_contract=ok\n')
