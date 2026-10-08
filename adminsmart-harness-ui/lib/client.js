/** AdminSmart browser plugin bundle using the DeepSeek Harness lazy-CJS client-module contract. */
window.__ModuleLoader__.load({
  id: '@adminsmart/dsh-client-ui',
  factory: (require) => {
    const module = { exports: {} } // Lazy-CJS module container returned to the Harness Client Loader.
    const exports = module.exports // Named exports populated at the end of this factory.
    const { jsx, jsxs } = require('react/jsx-runtime') // React JSX runtime is a Harness platform seed and is not bundled twice.
    const { useEffect, useRef, useState } = require('react') // Hooks drive model settings, Session web access, and official UI state.
    const {
      Button,
      Input,
      Modal,
      IconCheckOutlineRegular: IconCheckOutline16,
      IconEditOutlineRegular: IconEditOutline16,
      IconGlobeOutlineRegular: IconGlobeOutline14,
      IconPlusOutlineRegular: IconPlusOutline16,
      IconRefreshOutlineRegular: IconRefreshOutline16,
      IconTrashOutlineRegular: IconTrashOutline16,
      IconChevronDownOutlineRegular: IconChevronDownOutline14,
      IconPanelLeftOutlineRegular: IconPanelLeftOutline20,
      Menu
    } = require('@deepseek-ai/dsh-client-ui-primitives') // 官方 Regular 图标按调用点尺寸渲染，局部别名保留现有业务布局名称。

    const inject = ['slots', 'layout', 'uiWorkspace', 'workspaces', 'sessions', 'theme', 'inputTriggers', 'modelDirectories'] // 业务适配不依赖官方语音 Remote；语音 Bundle 自行管理录音和识别。
    const SESSION_WEB_ACCESS_URL = './adminsmart/sessions/web-access' // Host-owned current-Session public web access setting.
    const MODEL_PREFERENCE_URL = './adminsmart/model-preference' // Host-owned current user-and-mode model preference.
    const WORKSPACE_VIEW_URL = './adminsmart/workspace-view' // Current user's official sidebar view, independent from the browser-wide upstream key.
    const LEGACY_WORKSPACE_VIEW_KEY = 'dsh.workspace.view.v5' // Fixed official localStorage key must not carry a prior account into this business page.
    const SESSION_WEB_ACCESS_TIMEOUT_MS = 10_000 // 控制请求无论何种故障都不能永久锁住输入工具栏。
    const AURASEARCH_LOGO_URL = './adminsmart/assets/aurasearch-logo.jpg?v=20260901-2' // Relative URL works through both the Gateway prefix and an isolated direct Harness origin; the local date and revision invalidate superseded artwork.
    const INTERNAL_RUNTIME_WORKSPACE_TITLE = '知识库工作区' // 当前业务模式唯一的官方 Workspace 标识；它只绑定 Runtime cwd，不承担租户或知识库隔离。
    const ADMINSMART_PRIMARY_COLOR = '#409eff' // Exact Element Plus active-menu color used by the AdminSmart host navigation.
    const ADMINSMART_STYLE_ID = 'adminsmart-harness-client-ui' // Stable style element identity across Client HMR replacement.
    const MODAL_OVERLAY_MESSAGE_TYPE = 'adminsmart:agent-modal-overlay' // iframe 向主应用同步官方模态框几何，保证整个 AdminSmart 页面统一蒙层。
    const MODAL_OVERLAY_CLOSE_MESSAGE_TYPE = 'adminsmart:agent-modal-overlay-close' // 主应用点击外部蒙层后请求官方模态框执行原生 mask 关闭逻辑。
    const MODAL_OVERLAY_PREPARE_CLOSE_MESSAGE_TYPE = 'adminsmart:agent-modal-overlay-prepare-close' // 官方关闭按钮先通知宿主绘制完整遮罩，避免 iframe 先亮一帧。
    const MODAL_OVERLAY_CLOSE_READY_MESSAGE_TYPE = 'adminsmart:agent-modal-overlay-close-ready' // 宿主完成遮罩绘制后允许原生关闭按钮执行。
    const MODAL_OVERLAY_CLOSE_SUPPORTED_MESSAGE_TYPE = 'adminsmart:agent-modal-overlay-close-supported' // 仅新版主页面可启用关闭握手；旧生产前端继续原生关闭。
    const MOBILE_LOGOUT_MESSAGE_TYPE = 'adminsmart:agent-logout-request' // 手机按钮只发退出意图，由主应用清理 Gateway 路由和登录态。
    const HIDDEN_KNOWLEDGE_COMMANDS = new Set(['feedback', 'permission', 'free-search-engine']) // 知识问答不展示反馈、权限和搜索引擎配置指令；附件 attach 与模型切换保持可用。
    const MOBILE_SHELL_MAX_WIDTH_PX = 767 // 手机问答切换顶部栏和抽屉布局的最大 CSS 视口宽度。
    const MOBILE_LANDSCAPE_MAX_WIDTH_PX = 1024 // 手机横屏或小型折叠屏仍使用问答抽屉布局的最大宽度。
    const MOBILE_LANDSCAPE_MAX_HEIGHT_PX = 600 // 低高度横屏进入手机布局的上限，避免正常电脑视口误用手机工具栏。
    const MOBILE_SHELL_MEDIA_QUERY = `(max-width: ${MOBILE_SHELL_MAX_WIDTH_PX}px), (max-width: ${MOBILE_LANDSCAPE_MAX_WIDTH_PX}px) and (max-height: ${MOBILE_LANDSCAPE_MAX_HEIGHT_PX}px)` // JS 行为与 CSS 手机断点共享同一边界，避免抽屉状态和视觉布局分叉。


    /** Harness 聊天协议映射保留官方支持的历史等级和 off 线值，避免读取旧配置时丢失合法能力。 */
    const ADMINSMART_REASONING_LEVELS = Object.freeze([
      { id: 'off', label: '关闭' }, // 不发送思考配置，或显式关闭思考。
      { id: 'minimal', label: '极简' }, // 供应商支持的最小思考档位。
      { id: 'low', label: '低' }, // 低强度思考档位。
      { id: 'medium', label: '中' }, // 中等思考档位。
      { id: 'high', label: '高' }, // 高强度思考档位。
      { id: 'xhigh', label: '超高' }, // 供应商扩展的超高思考档位。
      { id: 'max', label: '最高' }, // 供应商支持的最高思考档位。
    ])
    const ADMINSMART_VISIBLE_REASONING_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']) // 供应商卡片仅提供业务约定的五个可选思考档位。
    const MODEL_REASONING_URL = './adminsmart/model-reasoning' // 管理员专用模型能力读取与保存路由；由 Host 校验 Runtime 身份。
    const MODEL_POLICY_URL = './adminsmart/model-policy' // 管理员专用默认模型与普通用户白名单路由；由 Host 校验 Runtime 身份。
    const MODEL_PROVIDER_PUBLISH_URL = './adminsmart/model-provider/publish' // 只提交官方 Provider 路由 ID，Key 由 Host 自行解析。
    const ADMIN_MODELS_URL = './adminsmart/admin-models' // 开发与生产管理员通过同一受保护 Host 管理各自环境的官方 Provider/Credentials。
    const ADMIN_MODELS_DISCOVER_URL = './adminsmart/admin-models/discover' // 仅管理员点击时调用官方 LLM 模型发现服务。
    const ADMIN_MODEL_PROTOCOLS = Object.freeze([
      { id: 'openai-responses', label: 'OpenAI Responses' }, // 原生 Responses 工具和文本协议。
      { id: 'openai-completions', label: 'OpenAI Chat Completions' }, // OpenAI 兼容模型协议。
      { id: 'anthropic-messages', label: 'Anthropic Messages' }, // Anthropic 原生消息协议。
    ])
    const PRIVATE_MODEL_REASONING_URL = './adminsmart/private-model-reasoning' // 官方私有模型的等级直接保存到 Harness Profile，不要求先发布。
    const MODEL_CONFIGURATION_URL = './adminsmart/model-configuration' // 服务端保存聊天模型思考等级与新会话兜底；固定知识处理不通过此目录选择模型。
    const MODEL_SYNC_RETRY_DELAYS_MS = Object.freeze([400, 800, 1200, 1800, 2500]) // 官方设置保存与 Host 后台发布之间的短暂竞态只重读五次，不常驻轮询。
    const MODEL_DEFAULTS_URL = './adminsmart/model-defaults' // 当前登录用户可见目录的逐模型默认等级，不包含 Key。

    /**
     * 官方语音 Client 依赖插件导航；普通用户没有插件管理页时仅补齐其启动依赖。
     * @param {object} ctx 当前 Harness Client Context。
     * @returns {void} Host 的公开启动标记让普通用户依赖在同步启动阶段完成注册。
     */
    function installNonAdminPluginNavigation(ctx) {
      if (window.__ADMINSMART_RUNTIME_ROLE__ !== 'managed-user') return // 管理员仍使用官方导航；标记不承担后端授权。
      if (ctx.reflect.get('pluginNavigation')) return
      ctx.reflect.provide('pluginNavigation', {
        openBundle: () => undefined, // 普通用户不能通过语音引导打开插件管理页。
      }) // Cordis 生命周期自动释放同步注册的服务，不进行角色网络探测。
    }

    /** @param {object} model 当前官方模型能力。 @returns {string|undefined} 有效默认或第一个真实非关闭等级，不伪造档位。 */
    function configuredReasoningEffort(model) {
      const availableEfforts = Array.isArray(model?.reasoning?.efforts)
        ? model.reasoning.efforts.map(effort => effort?.id).filter(Boolean)
        : [] // 原生目录已按固定 Harness 的等级顺序返回实际能力。
      if (availableEfforts.includes(model?.reasoning?.defaultEffort)) return model.reasoning.defaultEffort
      return availableEfforts.find(effort => effort !== 'off') ?? availableEfforts[0]
    }

    /** @param {object} state - Official ModelDirectoryState snapshot. @returns {object|null} First configured model selection. */
    function firstAvailableModelSelection(state) {
      for (const group of Array.isArray(state?.groups) ? state.groups : []) {
        const model = Array.isArray(group?.models) ? group.models[0] : undefined // Provider 目录中按服务端配置顺序排列的第一个可用模型。
        if (!group?.id || !model?.id) continue
        const defaultEffort = configuredReasoningEffort(model) // 首次使用必须明确选择配置中仍存在的等级。
        return {
          provider: group.id, // 当前第一个可用 Provider 路由键。
          model: model.id, // Provider 配置顺序中的第一个可用模型 ID。
          ...(defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort }) // 未声明默认等级时交给供应商默认行为。
        }
      }
      return null
    }

    /** @param {object|null} left - First selection. @param {object|null} right - Second selection. @returns {boolean} Exact selection equality. */
    function sameModelSelection(left, right) {
      return left === right || Boolean(
        left
        && right
        && left.provider === right.provider
        && left.model === right.model
        && left.reasoningEffort === right.reasoningEffort
      )
    }

    /** @param {object} state - Official ModelDirectoryState snapshot. @returns {object|null} Required repair selection, or null when memory is valid. */
    function repairedModelSelection(state) {
      if (state?.status !== 'ready' || !Array.isArray(state.groups) || !state.groups.length) return null
      const fallback = firstAvailableModelSelection(state) // 首次进入或失效模型统一回退当前目录第一个模型。
      if (fallback === null) return null
      const current = state.current // Session 投影中的下一次请求模型；可能来自已经删除的历史配置。
      if (current === null) return fallback
      const currentGroup = state.groups.find(group => group?.id === current.provider) // 当前 Provider 是否仍在实时目录。
      const currentModel = currentGroup?.models?.find(model => model?.id === current.model) // 当前模型是否仍由该 Provider 列出。
      if (!currentGroup || !currentModel || state.routable === false) {
        return sameModelSelection(current, fallback) ? null : fallback
      }
      const availableEfforts = new Set(
        Array.isArray(currentModel.reasoning?.efforts)
          ? currentModel.reasoning.efforts.map(effort => effort?.id).filter(Boolean)
          : []
      ) // 当前模型配置更新后仍然存在的思考等级。
      if (availableEfforts.has(current.reasoningEffort)) return null
      const defaultEffort = configuredReasoningEffort(currentModel) // 首次未选等级或旧等级失效时，都回到真实配置项。
      const repaired = {
        provider: current.provider, // 模型仍有效时保留用户选择的 Provider。
        model: current.model, // 模型仍有效时只修复思考等级。
        ...(defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort })
      } // 不再提交已关闭或已删除的历史等级。
      return sameModelSelection(current, repaired) ? null : repaired
    }

    /** @param {object} state 官方模型目录快照。 @param {object|null} preference 用户最近主动选择。 @returns {object|null} 当前目录可用的偏好选择。 */
    function availablePreferredModelSelection(state, preference) {
      if (state?.status !== 'ready' || !preference) return null
      const group = state.groups?.find(item => item?.id === preference.provider) // 偏好 Provider 必须仍存在于当前实时目录。
      const model = group?.models?.find(item => item?.id === preference.model) // 偏好模型必须仍属于原 Provider。
      if (!group || !model) return null
      const availableEfforts = new Set(
        Array.isArray(model.reasoning?.efforts)
          ? model.reasoning.efforts.map(effort => effort?.id).filter(Boolean)
          : []
      ) // 已删除思考等级不能阻止模型本身继续继承。
      const preferredEffort = availableEfforts.has(preference.reasoningEffort)
        ? preference.reasoningEffort
        : configuredReasoningEffort(model)
      return {
        provider: group.id,
        model: model.id,
        ...(preferredEffort === undefined ? {} : { reasoningEffort: preferredEffort })
      }
    }

    const ADMINSMART_UI_STYLES = `
/* 手机侧栏浮层在桌面完全隐藏，避免留下重复的无样式开启按钮。 */
[data-adminsmart-mobile-sidebar-overlay] {
  display: none;
}
/* AdminSmart brand: match the host system's selected navigation color. */
[data-adminsmart-brand-mark="true"] {
  background: transparent !important;
}

/* Mobile composer and notices remain independent of the removed custom sidebar. */
@media ${MOBILE_SHELL_MEDIA_QUERY} {
  :root,
  :root * {
    user-select: none !important;
    -webkit-user-select: none !important;
    -webkit-touch-callout: none !important;
    -webkit-tap-highlight-color: transparent !important;
  }
  :where(input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]) {
    user-select: text !important;
    -webkit-user-select: text !important;
    -webkit-touch-callout: default !important;
  }
  ::selection {
    color: inherit;
    background: rgba(86, 93, 105, 0.18);
  }
  [data-slot="conversation.composer.dock"] {
    display: none !important;
  }
  [data-slot="conversation.composer.bar"] > * {
    padding-bottom: max(8px, env(safe-area-inset-bottom)) !important;
  }
  [data-composer-input="true"],
  [data-composer-placeholder="true"] {
    font-size: 16px !important;
  }
  button[aria-label="上传图片"]:disabled {
    display: none !important;
  }
  button[aria-label^="上下文已用"],
  button[aria-label^="Context used"] {
    display: none !important;
  }
  body > [role="status"][aria-live="polite"][aria-atomic="true"] {
    top: calc(64px + env(safe-area-inset-top)) !important;
    box-sizing: border-box;
    max-width: calc(100vw - 24px);
    text-align: center;
    white-space: normal;
  }
}

/* AdminSmart Session web switch follows the shared composer control rhythm. */
.adminsmart-composer-tools {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.adminsmart-web-toggle {
  box-sizing: border-box;
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: var(--dsw-alias-label-primary, #303133);
  background: var(--dsw-specific-selector, #f5f7fa);
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}
.adminsmart-web-toggle:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-solid, #ecf5ff);
}
.adminsmart-web-toggle[data-state="on"] {
  color: #3964fe;
  background: #e4edfd;
}
.adminsmart-web-toggle[data-state="on"]:hover:not(:disabled) {
  color: #3964fe;
  background: #e4edfd;
}
.adminsmart-web-toggle:focus-visible {
  outline: 2px solid ${ADMINSMART_PRIMARY_COLOR};
  outline-offset: 2px;
}
.adminsmart-web-toggle:disabled {
  cursor: default;
  opacity: 0.5;
}

  .adminsmart-web-toggle-message {
    max-width: 180px;
    overflow: hidden;
    font-size: 12px;
    color: #f56c6c;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

/* Public administrator Models seat mirrors the fixed native settings hierarchy through owned classes and theme tokens. */
.adminsmart-public-models {
  display: flex;
  max-width: 720px;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
  color: var(--dsw-alias-label-primary);
}
.adminsmart-public-models__header,
.adminsmart-public-models__actions,
.adminsmart-public-models__provider-head,
.adminsmart-public-models__model-heading,
.adminsmart-public-models__catalog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.adminsmart-public-models__header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
}
.adminsmart-public-models__intro {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  line-height: 22px;
}
.adminsmart-public-models__provider-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.adminsmart-public-models__provider-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  border: .5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
}
.adminsmart-public-models__provider-main {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
  gap: 6px;
}
.adminsmart-public-models__provider-main strong {
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-public-models__tag {
  flex: none;
  padding: 1px 6px;
  border: .5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xs);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}
.adminsmart-public-models__credential-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-state-error-primary);
}
.adminsmart-public-models__credential-dot[data-configured="true"] {
  background: var(--dsw-alias-state-success-primary);
}
.adminsmart-public-models__meta,
.adminsmart-public-models__empty,
.adminsmart-public-models__catalog-meta {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.adminsmart-public-models__actions {
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-left: auto;
}
.adminsmart-public-models__actions button {
  white-space: nowrap;
}
.adminsmart-public-models__provider-divider {
  height: .5px;
  background: var(--dsw-alias-border-l3);
}
.adminsmart-public-models__reasoning-toggle {
  align-self: flex-start;
}
.adminsmart-public-models__status {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
}
.adminsmart-public-models__status[data-kind="error"] {
  color: var(--dsw-alias-state-error-primary);
}
.adminsmart-public-models__status[data-kind="ok"] {
  color: var(--dsw-alias-state-success-primary);
}
.adminsmart-public-models__add {
  min-height: 44px;
  width: 100%;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-lg);
  background: transparent;
}
.adminsmart-public-models__form {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-module-platform);
}
.adminsmart-public-models__new-card {
  padding: 12px 14px;
  border: .5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
}
.adminsmart-public-models__new-card .adminsmart-public-models__form {
  background: transparent;
  padding: 0;
}
.adminsmart-public-models__form-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}
.adminsmart-public-models__advanced-trigger {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  min-height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.adminsmart-public-models__advanced-trigger[aria-expanded="false"] svg {
  transform: rotate(-90deg);
}
.adminsmart-public-models__advanced-trigger:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.adminsmart-public-models__fields,
.adminsmart-public-models__model-advanced {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.adminsmart-public-models__field {
  display: grid;
  min-width: 0;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}
.adminsmart-public-models__field--wide {
  grid-column: 1 / -1;
}
.adminsmart-public-models__input,
.adminsmart-public-models__protocol {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.adminsmart-public-models__protocol {
  min-height: 32px;
  border: .5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
}
.adminsmart-public-models__catalog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 12px;
  border-top: .5px solid var(--dsw-alias-border-l3);
}
.adminsmart-public-models__catalog-head strong {
  font-size: 14px;
  font-weight: 500;
}
.adminsmart-public-models__model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.adminsmart-public-models__model {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  padding: 6px;
  border: .5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
}
.adminsmart-public-models__model-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 28px 28px;
  align-items: center;
  gap: 6px;
}
.adminsmart-public-models__model-row button {
  width: 28px;
  height: 28px;
  min-width: 28px;
  padding: 0;
}
.adminsmart-public-models__model-advanced {
  padding: 8px 4px 2px;
}
.adminsmart-public-models__check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  grid-column: 1 / -1;
  font-size: 13px;
}
.adminsmart-public-models__discovery-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  margin: 8px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.adminsmart-public-models__discovery {
  min-width: 0;
}
.adminsmart-public-models__discovery-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-md);
  cursor: pointer;
}
.adminsmart-public-models__discovery-item:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.adminsmart-public-models__discovery-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-public-models__dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 640px) {
  .adminsmart-public-models__fields,
  .adminsmart-public-models__model-advanced {
    grid-template-columns: minmax(0, 1fr);
  }
  .adminsmart-public-models__provider-head,
  .adminsmart-public-models__catalog-head {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .adminsmart-public-models__model-row {
    grid-template-columns: minmax(0, 1fr) 28px 28px;
  }
  .adminsmart-public-models__model-row .adminsmart-public-models__input:nth-child(2) {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}

.adminsmart-custom-reasoning {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding-top: 14px;
}
.adminsmart-custom-reasoning__heading {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
}
.adminsmart-custom-reasoning__intro {
  margin: -4px 0 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.adminsmart-custom-reasoning__provider {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.adminsmart-custom-reasoning__provider-title {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
}
.adminsmart-custom-reasoning__model {
  overflow: hidden;
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: var(--dsw-elevation-stroke);
}
.adminsmart-custom-reasoning__model-header {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
}
.adminsmart-custom-reasoning__model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}
.adminsmart-custom-reasoning__model-id {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-custom-reasoning__editor {
  display: flex;
  flex-direction: column;
  gap: 9px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 10px 12px 12px;
}
.adminsmart-custom-reasoning__level {
  display: grid;
  grid-template-columns: 20px 64px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.adminsmart-custom-reasoning__level input[type="text"] {
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 7px;
  padding: 0 8px;
  outline: none;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-family: var(--ds-font-family-code);
  font-size: 12px;
}
.adminsmart-custom-reasoning__level input[type="text"]:focus-visible {
  border-color: var(--dsw-alias-state-business-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent);
}
.adminsmart-custom-reasoning__default {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}
.adminsmart-custom-reasoning__default select {
  min-width: 120px;
  height: 30px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 7px;
  padding: 0 7px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
}
.adminsmart-custom-reasoning__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.adminsmart-custom-reasoning__save {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 5px;
  border: 0;
  border-radius: 7px;
  padding: 0 10px;
  background: var(--dsw-alias-state-business-primary);
  color: #fff;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.adminsmart-custom-reasoning__save:disabled {
  cursor: default;
  opacity: 0.5;
}
.adminsmart-model-policy {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding-top: 14px;
}
.adminsmart-model-policy__summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}
.adminsmart-model-policy__hint {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.adminsmart-model-policy__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.adminsmart-model-policy__default {
  min-width: min(100%, 280px);
  height: 32px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 7px;
  padding: 0 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
}
.adminsmart-model-policy__provider {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.adminsmart-model-policy__provider-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
}
.adminsmart-model-policy__model-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: var(--dsw-elevation-stroke);
}
.adminsmart-model-policy__model-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.adminsmart-model-policy__model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}
.adminsmart-model-policy__model-id {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-model-policy__reasoning {
  border: 0;
  border-radius: 6px;
  padding: 4px 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.adminsmart-model-policy__reasoning:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.adminsmart-model-policy__error {
  margin: 0;
  color: var(--dsw-alias-state-danger);
  font-size: 12px;
  line-height: 18px;
}
.adminsmart-model-policy__save {
  align-self: flex-end;
}
.adminsmart-provider-policy {
  margin-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding-top: 10px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
/* Official Provider-card seat: one compact entry and an on-demand per-model settings band. */
.adminsmart-model-configuration-seat {
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  margin-top: 10px;
  padding-top: 10px;
}
.adminsmart-model-configuration-seat__trigger,
.adminsmart-model-configuration__uses button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  justify-content: center;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 6px;
  padding: 0 10px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.adminsmart-model-configuration-seat__trigger:hover,
.adminsmart-model-configuration__uses button:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2);
}
.adminsmart-model-configuration-seat__trigger:focus-visible,
.adminsmart-model-configuration__uses button:focus-visible,
.adminsmart-model-configuration__effort:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.adminsmart-model-configuration {
  display: flex;
  min-width: 0;
  flex-direction: column;
  margin-top: 8px;
}
.adminsmart-model-configuration__row {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) minmax(0, 240px);
  align-items: center;
  gap: 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 10px 0;
}
.adminsmart-model-configuration__name {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.adminsmart-model-configuration__effort {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 32px;
  justify-content: space-between;
  border: 0;
  border-radius: 8px;
  padding: 0 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  font-weight: 500;
}
.adminsmart-model-configuration__effort:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
}
.adminsmart-model-configuration__effort-menu {
  display: inline-flex;
  min-width: 0;
  width: 100%;
}
.adminsmart-model-configuration__effort-list {
  box-sizing: border-box;
  width: 240px;
  min-width: 240px;
  max-width: 240px;
  background: var(--dsw-alias-bg-layer-1);
  backdrop-filter: none;
}
.adminsmart-model-configuration__effort-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adminsmart-model-configuration__uses {
  display: flex;
  grid-column: 1 / -1;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.adminsmart-model-configuration__use-state {
  align-self: center;
  color: var(--dsw-alias-state-business-primary);
  font-size: 12px;
}
.adminsmart-model-configuration__uses button:disabled {
  cursor: default;
  opacity: 0.55;
}
.adminsmart-model-configuration__state {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.adminsmart-private-reasoning {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.adminsmart-private-reasoning__title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
}
.adminsmart-private-reasoning__model {
  min-width: 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 8px 0;
}
.adminsmart-private-reasoning__model-head {
  display: flex;
  min-height: 34px;
  align-items: center;
  gap: 10px;
}
.adminsmart-private-reasoning__model-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.adminsmart-private-reasoning__name {
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 17px;
}
.adminsmart-private-reasoning__count {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 15px;
}
.adminsmart-private-reasoning__edit,
.adminsmart-private-reasoning__cancel,
.adminsmart-provider-policy__publish button {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 6px;
  padding: 0 9px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
}
.adminsmart-private-reasoning__edit:hover,
.adminsmart-private-reasoning__cancel:hover,
.adminsmart-provider-policy__publish button:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.adminsmart-private-reasoning__edit:focus-visible,
.adminsmart-private-reasoning__cancel:focus-visible,
.adminsmart-provider-policy__publish button:focus-visible,
.adminsmart-private-reasoning__level input:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.adminsmart-private-reasoning__editor {
  margin-top: 9px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 10px 0 2px;
}
.adminsmart-private-reasoning__level {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 36px;
}
.adminsmart-private-reasoning__toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  cursor: pointer;
}
.adminsmart-private-reasoning__toggle input {
  margin: 0;
}
.adminsmart-private-reasoning__level input[type="text"] {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  height: 28px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 6px;
  padding: 0 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.adminsmart-private-reasoning__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.adminsmart-private-reasoning__edit:disabled,
.adminsmart-private-reasoning__cancel:disabled,
.adminsmart-provider-policy__publish button:disabled {
  cursor: default;
  opacity: 0.5;
}
.adminsmart-provider-policy__publish {
  display: flex;
  justify-content: flex-end;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 10px 0 0;
}
.adminsmart-model-policy--card {
  border-top: 0;
  padding-top: 8px;
}
.adminsmart-model-policy--card .adminsmart-model-policy__model-row {
  grid-template-columns: 20px minmax(0, 1fr);
}
@media (max-width: 640px) {
  /* 手机模型名称与用途/等级分别占整行，不让右侧控件挤出逐字换行。 */
  .adminsmart-model-configuration__row {
    grid-template-columns: minmax(0, 1fr);
  }
  .adminsmart-model-configuration__effort-list {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }
  .adminsmart-custom-plugin-cards {
    grid-template-columns: minmax(0, 1fr);
  }
  .adminsmart-custom-reasoning__level {
    grid-template-columns: 20px 52px minmax(0, 1fr);
  }
}

@media ${MOBILE_SHELL_MEDIA_QUERY} {
  /* 原生设置手机布局：标题与原生关闭工具同排，导航与内容各占整行。 */
  [data-adminsmart-settings-dialog="true"] {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 12px;
    width: calc(100vw - 24px) !important;
    max-width: calc(100vw - 24px) !important;
    max-height: calc(100dvh - 24px) !important;
    box-sizing: border-box;
    padding: 16px !important;
  }
  [data-adminsmart-settings-part="navigation"],
  [data-adminsmart-settings-part="pane"] {
    display: contents !important;
  }
  [data-adminsmart-settings-part="title"] {
    grid-area: 1 / 1;
    align-self: center;
    min-width: 0;
    margin: 0 !important;
  }
  [data-adminsmart-settings-part="header"] {
    grid-area: 1 / 1;
    justify-content: flex-end !important;
    min-width: 0;
  }
  [data-adminsmart-settings-part="tabs"] {
    grid-area: 2 / 1;
    display: flex !important;
    min-width: 0;
    flex-direction: row !important;
    flex-wrap: nowrap;
    gap: 4px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }
  [data-adminsmart-settings-part="tabs"] button {
    width: auto !important;
    min-height: 44px;
    flex: 0 0 auto;
    white-space: nowrap;
  }
  [data-adminsmart-settings-part="header"] button {
    min-width: 44px;
    min-height: 44px;
  }
  [data-adminsmart-settings-part="content"] {
    grid-area: 3 / 1;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .adminsmart-public-models__model-heading {
    flex-wrap: wrap;
  }
  .adminsmart-public-models__model-heading > :first-child {
    min-width: 0;
    flex-basis: 100%;
  }
  .adminsmart-public-models__actions {
    max-width: 100%;
    margin-left: 0;
    justify-content: flex-start;
  }
  .adminsmart-web-toggle {
    width: 28px;
    height: 28px;
    flex-basis: 28px;
  }
  [data-adminsmart-mobile-frame] {
    grid-template-columns: 0px minmax(0px, 1fr) 0px !important;
  }
  /* 手机顶栏为两侧命令保留固定空间，官方会话标题仍在正常文档流中。 */
  [data-adminsmart-mobile-frame] header:has(> [data-conversation-header-leading]) {
    --dsh-frame-leading-clearance: 68px;
    box-sizing: border-box;
    min-height: calc(56px + env(safe-area-inset-top)) !important;
    padding-top: calc(8px + env(safe-area-inset-top)) !important;
    padding-right: 60px !important;
    padding-bottom: 8px !important;
  }
  [data-adminsmart-mobile-sidebar] {
    overflow: visible !important;
    border-right: 0 !important;
  }
  [data-adminsmart-mobile-sidebar] [data-slot="sidebar"] > * {
    position: fixed;
    z-index: 30;
    top: 0;
    bottom: 0;
    left: 0;
    box-sizing: border-box;
    width: min(320px, calc(100vw - 48px)) !important;
    height: 100dvh;
    transform: translateX(-100%);
    visibility: hidden;
    pointer-events: none;
    transition: transform 200ms ease;
  }
  [data-adminsmart-mobile-sidebar-open="true"] [data-adminsmart-mobile-sidebar] [data-slot="sidebar"] > * {
    transform: translateX(0);
    visibility: visible;
    pointer-events: auto;
  }
  [data-adminsmart-mobile-sidebar-overlay] {
    display: block;
    position: absolute;
    inset: 0;
    pointer-events: none !important;
  }
  [data-adminsmart-mobile-sidebar-trigger],
  [data-adminsmart-mobile-logout] {
    position: absolute;
    z-index: 2;
    top: calc(6px + env(safe-area-inset-top));
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 8px;
    color: var(--dsw-alias-label-primary);
    background: transparent;
    font: inherit;
    font-size: 13px;
    letter-spacing: 0;
    pointer-events: auto;
    cursor: pointer;
  }
  [data-adminsmart-mobile-sidebar-trigger] { left: 6px; }
  [data-adminsmart-mobile-logout] { right: 6px; }
  [data-adminsmart-mobile-sidebar-trigger]:hover,
  [data-adminsmart-mobile-logout]:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
  [data-adminsmart-mobile-sidebar-trigger]:focus-visible,
  [data-adminsmart-mobile-logout]:focus-visible {
    outline: 2px solid var(--dsw-alias-state-business-primary);
    outline-offset: -3px;
  }
  [data-adminsmart-mobile-logout]:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  [data-adminsmart-mobile-sidebar-backdrop] {
    position: absolute;
    inset: 0;
    left: min(320px, calc(100vw - 48px));
    display: none;
    padding: 0;
    border: 0;
    background: rgb(0 0 0 / 36%);
    pointer-events: auto;
    cursor: pointer;
  }
  [data-adminsmart-mobile-sidebar-open="true"] [data-adminsmart-mobile-sidebar-trigger] {
    display: none;
  }
  [data-adminsmart-mobile-sidebar-open="true"] [data-adminsmart-mobile-sidebar-backdrop] {
    display: block;
  }
  @media (prefers-reduced-motion: reduce) {
    [data-adminsmart-mobile-sidebar] [data-slot="sidebar"] > * {
      transition: none;
    }
  }
}
` // Scoped CSS uses stable AdminSmart classes and semantic data attributes, never upstream hashed class names.

    /** Install or refresh the single AdminSmart stylesheet owned by this Client plugin. */
    function installAdminSmartStyles() {
      let styleElement = document.querySelector(`style[data-adminsmart-style="${ADMINSMART_STYLE_ID}"]`) // Existing HMR style node, when present.
      if (!styleElement) {
        styleElement = document.createElement('style')
        styleElement.setAttribute('data-adminsmart-style', ADMINSMART_STYLE_ID)
        document.head.appendChild(styleElement)
      }
      if (styleElement.textContent !== ADMINSMART_UI_STYLES) styleElement.textContent = ADMINSMART_UI_STYLES
      return styleElement
    }

    /**
     * 通过官方布局动作和浮层插槽呈现原生手机侧栏，不复制会话树。
     * @param {object} props 插槽注入的公开布局服务。
     * @param {object} props.layout Harness 布局控制器，只调用官方 toggleSidebar。
     * @returns {object} 移动端开启按钮和可关闭遮罩。
     */
    function AdminSmartMobileSidebarOverlay({ layout }) {
      const overlayRef = useRef(null) // 自有节点用于定位公开浮层插槽，不读取会话正文或凭据。
      const logoutRequested = useRef(false) // 连续点击只能向主应用发出一次注销意图。
      const [loggingOut, setLoggingOut] = useState(false) // 发出意图后立即禁用按钮，等待宿主完成退出导航。
      useEffect(() => {
        const frame = overlayRef.current?.closest('[data-shell-overlay]')?.parentElement // Fixed-version Harness frame containing the public Slot seats.
        const sidebarColumn = frame?.querySelector('[data-slot="sidebar"]')?.parentElement // Native sidebar owner remains mounted in its official Slot.
        if (!frame || !sidebarColumn) return undefined
        const syncState = () => frame.setAttribute('data-adminsmart-mobile-sidebar-open', String(!frame.hasAttribute('data-sidebar-collapsed'))) // Reflect only official layout state; never maintain a second sidebar store.
        frame.setAttribute('data-adminsmart-mobile-frame', 'true')
        sidebarColumn.setAttribute('data-adminsmart-mobile-sidebar', 'true')
        const observer = new MutationObserver(syncState) // Native toggle, keyboard shortcut and route changes keep the drawer in sync.
        observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
        syncState()
        return () => {
          observer.disconnect()
          frame.removeAttribute('data-adminsmart-mobile-sidebar-open')
          frame.removeAttribute('data-adminsmart-mobile-frame')
          sidebarColumn.removeAttribute('data-adminsmart-mobile-sidebar')
        }
      }, [])
      /**
       * 把手机退出命令交给当前同源宿主，不直接操作任何认证状态。
       * @returns {void} 非手机、独立 Harness 页面或重复点击时不发送消息。
       */
      function requestLogout() {
        if (logoutRequested.current || !window.matchMedia(MOBILE_SHELL_MEDIA_QUERY).matches
          || !window.parent || window.parent === window) return
        logoutRequested.current = true
        setLoggingOut(true)
        window.parent.postMessage({ type: MOBILE_LOGOUT_MESSAGE_TYPE }, window.location.origin)
      }
      return jsxs('div', {
        ref: overlayRef,
        'data-adminsmart-mobile-sidebar-overlay': 'true',
        children: [
          jsx('button', {
            type: 'button',
            'aria-label': '打开侧边栏',
            'data-adminsmart-mobile-sidebar-trigger': 'true',
            onClick: () => layout.toggleSidebar(),
            title: '打开侧边栏',
            children: jsx(IconPanelLeftOutline20, { size: 18 })
          }),
          jsx('button', {
            type: 'button',
            'aria-label': '关闭侧边栏',
            'data-adminsmart-mobile-sidebar-backdrop': 'true',
            onClick: () => layout.toggleSidebar()
          }),
          jsx('button', {
            type: 'button',
            'aria-label': loggingOut ? '正在退出登录' : '退出登录',
            title: '退出登录',
            'data-adminsmart-mobile-logout': 'true',
            disabled: loggingOut,
            onClick: requestLogout,
            children: '退出'
          })
        ]
      })
    }

    /** Render the operator-provided AuraSearch logo requested by sidebar or hero geometry. */
    function AdminSmartMark({ size = 24, className }) {
      const edge = Math.max(20, Number(size) || 24) // Official slot owner controls mark geometry with a safe minimum.
      return jsx('img', {
        className,
        'data-adminsmart-brand-mark': 'true',
        src: AURASEARCH_LOGO_URL,
        alt: '',
        'aria-hidden': 'true',
        draggable: false,
        width: edge,
        height: edge,
        style: {
          display: 'block',
          width: `${edge}px`,
          height: `${edge}px`,
          borderRadius: '7px',
          clipPath: 'inset(0 round 7px)',
          objectFit: 'cover',
          boxShadow: '0 0 0 1px rgba(15, 17, 21, 0.08)'
        }
      })
    }

    /** Render the AuraSearch product name without any DSH or DeepSeek text. */
    function AdminSmartName() {
      return jsx('span', {
        'data-adminsmart-brand-name': 'true',
        style: {
          color: 'inherit',
          fontFamily: 'Inter, "Microsoft YaHei", sans-serif',
          fontSize: '14px',
          fontWeight: '600',
          lineHeight: '20px',
          letterSpacing: '0',
          whiteSpace: 'nowrap'
        },
        children: 'AuraSearch'
      })
    }

    /** 隐藏聊天区独立的系统提示词节点，仅影响显示，不删除模型实际使用的提示词或其它原生节点。 */
    function AdminSmartHiddenSystemPrompt() {
      return null
    }


    /**
     * 同步官方弹窗几何和栈深度；宿主只补 iframe 外遮罩，内层卸载后立即结束关闭过渡。
     * @param {boolean} open 当前是否存在官方弹窗。
     * @param {HTMLElement|null} dialogElement 当前最上层弹窗。
     * @param {number} depth 当前仍挂载的官方模态弹窗数。
     * @returns {void} 只向同源父页面发送非敏感几何和层级。
     */
    function publishModalOverlay(open, dialogElement, depth = 0) {
      if (!window.parent || window.parent === window) return
      const rectangle = open && dialogElement ? dialogElement.getBoundingClientRect() : null // Legacy hosts may still use dialog geometry; no text or form values cross the boundary.
      window.parent.postMessage({
        type: MODAL_OVERLAY_MESSAGE_TYPE, // Stable bridge command consumed by the Vue page host.
        open: Boolean(open), // Modal presence must not be lost while its first layout is still pending.
        depth: open ? depth : 0, // 嵌套官方弹窗关闭后，宿主可立即结束仅属于内层的全屏关闭过渡。
        rect: rectangle
          ? {
              left: rectangle.left,
              top: rectangle.top,
              width: rectangle.width,
              height: rectangle.height
            }
          : null
      }, window.location.origin)
    }

    /**
     * 收集需要让宿主页面同步遮罩的官方模态卡片。
     * 已由外部遮罩负责的卡片不重复参与宿主遮罩，保持每个弹窗只有一个遮罩所有者。
     * @returns {HTMLElement[]} 按 DOM 堆叠顺序排列的可见官方模态卡片。
     * @sideEffects 仅读取官方语义属性，不修改弹窗或关闭事件。
     */
    function visibleModalDialogs() {
      return [...document.querySelectorAll('[role="dialog"][aria-modal="true"], dialog[open]')]
        .filter(dialog => {
          const explicitlyHidden = dialog.closest?.('[hidden], [aria-hidden="true"]') != null // Official modal cards mount only when open; CSS layout need not be complete yet.
          const belongsToExternalOverlay = dialog.closest?.('[data-external-overlay="true"]') != null
          return !explicitlyHidden && !belongsToExternalOverlay
        })
    }

    /**
     * 清理当前弹窗的自有设置布局标记，不修改官方角色、事件或表单值。
     * @param {HTMLElement} dialog 曾经识别为原生设置的弹窗节点。
     * @returns {void} 原生节点复用为其它弹窗时不会继承设置手机样式。
     */
    function clearSettingsLayoutMarkers(dialog) {
      dialog.removeAttribute('data-adminsmart-settings-dialog')
      for (const element of dialog.querySelectorAll('[data-adminsmart-settings-part]')) {
        element.removeAttribute('data-adminsmart-settings-part')
      }
    }

    /**
     * 识别固定版原生设置的语义标题及两区结构，只添加自有响应式标记。
     * @param {HTMLElement} dialog 官方已挂载的模态卡片，不读取用户字段或配置值。
     * @returns {void} 未识别结构保持官方原样，已识别结构仍由官方导航与关闭事件驱动。
     */
    function markSettingsLayout(dialog) {
      const [navigation, pane] = dialog.children ?? [] // 原生设置由导航区和内容区两部分组成。
      const [title, tabs] = navigation?.children ?? [] // 标题只接受设置的中英文精确文案。
      const [header, content] = pane?.children ?? [] // 原生打开文件及关闭工具与设置内容各自保留。
      const recognized = navigation?.tagName === 'NAV' && pane?.tagName === 'DIV'
        && navigation.children.length === 2 && pane.children.length === 2
        && ['设置', 'Settings'].includes(String(title?.textContent ?? '').trim())
        && tabs != null && header != null && content != null // 上游改变结构时不推断新的适配目标。
      if (!recognized) {
        if (dialog.hasAttribute?.('data-adminsmart-settings-dialog')) clearSettingsLayoutMarkers(dialog)
        return
      }
      if (dialog.getAttribute('data-adminsmart-settings-dialog') !== 'true') {
        dialog.setAttribute('data-adminsmart-settings-dialog', 'true')
      }
      for (const [element, part] of [[navigation, 'navigation'], [title, 'title'], [tabs, 'tabs'], [pane, 'pane'], [header, 'header'], [content, 'content']]) {
        if (element.getAttribute('data-adminsmart-settings-part') !== part) {
          element.setAttribute('data-adminsmart-settings-part', part) // 相同值不重复写入，避免 MutationObserver 自触发循环。
        }
      }
    }

    /**
     * Find the direct official mask sibling/child for one modal surface.
     * Harness Modal, SettingsPanel, and ImageLightbox all expose the mask as an
     * aria-hidden direct element, keeping close behavior in the official owner.
     * @param {HTMLElement} dialog Visible official modal card.
     * @returns {HTMLElement|null} Official mask element, or null when unavailable.
     */
    function modalMaskFor(dialog) {
      const directHiddenChild = element => [...(element?.children ?? [])]
        .find(child => child.getAttribute?.('aria-hidden') === 'true') ?? null
      const modalRoot = dialog?.parentElement?.getAttribute?.('role') === 'presentation'
        ? dialog.parentElement
        : null
      return directHiddenChild(modalRoot) || directHiddenChild(dialog)
    }

    /**
     * 读取或保存 Host 的权威联网设置；包括响应 JSON 读取在内均受超时控制。
     * @param {string} sessionId 当前官方 Session 身份。
     * @param {boolean|undefined} enabled 省略为读取，布尔值为显式保存。
     * @param {AbortSignal|undefined} signal Session 切换或组件卸载时的取消信号。
     * @returns {Promise<boolean>} 服务器确认的开关值。
     * @throws {Error} 超时、鉴权失败或响应无效；不把乐观状态当作已保存状态。
     */
    async function requestSessionWebAccess(sessionId, enabled, signal) {
      const controller = new AbortController() // 当前单次控制请求的超时与外层取消共用同一个控制器。
      const cancelRequest = () => controller.abort() // 只取消本次请求，不影响其它 Session 或聊天流。
      const timeoutId = setTimeout(cancelRequest, SESSION_WEB_ACCESS_TIMEOUT_MS) // 超时覆盖 HTTP 和响应体读取。
      signal?.addEventListener('abort', cancelRequest, { once: true })
      if (signal?.aborted) controller.abort()
      try {
        const attempts = enabled === undefined ? 4 : 1 // 初次读取允许等待 Host Session 在同一轮挂载完成；保存动作不得重复提交。
        let lastError // 只保留最后一次稳定错误，不把中间竞态暴露给用户。
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try {
            const response = await fetch(SESSION_WEB_ACCESS_URL, {
              method: enabled === undefined ? 'GET' : 'PUT', // 读取和明确保存使用不同 HTTP 方法。
              headers: {
                'Content-Type': 'application/json', // 小型 JSON 控制请求，不附加用户正文。
                'X-AdminSmart-Session': sessionId // Host 核验当前用户 Runtime 中实际加载的 Session。
              },
              ...(enabled === undefined ? {} : { body: JSON.stringify({ enabled }) }), // 客户端只能控制一个布尔字段。
              credentials: 'same-origin',
              cache: 'no-store',
              signal: controller.signal
            })
            const payload = await response.json() // 不吞掉取消异常，保证等待提示能够正确结束。
            if (!response.ok || typeof payload?.enabled !== 'boolean') throw new Error('联网设置暂时不可用')
            return payload.enabled
          } catch (reason) {
            if (controller.signal.aborted || signal?.aborted) throw reason
            lastError = reason
            if (attempt + 1 < attempts) await Promise.resolve() // 让 SessionProvider 完成当前挂载任务后立即重读。
          }
        }
        throw lastError || new Error('联网设置暂时不可用')
      } catch (reason) {
        if (controller.signal.aborted && !signal?.aborted) throw new Error('联网设置超时，请点击重试')
        throw reason
      } finally {
        clearTimeout(timeoutId)
        signal?.removeEventListener('abort', cancelRequest)
      }
    }

    /**
     * 读取或保存当前用户和业务模式的最近主动模型选择。
     * @param {string} sessionId 当前官方 Session 身份。
     * @param {object|undefined} selection 省略为读取，传入为保存。
     * @param {AbortSignal|undefined} signal Session 切换或插件卸载时的取消信号。
     * @returns {Promise<object|null>} Host 确认的公开模型选择。
     */
    async function requestModelPreference(sessionId, selection, signal) {
      const response = await fetch(MODEL_PREFERENCE_URL, {
        method: selection === undefined ? 'GET' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-AdminSmart-Session': sessionId
        },
        ...(selection === undefined ? {} : { body: JSON.stringify({ selection }) }),
        credentials: 'same-origin',
        cache: 'no-store',
        signal
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload === null || typeof payload !== 'object') throw new Error('模型偏好暂时不可用')
      if (payload.selection === null) return null
      const preferred = payload.selection
      if (!preferred || typeof preferred !== 'object' || !preferred.provider || !preferred.model) {
        throw new Error('模型偏好暂时不可用')
      }
      return {
        provider: String(preferred.provider),
        model: String(preferred.model),
        ...(preferred.reasoningEffort ? { reasoningEffort: String(preferred.reasoningEffort) } : {})
      }
    }

    /**
     * 渲染当前 Session 联网开关，状态从 Host 读取，失败可重试。
     * @param {object} props 官方输入区 Slot 参数。
     * @param {string} props.sessionId Slot 的公开 inject 回调提供的当前会话身份。
     * @returns {object} React 工具栏；卸载时取消请求，未知状态不显示为开启。
     */
    function AdminSmartComposerTools({ sessionId }) {
      const [webEnabled, setWebEnabled] = useState(null) // null 表示尚未读取权威状态，不能先画成蓝色假定已开启。
      const [webPending, setWebPending] = useState(true) // 初次读取和保存期间阻止重复点击。
      const [webError, setWebError] = useState('') // 只展示稳定、短小的联网设置失败说明。
      const webOperationRef = useRef(null) // 当前请求控制器，同时承担同步防重复点击和卸载取消。
      const activeSessionRef = useRef(sessionId) // 保存当前 Session 身份，过期响应不能更新其它会话。
      activeSessionRef.current = sessionId

      useEffect(() => {
        const controller = new AbortController() // Session 切换或组件卸载时终止旧状态请求。
        webOperationRef.current = controller
        if (!sessionId) {
          webOperationRef.current = null
          setWebPending(false)
          return () => { controller.abort() }
        }
        setWebEnabled(null) // 首次权威状态未知时保持中性色，后端缺省值仍为开启。
        setWebPending(true)
        setWebError('')
        void requestSessionWebAccess(sessionId, undefined, controller.signal).then(
          enabled => {
            if (!controller.signal.aborted && activeSessionRef.current === sessionId) setWebEnabled(enabled)
          },
          reason => {
            if (controller.signal.aborted) return
            setWebError(String(reason?.message || '联网设置暂时不可用'))
          }
        ).finally(() => {
          if (!controller.signal.aborted) {
            webOperationRef.current = null
            setWebPending(false)
          }
        })
        return () => {
          controller.abort()
          webOperationRef.current?.abort()
          webOperationRef.current = null
        }
      }, [sessionId])

      /** Persist the inverse switch state and update the button only after Host acceptance. */
      async function toggleWebAccess() {
        if (!sessionId || webPending || webOperationRef.current) return
        const requestedEnabled = webEnabled === null ? undefined : !webEnabled // 状态未知或上次失败先重读；已确认时才反转。
        const controller = new AbortController() // 保存请求可在组件卸载时中断。
        webOperationRef.current = controller
        setWebPending(true)
        setWebError('')
        try {
          const acceptedEnabled = await requestSessionWebAccess(sessionId, requestedEnabled, controller.signal) // Host 持久化后的权威状态。
          if (!controller.signal.aborted && activeSessionRef.current === sessionId) setWebEnabled(acceptedEnabled)
        } catch (reason) {
          if (controller.signal.aborted || activeSessionRef.current !== sessionId) return
          setWebEnabled(null) // 保存超时可能已提交，必须重读而不能沿用旧状态。
          setWebError(String(reason?.message || '联网设置暂时不可用'))
        } finally {
          if (webOperationRef.current === controller) webOperationRef.current = null
          if (!controller.signal.aborted && activeSessionRef.current === sessionId) setWebPending(false)
        }
      }

      const buttonLabel = webPending
        ? '正在读取联网设置'
        : webEnabled === null ? '重试联网设置' : webEnabled ? '关闭联网' : '开启联网' // 未知与失败不冒充开启。
      return jsxs('div', {
        className: 'adminsmart-composer-tools',
        'data-adminsmart-composer-tools': 'true',
        children: [
          jsx('button', {
            type: 'button',
            className: 'adminsmart-web-toggle',
            disabled: !sessionId || webPending,
            'data-state': webEnabled === null ? 'unknown' : webEnabled ? 'on' : 'off',
            'aria-label': buttonLabel,
            'aria-pressed': webEnabled === true,
            'aria-busy': webPending,
            title: webPending ? '正在读取联网设置' : webError || (webEnabled ? '联网已开启，点击关闭' : '联网已关闭，点击开启'),
            onClick: () => { void toggleWebAccess() },
            children: jsx(IconGlobeOutline14, { size: 14, 'aria-hidden': 'true' })
          }),
          webError
            ? jsx('span', {
                className: 'adminsmart-web-toggle-message',
                role: 'alert',
                title: webError,
                children: webError
              })
            : null
        ]
      })
    }



    /** Normalize one model's reasoning map without accepting credentials or arbitrary server fields. */
    function normalizeReasoningEfforts(value) {
      const efforts = {} // 当前模型允许的 Harness 等级到供应商线值映射。
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [rawId, rawWireValue] of Object.entries(value)) {
          const id = String(rawId).trim().toLowerCase() // 统一公开等级键，避免重复或控制字符进入表单。
          if (!/^[a-z][a-z0-9_-]{0,31}$/.test(id)) continue
          if (!ADMINSMART_REASONING_LEVELS.some(level => level.id === id)) continue // 协议读取保留聊天模型已有等级和合法 off 映射。
          const wireValue = rawWireValue === null || rawWireValue === undefined
            ? null
            : String(rawWireValue).trim() // 供应商线值只作为受限文本展示和提交，不在 Client 解释协议。
          if (wireValue !== null && (wireValue.length > 120 || /[\u0000-\u001f\u007f]/u.test(wireValue))) continue
          efforts[id] = wireValue
        }
      }
      return efforts
    }

    /** Normalize the admin-only Host model-reasoning response into a small UI snapshot. */
    function normalizeModelReasoningSnapshot(value) {
      const providers = Array.isArray(value?.providers) ? value.providers : [] // Host 只返回当前管理员可见 Provider，不含端点或凭据。
      return providers.map(provider => ({
        id: String(provider?.providerId ?? provider?.id ?? '').trim(), // 官方 ModelDirectory Provider 路由键。
        name: String(provider?.displayName ?? provider?.name ?? provider?.providerId ?? provider?.id ?? '').trim(), // 管理员可读的 Provider 名称。
        models: (Array.isArray(provider?.models) ? provider.models : []).map(model => ({
          id: String(model?.modelId ?? model?.id ?? '').trim(), // 官方模型路由键。
          name: String(model?.displayName ?? model?.name ?? model?.modelName ?? model?.modelId ?? model?.id ?? '').trim(), // 管理员可读的模型名称。
          reasoningEfforts: normalizeReasoningEfforts(model?.reasoningEfforts ?? model?.reasoning?.efforts), // 当前模型真实支持的等级映射。
          defaultReasoningEffort: typeof model?.defaultReasoningEffort === 'string'
            ? model.defaultReasoningEffort.trim().toLowerCase()
            : null, // 当前模型默认等级；无默认值时由供应商决定。
        })).filter(model => model.id),
      })).filter(provider => provider.id && provider.models.length)
    }

    /** Read the admin-only model reasoning catalog through the Host same-origin route. */
    async function requestModelReasoning(signal) {
      const response = await fetch(MODEL_REASONING_URL, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
        headers: { accept: 'application/json' }
      }) // Host authenticates the Runtime lease; the browser never sends a model credential.
      let payload = null // Bounded JSON response parsed only after the status check.
      try { payload = await response.json() } catch { /* A stable UI error is shown below. */ }
      if (!response.ok || payload === null || typeof payload !== 'object') throw new Error('模型思考等级暂时不可用')
      return normalizeModelReasoningSnapshot(payload)
    }

    /** Persist one model's reasoning map through the Host admin route. */
    async function saveModelReasoning({ providerId, modelId, reasoningEfforts, defaultReasoningEffort, nativeProviderId, nativeModelName }, signal) {
      const response = await fetch(MODEL_REASONING_URL, {
        method: 'PUT',
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ providerId, modelId, reasoningEfforts, defaultReasoningEffort, nativeProviderId, nativeModelName })
      }) // Host validates level ids, provider ownership and admin capability before writing configuration.
      let payload = null // Response body contains only the normalized model projection, never credentials.
      try { payload = await response.json() } catch { /* A stable UI error is shown below. */ }
      if (!response.ok || payload === null || typeof payload !== 'object') throw new Error('模型思考等级保存失败')
      const returnedModel = payload.model
        ?? payload.modelConfig
        ?? payload.providers?.find(provider => String(provider?.providerId ?? provider?.id ?? '') === providerId)?.models?.find(model => String(model?.modelId ?? model?.id ?? '') === modelId)
        ?? payload // Backend currently returns the normalized full provider catalog; keep a direct-model fallback for future Host revisions.
      return normalizeModelReasoningSnapshot({ providers: [{ providerId, displayName: providerId, models: [returnedModel] }] })[0]?.models[0]
    }

    /** Normalize the administrator model-policy response without accepting credentials or server paths. */
    function normalizeModelPolicySnapshot(value) {
      const models = Array.isArray(value?.models) ? value.models : [] // 当前动态 Chat 目录的非敏感模型行。
      return {
        revision: Number(value?.revision || 0), // 保存并发提示使用的服务端目录修订。
        defaultModelId: String(value?.defaultChatModelId || '').trim(), // 新会话失效后的默认模型身份。
        selectableModelIds: new Set((Array.isArray(value?.userSelectableChatModelIds) ? value.userSelectableChatModelIds : []).map(item => String(item || '').trim()).filter(Boolean)), // 普通用户可见模型白名单。
        models: models.map(model => ({
          id: String(model?.modelId || '').trim(), // 后端动态目录的稳定模型身份。
          providerId: String(model?.providerId || '').trim(), // 后端供应商连接身份，用于 reasoning 保存。
          harnessProviderId: String(model?.harnessProviderId || '').trim(), // 后端签发的官方 Provider 路由键；不能由显示名称猜测。
          provider: String(model?.provider || '').trim(), // 管理员可读的供应商名称。
          name: String(model?.displayName || model?.modelName || model?.modelId || '').trim(), // 管理员可读的模型名称。
          modelName: String(model?.modelName || '').trim(), // 供应商真实模型名，仅作为辅助信息展示。
          enabled: model?.enabled !== false, // 禁用模型保留历史配置但不能进入新会话白名单。
          reasoningEfforts: normalizeReasoningEfforts(model?.reasoningEfforts), // 当前模型可维护的 Harness 等级映射。
          defaultReasoningEffort: typeof model?.defaultReasoningEffort === 'string' ? model.defaultReasoningEffort.trim().toLowerCase() : null, // 当前模型的新会话默认等级。
        })).filter(model => model.id),
      }
    }

    /** Read the administrator default-model and ordinary-user allow-list policy. */
    async function requestModelPolicy(signal) {
      const response = await fetch(MODEL_POLICY_URL, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
        headers: { accept: 'application/json' },
      }) // Host authenticates the Runtime lease; the browser never supplies a user id or credential.
      let payload = null // Bounded JSON response parsed only after the status check.
      try { payload = await response.json() } catch { /* The component renders a stable error state below. */ }
      if (!response.ok || payload === null || typeof payload !== 'object') throw new Error('模型策略暂时不可用')
      if (payload.error !== undefined) throw new Error(String(payload.error.message || '模型策略暂时不可用'))
      return normalizeModelPolicySnapshot(payload)
    }

    /** Persist the administrator default model and ordinary-user allow-list policy. */
    async function saveModelPolicy({ defaultModelId, selectableModelIds }, signal) {
      const response = await fetch(MODEL_POLICY_URL, {
        method: 'PUT',
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          defaultChatModelId: defaultModelId,
          userSelectableChatModelIds: [...selectableModelIds],
        }),
      }) // Server validates that every selected identity is enabled and that the default is selectable.
      let payload = null // Response contains only the normalized non-sensitive catalog.
      try { payload = await response.json() } catch { /* The component renders a stable error state below. */ }
      if (!response.ok || payload === null || typeof payload !== 'object') throw new Error('模型策略保存失败')
      if (payload.error !== undefined) throw new Error(String(payload.error.message || '模型策略保存失败'))
      return normalizeModelPolicySnapshot(payload)
    }

    /** Publish the official provider's already-saved profile and credential through the Host. */
    async function publishModelProvider(providerId) {
      const response = await fetch(MODEL_PROVIDER_PUBLISH_URL, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ providerId }),
      }) // 浏览器绝不提交、接收或记录真实 API Key。
      const payload = await response.json().catch(() => null) // Host 只返回受管目录或稳定错误。
      if (!response.ok || !payload || payload.error) throw new Error(String(payload?.error?.message || payload?.error || '发布业务模型失败'))
      return payload
    }

    /** Read or save one official Provider's per-model reasoning capabilities independently of publication. */
    async function requestPrivateModelReasoning(providerId, update, signal) {
      const response = await fetch(update === undefined
        ? `${PRIVATE_MODEL_REASONING_URL}?providerId=${encodeURIComponent(providerId)}`
        : PRIVATE_MODEL_REASONING_URL, {
        method: update === undefined ? 'GET' : 'PUT',
        credentials: 'same-origin', cache: 'no-store', signal,
        headers: { accept: 'application/json', ...(update === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(update === undefined ? {} : { body: JSON.stringify({ providerId, ...update }) }),
      }) // 凭据、端点和服务器文件路径均不经过 Client。
      const payload = await response.json().catch(() => null) // Host 只返回已保存的模型名和思考映射。
      if (!response.ok || !payload || !Array.isArray(payload.models)) throw new Error(String(payload?.error || '模型思考等级暂时不可用'))
      const models = payload.models.map(model => ({
        id: String(model?.id || '').trim(), // 官方 Provider 内真实模型 ID。
        name: String(model?.name || model?.id || '').trim(), // 当前模型显示名。
        reasoningEfforts: normalizeReasoningEfforts(model?.reasoningEfforts), // 后端允许的七档映射，未配置时为空。
      })).filter(model => model.id)
      return { models, warning: typeof payload.warning === 'string' ? payload.warning : '' } // 同步失败只作为明确告警，不能抹掉私有保存成功的结果。
    }

    /** Read or update the shared model-use projection without exposing the provider credential. */
    async function requestModelConfiguration(providerId, update, signal) {
      const response = await fetch(update === undefined
        ? `${MODEL_CONFIGURATION_URL}?providerId=${encodeURIComponent(providerId)}`
        : MODEL_CONFIGURATION_URL, {
        method: update === undefined ? 'GET' : 'PUT', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { accept: 'application/json', ...(update === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(update === undefined ? {} : { body: JSON.stringify({ providerId, ...update }) }),
      }) // 原生 Provider、Model 和当前管理员租约均由 Host 再次校验。
      const payload = await response.json().catch(() => null) // 只接收非敏感的模型用途列表。
      if (!response.ok || !payload || !Array.isArray(payload.models)) throw new Error(String(payload?.error || '模型配置暂时不可用'))
      return payload.models.map(model => ({
        id: String(model?.id ?? ''), // 官方 Provider 中的模型 ID。
        name: String(model?.name ?? model?.id ?? ''), // 官方可读模型名称。
        reasoningEfforts: normalizeReasoningEfforts(model?.reasoningEfforts), // 选择器只提供当前模型真正声明的档位。
        managedPublished: model?.managedPublished !== false, // 新官方模型尚未进入业务目录时触发短期重读；旧响应不误标未发布。
        defaultReasoningEffort: typeof model?.defaultReasoningEffort === 'string' ? model.defaultReasoningEffort : '', // 当前确认的单模型默认等级。
        isHarnessDefault: model?.isHarnessDefault === true, // 新会话兜底标记。
      })).filter(model => model.id)
    }

    /** Read only per-model default effort identities for the current signed Runtime. */
    async function requestModelDefaults(signal) {
      const response = await fetch(MODEL_DEFAULTS_URL, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { accept: 'application/json' },
      })
      const payload = await response.json().catch(() => null) // 公开目录只包含模型身份与等级，不返回连接和凭据。
      if (!response.ok || !Array.isArray(payload?.defaults)) throw new Error('模型默认等级暂时不可用')
      return new Map(payload.defaults.map(row => [`${row.provider}\u0000${row.model}`, String(row.effort)]))
    }

    /** Render the administrator policy for one official Provider card or for the global Models footer. */
    function AdminSmartModelPolicyFooter({ provider } = {}) {
      const [policyState, setPolicyState] = useState({ status: 'loading', models: [], defaultModelId: '', selectableModelIds: new Set(), error: '' }) // 官方模型目录扩展的当前服务端策略快照。
      const [drafts, setDrafts] = useState({}) // 每个模型的思考等级草稿，不直接修改服务端快照。
      const [expandedModels, setExpandedModels] = useState(new Set()) // 当前展开思考等级编辑器的模型身份集合。
      const [savingPolicy, setSavingPolicy] = useState(false) // 默认模型和白名单保存请求状态。
      const [policyMessage, setPolicyMessage] = useState('') // 最近一次策略保存结果的人类可读状态。

      const initializeDrafts = models => Object.fromEntries(models.map(model => [
        reasoningDraftKey(model.providerId, model.id),
        {
          efforts: { ...model.reasoningEfforts },
          defaultEffort: model.defaultReasoningEffort && Object.prototype.hasOwnProperty.call(model.reasoningEfforts, model.defaultReasoningEffort)
            ? model.defaultReasoningEffort
            : '',
          saving: false,
          error: '',
        },
      ])) // 模型目录加载后建立每行独立草稿，避免不同 Provider 互相覆盖。

      useEffect(() => {
        const controller = new AbortController() // 页签卸载时取消过期策略请求。
        setPolicyState(current => ({ ...current, status: 'loading', error: '' }))
        void requestModelPolicy(controller.signal).then(
          snapshot => {
            setPolicyState({ ...snapshot, status: 'ready', error: '' })
            setDrafts(initializeDrafts(snapshot.models))
          },
          error => {
            if (!controller.signal.aborted) setPolicyState(current => ({ ...current, status: 'error', error: String(error?.message || '模型策略暂时不可用') }))
          },
        )
        return () => { controller.abort() }
      }, [])

      const updateDraft = (key, updater) => {
        setDrafts(previous => ({
          ...previous,
          [key]: updater(previous[key] ?? { efforts: {}, defaultEffort: '', saving: false, error: '' }),
        }))
      }

      const toggleReasoningLevel = (key, levelId, enabled) => {
        updateDraft(key, draft => {
          const efforts = { ...draft.efforts } // 只修改当前模型的等级集合。
          if (enabled) efforts[levelId] = levelId === 'off' ? null : levelId
          else delete efforts[levelId]
          return {
            ...draft,
            efforts,
            defaultEffort: draft.defaultEffort === levelId && !enabled ? '' : draft.defaultEffort,
            error: '',
          }
        })
      }

      const updateReasoningWireValue = (key, levelId, value) => {
        updateDraft(key, draft => ({
          ...draft,
          efforts: { ...draft.efforts, [levelId]: levelId === 'off' && value.trim() === '' ? null : value },
          error: '',
        }))
      }

      const saveReasoning = async model => {
        const key = reasoningDraftKey(model.providerId, model.id) // 当前 Provider/model 的稳定草稿键。
        const draft = drafts[key]
        if (!draft || draft.saving || !model.providerId) return
        const selectedLevels = Object.keys(draft.efforts).filter(level => ADMINSMART_REASONING_LEVELS.some(item => item.id === level)) // 只提交 Harness 公开等级。
        if (selectedLevels.some(level => level !== 'off' && String(draft.efforts[level] ?? '').trim() === '')) {
          updateDraft(key, current => ({ ...current, error: '除“关闭”外，每个启用等级都必须填写线协议值。' }))
          return
        }
        const defaultEffort = draft.defaultEffort && selectedLevels.includes(draft.defaultEffort) ? draft.defaultEffort : null // 默认等级必须属于当前启用集合。
        const controller = new AbortController() // 单次 reasoning 保存的取消边界。
        updateDraft(key, current => ({ ...current, saving: true, error: '' }))
        try {
          const savedModel = await saveModelReasoning({
            providerId: model.providerId,
            modelId: model.id,
            reasoningEfforts: Object.fromEntries(selectedLevels.map(level => [level, draft.efforts[level]])),
            defaultReasoningEffort: defaultEffort,
            nativeProviderId: provider?.settingsNs === 'llm-pi-ai' ? provider.provider : undefined, // 官方管理员模型必须同步显示等级。
            nativeModelName: provider?.settingsNs === 'llm-pi-ai' ? model.modelName : undefined, // 后端稳定 ID 不替代官方模型名。
          }, controller.signal)
          const normalizedModel = savedModel ?? { ...model, reasoningEfforts: draft.efforts, defaultReasoningEffort: defaultEffort }
          setPolicyState(current => ({
            ...current,
            models: current.models.map(item => item.id === model.id && item.providerId === model.providerId
              ? { ...item, reasoningEfforts: { ...normalizedModel.reasoningEfforts }, defaultReasoningEffort: normalizedModel.defaultReasoningEffort ?? defaultEffort }
              : item),
          }))
          updateDraft(key, current => ({
            ...current,
            efforts: { ...normalizedModel.reasoningEfforts },
            defaultEffort: normalizedModel.defaultReasoningEffort ?? defaultEffort ?? '',
            saving: false,
            error: '',
          }))
        } catch (error) {
          updateDraft(key, current => ({ ...current, saving: false, error: String(error?.message || '模型思考等级保存失败') }))
        }
      }

      const savePolicy = async () => {
        if (savingPolicy || policyState.status !== 'ready' || !policyState.defaultModelId) return
        setSavingPolicy(true)
        setPolicyMessage('正在保存模型策略…')
        try {
          const snapshot = await saveModelPolicy({
            defaultModelId: policyState.defaultModelId,
            selectableModelIds: policyState.selectableModelIds,
          }, new AbortController().signal)
          setPolicyState({ ...snapshot, status: 'ready', error: '' })
          setDrafts(initializeDrafts(snapshot.models))
          setPolicyMessage('模型策略已保存，新的会话会使用当前默认模型。')
        } catch (error) {
          setPolicyMessage(String(error?.message || '模型策略保存失败'))
        } finally {
          setSavingPolicy(false)
        }
      }

      if (policyState.status === 'loading') return jsx('p', { className: 'adminsmart-custom-plugin-section__status', role: 'status', children: '正在读取模型策略…' })
      if (policyState.status === 'error') return jsx('p', { className: 'adminsmart-model-policy__error', role: 'alert', children: policyState.error })

      const groups = [] // 按后端 Provider 展示顺序分组，便于管理员核对模型归属。
      for (const model of policyState.models) {
        let group = groups.find(item => item.id === model.providerId)
        if (!group) {
          group = { id: model.providerId, name: model.provider || model.providerId, models: [] }
          groups.push(group)
        }
        group.models.push(model)
      }
      const managedGroups = provider ? groups.map(group => ({
        ...group,
        models: group.models.filter(model => model.harnessProviderId === provider.provider || provider.settingsNs === 'llm-pi-ai' && model.harnessProviderId === `agent-${provider.provider}`),
      })).filter(group => group.models.length) : groups // 后端显式路由键决定卡片归属，连接 ID 不必等于官方 Provider ID。
      if (provider && managedGroups.length === 0) return null // 未发布只隐藏共享权限，私有思考编辑仍在同一卡片显示。
      const renderReasoningEditor = model => {
        const key = reasoningDraftKey(model.providerId, model.id) // 当前模型的 reasoning 草稿身份。
        const draft = drafts[key] ?? { efforts: {}, defaultEffort: '', saving: false, error: '' } // 目录异步加载期间的空安全草稿。
        return jsxs('div', {
          className: 'adminsmart-custom-reasoning__editor',
          children: [
            ...ADMINSMART_REASONING_LEVELS.map(level => {
              const enabled = Object.prototype.hasOwnProperty.call(draft.efforts, level.id) // 当前模型是否启用该等级。
              const wireValue = enabled && draft.efforts[level.id] !== null ? String(draft.efforts[level.id]) : '' // 供应商线协议值。
              return jsxs('label', {
                className: 'adminsmart-custom-reasoning__level',
                children: [
                  jsx('input', { type: 'checkbox', checked: enabled, onChange: event => { toggleReasoningLevel(key, level.id, event.currentTarget.checked) }, 'aria-label': `启用${level.label}思考等级` }),
                  jsx('span', { children: level.label }),
                  jsx('input', { type: 'text', value: wireValue, disabled: !enabled, placeholder: level.id === 'off' ? '留空表示关闭' : '供应商线协议值', 'aria-label': `${level.label}线协议值`, onChange: event => { updateReasoningWireValue(key, level.id, String(event.currentTarget.value ?? '')) } }),
                ],
              }, level.id)
            }),
            jsxs('label', {
              className: 'adminsmart-custom-reasoning__default',
              children: [
                jsx('span', { children: '默认等级' }),
                jsx('select', {
                  value: draft.defaultEffort,
                  onChange: event => { updateDraft(key, current => ({ ...current, defaultEffort: String(event.currentTarget.value ?? '') })) },
                  children: [jsx('option', { value: '', children: '跟随供应商' }), ...ADMINSMART_REASONING_LEVELS.filter(level => Object.prototype.hasOwnProperty.call(draft.efforts, level.id)).map(level => jsx('option', { value: level.id, children: level.label }, level.id))],
                }),
              ],
            }),
            draft.error ? jsx('p', { className: 'adminsmart-model-policy__error', role: 'alert', children: draft.error }) : null,
            jsx('button', { type: 'button', className: 'adminsmart-custom-reasoning__save', disabled: draft.saving, onClick: () => { void saveReasoning(model) }, children: [jsx(IconCheckOutline16, { size: 14, 'aria-hidden': 'true' }), draft.saving ? '保存中…' : '保存思考等级'] }),
          ],
        })
      }

      return jsxs(provider ? 'div' : 'details', {
        className: provider ? 'adminsmart-model-policy adminsmart-model-policy--card' : 'adminsmart-model-policy',
        ...(provider ? {} : { open: true }), // 后端独立身份的共享模型必须直接可见，不能藏在官方卡片的非同名 Provider 后面。
        children: [
          provider ? null : jsx('summary', { className: 'adminsmart-model-policy__summary', children: 'Admin 模型策略' }),
          jsx('p', { className: 'adminsmart-model-policy__hint', children: provider ? '普通用户可用模型' : '新会话默认模型、普通用户可见模型与思考等级以 AdminSmart 后端目录为准；管理员 Runtime 可查看全部已启用的受管模型。' }),
          policyState.models.length === 0 || provider && managedGroups.length === 0 ? null : jsxs('div', {
            className: 'adminsmart-model-policy__toolbar',
            children: [
              provider ? null : jsx('select', {
                className: 'adminsmart-model-policy__default',
                value: policyState.defaultModelId,
                'aria-label': '新会话默认模型',
                onChange: event => {
                  const nextDefault = String(event.currentTarget.value ?? '')
                  setPolicyState(current => ({ ...current, defaultModelId: nextDefault }))
                },
                children: policyState.models.filter(model => model.enabled).map(model => jsx('option', { value: model.id, children: `${model.name} · ${model.provider}` }, model.id)),
              }),
              jsx('button', { type: 'button', className: 'adminsmart-custom-reasoning__save adminsmart-model-policy__save', disabled: savingPolicy, onClick: () => { void savePolicy() }, children: savingPolicy ? '保存中…' : '保存模型策略' }),
            ],
          }),
          managedGroups.map(group => jsxs('section', {
            key: group.id,
            className: 'adminsmart-model-policy__provider',
            children: [
              jsx('h4', { className: 'adminsmart-model-policy__provider-title', children: group.name }),
              group.models.filter(model => model.enabled).map(model => jsxs('div', {
                className: 'adminsmart-model-policy__model-row',
                children: [
                  jsx('input', {
                    type: 'checkbox',
                    checked: policyState.selectableModelIds.has(model.id),
                    'aria-label': `允许普通用户使用 ${model.name}`,
                    onChange: event => {
                      const next = new Set(policyState.selectableModelIds)
                      if (event.currentTarget.checked) next.add(model.id)
                      else next.delete(model.id)
                      setPolicyState(current => ({ ...current, selectableModelIds: next }))
                    },
                  }),
                  jsxs('span', { className: 'adminsmart-model-policy__model-copy', children: [jsx('span', { className: 'adminsmart-model-policy__model-name', children: model.name }), jsx('code', { className: 'adminsmart-model-policy__model-id', children: model.id })] }),
                  provider ? null : jsx('button', { type: 'button', className: 'adminsmart-model-policy__reasoning', 'aria-expanded': expandedModels.has(model.id), onClick: () => setExpandedModels(current => { const next = new Set(current); if (next.has(model.id)) next.delete(model.id); else next.add(model.id); return next }), children: expandedModels.has(model.id) ? '收起思考等级' : '配置思考等级' }),
                ],
              }, model.id), !provider && expandedModels.has(model.id) ? jsx('div', { key: `${model.id}:reasoning`, className: 'adminsmart-custom-reasoning__model', children: renderReasoningEditor(model) }) : null),
            ],
          })),
          policyMessage ? jsx('p', { className: 'adminsmart-custom-plugin-section__status', role: 'status', children: policyMessage }) : null,
        ],
      })
    }

    /** Edit actual official per-model reasoning before or after this Provider is shared. */
    function AdminSmartPrivateReasoning({ providerId }) {
      const [state, setState] = useState({ status: 'loading', models: [], error: '' }) // 当前私有 Provider 的官方模型目录快照。
      const [drafts, setDrafts] = useState({}) // 每个模型独立维护七档线值草稿。
      const [editingModelId, setEditingModelId] = useState('') // 只展开当前操作的模型，其它模型保持紧凑摘要。
      const [saving, setSaving] = useState('') // 单一保存中的模型身份，避免重复提交。
      const [message, setMessage] = useState('') // 最近一次成功保存的本地确认。

      useEffect(() => {
        const controller = new AbortController() // 切换 Provider 后取消迟到目录响应。
        setState({ status: 'loading', models: [], error: '' })
        setEditingModelId('')
        void requestPrivateModelReasoning(providerId, undefined, controller.signal).then(
          snapshot => {
            if (controller.signal.aborted) return
            setState({ status: 'ready', models: snapshot.models, error: '' })
            setDrafts(Object.fromEntries(snapshot.models.map(model => [model.id, { ...model.reasoningEfforts }])))
          },
          error => { if (!controller.signal.aborted) setState({ status: 'error', models: [], error: String(error?.message || '模型思考等级暂时不可用') }) },
        )
        return () => controller.abort()
      }, [providerId])

      const changeDraft = (modelId, levelId, value, enabled) => {
        setMessage('')
        setDrafts(current => {
          const efforts = { ...(current[modelId] ?? {}) } // 更新只属于当前官方模型。
          if (enabled === false) delete efforts[levelId]
          else efforts[levelId] = levelId === 'off' && String(value ?? '').trim() === '' ? null : value
          return { ...current, [modelId]: efforts }
        })
      }

      const save = async model => {
        if (saving) return
        const efforts = drafts[model.id] ?? {} // 当前用户已选择的等级和真实供应商线值。
        if (Object.entries(efforts).some(([id, wire]) => id !== 'off' && !String(wire ?? '').trim())) {
          setState(current => ({ ...current, error: '启用的思考等级必须填写供应商线协议值。' }))
          return
        }
        setSaving(model.id); setMessage('')
        try {
          const snapshot = await requestPrivateModelReasoning(providerId, { modelId: model.id, reasoningEfforts: efforts })
          setState({ status: 'ready', models: snapshot.models, error: snapshot.warning })
          setDrafts(current => ({ ...current, [model.id]: { ...(snapshot.models.find(item => item.id === model.id)?.reasoningEfforts ?? {}) } }))
          setMessage(`${model.name} 思考等级已保存`)
        } catch (error) {
          setState(current => ({ ...current, error: String(error?.message || '模型思考等级保存失败') }))
        } finally { setSaving('') }
      }

      if (state.status === 'loading') return jsx('p', { role: 'status', className: 'adminsmart-model-policy__hint', children: '正在读取模型…' })
      if (state.status === 'error' && !state.models.length) return jsx('p', { role: 'alert', className: 'adminsmart-model-policy__error', children: state.error })
      return jsxs('section', {
        className: 'adminsmart-private-reasoning',
        children: [
          jsx('h4', { className: 'adminsmart-private-reasoning__title', children: '模型思考等级' }),
          ...state.models.map(model => {
            const enabledCount = Object.keys(model.reasoningEfforts).length // 摘要只反映已保存能力，不把未提交草稿当成生效配置。
            const editing = editingModelId === model.id // 当前模型的表单展开状态。
            const editorId = `adminsmart-reasoning-${encodeURIComponent(providerId)}-${encodeURIComponent(model.id)}` // 按 Provider 和模型身份关联展开按钮与唯一表单。
            return jsxs('div', {
              className: 'adminsmart-private-reasoning__model',
              children: [
                jsxs('div', { className: 'adminsmart-private-reasoning__model-head', children: [
                  jsxs('div', { className: 'adminsmart-private-reasoning__model-copy', children: [
                    jsx('strong', { className: 'adminsmart-private-reasoning__name', children: model.name }),
                    jsx('span', { className: 'adminsmart-private-reasoning__count', children: enabledCount ? `已启用 ${enabledCount} 档` : '未配置' }),
                  ] }),
                  jsxs('button', { type: 'button', className: 'adminsmart-private-reasoning__edit', disabled: Boolean(saving), 'aria-expanded': editing, 'aria-controls': editing ? editorId : undefined, onClick: () => setEditingModelId(current => current === model.id ? '' : model.id), children: [jsx(IconEditOutline16, { size: 14, 'aria-hidden': 'true' }), editing ? '收起' : '配置'] }),
                ] }),
                editing ? jsxs('div', { id: editorId, className: 'adminsmart-private-reasoning__editor', children: [
                  ...ADMINSMART_REASONING_LEVELS.map(level => {
                    const enabled = Object.prototype.hasOwnProperty.call(drafts[model.id] ?? {}, level.id) // 当前模型的等级是否已打开。
                    const wire = enabled && drafts[model.id][level.id] !== null ? String(drafts[model.id][level.id]) : '' // 输入框保留未提交草稿。
                    return jsxs('div', { className: 'adminsmart-private-reasoning__level', children: [
                      jsxs('label', { className: 'adminsmart-private-reasoning__toggle', children: [
                        jsx('input', { type: 'checkbox', checked: enabled, 'aria-label': `${model.name} ${level.label}`, onChange: event => changeDraft(model.id, level.id, level.id === 'off' ? null : level.id, event.currentTarget.checked) }),
                        jsx('span', { children: level.label }),
                      ] }),
                      jsx('input', { type: 'text', value: wire, disabled: !enabled, placeholder: level.id === 'off' ? '留空关闭' : '供应商线值', 'aria-label': `${model.name} ${level.label}线值`, onChange: event => changeDraft(model.id, level.id, String(event.currentTarget.value ?? ''), true) }),
                    ] }, level.id)
                  }),
                  jsxs('div', { className: 'adminsmart-private-reasoning__actions', children: [
                    jsx('button', { type: 'button', className: 'adminsmart-private-reasoning__cancel', disabled: Boolean(saving), onClick: () => { setDrafts(current => ({ ...current, [model.id]: { ...model.reasoningEfforts } })); setEditingModelId(''); setState(current => ({ ...current, error: '' })) }, children: '取消' }),
                    jsx('button', { type: 'button', className: 'adminsmart-custom-reasoning__save', disabled: Boolean(saving), onClick: () => { void save(model) }, children: [jsx(IconCheckOutline16, { size: 14, 'aria-hidden': 'true' }), saving === model.id ? '保存中…' : '保存思考等级'] }),
                  ] }),
                ] }) : null,
              ],
            }, model.id)
          }),
          state.error ? jsx('p', { role: 'alert', className: 'adminsmart-model-policy__error', children: state.error }) : null,
          message ? jsx('p', { role: 'status', className: 'adminsmart-model-policy__hint', children: message }) : null,
        ],
      })
    }

    /**
     * Show saved models and their independent grades/uses in the official Provider card.
     * @param {object} props - Provider identity and the official Models-page snapshot.
     * @param {string} props.providerId - Saved route whose private models are read through the Host.
     * @param {object} props.providerSnapshot - New reference after an official Settings refresh; invalidates the old model list.
     * @param {boolean} [props.showEfforts=true] 是否展示高级推理等级；模型用途始终可见。
     * @returns {object} Current model rows, loading state, or a bounded error.
     */
    function AdminSmartModelConfiguration({ providerId, providerSnapshot, showEfforts = true }) {
      const [state, setState] = useState({ status: 'loading', models: [], error: '' }) // 当前 Provider 的非敏感共享模型用途。
      const [busyModelId, setBusyModelId] = useState('') // 单次操作的模型 ID，避免同一 Provider 内重复提交。
      const [openEffortModelId, setOpenEffortModelId] = useState('') // 当前展开官方 Menu 的模型 ID，避免多行菜单同时覆盖。
      const activeScope = useRef(null) // 当前 Provider 快照的取消作用域，切换或卸载后阻止迟到响应更新界面。
      const requestGeneration = useRef(0) // 单调递增的目录读取代数，写入开始后旧 GET 与同步重试立即失效。
      const pendingMutation = useRef(null) // 同步占用的写入身份，在 React 状态重绘之前阻止同一按钮重复提交。

      useEffect(() => {
        const priorProviderId = activeScope.current?.providerId // 同一路由刷新可以保留行，切换路由必须先撤下旧模型。
        activeScope.current?.controller.abort() // 重新挂载作用域时同时撤销尚未结束的旧读取或写入。
        const controller = new AbortController() // 切换供应商或关闭面板时忽略过期响应。
        const scope = {
          controller, // 卸载或切换时同时取消目录读取和保存请求。
          providerId, // 当前模型列表归属的非敏感官方路由身份。
          resumeSync: null, // 保存结束后必要时恢复新增模型的有界发布重读。
        } // 请求作用域不包含供应商端点或凭据。
        let generation = ++requestGeneration.current // 当前作用域允许的读取代数；保存结束后可接续有界同步。
        activeScope.current = scope
        pendingMutation.current = null
        if (priorProviderId !== providerId) setState({ status: 'loading', models: [], error: '' })
        setBusyModelId('')
        setOpenEffortModelId('')
        let retryTimer = null // 当前 Provider 快照唯一的待执行重读；卸载或下一次官方快照会取消。
        /**
         * Read the private models and converge only rows still waiting for managed publication.
         * @param {number} attempt - Current bounded retry index after the official Settings save.
         * @returns {Promise<void>} Settles after the confirmed rows or schedules one later GET; never writes credentials.
         */
        const load = async attempt => {
          if (controller.signal.aborted || activeScope.current !== scope || requestGeneration.current !== generation) return
          const readGeneration = generation // 本次 GET 的固定代数，后续恢复同步不能使旧响应重新有效。
          try {
            const models = await requestModelConfiguration(providerId, undefined, controller.signal) // Host 返回官方私有模型与受管发布状态。
            if (controller.signal.aborted || activeScope.current !== scope || requestGeneration.current !== readGeneration) return
            const unpublished = models.some(model => !model.managedPublished) // 只有新增而尚未同步的行需要后续 GET。
            const exhausted = unpublished && attempt >= MODEL_SYNC_RETRY_DELAYS_MS.length // 后台发布超过有界重试后不再显示“同步中”。
            setState({ status: 'ready', models, error: exhausted ? '模型未同步到业务目录，请检查供应商凭据和后端发布状态。' : '' })
            if (unpublished && !exhausted) {
              retryTimer = window.setTimeout(() => {
                retryTimer = null
                void load(attempt + 1)
              }, MODEL_SYNC_RETRY_DELAYS_MS[attempt]) // 设置事件到自动发布存在 300ms debounce，短期退避等待后端收敛。
            }
          } catch (error) {
            if (!controller.signal.aborted && activeScope.current === scope && requestGeneration.current === readGeneration) setState(current => ({
              ...current, status: current.models.length ? 'ready' : 'error',
              error: String(error?.message || '模型配置暂时不可用'),
            }))
          }
        }
        /** @returns {void} 保存后的权威目录仍有未发布行时，按原有界退避继续同步，不重启已失效的旧 GET。 */
        scope.resumeSync = () => {
          if (controller.signal.aborted || activeScope.current !== scope) return
          generation = requestGeneration.current
          if (retryTimer !== null) window.clearTimeout(retryTimer)
          retryTimer = window.setTimeout(() => {
            retryTimer = null
            void load(1)
          }, MODEL_SYNC_RETRY_DELAYS_MS[0])
        }
        void load(0)
        return () => {
          controller.abort()
          if (retryTimer !== null) window.clearTimeout(retryTimer)
          if (activeScope.current === scope) {
            activeScope.current = null
            requestGeneration.current += 1
            pendingMutation.current = null
          }
        }
      }, [providerId, providerSnapshot])

      /**
       * Persist one model's selected grades or independent business use through the admin Host route.
       * @param {object} model - Saved official Provider model containing its stable model ID.
       * @param {'efforts'|'harness'} action - 聊天模型五档能力集合，或新会话兜底用途；不参与固定知识处理。
       * @param {string[]} [value] - 五档身份集合，不包含供应商连接和凭据。
       * @returns {Promise<void>} 写入后重新 GET 权威状态；只更新管理员明确提交的聊天配置。
       * @throws 无；Host 拒绝或权威重读失败时显示面板错误并保留最后已确认状态。
       * @remarks 作用域变化会取消请求并丢弃旧响应；同步 Ref 防重覆盖 React 尚未重绘的窗口。
       */
       const update = async (model, action, value) => {
         if (pendingMutation.current || !activeScope.current || activeScope.current.controller.signal.aborted) return
         const scope = activeScope.current // 此次写入必须始终属于开始时的 Provider 作用域。
         const generation = ++requestGeneration.current // 使写入前已发出的 GET 及其后续定时重读失效。
         const mutation = {
           scope, // 写入归属的 Provider 作用域，防止切换后释放新作用域的锁。
           generation, // 这次写入开始后允许提交结果的读取代数。
           modelId: model.id, // 本次写入的非敏感模型身份。
         } // 同步防重和释放锁使用的唯一动作身份。
         /** @returns {boolean} 当前写入是否仍属于未卸载的 Provider 与最新代数。 */
         const isCurrent = () => activeScope.current === scope && !scope.controller.signal.aborted
           && requestGeneration.current === generation && pendingMutation.current === mutation // 只允许当前未卸载动作提交权威结果。
         pendingMutation.current = mutation
         setBusyModelId(model.id)
         setState(current => ({ ...current, error: '' }))
         try {
           await requestModelConfiguration(providerId, {
             modelId: model.id, action,
             ...(action === 'efforts' ? { reasoningEfforts: value } : {}),
           }, scope.controller.signal)
           if (!isCurrent()) return
           const models = await requestModelConfiguration(providerId, undefined, scope.controller.signal) // 写入返回不能代替官方能力与聊天兜底状态的权威重读。
           if (!isCurrent()) return
           setState({ status: 'ready', models, error: '' })
           if (models.some(item => !item.managedPublished)) scope.resumeSync() // 保存一个模型不能让其它尚未发布的行永久停在“同步中”。
         } catch (error) {
           if (!isCurrent()) return
           const message = String(error?.message || '模型配置保存失败') // 写入部分成功时重新读取权威状态，不把旧选择显示成已确认结果。
           const models = await requestModelConfiguration(providerId, undefined, scope.controller.signal).catch(() => null) // 重读失败仍保留原已确认快照，不用请求草稿伪装成功。
           if (!isCurrent()) return
           setState(current => ({ ...current, ...(models ? { models } : {}), error: message }))
           if (models?.some(item => !item.managedPublished)) scope.resumeSync()
         } finally {
           if (pendingMutation.current === mutation) {
             pendingMutation.current = null
             if (activeScope.current === scope && !scope.controller.signal.aborted) setBusyModelId('')
           }
         }
      }

      if (state.status === 'loading') return jsx('p', { role: 'status', className: 'adminsmart-model-configuration__state', children: '正在读取模型…' })
      if (state.status === 'error' && !state.models.length) return jsx('p', { role: 'alert', className: 'adminsmart-model-policy__error', children: state.error })
      return jsxs('div', { className: 'adminsmart-model-configuration', children: [
         ...state.models.map(model => {
           const selectedLevels = ADMINSMART_VISIBLE_REASONING_LEVELS.filter(level => Object.prototype.hasOwnProperty.call(model.reasoningEfforts, level)) // 官方模型真实启用的五档集合，不把单一默认等级当成全部能力。
           const selectedLabel = selectedLevels.length > 1 ? `已选 ${selectedLevels.length} 档` : selectedLevels[0] ?? '未设置' // 固定宽度触发器的简短摘要；菜单勾选展示具体档位。
          return jsxs('div', { className: 'adminsmart-model-configuration__row', children: [
          jsx('strong', { className: 'adminsmart-model-configuration__name', children: model.name }),
          showEfforts ? jsx(Menu, {
            open: openEffortModelId === model.id,
            onClose: () => setOpenEffortModelId(''),
            items: [
              { type: 'label', id: 'effort-heading', text: '推理等级' },
              ...ADMINSMART_VISIBLE_REASONING_LEVELS.map(level => ({ id: level, label: level, disabled: Boolean(busyModelId) })),
            ],
            selectedIds: selectedLevels,
            selection: 'check', portal: true, align: 'end', autoFocus: true,
            className: 'adminsmart-model-configuration__effort-menu',
            listClassName: 'adminsmart-model-configuration__effort-list',
            onSelect: level => {
              if (busyModelId || !ADMINSMART_VISIBLE_REASONING_LEVELS.includes(level)) return
              const nextLevels = ADMINSMART_VISIBLE_REASONING_LEVELS.filter(id => id === level ? !selectedLevels.includes(id) : selectedLevels.includes(id)) // 每次只切换一个等级，保留其它已选档位。
              void update(model, 'efforts', nextLevels)
            },
            anchor: jsxs(Button, {
              variant: 'ghost', size: 'sm', className: 'adminsmart-model-configuration__effort',
              disabled: Boolean(busyModelId), 'aria-label': `${model.name} 可用思考等级`,
              'aria-haspopup': 'menu', 'aria-expanded': openEffortModelId === model.id,
              title: selectedLevels.length ? selectedLevels.join(', ') : '未设置',
              onClick: () => setOpenEffortModelId(current => current === model.id ? '' : model.id),
              children: [
                jsx('span', { className: 'adminsmart-model-configuration__effort-label', children: selectedLabel }),
                jsx(IconChevronDownOutline14, { size: 14, 'aria-hidden': 'true' }),
              ],
            }),
          }) : null,
          jsxs('div', { className: 'adminsmart-model-configuration__uses', children: [
            !model.managedPublished ? jsx('span', { className: 'adminsmart-model-configuration__state', role: 'status', children: state.error ? '未同步' : '同步中…' }) : null,
            model.isHarnessDefault ? jsx('span', { className: 'adminsmart-model-configuration__use-state', children: '当前新会话兜底模型' }) : jsx(Button, {
              type: 'button', variant: 'outline', size: 'sm', disabled: Boolean(busyModelId) || !model.managedPublished,
              title: model.managedPublished ? undefined : '请先将模型同步到业务目录',
              onClick: () => { void update(model, 'harness') },
              children: '设为兜底模型',
            }),
           ] }),
          ] }, model.id)
        }),
        state.error ? jsx('p', { role: 'alert', className: 'adminsmart-model-policy__error', children: state.error }) : null,
      ] })
    }

    /**
     * Put the model configuration entry below the native Provider header.
     * @param {object} props - Official keyed Provider-card owner props.
     * @param {object} props.provider - Fresh directory entry after a native Models-page reload.
     * @param {boolean} props.configured - Whether the Provider profile has been saved.
     * @returns {object|null} Admin-only configuration seat or no extension.
     */
    function AdminSmartProviderPolicy({ provider, configured }) {
      const [opened, setOpened] = useState(false) // 供应商列表默认只保留一个明确的配置入口。
      const [available, setAvailable] = useState(false) // 官方私有 Provider 存在且管理员已验签时才显示管理入口。
      useEffect(() => {
        if (!provider?.provider || !configured || provider.settingsNs !== 'llm-pi-ai') return undefined
        const controller = new AbortController() // Provider 被删除或权限变化时忽略迟到响应。
        void requestPrivateModelReasoning(provider.provider, undefined, controller.signal).then(
          snapshot => { if (!controller.signal.aborted) setAvailable(snapshot.models.length > 0) },
          () => { if (!controller.signal.aborted) setAvailable(false) },
        )
        return () => controller.abort()
      }, [provider?.provider, configured, provider?.settingsNs])
      if (!provider?.provider || !configured || provider.settingsNs !== 'llm-pi-ai' || !available) return null // 共享动态 Provider 与普通用户不能获得配置入口。
      return jsxs('section', {
        className: 'adminsmart-model-configuration-seat',
        children: [
          jsx('button', { type: 'button', className: 'adminsmart-model-configuration-seat__trigger', 'aria-expanded': opened, onClick: () => setOpened(current => !current), children: opened ? '收起模型配置' : '配置模型用途与思考等级' }),
          opened ? jsx(AdminSmartModelConfiguration, { providerId: provider.provider, providerSnapshot: provider }) : null,
        ],
      })
    }

    /** @param {'GET'|'PUT'|'DELETE'} method 管理动作。 @param {object} [body] 非敏感草稿或仅本次使用的 Key。 @param {AbortSignal} [signal] 卸载取消。 @returns {Promise<object>} 无 Key 的 Host 确认目录。 */
    async function requestAdminModels(method, body, signal) {
      const response = await fetch(ADMIN_MODELS_URL, {
        method, credentials: 'same-origin', cache: 'no-store', signal,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      }) // 签名 Runtime Cookie 由浏览器自动携带；页面不读取能力令牌。
      const payload = await response.json().catch(() => null) // Host 只返回 Provider 元数据、配置指纹和凭据状态。
      if (!response.ok || !Array.isArray(payload?.providers)) throw new Error(String(payload?.error || '模型供应商暂时不可用'))
      return payload
    }

    /** @param {object} draft 当前未保存的供应商草稿。 @param {AbortSignal} [signal] 卸载取消。 @returns {Promise<object[]>} 官方发现返回的非敏感候选模型。 */
    async function requestAdminModelDiscovery(draft, signal) {
      const response = await fetch(ADMIN_MODELS_DISCOVER_URL, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeId: draft.routeId, // 已保存路由可在 Host 内解引用旧 Key。
          fingerprint: draft.fingerprint, // 旧页面不得读取已轮换的凭据。
          api: draft.api, // 当前尚未保存的线协议。
          baseURL: draft.baseURL, // 当前尚未保存的上游地址。
          apiKey: draft.apiKey, // 有新 Key 时只在这一轮请求中使用。
        }),
      })
      const payload = await response.json().catch(() => null) // 响应只含模型身份和可选规格。
      if (!response.ok || !Array.isArray(payload?.models)) throw new Error(String(payload?.error || '获取可用模型失败'))
      return payload.models
    }

    /** @param {object|null} provider 已保存 Provider，null 表示新增。 @returns {object} 与密码值分离的可编辑草稿。 */
    function adminProviderDraft(provider) {
      return {
        routeId: provider?.routeId, // 新增时由 Host 生成，不允许浏览器指定。
        fingerprint: provider?.fingerprint, // 编辑时使用最新官方配置指纹。
        displayName: provider?.displayName ?? '', // 管理员确认的显示名称。
        api: provider?.api || 'openai-responses', // 默认采用受管 Responses 协议。
        baseURL: provider?.baseURL ?? '', // 不含 URL 凭据的已保存服务根。
        apiKey: '', // 已保存 Key 绝不回填；留空表示编辑时保持原 Key。
        models: provider?.models?.length ? provider.models.map(model => ({
          id: model.id, // 上游模型身份。
          name: model.name, // 官方选择器展示名称。
          contextWindow: model.contextWindow ? String(model.contextWindow) : '', // 缺失规格要求管理员补齐，不猜容量。
          maxTokens: model.maxTokens ? String(model.maxTokens) : '', // 缺失输出容量保持空草稿。
          input: Array.isArray(model.input) ? [...model.input] : ['text'], // 保留已声明图片输入能力。
        })) : [{ id: '', name: '', contextWindow: '', maxTokens: '', input: ['text'] }], // 新供应商先提供一行可编辑模型。
      }
    }

    /** @param {object} props 字段标签、值及原生输入契约。 @returns {object} 官方 Input 原语和可访问标签。 */
    function AdminSmartPublicModelField({ label, value, onChange, type = 'text', placeholder = '', required = false, autoComplete, className = '' }) {
      return jsxs('label', { className: `adminsmart-public-models__field ${className}`, children: [
        jsx('span', { children: label }),
        jsx(Input, {
          className: 'adminsmart-public-models__input', type, value, placeholder,
          required, autoComplete, 'aria-label': label,
          ...(type === 'password' ? { 'data-lpignore': 'true', 'data-1p-ignore': 'true' } : {}),
          onChange: event => onChange(event.currentTarget.value),
        }),
      ] })
    }

    /** 开发与生产共用的管理员 Models 页面；模型执行、配置和凭据仍由 Harness Host 服务拥有。 */
    function AdminSmartManagedModelsSection() {
      const [state, setState] = useState({ status: 'loading', providers: [], error: '' }) // 已确认的管理员私有 Provider 目录。
      const [draft, setDraft] = useState(null) // 当前新增或编辑表单；null 返回列表。
      const [busy, setBusy] = useState(false) // 保存和删除互斥，防止重复提交。
      const [message, setMessage] = useState('') // 最近一次 Host 确认结果或发布警告。
      const [protocolOpen, setProtocolOpen] = useState(false) // 官方 Menu 的当前开关。
      const [providerAdvancedOpen, setProviderAdvancedOpen] = useState(true) // 已保存 Provider 的自定义地址与协议字段按需折叠。
      const [expandedProviderId, setExpandedProviderId] = useState('') // 按需展开已存在的逐模型等级与用途组件。
      const [advancedModelIndex, setAdvancedModelIndex] = useState(-1) // 当前模型行展开的容量和输入类型字段。
      const [discovery, setDiscovery] = useState({ open: false, status: 'idle', models: [], selected: [], error: '' }) // 官方模型发现的候选与显式选择。
      const [discoveryQuery, setDiscoveryQuery] = useState('') // 候选模型弹窗内的本地关键词。
      const discoveryControllerRef = useRef(null) // 关闭弹窗或离开页面时取消当前上游发现请求。
      const [publishRetryRouteId, setPublishRetryRouteId] = useState('') // 保存成功但业务发布失败时才显示重试入口。
      const [deleteTarget, setDeleteTarget] = useState(null) // 明确二次确认的单个供应商。
      const [deleteError, setDeleteError] = useState('') // 删除被默认模型引用等稳定业务拒绝。

      useEffect(() => {
        const controller = new AbortController() // 设置页卸载后不提交迟到目录。
        void requestAdminModels('GET', undefined, controller.signal).then(
          payload => { if (!controller.signal.aborted) setState({ status: 'ready', providers: payload.providers, error: '' }) },
          error => { if (!controller.signal.aborted) setState({ status: 'error', providers: [], error: String(error?.message || '模型供应商暂时不可用') }) },
        )
        return () => { controller.abort(); discoveryControllerRef.current?.abort() }
      }, [])

      /** @returns {Promise<void>} 重读官方 Host 当前目录，供并发冲突或保存后人工核对。 */
      const refresh = async () => {
        if (busy) return
        setState(current => ({ ...current, status: 'loading', error: '' }))
        try {
          const payload = await requestAdminModels('GET')
          setState({ status: 'ready', providers: payload.providers, error: '' })
          setMessage('')
        } catch (error) { setState(current => ({ ...current, status: 'error', error: String(error?.message || '模型供应商暂时不可用') })) }
      }

      /** @param {string} routeId 已保存官方路由。 @returns {Promise<void>} 通过现有签名 Host 重试业务模型发布。 */
      const retryPublish = async routeId => {
        if (busy) return
        setBusy(true)
        setMessage('')
        try {
          await publishModelProvider(routeId)
          setMessage('业务模型已发布')
          setPublishRetryRouteId('')
          const payload = await requestAdminModels('GET')
          setState({ status: 'ready', providers: payload.providers, error: '' })
        } catch (error) { setMessage(String(error?.message || '业务模型发布失败')) }
        finally { setBusy(false) }
      }

      /** @param {string} field Provider 表单字段。 @param {string} value 当前输入。 @returns {void} 不修改权威目录。 */
      const changeField = (field, value) => setDraft(current => ({ ...current, [field]: value }))
      /** @param {number} index 当前模型草稿行。 @param {string} field 行字段。 @param {unknown} value 输入值。 @returns {void} 只更新当前表单。 */
      const changeModel = (index, field, value) => setDraft(current => ({
        ...current,
        models: current.models.map((model, position) => position === index ? { ...model, [field]: value } : model),
      }))
      /** @param {object|null} provider 当前已保存供应商，null 表示新增。 @returns {void} 同时只编辑一个 Provider。 */
      const openEditor = provider => {
        setDraft(adminProviderDraft(provider))
        setAdvancedModelIndex(provider ? -1 : 0)
        setProviderAdvancedOpen(true)
        setExpandedProviderId('')
        setProtocolOpen(false)
        setMessage('')
      }
      /** @returns {void} 丢弃尚未提交的表单并回到供应商卡片。 */
      const closeEditor = () => {
        discoveryControllerRef.current?.abort()
        setDiscovery({ open: false, status: 'idle', models: [], selected: [], error: '' })
        setDraft(null)
        setAdvancedModelIndex(-1)
        setProtocolOpen(false)
        setMessage('')
      }
      /** @returns {Promise<void>} 通过官方 LLM 服务发现草稿地址的可用模型，不自动修改保存目录。 */
      const discover = async () => {
        if (!draft || discovery.status === 'loading') return
        discoveryControllerRef.current?.abort()
        const controller = new AbortController() // 当前弹窗关闭时废弃迟到的候选目录。
        discoveryControllerRef.current = controller
        setDiscoveryQuery('')
        setDiscovery({ open: true, status: 'loading', models: [], selected: [], error: '' })
        try {
          const models = await requestAdminModelDiscovery(draft, controller.signal) // Host 不向浏览器返回已保存 Key。
          if (!controller.signal.aborted) setDiscovery({ open: true, status: 'ready', models, selected: [], error: '' })
        } catch (error) {
          if (!controller.signal.aborted) setDiscovery({ open: true, status: 'error', models: [], selected: [], error: String(error?.message || '获取可用模型失败') })
        } finally { if (discoveryControllerRef.current === controller) discoveryControllerRef.current = null }
      }
      /** @returns {void} 只把管理员勾选的候选项加入草稿，未知容量保持待填写。 */
      const adoptDiscoveredModels = () => {
        const selected = new Set(discovery.selected) // 当前弹窗明确勾选的模型身份。
        const candidates = discovery.models.filter(model => selected.has(model.id)) // 只接纳已确认候选。
        const previousCount = draft.models.filter(model => model.id.trim()).length // 已配置行保持现有顺序。
        const unknownCapacityIndex = candidates.findIndex(model => !model.contextWindow) // 仅上下文窗口是保存 Harness 模型的必填容量。
        setDraft(current => {
          const existing = current.models.filter(model => model.id.trim()) // 首次添加时移除未填写的占位空行。
          const ids = new Set(existing.map(model => model.id)) // 已配置模型不得被发现结果覆盖。
          const additions = candidates.filter(model => !ids.has(model.id)).map(model => ({
            id: model.id, // 官方发现的真实上游模型 ID。
            name: model.name || model.id, // 官方或供应商提供的展示名。
            contextWindow: model.contextWindow ? String(model.contextWindow) : '', // 未披露容量必须人工确认。
            maxTokens: model.maxTokens ? String(model.maxTokens) : '', // 未披露输出上限保留原生空值，业务发布前可补充。
            input: Array.isArray(model.input) ? [...model.input] : ['text'], // 已知输入模态。
          }))
          return { ...current, models: [...existing, ...additions] }
        })
        setAdvancedModelIndex(unknownCapacityIndex < 0 ? -1 : previousCount + unknownCapacityIndex)
        setDiscovery(current => ({ ...current, open: false }))
      }
      /** @returns {void} 关闭官方发现候选弹窗并取消尚未完成的查询。 */
      const closeDiscovery = () => {
        discoveryControllerRef.current?.abort()
        discoveryControllerRef.current = null
        setDiscovery({ open: false, status: 'idle', models: [], selected: [], error: '' })
      }
      /** @returns {Promise<void>} 官方 Host 保存后才返回列表；发布失败保留明确警告。 */
      const save = async () => {
        if (busy || !draft) return
        if (!draft.displayName.trim() || !draft.baseURL.trim()) {
          setProviderAdvancedOpen(true)
          setMessage('请填写供应商名称和 API 地址')
          return
        }
        const incompleteModelIndex = draft.models.findIndex(model => {
          const contextWindow = Number(model.contextWindow) // 容量字段即使处于收起状态也必须完整有效。
          const hasMaxTokens = String(model.maxTokens ?? '').trim() !== '' // 输出上限可省略，已填写时仍验证规格。
          const maxTokens = hasMaxTokens ? Number(model.maxTokens) : undefined // 已确认的数值不得超过上下文窗口。
          return !model.id.trim() || !model.name.trim() || !Number.isInteger(contextWindow) || contextWindow < 1024
            || (hasMaxTokens && (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > contextWindow))
        }) // 定位到首个需要管理员修正的模型行。
        if (incompleteModelIndex >= 0) {
          setAdvancedModelIndex(incompleteModelIndex)
          setMessage('请检查模型 ID、名称和 token 容量')
          return
        }
        setBusy(true)
        setMessage('')
        try {
          const payload = await requestAdminModels('PUT', draft) // Key 仅在此请求体中提交一次，随后清空编辑草稿。
          setState({ status: 'ready', providers: payload.providers, error: '' })
          setMessage(payload.published ? '供应商已保存并发布' : String(payload.warning || '供应商已保存，发布待重试'))
          setPublishRetryRouteId(payload.published ? '' : payload.routeId)
          setDraft(null)
          setAdvancedModelIndex(-1)
          setProtocolOpen(false)
        } catch (error) { setMessage(String(error?.message || '模型供应商保存失败')) }
        finally { setBusy(false) }
      }
      /** @returns {Promise<void>} 只有管理员确认后才通过受签名后端撤销业务目录。 */
      const remove = async () => {
        if (busy || !deleteTarget) return
        setBusy(true)
        setDeleteError('')
        try {
          const payload = await requestAdminModels('DELETE', {
            routeId: deleteTarget.routeId, fingerprint: deleteTarget.fingerprint,
          })
          setState({ status: 'ready', providers: payload.providers, error: '' })
          setDeleteTarget(null)
          setExpandedProviderId('')
          setPublishRetryRouteId('')
          setMessage('供应商已删除')
        } catch (error) { setDeleteError(String(error?.message || '供应商删除失败')) }
        finally { setBusy(false) }
      }

      const field = (label, value, onChange, extras = {}) => jsx(AdminSmartPublicModelField, {
        label, value, onChange, ...extras,
      }) // 重复模型行统一使用官方 Input 与可访问标签。
      const editor = draft ? jsxs('form', {
        className: 'adminsmart-public-models__form',
        onSubmit: event => { event.preventDefault(); void save() },
        children: [
          jsx('h3', { className: 'adminsmart-public-models__form-title', children: draft.routeId ? '编辑供应商' : '添加自定义供应商' }),
          field('API 密钥', draft.apiKey, value => changeField('apiKey', value), {
            type: 'password', required: !draft.routeId, autoComplete: 'new-password', className: 'adminsmart-public-models__field--wide',
            placeholder: draft.routeId ? '已配置，输入新值可替换' : '输入 API 密钥',
          }),
          jsxs('button', {
            type: 'button', className: 'adminsmart-public-models__advanced-trigger',
            'aria-expanded': providerAdvancedOpen, onClick: () => setProviderAdvancedOpen(current => !current),
            children: [jsx(IconChevronDownOutline14, { size: 14, 'aria-hidden': 'true' }), '自定义设置'],
          }),
          providerAdvancedOpen ? jsxs('div', { className: 'adminsmart-public-models__fields', children: [
            field('显示名称', draft.displayName, value => changeField('displayName', value), { required: true, className: 'adminsmart-public-models__field--wide' }),
            field('API 地址', draft.baseURL, value => changeField('baseURL', value), { required: true, className: 'adminsmart-public-models__field--wide', placeholder: 'https://api.example.com/v1' }),
            jsxs('label', { className: 'adminsmart-public-models__field', children: [
              jsx('span', { children: 'API 协议' }),
              jsx(Menu, {
                open: protocolOpen, onClose: () => setProtocolOpen(false),
                items: ADMIN_MODEL_PROTOCOLS.map(item => ({ id: item.id, label: item.label })),
                selectedId: draft.api, onSelect: value => { changeField('api', value); setProtocolOpen(false) },
                anchor: jsxs(Button, {
                  variant: 'outline', className: 'adminsmart-public-models__protocol',
                  type: 'button', 'aria-label': 'API 协议', 'aria-expanded': protocolOpen,
                  onClick: () => setProtocolOpen(current => !current),
                  children: [ADMIN_MODEL_PROTOCOLS.find(item => item.id === draft.api)?.label ?? draft.api, jsx(IconChevronDownOutline14, { size: 14, 'aria-hidden': 'true' })],
                }),
              }),
            ] }),
          ] }) : null,
          jsxs('section', { className: 'adminsmart-public-models__catalog', children: [
            jsxs('div', { className: 'adminsmart-public-models__catalog-head', children: [
              jsx('strong', { children: '模型目录' }),
              jsx(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: () => { void discover() }, children: '获取可用模型' }),
            ] }),
            jsx('p', { className: 'adminsmart-public-models__catalog-meta', children: '已自定义模型目录' }),
            jsxs('div', { className: 'adminsmart-public-models__model-list', children: draft.models.map((model, index) => {
              const expanded = advancedModelIndex === index || !model.id // 新空行始终展示必填容量字段。
              return jsxs('div', { className: 'adminsmart-public-models__model', children: [
                jsxs('div', { className: 'adminsmart-public-models__model-row', children: [
                  jsx(Input, { className: 'adminsmart-public-models__input', value: model.id, required: true, placeholder: '模型 ID', 'aria-label': `模型 ${index + 1} ID`, onChange: event => changeModel(index, 'id', event.currentTarget.value) }),
                  jsx(Input, { className: 'adminsmart-public-models__input', value: model.name, required: true, placeholder: '模型名称', 'aria-label': `模型 ${index + 1} 名称`, onChange: event => changeModel(index, 'name', event.currentTarget.value) }),
                  jsx(Button, { type: 'button', variant: 'ghost', title: '模型规格与输入类型', 'aria-label': `模型 ${index + 1} 规格`, 'aria-expanded': expanded, icon: jsx(IconChevronDownOutline14, { size: 14, 'aria-hidden': 'true' }), onClick: () => setAdvancedModelIndex(current => current === index ? -1 : index) }),
                  jsx(Button, { type: 'button', variant: 'ghost', title: '移除模型', 'aria-label': `移除模型 ${index + 1}`, disabled: draft.models.length <= 1, icon: jsx(IconTrashOutline16, { size: 14, 'aria-hidden': 'true' }), onClick: () => {
                    setDraft(current => ({ ...current, models: current.models.filter((_, position) => position !== index) }))
                    setAdvancedModelIndex(current => current === index ? -1 : current > index ? current - 1 : current)
                  } }),
                ] }),
                expanded ? jsxs('div', { className: 'adminsmart-public-models__model-advanced', children: [
                  field('上下文窗口', model.contextWindow, value => changeModel(index, 'contextWindow', value), { type: 'number', required: true }),
                  field('最大输出 token', model.maxTokens, value => changeModel(index, 'maxTokens', value), { type: 'number', placeholder: '可留空' }),
                  jsxs('label', { className: 'adminsmart-public-models__check', children: [
                    jsx('input', { type: 'checkbox', checked: model.input.includes('image'), onChange: event => changeModel(index, 'input', event.currentTarget.checked ? ['text', 'image'] : ['text']) }),
                    '支持图片输入',
                  ] }),
                ] }) : null,
              ] }, index)
            }) }),
            jsx(Button, { type: 'button', variant: 'outline', size: 'sm', icon: jsx(IconPlusOutline16, { size: 14, 'aria-hidden': 'true' }), onClick: () => { setAdvancedModelIndex(draft.models.length); setDraft(current => ({ ...current, models: [...current.models, { id: '', name: '', contextWindow: '', maxTokens: '', input: ['text'] }] })) }, children: '添加模型' }),
          ] }),
          jsxs('div', { className: 'adminsmart-public-models__actions', children: [
            jsx(Button, { type: 'button', variant: 'ghost', disabled: busy, onClick: closeEditor, children: '取消' }),
            jsx(Button, { type: 'submit', variant: 'primary', disabled: busy, children: busy ? '保存中…' : '应用' }),
          ] }),
        ],
      }) : null

      const existingModelIds = new Set(draft?.models.map(model => model.id).filter(Boolean) ?? []) // 发现弹窗不得重复加入已配置模型。
      const visibleCandidates = discovery.models.filter(model => [model.id, model.name].some(value => String(value).toLocaleLowerCase().includes(discoveryQuery.trim().toLocaleLowerCase()))) // 候选搜索只在当前响应内进行。
      return jsxs('section', { className: 'adminsmart-public-models', children: [
        jsxs('div', { className: 'adminsmart-public-models__header', children: [
          jsx('h2', { children: '模型' }),
          jsx(Button, { type: 'button', variant: 'ghost', size: 'sm', title: '刷新模型目录', 'aria-label': '刷新模型目录', disabled: busy || Boolean(draft), icon: jsx(IconRefreshOutline16, { size: 14, 'aria-hidden': 'true' }), onClick: () => { void refresh() } }),
        ] }),
        jsx('p', { className: 'adminsmart-public-models__intro', children: '填入各提供商的 API 密钥即可使用其模型。' }),
        state.status === 'loading' ? jsx('p', { role: 'status', className: 'adminsmart-public-models__status', children: '正在读取模型供应商…' }) : null,
        state.error ? jsx('p', { role: 'alert', className: 'adminsmart-public-models__status', 'data-kind': 'error', children: state.error }) : null,
        message ? jsx('p', { role: 'status', className: 'adminsmart-public-models__status', 'data-kind': message.includes('失败') || message.includes('未同步') || message.includes('重试') || message.startsWith('请') ? 'error' : 'ok', children: message }) : null,
        state.status === 'ready' && !state.providers.length && !draft ? jsx('p', { className: 'adminsmart-public-models__empty', children: '尚无模型供应商' }) : null,
        state.status === 'ready' ? jsx('ul', { className: 'adminsmart-public-models__provider-list', children: state.providers.map(provider => jsxs('li', { key: provider.routeId, className: 'adminsmart-public-models__provider-card', children: [
          jsxs('div', { className: 'adminsmart-public-models__provider-head', children: [
            jsxs('div', { className: 'adminsmart-public-models__provider-main', children: [
              jsx('strong', { children: provider.displayName }),
              jsx('span', { className: 'adminsmart-public-models__tag', children: '自定义' }),
              jsx('span', { className: 'adminsmart-public-models__credential-dot', 'data-configured': provider.credentialConfigured, role: 'img', 'aria-label': provider.credentialConfigured ? '密钥已配置' : '密钥未配置', title: provider.credentialConfigured ? '密钥已配置' : '密钥未配置' }),
            ] }),
            jsxs('div', { className: 'adminsmart-public-models__actions', children: [
              publishRetryRouteId === provider.routeId ? jsx(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: busy || Boolean(draft), onClick: () => { void retryPublish(provider.routeId) }, children: '重试发布' }) : null,
              jsx(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: busy || Boolean(draft), onClick: () => openEditor(provider), children: '编辑' }),
              jsx(Button, { type: 'button', variant: 'ghost', size: 'sm', className: 'adminsmart-public-models__danger', disabled: busy || Boolean(draft), 'aria-label': `删除 ${provider.displayName}`, onClick: () => { setDeleteTarget(provider); setDeleteError('') }, children: '删除' }),
            ] }),
          ] }),
          jsx('div', { className: 'adminsmart-public-models__provider-divider' }),
          jsx(Button, { type: 'button', variant: 'outline', size: 'sm', className: 'adminsmart-public-models__reasoning-toggle', disabled: busy || Boolean(draft), 'aria-expanded': expandedProviderId === provider.routeId, onClick: () => setExpandedProviderId(current => current === provider.routeId ? '' : provider.routeId), children: expandedProviderId === provider.routeId ? '收起思考等级' : '配置思考等级' }),
          jsx(AdminSmartModelConfiguration, { providerId: provider.routeId, providerSnapshot: provider.fingerprint, showEfforts: expandedProviderId === provider.routeId }),
          draft?.routeId === provider.routeId ? editor : null,
        ] })) }) : null,
        draft && !draft.routeId ? jsx('div', { className: 'adminsmart-public-models__new-card', children: editor }) : null,
        state.status === 'ready' && !draft ? jsx(Button, { type: 'button', variant: 'outline', className: 'adminsmart-public-models__add', icon: jsx(IconPlusOutline16, { size: 16, 'aria-hidden': 'true' }), onClick: () => openEditor(null), children: '添加供应商' }) : null,
        jsx(Modal, {
          open: Boolean(deleteTarget), title: '删除供应商', closeLabel: '关闭',
          onClose: () => { if (!busy) setDeleteTarget(null) },
          description: deleteTarget ? `确认删除 ${deleteTarget.displayName} 及所属模型？仍被默认模型引用时服务器会拒绝。` : '',
          footer: jsxs('div', { className: 'adminsmart-public-models__dialog-actions', children: [
            jsx(Button, { variant: 'ghost', disabled: busy, onClick: () => setDeleteTarget(null), children: '取消' }),
            jsx(Button, { variant: 'outline', className: 'adminsmart-public-models__danger', disabled: busy, onClick: () => { void remove() }, children: busy ? '删除中…' : '确认删除' }),
          ] }),
          children: deleteError ? jsx('p', { role: 'alert', className: 'adminsmart-public-models__status', 'data-kind': 'error', children: deleteError }) : null,
        }),
        jsx(Modal, {
          open: discovery.open, title: '获取可用模型', closeLabel: '关闭', onClose: closeDiscovery,
          footer: jsxs('div', { className: 'adminsmart-public-models__dialog-actions', children: [
            jsx(Button, { type: 'button', variant: 'ghost', onClick: closeDiscovery, children: '取消' }),
            jsx(Button, { type: 'button', variant: 'primary', disabled: !discovery.selected.length, onClick: adoptDiscoveredModels, children: `添加已选模型 (${discovery.selected.length})` }),
          ] }),
          children: jsxs('div', { className: 'adminsmart-public-models__discovery', children: [
            jsx(Input, { className: 'adminsmart-public-models__input', value: discoveryQuery, onChange: event => setDiscoveryQuery(event.currentTarget.value), placeholder: '搜索模型', 'aria-label': '搜索可用模型', 'data-modal-autofocus': true }),
            discovery.status === 'loading' ? jsx('p', { role: 'status', className: 'adminsmart-public-models__status', children: '正在获取可用模型…' }) : null,
            discovery.error ? jsx('p', { role: 'alert', className: 'adminsmart-public-models__status', 'data-kind': 'error', children: discovery.error }) : null,
            discovery.status === 'ready' && !visibleCandidates.length ? jsx('p', { className: 'adminsmart-public-models__empty', children: '没有匹配的模型' }) : null,
            discovery.status === 'ready' ? jsx('ul', { className: 'adminsmart-public-models__discovery-list', children: visibleCandidates.map(model => jsx('li', { children: jsxs('label', { className: 'adminsmart-public-models__discovery-item', children: [
              jsx('input', { type: 'checkbox', disabled: existingModelIds.has(model.id), checked: discovery.selected.includes(model.id), onChange: event => {
                const checked = event.currentTarget.checked // React 延迟执行状态更新时事件的 currentTarget 已失效，必须先取本次选择值。
                setDiscovery(current => ({ ...current, selected: checked ? [...current.selected, model.id] : current.selected.filter(id => id !== model.id) }))
              } }),
              jsx('span', { title: model.id, children: model.name === model.id ? model.id : `${model.name} · ${model.id}` }),
            ] }) }, model.id)) }) : null,
          ] }),
        }),
      ] })
    }

    /** Build one stable draft key for a Provider/model pair. */
    function reasoningDraftKey(providerId, modelId) {
      return `${providerId}\u0000${modelId}`
    }






    /** Replace exact official chrome copy without depending on CSS Module hash names. */
    function reconcileAdminSmartChrome(root) {
      for (const input of root.querySelectorAll('input[type="password"][aria-label="API 密钥"]')) {
        const clearUnexpectedDraft = () => {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set // 通过原生 setter 通知 React 的受控值追踪器发生了真正的变化。
          input.setAttribute('data-adminsmart-credential-clearing', 'true')
          try {
            if (setter) setter.call(input, '')
            else input.value = ''
            input.dispatchEvent?.(new Event('input', { bubbles: true })) // 同步清空官方 keyDraft；否则保存按钮仍可能提交自动填充值。
          } finally { input.removeAttribute('data-adminsmart-credential-clearing') }
        }
        if (input.getAttribute('data-adminsmart-credential-guard') !== 'true') {
          input.setAttribute('data-adminsmart-credential-guard', 'true')
          input.setAttribute('autocomplete', 'new-password') // 登录页与同源 iframe 共存时，不把登录管理器的密码候选填入模型 Key。
          input.setAttribute('data-lpignore', 'true')
          input.setAttribute('data-1p-ignore', 'true')
          const activate = () => {
            input.setAttribute('data-adminsmart-credential-editing', 'true') // 只有明确的键盘、粘贴或指针操作才解锁本次 Key 更换。
            input.readOnly = false
          }
          input.addEventListener('pointerdown', activate, { once: true })
          input.addEventListener('keydown', activate, { once: true })
          input.addEventListener('paste', activate, { once: true })
          input.addEventListener('input', event => {
            if (input.getAttribute('data-adminsmart-credential-clearing') === 'true') return
            if (input.getAttribute('data-adminsmart-credential-editing') === 'true') return
            event.stopPropagation() // 自动填充事件不得更新官方 React 的密钥草稿。
            clearUnexpectedDraft() // 官方输入的初始草稿本来为空，不改变受保护 Credentials 中的既有值。
          }, true)
        }
        if (input.getAttribute('data-adminsmart-credential-editing') !== 'true') {
          if (!input.readOnly) input.readOnly = true // MutationObserver 监听属性；重复写相同值会让编辑弹窗无限重排。
          if (input.value) clearUnexpectedDraft() // 处理观察器首次运行前写入 DOM、但未经过用户操作的自动填充。
        }
      }
      for (const menuItem of root.querySelectorAll('[role="menuitem"]')) {
        const label = String(menuItem.textContent ?? '').trim() // 官方 Workspace 菜单唯一的中英文删除动作，不依赖 CSS Module 类名。
        const isWorkspaceDelete = label === '删除工作区' || label === 'Delete workspace' // 普通 Session 删除与其它菜单项不受影响。
        if (isWorkspaceDelete) {
          if (menuItem.getAttribute('data-adminsmart-hidden-workspace-delete') === 'true') continue
          menuItem.setAttribute('data-adminsmart-hidden-workspace-delete', 'true')
          menuItem.setAttribute('aria-hidden', 'true')
          menuItem.setAttribute('tabindex', '-1')
          menuItem.hidden = true
          menuItem.disabled = true // 官方菜单键盘遍历会跳过 disabled 按钮。
          menuItem.style.setProperty('display', 'none', 'important')
        } else if (menuItem.getAttribute('data-adminsmart-hidden-workspace-delete') === 'true') {
          menuItem.removeAttribute('data-adminsmart-hidden-workspace-delete')
          menuItem.removeAttribute('aria-hidden')
          menuItem.removeAttribute('tabindex')
          menuItem.hidden = false
          menuItem.disabled = false // React 复用菜单项为普通动作时恢复其可操作状态。
          menuItem.style.removeProperty('display')
        }
      }
      for (const option of root.querySelectorAll('[data-trigger-menu] [role="option"]')) {
        const commandName = Array.from(option.querySelectorAll('span'))
          .map(span => String(span.textContent || '').trim())
          .find(text => HIDDEN_KNOWLEDGE_COMMANDS.has(text)) // 只识别官方菜单中的独立指令名，不扫描消息正文或描述。
        if (!commandName) {
          if (option.hasAttribute('data-adminsmart-hidden-command')) {
            option.removeAttribute('data-adminsmart-hidden-command')
            option.removeAttribute('aria-hidden')
            option.removeAttribute('tabindex')
            option.hidden = false
            option.style.removeProperty('display') // React 复用菜单行展示 model 时，撤销仅由本插件写入的隐藏状态。
          }
          continue
        }
        if (option.getAttribute('data-adminsmart-hidden-command') === commandName) continue
        option.setAttribute('data-adminsmart-hidden-command', commandName)
        option.setAttribute('aria-hidden', 'true')
        option.setAttribute('tabindex', '-1')
        option.hidden = true
        option.style.setProperty('display', 'none', 'important')
      }
      const replacements = new Map([
        ['探索未至之境', 'AuraSearch'],
        ['Into the Unknown', 'AuraSearch']
      ]) // Only exact standalone UI text is replaced; user messages and knowledge content are never inspected.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let textNode = walker.nextNode()
      while (textNode) {
        const originalText = String(textNode.nodeValue ?? '').trim()
        const replacementText = replacements.get(originalText)
        if (replacementText !== undefined && textNode.nodeValue !== replacementText) {
          textNode.nodeValue = replacementText
        }
        if (originalText === '预览版' || originalText === 'Preview') {
          const badge = textNode.parentElement
          if (badge && !badge.hidden) badge.hidden = true
        }
        textNode = walker.nextNode()
      }

      for (const accessModeButton of root.querySelectorAll(
        'button[aria-label^="访问模式"],button[aria-label^="Access mode"]'
      )) {
        const accessModeDisplay = accessModeButton.style.getPropertyValue('display') // Knowledge Q&A never exposes coding filesystem write modes.
        if (
          !accessModeButton.hidden
          || accessModeButton.getAttribute('aria-hidden') !== 'true'
          || accessModeDisplay !== 'none'
        ) {
          accessModeButton.hidden = true
          accessModeButton.setAttribute('aria-hidden', 'true')
          accessModeButton.style.setProperty('display', 'none', 'important') // Remove the irrelevant write-access control from layout and focus order.
        }
      }
      for (const commandButton of root.querySelectorAll(
        'button[aria-label="指令"],button[aria-label="Commands"]'
      )) {
        const commandDisplay = commandButton.style.getPropertyValue('display') // Official plus opens coding commands; AdminSmart supplies a real image picker instead.
        if (
          !commandButton.hidden
          || commandButton.getAttribute('aria-hidden') !== 'true'
          || commandDisplay !== 'none'
        ) {
          commandButton.hidden = true
          commandButton.setAttribute('aria-hidden', 'true')
          commandButton.style.setProperty('display', 'none', 'important')
        }
      }
      for (const composerTools of root.querySelectorAll('[data-adminsmart-composer-tools="true"]')) {
        const slotWrapper = composerTools.parentElement // Renderer-owned wrapper around the AdminSmart list-slot occupant.
        const officialToolsRow = slotWrapper?.parentElement // Official left toolbar group whose row padding must remain the only outer inset.
        if (!slotWrapper || !officialToolsRow) continue
        for (const sibling of Array.from(officialToolsRow.children)) {
          if (sibling === slotWrapper) continue
          const candidateControls = [
            ...(sibling.matches('button,input,select,[role="button"]') ? [sibling] : []),
            ...sibling.querySelectorAll('button,input,select,[role="button"]')
          ] // Official command/mode containers may remain in layout after all of their controls are semantically hidden.
          const hasVisibleControl = candidateControls.some(control => (
            !control.hidden
            && control.getAttribute('aria-hidden') !== 'true'
            && control.style.getPropertyValue('display') !== 'none'
          )) // Only genuinely interactive siblings keep their place in the official 16px flex-gap account.
          const alreadyRemovedFromLayout = (
            sibling.getAttribute('aria-hidden') === 'true'
            && sibling.style.getPropertyValue('display') === 'none'
            && sibling.style.getPropertyPriority('display') === 'important'
          ) // Attribute-observing reconciliation must not rewrite an already stable hidden state.
          if (!hasVisibleControl && !alreadyRemovedFromLayout) {
            sibling.setAttribute('aria-hidden', 'true')
            sibling.style.setProperty('display', 'none', 'important')
          }
        }
      }
      for (const input of root.querySelectorAll('textarea,[contenteditable="true"]')) {
        const placeholderCandidates = [
          input.getAttribute('placeholder'),
          input.getAttribute('data-placeholder'),
          input.getAttribute('aria-label')
        ].filter(value => typeof value === 'string') // Visible copy and accessible copy may diverge while stale coding copy is reconciled.
        const carriesWorkspaceCopy = placeholderCandidates.some(value => (
          value.includes('工作区')
          || value.includes('构建的内容')
          || value.includes('发送消息或做任务')
          || value.includes('调用指令')
          || value.includes('文件或对话')
          || value.includes('workspace')
          || value.includes('want to build')
          || value.includes('Send a message or do a task')
        )) // Any stale coding/workspace phrase causes every composer label source to be reconciled together.
        if (carriesWorkspaceCopy) {
          const knowledgePlaceholder = '请输入知识问题…' // AdminSmart composer copy must describe knowledge Q&A rather than coding workspaces.
          if (input.hasAttribute('placeholder')) input.setAttribute('placeholder', knowledgePlaceholder)
          if (input.hasAttribute('data-placeholder')) input.setAttribute('data-placeholder', knowledgePlaceholder)
          if (input.hasAttribute('aria-label')) input.setAttribute('aria-label', knowledgePlaceholder)
        }
      }
      for (const placeholderNode of root.querySelectorAll('[data-composer-placeholder="true"]')) {
        const placeholderText = String(placeholderNode.textContent ?? '').trim() // Visible Lexical placeholder copy lives in a dedicated sibling node.
        if (
          placeholderText.includes('工作区')
          || placeholderText.includes('构建的内容')
          || placeholderText.includes('发送消息或做任务')
          || placeholderText.includes('调用指令')
          || placeholderText.includes('文件或对话')
          || placeholderText.includes('workspace')
          || placeholderText.includes('want to build')
          || placeholderText.includes('Send a message or do a task')
        ) {
          placeholderNode.textContent = '请输入知识问题…'
        }
      }
    }

    /**
     * Complete the upstream developer notice in the managed product shell.
     * @param {object} props Official settings onboarding render contract.
     * @param {() => void} props.complete Advance the official coordinator for this step only.
     * @returns {null} No developer notice UI in the business product.
     * @sideEffects Completes the current in-memory step without changing Host settings or credentials.
     */
    function AdminSmartManagedWelcomeNotice({ complete }) {
      useEffect(() => { complete() }, [complete]) // The official Settings coordinator advances only after this public Slot occupant mounts.
      return null // AuraSearch users never see the Harness developer notice.
    }

    /** Bind the official Workspace browser Store to this signed user's Host-owned view state. */
    function installUserWorkspaceView(ctx) {
      ctx.effect(() => {
        let disposed = false // Client teardown prevents pending reads or retries from changing a replacement Store.
        let instance = null // The official shared handle returns the same instance its renderer uses.
        let releaseStore = () => {} // Current Store snapshot subscription, installed after authoritative hydration.
        let loading = false // Avoid duplicate GETs while Slot registrations change.
        let pending = null // Latest complete official view awaiting an ordered Host write.
        let writing = false // Serialize writes so an older network response cannot replace a newer choice.
        let retryTimer = null // Temporary Host failure retains the most recent state for a bounded retry.
        let readRetryTimer = null // A failed initial GET must retry without saving a provisional default over existing state.

        /** @returns {void} Remove only the obsolete cross-account view key; no other Harness storage is touched. */
        const clearLegacy = () => {
          try { localStorage.removeItem(LEGACY_WORKSPACE_VIEW_KEY) } catch { /* Storage may be unavailable in private browsing. */ }
        }

        /** @returns {Promise<void>} Persist the newest Store state without exposing Session content. */
        const flush = async () => {
          if (writing || disposed || pending === null) return
          writing = true
          try {
            while (pending !== null && !disposed) {
              const view = pending // A new user action can replace this queued snapshot during the request.
              pending = null
              const response = await fetch(WORKSPACE_VIEW_URL, {
                method: 'PUT', credentials: 'same-origin', cache: 'no-store', keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ view }),
              })
              if (!response.ok) throw new Error('工作区视图保存失败')
              clearLegacy() // Official persistence subscriber writes first; the per-user Host file remains authoritative.
            }
          } catch (reason) {
            if (!disposed) {
              if (pending === null) pending = instance?.getSnapshot() ?? null
              console.warn('AdminSmart 工作区视图保存失败：', reason)
              if (retryTimer === null) retryTimer = setTimeout(() => { retryTimer = null; void flush() }, 2000)
            }
          } finally {
            writing = false
          }
        }

        /** @param {object} handle Official Store handle whose init() is the only new-user default. @returns {Promise<void>} Authoritative view load. */
        const hydrate = async handle => {
          if (disposed || loading) return
          loading = true
          try {
            const response = await fetch(WORKSPACE_VIEW_URL, { credentials: 'same-origin', cache: 'no-store' })
            if (!response.ok) throw new Error('工作区视图读取失败')
            const payload = await response.json()
            if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'view')) throw new Error('工作区视图响应无效')
            if (disposed) return
            instance.store.set(payload.view ?? handle.spec.init()) // Restore the whole official view, including manual order and expansion.
            clearLegacy()
            releaseStore = instance.subscribe(() => {
              if (disposed) return
              pending = instance.getSnapshot()
              clearLegacy()
              void flush()
            })
          } catch (reason) {
            if (!disposed) {
              console.warn('AdminSmart 工作区视图读取失败：', reason)
              readRetryTimer = setTimeout(() => { readRetryTimer = null; void hydrate(handle) }, 2000)
            }
          } finally {
            loading = false
          }
        }

        /** @returns {void} Find the native Slot's public Store handle after its owner registers. */
        const attach = () => {
          if (disposed || instance !== null || loading) return
          const entry = ctx.slots.entriesOfSlot('sidebar.workspaces')[0] // Public Slot registration exposes its store seat without DOM scraping.
          if (!entry?.store || typeof entry.store === 'function' || typeof entry.store.create !== 'function') return
          const handle = entry.store // Official ui-workspace uses a shared handle whose create() returns its renderer's instance.
          instance = handle.create()
          if (typeof instance?.store?.set !== 'function' || typeof handle.spec?.init !== 'function') {
            instance = null
            return
          }
          instance.store.set(handle.spec.init()) // Never display another account's browser-wide state while the Host read is pending.
          clearLegacy()
          void hydrate(handle)
        }

        const releaseSlots = ctx.slots.subscribe('sidebar.workspaces', attach) // The official plugin may register after this Client module.
        attach()
        return () => {
          disposed = true
          releaseSlots()
          releaseStore()
          if (retryTimer !== null) clearTimeout(retryTimer)
          if (readRetryTimer !== null) clearTimeout(readRetryTimer)
        }
      }, 'adminsmart-client-ui: per-user official Workspace view')
    }


    /** Install business seats and semantic adapters around the official Harness sidebar and conversation. */
    function apply(ctx) {
      installNonAdminPluginNavigation(ctx)
      installUserWorkspaceView(ctx)
      const styleElement = installAdminSmartStyles() // CSS is installed before custom Slot occupants can render.
      ctx.effect(() => () => {
        if (styleElement.isConnected) styleElement.remove()
      }, 'adminsmart-client-ui: owned styles')
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'adminsmart-mobile-sidebar',
        order: 10
      }, () => jsx(AdminSmartMobileSidebarOverlay, { layout: ctx.layout })))
      // The business page has no right-side navigation entry; the official panel and its resource service remain mounted.
      ctx.slots.inject('conversation.session.header.corner', () => ctx.slots.register({
        name: 'conversation.session.header.corner',
        priority: -1,
      }, () => null))
      // 官方 list Slot 对同一 id 的不同 priority 采用最低值渲染；保留 Models 页，只替换开发者声明步骤。
      ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
        name: 'settings.onboarding', // 官方设置外壳声明的首次引导席位。
        id: 'welcome-notice', // 只覆盖上游开发者声明，不影响模型设置和其它引导步骤。
        order: -100, // 保持官方声明的步骤顺序，由 complete 前进到后续步骤。
        priority: -1 // 同一 list cell 以公开的较低优先级遮蔽默认值 0。
      }, AdminSmartManagedWelcomeNotice))
      ctx.slots.inject('settings.section', () => {
        const nativeModels = ctx.slots.entries('settings.section').some(entry => (
          entry.options.id === 'models' && (entry.options.priority ?? 0) >= 0
        )) // 旧 Runtime Profile 仍装载原生页时，先由其继续服务直至 Gateway 安全重启。
        if (nativeModels) return undefined
        return ctx.slots.register({
          name: 'settings.section',
          id: 'models', // 新 Profile 在开发与生产均只装载这一受管导航身份。
          order: 10,
          priority: -1, // 旧 Profile 若晚于本插件加载，过渡期也不能因同优先级重复注册而阻断 Web boot。
          label: () => '模型',
        }, AdminSmartManagedModelsSection)
      })
      // 固定版本的公开 keyed Provider Slot 按 settings namespace 分派，卡片旁仅管理同身份的后端模型。
      ctx.slots.inject('settings.models.provider-card', function* () {
        for (const namespace of ['llm-pi-ai', 'llm-deepseek']) {
          yield ctx.slots.register({ name: 'settings.models.provider-card', key: namespace }, AdminSmartProviderPolicy)
        }
      })
      // 模型用途紧邻所属 Provider 卡片；不再在官方列表末尾追加独立管理员策略区。
      ctx.slots.inject('conversation.hero.brand.mark', () =>
        ctx.slots.register({ name: 'conversation.hero.brand.mark' }, AdminSmartMark))
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.inject('sidebar.brand.name', function* () {
          yield ctx.slots.register({ name: 'sidebar.brand.mark' }, AdminSmartMark)
          yield ctx.slots.register({ name: 'sidebar.brand.name' }, AdminSmartName)
        }))
      ctx.slots.inject('conversation.chat.node', () =>
        ctx.slots.register({
          name: 'conversation.chat.node',
          key: 'system-prompt', // 只接管系统提示词节点；context、tool-call、turn-process 继续由 Harness 渲染。
          priority: -100
        }, AdminSmartHiddenSystemPrompt))
      // 官方 ui-sidebar、ui-workspace 和 ui-sidebar-right 继续拥有完整入口；
      // AdminSmart 只通过公开品牌 Slot 提供 AuraSearch 标识，不复制官方外壳。
      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register({
          name: 'conversation.input.left',
          id: 'adminsmart-web-access-toggle',
          order: 10, // Harness 原有 + 菜单（含社区附件 attach）在左，本开关紧随其右。
          inject: sessionId => ({ sessionId }) // session-scoped Slot 不会自动把 SessionSnapshot 作为组件 Props 传入。
        }, AdminSmartComposerTools))

      ctx.effect(() => {
        let disposed = false // Client plugin teardown prevents late navigation after HMR or page disposal.
        let connectingSession = false // At most one internal Runtime Workspace Session connection can be in flight.
        let openedSessionId // 官方 uiWorkspace 已接管的首个内部 Workspace Session，避免重复导航。
        const reconcileSession = () => {
          if (disposed || connectingSession) return
          const workspaceSnapshot = ctx.workspaces.list.getSnapshot()
          const sessionSnapshot = ctx.sessions.list.getSnapshot()
          if (workspaceSnapshot.phase !== 'ready' || sessionSnapshot.phase !== 'ready') return
          if (openedSessionId !== undefined) return
          const mainSessionId = sessionSnapshot.ids.find(sessionId => (
            (sessionSnapshot.byId[sessionId]?.retainedBy?.mainView ?? 0) > 0
          )) // 官方 uiWorkspace 已拥有主视图时，不抢占用户当前会话或重复导航。
          if (mainSessionId !== undefined) {
            openedSessionId = mainSessionId
            return
          }
          const internalWorkspace = workspaceSnapshot.items.find(workspace => (
            workspace.title === INTERNAL_RUNTIME_WORKSPACE_TITLE
          )) // 只复用当前业务模式的官方 Workspace，不把历史目录或其它 Workspace 当成输入目标。
          if (!internalWorkspace) return
          connectingSession = true
          void ctx.uiWorkspace.connectWorkspace(internalWorkspace.workspaceId).then(
            sessionId => {
              if (disposed || openedSessionId !== undefined) return
              openedSessionId = sessionId
              try {
                ctx.uiWorkspace.openSession(sessionId) // 通过官方导航建立 mainView 引用，保证 Composer 获得可编辑 Session。
              } catch (reason) {
                openedSessionId = undefined
                if (!disposed) console.warn('AdminSmart 知识会话导航失败：', reason)
              }
            },
            (reason) => {
              if (!disposed) console.warn('AdminSmart 知识会话连接失败：', reason)
            }
          ).finally(() => { connectingSession = false })
        }
        const disposeWorkspaceState = ctx.workspaces.list.subscribe(reconcileSession)
        const disposeSessions = ctx.sessions.list.subscribe(reconcileSession)
        reconcileSession()
        return () => {
          disposed = true
          disposeSessions()
          disposeWorkspaceState()
        }
      }, 'adminsmart-client-ui: official knowledge Workspace session')

      ctx.effect(() => {
        let disposed = false // Client 模块卸载后禁止继续提交 Session 模型选择。
        let currentSessionId // 当前绑定模型目录的普通 Session 身份。
        let currentDirectory = null // 官方 modelDirectories 为当前 Session 提供的目录控制器。
        let disposeDirectory = () => {} // 当前目录快照订阅的释放函数。
        let preferenceController = null // Session 切换只取消尚未完成的偏好读取。
        let preferenceWrites = Promise.resolve() // Explicit selections are serialized and never cancelled by navigation.
        let preferredSelection = null // 当前用户和业务模式最近一次主动选择的公开模型身份。
        let preferenceLoaded = false // 未读取完成前不能用默认选择覆盖已有用户偏好。
        let inheritanceEvaluated = false // 每个新 Session 只执行一次偏好继承，之后允许用户主动切换。
        let defaultEfforts = new Map() // 当前签名目录的逐模型默认档位，不跨租户或凭据共享。
        let defaultsLoaded = false // 后端目录不可达时退回官方 Provider 默认值，不阻断正常聊天。
        let observedModelKey = null // 首次快照保留历史会话选择；随后模型切换才应用单模型默认。
        let baselineSelectionSignature = '' // 目录首次就绪或插件自动修复后的选择，用于识别后续用户主动变化。
        let manualSelectionPending = false // Official picker entered selecting outside this plugin's automatic repair.
        let automaticSelectPending = false // Tag only this plugin's own official selectModel call.
        let repairScheduled = false // 同一微任务只安排一次模型选择检查。
        let repairInFlight = false // 目录加载或官方 selectModel 调用是否尚未完成。
        let repairAgain = false // 修复期间收到新快照时在完成后再检查一次。
        let lastAttemptSignature = '' // 相同失效状态只提交一次，避免远端拒绝时无界重试。

        /** @param {object|null} selection 当前官方选择。 @returns {string} 用于比较变化的稳定签名。 */
        const selectionSignature = selection => selection ? JSON.stringify({
          provider: selection.provider,
          model: selection.model,
          reasoningEffort: selection.reasoningEffort
        }) : ''
        const modelKey = selection => selection ? `${selection.provider}\u0000${selection.model}` : '' // Provider 与模型联合标识避免同名串改。

        /** @returns {Promise<void>} 当前用户第一次访问模型目录时读取安全默认档位。 */
        const loadDefaults = async () => {
          if (defaultsLoaded) return
          defaultsLoaded = true
          try { defaultEfforts = await requestModelDefaults() }
          catch { defaultEfforts = new Map() } // 失效时仍使用 Harness 原生模型选择，不向用户隐藏可用模型。
        }

        /** @param {string} sessionId 当前 Session。 @returns {boolean} 是否为尚无消息的新会话。 */
        const sessionIsBlank = sessionId => {
          const sessionsState = ctx.sessions.list.getSnapshot() // 官方会话列表提供空白状态，不按标题或消息 DOM 猜测。
          return sessionsState?.byId?.[sessionId]?.blank === true
        }

        /** @param {string} sessionId 当前 Session。 @returns {Promise<void>} 读取一次用户模型偏好。 */
        const loadPreference = async sessionId => {
          if (preferenceLoaded) return
          preferenceController?.abort()
          const controller = typeof AbortController === 'function'
            ? new AbortController()
            : { signal: { aborted: false }, abort() { this.signal.aborted = true } } // 浏览器提供真实取消器；离线契约运行器可使用无副作用替身。
          preferenceController = controller
          try {
            preferredSelection = await requestModelPreference(sessionId, undefined, controller.signal)
          } catch (reason) {
            if (!controller.signal.aborted && !disposed) console.warn('AdminSmart 模型偏好读取失败：', reason)
            preferredSelection = null
          } finally {
            if (preferenceController === controller) preferenceController = null
            if (!controller.signal.aborted) preferenceLoaded = true
          }
        }

        /** @param {string} sessionId 当前 Session。 @param {object} selection 当前官方有效选择。 @returns {Promise<void>} */
        const persistPreference = async (sessionId, selection) => {
          preferenceWrites = preferenceWrites.catch(() => {}).then(async () => {
            const saved = await requestModelPreference(sessionId, selection) // Host confirms one complete selection before the next write.
            if (!disposed) preferredSelection = saved
          }).catch(reason => {
            if (!disposed) console.warn('AdminSmart 模型偏好保存失败：', reason)
          })
          await preferenceWrites
        }

        /** @returns {void} 在当前同步更新完成后执行一次失效模型检查。 */
        const scheduleRepair = () => {
          if (disposed) return
          if (repairInFlight) { repairAgain = true; return }
          if (repairScheduled) return
          repairScheduled = true
          queueMicrotask(() => {
            repairScheduled = false
            void repairSelection()
          })
        }

        /** @returns {Promise<void>} 通过官方 ModelDirectory 修复当前 Session 的失效模型或思考等级。 */
        const repairSelection = async () => {
          if (disposed || currentSessionId === undefined || currentDirectory === null || repairInFlight) return
          const sessionId = currentSessionId // 当前异步轮次绑定的 Session，完成时必须仍然一致。
          const directory = currentDirectory // 当前异步轮次唯一允许调用的官方目录控制器。
          repairInFlight = true
          try {
            let state = directory.store.getSnapshot() // 已就绪目录直接读取，禁止订阅回调再次触发无意义 load 循环。
            if (state.status === 'idle' || state.status === 'loading') {
              state = await directory.load() // 仅首次目录尚未就绪时请求 Host 当前模型目录和 Session 持久选择。
            }
            if (disposed || currentSessionId !== sessionId || currentDirectory !== directory) return
            if (state.status !== 'ready') return // selecting/error 状态等待官方后续快照或用户重试，不主动循环请求。
            await loadPreference(sessionId)
            await loadDefaults()
            if (disposed || currentSessionId !== sessionId || currentDirectory !== directory) return
            state = directory.store.getSnapshot() // A manual selection may have landed while the preference and defaults were loading.
            if (state.status !== 'ready') return
            const blankSession = sessionIsBlank(sessionId) // 只有新空会话继承用户偏好，打开历史会话不能改写其持久模型选择。
            const shouldInheritPreference = blankSession && !inheritanceEvaluated // 初始继承完成后，空白会话中的用户切换也必须保留。
            const inheritedSelection = shouldInheritPreference
              ? availablePreferredModelSelection(state, preferredSelection)
              : null // 偏好已停用、删除或失去 Provider 时返回 null。
            const repairedSelection = repairedModelSelection(state) // 当前 Session 失效时回退后端置顶的系统默认模型。
            const invalidPreferenceFallback = shouldInheritPreference && preferredSelection !== null && inheritedSelection === null
              ? firstAvailableModelSelection(state)
              : null // 用户偏好失效时新会话明确回退系统默认，并更新偏好避免反复尝试旧模型。
            let desiredSelection = inheritedSelection && !sameModelSelection(state.current, inheritedSelection)
              ? inheritedSelection
              : invalidPreferenceFallback && !sameModelSelection(state.current, invalidPreferenceFallback)
                ? invalidPreferenceFallback
                : repairedSelection
            const selectedModel = desiredSelection ?? state.current // 自动回退后应按最终目标模型选择等级。
            const selectedModelKey = modelKey(selectedModel) // 本轮切换后的官方 Provider/模型身份。
            const changedModel = observedModelKey !== null && selectedModelKey !== observedModelKey // 同模型手动改思考档位不能被插件覆盖。
            const initialBlank = observedModelKey === null && blankSession && inheritedSelection === null // 新空会话优先使用管理员所设单模型等级。
            const defaultEffort = defaultEfforts.get(selectedModelKey) // 后端模型级默认项，未知时保留官方行为。
            const availableModel = state.groups.find(group => group.id === selectedModel?.provider)?.models?.find(model => model.id === selectedModel?.model) // 只在当前有效目录里选择等级。
            if ((changedModel || initialBlank) && defaultEffort
              && availableModel?.reasoning?.efforts?.some(level => level.id === defaultEffort)
              && selectedModel?.reasoningEffort !== defaultEffort) {
              desiredSelection = { ...selectedModel, reasoningEffort: defaultEffort }
            }
            if (desiredSelection === null) {
              observedModelKey = modelKey(state.current)
              lastAttemptSignature = ''
              const currentSignature = selectionSignature(state.current) // 当前有效选择可能是用户刚通过官方选择器修改的结果。
              if (!baselineSelectionSignature) {
                baselineSelectionSignature = currentSignature
                if (invalidPreferenceFallback && state.current) await persistPreference(sessionId, state.current)
                inheritanceEvaluated = true
                return
              }
              return
            }
            const attemptSignature = JSON.stringify({
              current: state.current, // 触发修复的历史模型和思考等级。
              repaired: desiredSelection // 将通过官方 selectModel 写入的继承、默认回退或思考等级修复结果。
            })
            if (attemptSignature === lastAttemptSignature) return
            lastAttemptSignature = attemptSignature
            automaticSelectPending = true
            try { await directory.select(desiredSelection) } finally { automaticSelectPending = false } // Official Host validates and persists automatic repair.
            observedModelKey = modelKey(desiredSelection)
            baselineSelectionSignature = selectionSignature(desiredSelection)
            if (manualSelectionPending) {
              manualSelectionPending = false
              await persistPreference(sessionId, desiredSelection) // A ready-only model switch persists after its model default is resolved.
            }
            if (invalidPreferenceFallback) await persistPreference(sessionId, desiredSelection)
            inheritanceEvaluated = true
          } catch (reason) {
            if (!disposed && currentSessionId === sessionId) {
              console.warn('AdminSmart 当前模型选择修复失败：', reason)
            }
          } finally {
            repairInFlight = false
            if (repairAgain) {
              repairAgain = false
              scheduleRepair()
            }
          }
        }

        /** @returns {void} 跟随当前 Session 切换官方 ModelDirectory 订阅。 */
        const bindCurrentDirectory = () => {
          if (disposed) return
          const sessionsState = ctx.sessions.list.getSnapshot() // 官方列表不提供 current 字段；主视图引用才是当前会话的公开身份。
          const nextSessionId = sessionsState.ids.find(sessionId => (
            (sessionsState.byId[sessionId]?.retainedBy?.mainView ?? 0) > 0
          )) // 仅绑定官方主视图持有的 Session，空会话也可继承用户最后主动选择。
          if (nextSessionId === currentSessionId && currentDirectory !== null) {
            scheduleRepair()
            return
          }
          disposeDirectory()
          disposeDirectory = () => {}
          currentSessionId = nextSessionId
          currentDirectory = null
          lastAttemptSignature = ''
          inheritanceEvaluated = false
          defaultsLoaded = false
          defaultEfforts = new Map()
          observedModelKey = null
          baselineSelectionSignature = ''
          manualSelectionPending = false
          automaticSelectPending = false
          if (nextSessionId === undefined) return
          try {
            currentDirectory = ctx.modelDirectories.directoryFor(nextSessionId) // 官方模型选择插件拥有目录和 selectModel 行为。
          } catch {
            return // Session 作用域尚未物化时等待下一次官方列表快照。
          }
          disposeDirectory = currentDirectory.store.subscribe(() => {
            const state = currentDirectory?.store.getSnapshot() // Official selecting/ready lifecycle distinguishes a user click from our repair.
            if (state?.status === 'selecting' && !automaticSelectPending) manualSelectionPending = true
            if (state?.status === 'error') manualSelectionPending = false
            if (state?.status === 'ready' && manualSelectionPending && state.current) {
              manualSelectionPending = false
              inheritanceEvaluated = true // A real user choice takes precedence over an in-flight new-Session inheritance.
              observedModelKey = modelKey(state.current)
              baselineSelectionSignature = selectionSignature(state.current)
              void persistPreference(currentSessionId, state.current)
            }
            if (state?.status === 'ready' && state.current && !automaticSelectPending && inheritanceEvaluated && preferenceLoaded) {
              const currentSignature = selectionSignature(state.current) // Some fixed Harness builds publish only the final ready snapshot.
              const currentModelKey = modelKey(state.current) // A model change still needs the configured per-model default before persistence.
              if (currentModelKey !== observedModelKey) {
                manualSelectionPending = true // Let repairSelection apply the official model-specific default, then persist the complete result.
              } else if (baselineSelectionSignature && currentSignature !== baselineSelectionSignature) {
                manualSelectionPending = false
                observedModelKey = modelKey(state.current)
                baselineSelectionSignature = currentSignature
                void persistPreference(currentSessionId, state.current) // Persist model and reasoning changes even without a selecting event.
              }
            }
            scheduleRepair()
          })
          scheduleRepair()
        }

        const disposeSessions = ctx.sessions.list.subscribe(bindCurrentDirectory) // 新建、打开和重连 Session 都重新判断当前可用选择。
        bindCurrentDirectory()
        return () => {
          disposed = true
          preferenceController?.abort()
          disposeSessions()
          disposeDirectory()
          currentDirectory = null
        }
      }, 'adminsmart-client-ui: valid current model selection')

      ctx.effect(() => {
        let reconciling = false // MutationObserver callbacks may be triggered by the adapter's own text updates.
        let pendingModalClose = null // 等待宿主确认的官方关闭按钮，不保存按钮文案或设置内容。
        let replayingModalClose = false // 原生按钮恢复执行时不再拦截同一次合成 click。
        let hostSupportsModalCloseHandshake = false // 旧主页面未声明能力时绝不延后 Harness 原生关闭。

        /** @returns {void} 释放本轮关闭握手；弹窗消失或插件卸载后不留待执行动作。 */
        const clearPendingModalClose = () => {
          if (pendingModalClose?.timeoutId !== undefined) window.clearTimeout(pendingModalClose.timeoutId)
          pendingModalClose = null
        }

        /** @returns {void} 宿主遮罩已提交或回执超时后，继续执行官方关闭按钮或 Escape 原有动作。 */
        const replayModalClose = () => {
          const pending = pendingModalClose // 当前唯一的官方关闭命令与所属弹窗。
          clearPendingModalClose()
          if (!pending?.dialog?.isConnected) return
          replayingModalClose = true
          try {
            if (pending.button?.isConnected) pending.button.click() // 关闭按钮仍由其原生 React 回调执行。
            else if (pending.target?.isConnected) {
              pending.target.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
              })) // 合成同一 Escape 只延后执行，不改写 Harness 的键盘关闭规则。
            }
          } finally { replayingModalClose = false }
          queueMicrotask(reconcile)
        }

        /** @param {object} intent 当前官方关闭意图。 @returns {void} 最多登记一个等待宿主遮罩的动作。 */
        const requestModalClose = intent => {
          if (pendingModalClose) return
          pendingModalClose = {
            ...intent, // 保留当前官方弹窗和本次原生动作身份。
            timeoutId: window.setTimeout(replayModalClose, 1200) // 宿主失联时恢复官方关闭能力。
          }
          window.parent.postMessage({ type: MODAL_OVERLAY_PREPARE_CLOSE_MESSAGE_TYPE }, window.location.origin)
        }

        /** @param {MouseEvent} event 原生关闭按钮的捕获阶段点击。 @returns {void} 只延后明确的关闭命令。 */
        const prepareModalClose = event => {
          if (replayingModalClose || !hostSupportsModalCloseHandshake || window.parent === window) return
          const dialog = visibleModalDialogs().at(-1) // 仅最上层官方模态框可发起本轮关闭。
          const button = event.target?.closest?.('button') // 精确取用户实际点击的按钮，不依赖上游哈希类名。
          const label = String(button?.getAttribute?.('aria-label') || button?.textContent || '').trim() // 官方关闭按钮的可访问名称。
          if (!dialog?.contains?.(button) || !['关闭', '关闭弹窗', 'Close', 'Close dialog'].includes(label)) return
          event.preventDefault()
          event.stopImmediatePropagation()
          requestModalClose({ button, dialog }) // 过期弹窗卸载时不向新弹窗重放旧点击。
        }

        /** @param {KeyboardEvent} event 官方模态框内的 Escape。 @returns {void} 子菜单仍由 Harness 先关闭。 */
        const prepareModalEscape = event => {
          if (event.key !== 'Escape' || event.isComposing || replayingModalClose
            || !hostSupportsModalCloseHandshake || window.parent === window) return
          const dialog = visibleModalDialogs().at(-1) // 只处理当前最上层弹窗。
          if (!dialog?.contains?.(event.target)) return
          const nestedPopup = [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="combobox"][aria-expanded="true"]')]
            .some(element => element.getClientRects?.().length > 0) // 下拉选项仍按 Harness 自己的 Escape 顺序关闭。
          if (nestedPopup) return
          event.preventDefault()
          event.stopImmediatePropagation()
          requestModalClose({ target: event.target, dialog })
        }

        /** @param {MessageEvent} event 同源宿主的遮罩就绪回执。 @returns {void} 不接收配置内容。 */
        const resumeModalClose = event => {
          if (!window.parent || window.parent === window || event?.source !== window.parent
            || event.origin !== window.location.origin || event.data?.type !== MODAL_OVERLAY_CLOSE_READY_MESSAGE_TYPE) return
          replayModalClose()
        }

        /** @param {MessageEvent} event 当前主页面的协议能力声明。 @returns {void} 不读取用户或设置数据。 */
        const enableModalCloseHandshake = event => {
          if (!window.parent || window.parent === window || event?.source !== window.parent
            || event.origin !== window.location.origin || event.data?.type !== MODAL_OVERLAY_CLOSE_SUPPORTED_MESSAGE_TYPE) return
          hostSupportsModalCloseHandshake = true
        }






        /** @returns {object|null} 当前会话官方输入触发控制器；不读取或改写私有注册表。 */
        const currentCommandController = () => {
          const sessionId = ctx.sessions.list.getSnapshot().current // 当前已打开的真实官方 Session。
          const sessionScope = sessionId === undefined ? undefined : ctx.sessions.scope(sessionId) // 官方公开的 Session 作用域。
          return sessionScope === undefined ? null : ctx.inputTriggers.sessionOf(sessionScope)
        }

        /** @returns {void} 仅在当前高亮指向隐藏指令时，通过官方 hover 接口转到可见项。 */
        const reconcileCommandHighlight = () => {
          const controller = currentCommandController() // 当前会话唯一官方菜单状态所有者。
          const menu = controller?.menu.getSnapshot() // 只读候选项和高亮快照。
          if (!menu?.open || menu.highlight?.source !== 'command') return
          const commandGroup = menu.groups.find(group => group.source === 'command') // 官方命令候选组，不涉及 @引用等其他触发源。
          const highlightedCommand = commandGroup?.items[menu.highlight.index] // 当前键盘或鼠标选中的候选指令。
          if (!HIDDEN_KNOWLEDGE_COMMANDS.has(highlightedCommand?.name)) return
          const visibleIndex = commandGroup.items.findIndex(item => !HIDDEN_KNOWLEDGE_COMMANDS.has(item.name)) // 原始官方索引必须保留，不能以过滤后的序号调用 pick。
          if (visibleIndex >= 0) controller.hover('command', visibleIndex)
          else controller.dismiss() // 过滤后没有可见指令时不保留空白菜单。
        }

        /** @param {KeyboardEvent} event 输入框按键 @returns {void} 隐藏指令不参与菜单键盘循环，模型选择仍交给官方控制器。 */
        const onKnowledgeCommandKeyDown = event => {
          if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && event.key === 'Tab')) return
          if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(event.key)) return
          if (!event.target?.matches?.('textarea,[contenteditable="true"]')) return
          const controller = currentCommandController() // 官方控制器继续负责草稿 CAS、模型弹窗和实际执行。
          const menu = controller?.menu.getSnapshot() // 当前菜单快照不做任何直接修改。
          const group = menu?.groups.find(item => item.source === 'command') // 仅处理包含隐藏项的命令菜单。
          if (!menu?.open || menu.hit?.trigger !== '/' || !group?.items.some(item => HIDDEN_KNOWLEDGE_COMMANDS.has(item.name))) return
          const visibleIndices = group.items.flatMap((item, index) => HIDDEN_KNOWLEDGE_COMMANDS.has(item.name) ? [] : [index]) // 用官方原始候选索引维护可见项的键盘顺序。
          if (!visibleIndices.length) { controller.dismiss(); return }
          event.preventDefault()
          event.stopImmediatePropagation()
          const currentIndex = visibleIndices.indexOf(menu.highlight?.index) // 当前高亮在可见序列中的位置，隐藏项视为未选中。
          if (event.key === 'Enter' || event.key === 'Tab') {
            controller.pick('command', visibleIndices[Math.max(0, currentIndex)])
          } else {
            const direction = event.key === 'ArrowUp' ? -1 : 1 // 键盘向上或向下只在可见命令中循环。
            const nextIndex = currentIndex < 0 ? (direction > 0 ? 0 : visibleIndices.length - 1) : (currentIndex + direction + visibleIndices.length) % visibleIndices.length // 未选中时取对应边界，已选中时按可见序列循环。
            controller.hover('command', visibleIndices[nextIndex])
          }
        }

        let observedModal = null // 当前被 ResizeObserver 追踪的官方模态框，避免每次 Mutation 重建观察器。
        let modalResizeObserver = null // 官方模态框尺寸变化时重新发布 iframe 内几何。
        const observeModal = dialog => {
          if (dialog === observedModal) return
          modalResizeObserver?.disconnect()
          modalResizeObserver = null
          observedModal = dialog ?? null
          if (observedModal === null || typeof ResizeObserver !== 'function') return
          modalResizeObserver = new ResizeObserver(() => { reconcile() })
          modalResizeObserver.observe(observedModal)
        }

        const closeModalFromHost = event => {
          if (
            !window.parent
            || window.parent === window
            || event?.source !== window.parent
            || event.origin !== window.location.origin
            || event.data?.type !== MODAL_OVERLAY_CLOSE_MESSAGE_TYPE
          ) return
          const dialog = visibleModalDialogs().at(-1)
          const mask = dialog === undefined ? null : modalMaskFor(dialog)
          if (typeof mask?.click !== 'function') return
          mask.click() // 让官方 Modal/SettingsPanel 自己执行 onClose、焦点归还和状态清理。
          queueMicrotask(reconcile)
        }

        const reconcile = () => {
          if (reconciling) return
          reconciling = true
          try {
            const dialogs = visibleModalDialogs()
            for (const dialog of dialogs) markSettingsLayout(dialog)
            if (!dialogs.length) clearPendingModalClose()
            publishModalOverlay(dialogs.length > 0, dialogs.at(-1), dialogs.length)
            observeModal(dialogs.at(-1))
            reconcileAdminSmartChrome(document.body)
            reconcileCommandHighlight()
          } finally {
            reconciling = false
          }
        }
        const observer = new MutationObserver(reconcile) // React rerenders and locale changes are reapplied without polling.
        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
        document.body.addEventListener?.('click', prepareModalClose, true) // 捕获明确的原生关闭按钮，普通弹窗操作保持 Harness 所有。
        document.body.addEventListener?.('keydown', onKnowledgeCommandKeyDown, true) // 输入法组合和普通正文按键保持原行为。
        window.addEventListener?.('keydown', prepareModalEscape, true) // 在官方监听前接管最上层模态框的 Escape 时序。
        window.addEventListener?.('message', closeModalFromHost)
        window.addEventListener?.('message', resumeModalClose)
        window.addEventListener?.('message', enableModalCloseHandshake)
        window.addEventListener?.('resize', reconcile)
        window.visualViewport?.addEventListener?.('resize', reconcile)
        queueMicrotask(reconcile)
        return () => {
          observer.disconnect()
          for (const dialog of document.querySelectorAll('[data-adminsmart-settings-dialog]')) clearSettingsLayoutMarkers(dialog)
          clearPendingModalClose()
          modalResizeObserver?.disconnect()
          modalResizeObserver = null
          observedModal = null
          document.body.removeEventListener?.('click', prepareModalClose, true)
          document.body.removeEventListener?.('keydown', onKnowledgeCommandKeyDown, true)
          window.removeEventListener?.('keydown', prepareModalEscape, true)
          window.removeEventListener?.('message', closeModalFromHost)
          window.removeEventListener?.('message', resumeModalClose)
          window.removeEventListener?.('message', enableModalCloseHandshake)
          window.removeEventListener?.('resize', reconcile)
          window.visualViewport?.removeEventListener?.('resize', reconcile)
          publishModalOverlay(false)
        }
      }, 'adminsmart-client-ui: brand and conversation chrome')
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
