/** AdminSmart browser plugin bundle using the DeepSeek Harness lazy-CJS client-module contract. */
window.__ModuleLoader__.load({
  id: '@adminsmart/dsh-client-ui',
  factory: (require) => {
    const module = { exports: {} } // Lazy-CJS module container returned to the Harness Client Loader.
    const exports = module.exports // Named exports populated at the end of this factory.
    const { jsx } = require('react/jsx-runtime') // React JSX runtime is a Harness platform seed and is not bundled twice.
    const { useEffect, useRef, useState } = require('react') // 手机退出的视口同步、防重复和反馈沿用平台React单例。
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives') // 手机退出在官方Slot内复用原生主题按钮，不复制控件或引入第二套React。

    const inject = ['slots'] // 品牌、手机退出和宿主蒙层只接公开Slot；不再读取或管理官方Session。
    const MODAL_OVERLAY_MESSAGE_TYPE = 'adminsmart:agent-modal-overlay' // iframe 向主应用同步官方模态框几何，保证整个 AdminSmart 页面统一蒙层。
    const MODAL_OVERLAY_CLOSE_MESSAGE_TYPE =
      'adminsmart:agent-modal-overlay-close' // 主应用点击外部蒙层后请求官方模态框执行原生 mask 关闭逻辑。
    const MODAL_OVERLAY_PREPARE_CLOSE_MESSAGE_TYPE =
      'adminsmart:agent-modal-overlay-prepare-close' // 官方关闭按钮先通知宿主绘制完整遮罩，避免 iframe 先亮一帧。
    const MODAL_OVERLAY_CLOSE_READY_MESSAGE_TYPE =
      'adminsmart:agent-modal-overlay-close-ready' // 宿主完成遮罩绘制后允许原生关闭按钮执行。
    const MODAL_OVERLAY_CLOSE_SUPPORTED_MESSAGE_TYPE =
      'adminsmart:agent-modal-overlay-close-supported' // 仅新版主页面可启用关闭握手；旧生产前端继续原生关闭。
    const MOBILE_LOGOUT_MESSAGE_TYPE = 'adminsmart:agent-logout-request' // 手机退出只传递固定意图，认证和Cookie清理由主应用既有流程拥有。
    const MOBILE_LOGOUT_MEDIA_QUERY = '(max-width: 767px), (max-width: 1024px) and (max-height: 600px)' // 与问答宿主手机画布一致，覆盖窄屏和低高度横屏。
    const MOBILE_LOGOUT_USER_AGENT_PATTERN = /Android.+Mobile|iPhone|iPod|IEMobile|Windows Phone|Opera Mini|Mobile Safari/i // 手机横屏变宽时仍保留已隐藏主框架的退出能力。
    const PERSONAL_THEME_REQUEST = 'adminsmart:theme-request' // 同源父页面只能读取或选择本人明暗，不传递其他设置。
    const PERSONAL_THEME_STATE = 'adminsmart:theme-state' // 本人已确认外观及有界保存状态，不包含身份、规则或配置。
    const PERSONAL_THEME_TIMEOUT_MS = 6_000 // 官方setTheme及本人Host保存回执的总等待预算。

    /**
     * 通过官方ThemeRuntime与本人设置回执联动宿主，不使用DOM或Token主题覆盖。
     * @param {object} ctx 官方Client Context；theme负责渲染，adminsmartPersonalTheme只报告本人持久化状态。
     * @returns {void} 消息、主题及保存订阅均随公开Cordis生命周期释放。
     */
    function installPersonalThemeBridge(ctx) {
      ctx.inject(['theme', 'adminsmartPersonalTheme'], scope => {
        scope.effect(() => {
          if (!window.parent || window.parent === window) return () => {}
          let disposed = false // 卸载后不发送迟到保存或主题事件。
          const pending = new Map() // 当前父页面有界请求及一次性订阅清理，不按页面载荷访问其他账号。

          /** @param {string|undefined} requestId 当前父页面请求身份。 @param {string|undefined} failure 固定保存失败提示。 @returns {void} 向可信父窗口发送有限状态。 */
          const publish = (requestId, failure) => {
            if (disposed) return
            const saved = scope.adminsmartPersonalTheme.getSnapshot() // 唯一本人持久化确认来源。
            if (saved.status === 'loading') return
            const active = scope.theme.getTheme().active?.colorScheme // system存量偏好由官方媒体查询解析，不猜测系统颜色。
            const mode = saved.preference === 'system' ? active === 'dark' ? 'dark' : 'light' : saved.preference === 'dark' ? 'dark' : 'light' // 只有light/dark可以跨iframe。
            const status = failure || saved.error ? 'error' : saved.saving ? 'saving' : 'ready' // 不把官方乐观颜色或失败写入当作持久成功。
            window.parent.postMessage({ type: PERSONAL_THEME_STATE, ...(requestId ? { requestId } : {}), status, mode, ...(['light', 'dark', 'system'].includes(saved.preference) ? { preference: saved.preference } : {}), ...(status === 'error' ? { error: failure || '个人主题保存失败，请重试' } : {}) }, window.location.origin) // preference保留Host确认的system语义；mode仅表示官方解析后的有效颜色，不能据此创建固定偏好。
          }

          /** @param {MessageEvent} event 浏览器提供的来源与固定载荷。 @returns {void} 只调用官方主题API，不自行渲染界面。 */
          const receive = event => {
            const data = event.data // 不信任主页面载荷中的身份、地址、函数或额外配置。
            if (event.origin !== window.location.origin || event.source !== window.parent || !data || typeof data !== 'object' || Array.isArray(data) || data.type !== PERSONAL_THEME_REQUEST || typeof data.requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/u.test(data.requestId) || Object.keys(data).some(key => !['type', 'requestId', 'mode'].includes(key)) || Object.hasOwn(data, 'mode') && !['light', 'dark'].includes(data.mode)) return
            if (!Object.hasOwn(data, 'mode')) { publish(data.requestId); return }
            if (pending.has(data.requestId) || pending.size >= 8) return // 重复请求不重复执行，父页面不能制造无界保存等待。
            let timer // 当前唯一保存回执预算，结束后释放。
            let unsubscribe = () => {} // 同步setTheme发生前也允许统一清理。
            const finish = failure => {
              if (!pending.has(data.requestId)) return
              clearTimeout(timer)
              unsubscribe()
              pending.delete(data.requestId)
              publish(data.requestId, failure)
            } // 成功或失败只回一次，普通主题变化仍走独立无requestId通知。
            const inspect = () => {
              const saved = scope.adminsmartPersonalTheme.getSnapshot() // 只有官方Host接受后才确认；未保存的乐观值不能ACK。
              if (saved.saving || saved.status === 'loading') return
              if (saved.error || saved.status === 'error') finish('个人主题保存失败，请重试')
              else if (saved.preference === data.mode) finish()
            }
            pending.set(data.requestId, () => { clearTimeout(timer); unsubscribe() })
            unsubscribe = scope.adminsmartPersonalTheme.subscribe(inspect)
            timer = setTimeout(() => finish('个人主题保存失败，请重试'), PERSONAL_THEME_TIMEOUT_MS)
            try { scope.theme.setTheme(data.mode) } catch { finish('个人主题保存失败，请重试') }
            queueMicrotask(inspect) // 无变化的已保存选择也确认；实际保存则等待同一Observable。
          }
          const changed = () => publish() // 只发送当前本人值，不能以任意对象字段驱动全站设置。
          const releaseTheme = scope.on('theme/change', changed) // 官方system媒体查询变化也同步给宿主。
          const releaseSaved = scope.adminsmartPersonalTheme.subscribe(changed) // 保存失败或重连采用都会通知父应用。
          window.addEventListener('message', receive)
          publish()
          return () => {
            disposed = true
            window.removeEventListener('message', receive)
            releaseTheme?.()
            releaseSaved()
            for (const cleanup of pending.values()) cleanup()
            pending.clear()
          }
        }, 'adminsmart-client-ui: personal theme bridge')
      })
    }

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

    /**
     * 同步官方弹窗几何和栈深度；宿主只补 iframe 外遮罩，内层卸载后立即结束关闭过渡。
     * @param {boolean} open 当前是否存在官方弹窗。
     * @param {HTMLElement|null} dialogElement 当前最上层弹窗。
     * @param {number} depth 当前仍挂载的官方模态弹窗数。
     * @returns {void} 只向同源父页面发送非敏感几何和层级。
     */
    function publishModalOverlay(open, dialogElement, depth = 0) {
      if (!window.parent || window.parent === window) return
      const rectangle =
        open && dialogElement ? dialogElement.getBoundingClientRect() : null // Legacy hosts may still use dialog geometry; no text or form values cross the boundary.
      window.parent.postMessage(
        {
          type: MODAL_OVERLAY_MESSAGE_TYPE, // Stable bridge command consumed by the Vue page host.
          open: Boolean(open), // Modal presence must not be lost while its first layout is still pending.
          depth: open ? depth : 0, // 嵌套官方弹窗关闭后，宿主可立即结束仅属于内层的全屏关闭过渡。
          rect: rectangle
            ? {
                left: rectangle.left,
                top: rectangle.top,
                width: rectangle.width,
                height: rectangle.height,
              }
            : null,
        },
        window.location.origin,
      )
    }

    /**
     * 收集需要让宿主页面同步遮罩的官方模态卡片。
     * 已由外部遮罩负责的卡片不重复参与宿主遮罩，保持每个弹窗只有一个遮罩所有者。
     * @returns {HTMLElement[]} 按 DOM 堆叠顺序排列的可见官方模态卡片。
     * @sideEffects 仅读取官方语义属性，不修改弹窗或关闭事件。
     */
    function visibleModalDialogs() {
      return [
        ...document.querySelectorAll(
          '[role="dialog"][aria-modal="true"], dialog[open]',
        ),
      ].filter((dialog) => {
        const explicitlyHidden =
          dialog.closest?.('[hidden], [aria-hidden="true"]') != null // Official modal cards mount only when open; CSS layout need not be complete yet.
        const belongsToExternalOverlay =
          dialog.closest?.('[data-external-overlay="true"]') != null
        return !explicitlyHidden && !belongsToExternalOverlay
      })
    }

    /**
     * Find the direct official mask sibling/child for one modal surface.
     * Harness Modal, SettingsPanel, and ImageLightbox all expose the mask as an
     * aria-hidden direct element, keeping close behavior in the official owner.
     * @param {HTMLElement} dialog Visible official modal card.
     * @returns {HTMLElement|null} Official mask element, or null when unavailable.
     */
    function modalMaskFor(dialog) {
      const directHiddenChild = (element) =>
        [...(element?.children ?? [])].find(
          (child) => child.getAttribute?.('aria-hidden') === 'true',
        ) ?? null
      const modalRoot =
        dialog?.parentElement?.getAttribute?.('role') === 'presentation'
          ? dialog.parentElement
          : null
      return directHiddenChild(modalRoot) || directHiddenChild(dialog)
    }

    /**
     * 在官方侧栏品牌席位明确返回空内容，遵守用户不显示任何品牌图片或icon的选择。
     * @returns {null} 不绘制图片、SVG或替代标记；文字、布局及按钮语义仍由官方父组件所有。
     * @remarks 必须保留公开Slot的占用；直接删除登记会触发官方FishLogo回退。
     */
    function AdminSmartBrandMark() {
      return null
    }

    const HERO_PRESENTATION_TITLE = '今天想解决什么问题？' // 用户授权替换的唯一欢迎标题，不用于会话内容或模型提示词。
    const HERO_OFFICIAL_COPY = Object.freeze([
      Object.freeze({
        headline: '探索未至之境', // 固定alpha.3中文原始欢迎语，用于确认目标和恢复当前语言。
        badge: '预览版', // 只有同一语言的标题/标签配对才允许应用有限展示例外。
      }),
      Object.freeze({
        headline: 'Into the Unknown', // 固定alpha.3英文原始欢迎语，语言切换后不能恢复成旧中文。
        badge: 'Preview', // 英文标签仍保留原文字，仅隐藏该元素而不改写其它英文内容。
      }),
    ]) // 未知官方语言或将来的文案变化会停止适配，不猜测替换目标。

    /**
     * 在当前公开品牌Slot的有限祖先内确认固定版Hero文本结构。
     * @param {HTMLElement} anchor 当前组件拥有且隐藏的语义锚点。
     * @returns {object|null} 精确的官方headline、标题Text和徽标节点；结构未知时为空。
     * @remarks 不使用CSS哈希、全局选择器或textContent写入，不进入聊天记录与输入区。
     */
    function heroPresentationNodes(anchor) {
      if (!anchor?.isConnected || anchor.tagName !== 'SPAN' || anchor.getAttribute('data-adminsmart-hero-presentation') !== 'v1' || anchor.getAttribute('aria-hidden') !== 'true' || !anchor.hidden || anchor.childNodes.length !== 0) return null
      const outlet = anchor.parentElement // 当前组件的官方SlotOutlet，不能从任意相似标题向上猜测来源。
      if (!outlet || outlet.getAttribute('data-slot') !== 'conversation.hero.brand.mark' || outlet.childNodes.length !== 1 || outlet.firstChild !== anchor || outlet.hasAttribute('data-slot-error')) return null
      const mark = outlet.parentElement // 官方Hero的品牌命中span；仅用于确认归属，保持其属性和布局不变。
      const headline = mark?.parentElement // 固定版仅向上三层的欢迎标题div，是唯一允许观察的范围。
      if (mark?.tagName !== 'SPAN' || mark.childNodes.length !== 1 || mark.firstChild !== outlet || headline?.tagName !== 'DIV' || headline.childNodes.length !== 2 || headline.firstChild !== mark) return null
      const group = headline.lastChild // 官方标题和预览标记的共同父span。
      if (group?.tagName !== 'SPAN' || group.childNodes.length !== 2) return null
      const title = group.firstChild // 官方纯文字标题span，不允许在富文本、链接或按钮中替换文字。
      const badge = group.lastChild // 官方纯文字预览span，隐藏范围仅为此元素。
      if (title?.tagName !== 'SPAN' || badge?.tagName !== 'SPAN' || title.childNodes.length !== 1 || badge.childNodes.length !== 1 || title.firstChild?.nodeType !== 3 || badge.firstChild?.nodeType !== 3 || typeof badge.style?.setProperty !== 'function' || typeof badge.style?.getPropertyPriority !== 'function') return null
      return {
        headline, // 确认身份后的局部观察根，不观察document或Conversation其它区域。
        title, // Text必须持续属于这一官方span，节点被替换时停止。
        titleText: title.firstChild, // 只允许更新该Text.nodeValue，不重建React拥有的子树。
        badge, // 只允许控制该预览标记的hidden与display属性。
        badgeText: badge.firstChild, // 官方语言匹配仍读取原徽标文字，不删除或清空它。
      }
    }

    /**
     * 应用用户明确授权的两处Hero展示例外，并提供精确、幂等的生命周期恢复。
     * @param {HTMLElement|null} anchor 本组件通过公开品牌Slot挂载的隐藏锚点。
     * @returns {Function} 停止局部观察并只恢复仍属于本适配的标题/hidden/display字段。
     * @remarks 标题或徽标结构未知、Text被替换、节点离开原headline时终态停用；不修改上游文件或祖先样式。
     */
    function installHeroPresentationScope(anchor) {
      const Observer = window.MutationObserver ?? globalThis.MutationObserver // 必须拥有局部观察能力才允许改写，缺失时保留官方原样。
      if (typeof Observer !== 'function') return () => {}
      const nodes = heroPresentationNodes(anchor) // 第一次完整结构校验发生在任何官方DOM写入之前。
      if (!nodes) return () => {}
      const initialCopy = HERO_OFFICIAL_COPY.find(copy => copy.headline === nodes.titleText.nodeValue && copy.badge === nodes.badgeText.nodeValue) // 首次仅接受官方完整中英文配对，不能接管其它已修改内容。
      if (!initialCopy) return () => {}
      const enqueue = typeof queueMicrotask === 'function' ? queueMicrotask : callback => Promise.resolve().then(callback) // 同一批React提交合并一次；旧任务由active标记取消。
      let active = true // cleanup或结构失败后，旧Observer与微任务均不得恢复运行。
      let queued = false // 当前最多一个待协调微任务，避免多条Mutation记录造成重复写入。
      let observer = null // 只观察已校验headline的当前实例；失败或卸载即断开。
      let titleBaseline = initialCopy.headline // 最新一次合法官方语言的恢复文案，不把英文切换恢复成旧中文。
      let hiddenBaseline = nodes.badge.getAttribute('hidden') // 完整保留原始hidden属性缺省或具体值，不用布尔猜测until-found等语义。
      let displayBaseline = nodes.badge.style.getPropertyValue('display') // 仅保存display声明，不覆盖徽标其它内联样式。
      let displayPriority = nodes.badge.style.getPropertyPriority('display') // 恢复时保持原important优先级。
      let ownsTitle = false // 只有本实例尝试写入的目标值才允许在结束时恢复。
      let ownsHidden = false // 本实例对hidden属性的有限所有权，不撤销后来的外部值。
      let ownsDisplay = false // 本实例对display:none!important的有限所有权，不恢复其它样式。

      /**
       * 仅恢复仍位于原headline且保持本实例写入值的字段。
       * @returns {void} 不重建DOM，不移除外部添加的属性或其它内联样式。
       */
      function restore() {
        try {
          if (ownsTitle && nodes.headline.contains(nodes.title) && nodes.titleText.parentNode === nodes.title && nodes.titleText.nodeValue === HERO_PRESENTATION_TITLE) nodes.titleText.nodeValue = titleBaseline
        } catch { /* 单个宿主节点不可恢复时，仍尝试恢复其余由本实例拥有的字段。 */ }
        try {
          if (ownsHidden && nodes.headline.contains(nodes.badge) && nodes.badge.getAttribute('hidden') === '') {
            if (hiddenBaseline === null) nodes.badge.removeAttribute('hidden')
            else nodes.badge.setAttribute('hidden', hiddenBaseline)
          }
        } catch { /* hidden恢复失败不能影响官方Hero或阻止display的独立恢复。 */ }
        try {
          if (ownsDisplay && nodes.headline.contains(nodes.badge) && nodes.badge.style.getPropertyValue('display') === 'none' && nodes.badge.style.getPropertyPriority('display') === 'important') {
            if (displayBaseline) nodes.badge.style.setProperty('display', displayBaseline, displayPriority)
            else nodes.badge.style.removeProperty('display')
          }
        } catch { /* 仅这一条display声明可恢复，不改写整个style或父级节点。 */ }
      }

      /** @returns {void} 断开观察后恢复本实例仍拥有的字段；重复结束不产生新副作用。 */
      function stop() {
        if (!active) return
        active = false
        queued = false
        try { observer?.disconnect() } catch { /* 观察器异常只能结束本展示适配，不能使官方品牌Slot退位。 */ }
        try { restore() } catch { /* 节点已被宿主释放时不扩大查找或写入范围。 */ }
      }

      /**
       * 重新核对原节点身份、官方语言和本实例所有权，再施加两处有限展示变化。
       * @returns {void} 结构失配会终态停用；官方正常中英文更新会推进恢复基线。
       */
      function reconcile() {
        if (!active) return
        try {
          const current = heroPresentationNodes(anchor) // 每次仍从同一自有锚点校验，不向其它页面区域搜索。
          if (!current || current.headline !== nodes.headline || current.title !== nodes.title || current.titleText !== nodes.titleText || current.badge !== nodes.badge || current.badgeText !== nodes.badgeText) { stop(); return }
          const currentTitle = nodes.titleText.nodeValue // 只接受官方当前值或本实例仍拥有的固定展示值。
          const currentBadge = nodes.badgeText.nodeValue // 徽标文字仅用于确认语言和目标，保持官方内容不变。
          const copy = HERO_OFFICIAL_COPY.find(candidate => candidate.badge === currentBadge && (candidate.headline === currentTitle || ownsTitle && currentTitle === HERO_PRESENTATION_TITLE)) // 自身写入不会触发误停；合法语言变化更新下面的恢复基线。
          if (!copy) { stop(); return }
          titleBaseline = copy.headline
          if (currentTitle !== HERO_PRESENTATION_TITLE) {
            ownsTitle = true
            nodes.titleText.nodeValue = HERO_PRESENTATION_TITLE
          }
          if (nodes.badge.getAttribute('hidden') !== '') {
            hiddenBaseline = nodes.badge.getAttribute('hidden')
            ownsHidden = true
            nodes.badge.hidden = true
          }
          if (nodes.badge.style.getPropertyValue('display') !== 'none' || nodes.badge.style.getPropertyPriority('display') !== 'important') {
            displayBaseline = nodes.badge.style.getPropertyValue('display')
            displayPriority = nodes.badge.style.getPropertyPriority('display')
            ownsDisplay = true
            nodes.badge.style.setProperty('display', 'none', 'important')
          }
          observer?.takeRecords() // 本同步块只写上述自有目标，丢弃自身记录；React后续提交仍由新记录驱动。
        } catch { stop() }
      }

      try {
        observer = new Observer(() => {
          try {
            if (!active || queued) return
            queued = true
            enqueue(() => {
              queued = false
              if (active) reconcile()
            })
          } catch { stop() }
        })
        observer.observe(nodes.headline, {
          childList: true, // 官方替换子节点必须失效，不能沿新Text继续覆盖。
          subtree: true, // 只涵盖这一个标题区域，包含语言Text与badge属性。
          characterData: true, // 官方语言切换会更新原Text.nodeValue。
          attributes: true, // 局部隐藏声明及语义身份变化都必须重新校验，不观察会话或表单区域。
          attributeFilter: ['hidden', 'style', 'data-slot', 'data-slot-error', 'data-adminsmart-hero-presentation', 'aria-hidden'], // 覆盖目标识别所用属性；纯属性失配也要恢复并停止，不扩大观察根。
        })
      } catch { stop(); return () => {} }
      reconcile() // 只有Observer成功安装和初始结构合法后才应用，缺能力时不留下不可跟踪覆盖。
      return stop
    }

    /**
     * 在官方Slot组件effect中隔离初始化探测异常，失配时继续使用官方Hero。
     * @param {HTMLElement|null} anchor 当前隐藏自有锚点。
     * @returns {Function} 成功时返回局部恢复动作，否则返回无副作用的cleanup。
     * @remarks DOM或Observer不可用不抛到SlotErrorBoundary，避免品牌entry退位后恢复官方图标。
     */
    function installHeroPresentation(anchor) {
      try { return installHeroPresentationScope(anchor) } catch { return () => {} }
    }

    /**
     * 占用官方Hero品牌位但不绘图，并把两处授权展示适配绑定到真实组件生命周期。
     * @returns {object} 不参与布局或无障碍阅读的自有锚点，不显示图片、SVG或替代icon。
     */
    function AdminSmartHeroPresentationMark() {
      const anchorRef = useRef(null) // 仅定位当前Hero实例，不保存或跨会话复用官方DOM节点。
      useEffect(() => installHeroPresentation(anchorRef.current), []) // StrictMode与正常卸载均调用同一幂等恢复动作。
      return jsx('span', {
        ref: anchorRef, // React提交后提供真实自有锚点，避免扫描其它Hero或聊天文字。
        hidden: true, // 不绘制图标、不新增可见品牌占位。
        'data-adminsmart-hero-presentation': 'v1', // 固定版结构防护与目标验收只依赖自有语义标识。
        'aria-hidden': 'true', // 技术锚点不作为欢迎内容或交互入口被辅助技术朗读。
      })
    }

    /**
     * 显示用户授权的产品名称。
     * @returns {object} AuraSearch 文字；字体、布局和交互由原生父席位继承。
     */
    function AdminSmartSidebarBrandName() {
      return jsx('span', { children: 'AuraSearch' })
    }

    /**
     * 判断当前页面是否为需要主应用退出入口的嵌入式手机画布。
     * @returns {boolean} 只有同一业务页面中的iframe与手机视口或设备标识同时成立才展示入口。
     * @remarks 不读取父页面DOM、登录态或凭据；主应用仍独立校验来源和手机状态。
     */
    function isEmbeddedMobileLogoutAvailable() {
      if (!window.parent || window.parent === window) return false
      const navigatorObject = window.navigator // 仅用于与主框架一致的设备识别，不跨窗口读取身份。
      if (navigatorObject?.userAgentData?.mobile === true) return true
      if (MOBILE_LOGOUT_USER_AGENT_PATTERN.test(String(navigatorObject?.userAgent || ''))) return true
      return window.matchMedia?.(MOBILE_LOGOUT_MEDIA_QUERY).matches === true
    }

    /**
     * 通过官方按钮向主应用发出手机注销意图，保留官方Header及侧栏所有权。
     * @returns {object|null} 手机嵌入页面中的退出按钮，桌面和独立Harness页面不渲染。
     * @remarks 不调用认证API或保存登录数据；主壳先撤销Gateway路由，再执行统一signOut并跳转登录。
     */
    function AdminSmartMobileLogout() {
      const [available, setAvailable] = useState(isEmbeddedMobileLogoutAvailable) // 视口切换后同步显示，不通过CSS隐藏仍可聚焦的按钮。
      const [pending, setPending] = useState(false) // 已发送的退出意图在主壳清理期间保持禁用和明确反馈。
      const pendingRef = useRef(false) // 同一事件循环内的重复点击也只能发送一次退出意图。
      useEffect(() => {
        const media = window.matchMedia?.(MOBILE_LOGOUT_MEDIA_QUERY) // 只监听手机断点，不接管官方布局或侧栏展开状态。
        const updateAvailability = () => setAvailable(isEmbeddedMobileLogoutAvailable()) // 旋转和窗口缩放使用当前设备/视口重新计算入口。
        updateAvailability()
        media?.addEventListener?.('change', updateAvailability)
        window.addEventListener?.('resize', updateAvailability)
        return () => {
          media?.removeEventListener?.('change', updateAvailability)
          window.removeEventListener?.('resize', updateAvailability)
        }
      }, [])
      if (!available) return null
      const logoutIcon = jsx('svg', {
        width: 18, // 字形尺寸与官方导航图标接近，触屏区域由按钮独立保证。
        height: 18, // 固定图形几何避免等待状态切换造成布局移动。
        viewBox: '0 0 24 24', // 门框与向外箭头共用的局部矢量坐标。
        fill: 'none', // 线性图形与相邻官方导航图标保持一致。
        stroke: 'currentColor', // 图标颜色及禁用反馈继承官方按钮主题。
        strokeWidth: 1.75, // 保持小尺寸下门框和箭头的清晰度。
        strokeLinecap: 'round', // 端点沿用轻量导航图标的圆润视觉。
        strokeLinejoin: 'round', // 箭头转角在缩放时保持清晰。
        'aria-hidden': 'true', // 退出含义由按钮可访问名称统一提供，避免重复朗读。
        focusable: 'false', // 图形不单独进入键盘焦点序列。
        children: jsx('path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9' }), // 门框和向外箭头表达注销，避免误用外链或关闭图标。
      }) // 此图形仅为用户指定业务退出入口的装饰，不复制官方私有账号组件或新增按钮实现。
      return jsx(Button, {
        type: 'button', // 阻止在任意宿主表单上下文触发表单提交。
        variant: 'ghost', // 采用当前固定官方Primitive的主题及焦点表现，不引入平行控件。
        size: 'md', // 官方中尺寸按钮与顶部导航控件保持一致。
        'data-adminsmart-mobile-logout': '', // 业务验收只依赖自有语义标记，不依赖官方CSS哈希。
        'aria-label': pending ? '正在退出登录' : '退出登录', // 图标按钮始终向辅助技术提供完整动作及等待状态。
        'aria-busy': pending, // 主应用两层清理完成前保持操作状态可感知。
        disabled: pending, // 阻止重复提交；实际认证仍由主壳控制。
        title: pending ? '正在退出登录' : '退出登录并切换账号', // 明确这是业务账号注销，而非删除会话。
        style: {
          minWidth: 44, // 图标视觉尺寸与手机点击区域分离，保证触屏操作。
          minHeight: 44, // 触屏命中范围不依赖小图标尺寸。
          width: 44, // 两个手机入口均使用紧凑图标；官方侧栏的wide参数不能恢复文字。
          paddingInline: 0, // 纯图标在完整触屏命中区内居中。
        },
        onClick: () => {
          if (pendingRef.current || !isEmbeddedMobileLogoutAvailable()) return
          pendingRef.current = true
          setPending(true)
          window.parent.postMessage({ type: MOBILE_LOGOUT_MESSAGE_TYPE }, window.location.origin)
        },
        icon: logoutIcon, // 通过官方Button的公开icon属性展示业务退出图形。
        children: undefined, // Header与侧栏始终只显示退出图标；动作及等待含义由aria-label和title提供。
      })
    }

    /**
     * 通过公开 Slot 和受限 iframe 协议装配业务集成。
     * @param {object} ctx 官方 Client Context，提供 Slot、Remote 和 effect 生命周期。
     * @returns {void} 只接品牌、业务退出和宿主模态几何，不重写官方设置或会话界面。
     * @sideEffects 注册业务 Slot 和受限观察器，effect 卸载释放所有资源。
     */
    function apply(ctx) {
      installPersonalThemeBridge(ctx) // 官方主题渲染及本人持久化就绪后才接入父应用，不影响其他全站配置。
      installNonAdminPluginNavigation(ctx)
      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.register(
          { name: 'sidebar.brand.mark', priority: -1 },
          AdminSmartBrandMark,
        ),
      ) // 只覆盖公开品牌内容，不声明或接管侧栏。
      ctx.slots.inject('sidebar.brand.name', () =>
        ctx.slots.register(
          { name: 'sidebar.brand.name', priority: -1 },
          AdminSmartSidebarBrandName,
        ),
      ) // 官方原有品牌仍在账本，较低优先级选择受管文字。
      ctx.slots.inject('conversation.hero.brand.mark', () =>
        ctx.slots.register(
          { name: 'conversation.hero.brand.mark', priority: -1 },
          AdminSmartHeroPresentationMark,
        ),
      ) // 用户授权两处Hero展示例外；官方空会话布局、输入区与Workspace保持原组件及协议。
      ctx.slots.inject('conversation.session.header.utilities', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.utilities', // 官方列表位位于右侧栏展开按钮左侧，不覆盖原生corner。
            id: 'adminsmart-mobile-logout', // 独立业务入口不复用或替换任何官方条目ID。
            order: 100, // 保持官方已有会话工具的相对顺序，退出放在其后。
          },
          AdminSmartMobileLogout,
        ),
      )
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action', // 官方空会话隐藏Header utilities，侧栏脚部提供无Session退出兜底。
            id: 'adminsmart-mobile-logout', // 与Header共用同一实现和受控消息协议。
            order: 100, // 不覆盖官方设置和其他脚部功能。
          },
          AdminSmartMobileLogout,
        ),
      )
      ctx.effect(() => {
        let reconciling = false // 宿主几何发布和局部观察回调不得互相递归。
        let pendingModalClose = null // 等待宿主确认的官方关闭按钮，不保存按钮文案或设置内容。
        let replayingModalClose = false // 原生按钮恢复执行时不再拦截同一次合成 click。
        let hostSupportsModalCloseHandshake = false // 旧主页面未声明能力时绝不延后 Harness 原生关闭。

        /** @returns {void} 释放本轮关闭握手；弹窗消失或插件卸载后不留待执行动作。 */
        const clearPendingModalClose = () => {
          if (pendingModalClose?.timeoutId !== undefined)
            window.clearTimeout(pendingModalClose.timeoutId)
          pendingModalClose = null
        }

        /** @returns {void} 宿主遮罩已提交或回执超时后，继续执行官方关闭按钮或 Escape 原有动作。 */
        const replayModalClose = () => {
          const pending = pendingModalClose // 当前唯一的官方关闭命令与所属弹窗。
          clearPendingModalClose()
          if (!pending?.dialog?.isConnected) return
          replayingModalClose = true
          try {
            if (pending.button?.isConnected)
              pending.button.click() // 关闭按钮仍由其原生 React 回调执行。
            else if (pending.target?.isConnected) {
              pending.target.dispatchEvent(
                new KeyboardEvent('keydown', {
                  key: 'Escape',
                  code: 'Escape',
                  bubbles: true,
                  cancelable: true,
                }),
              ) // 合成同一 Escape 只延后执行，不改写 Harness 的键盘关闭规则。
            }
          } finally {
            replayingModalClose = false
          }
          queueMicrotask(reconcile)
        }

        /** @param {object} intent 当前官方关闭意图。 @returns {void} 最多登记一个等待宿主遮罩的动作。 */
        const requestModalClose = (intent) => {
          if (pendingModalClose) return
          pendingModalClose = {
            ...intent, // 保留当前官方弹窗和本次原生动作身份。
            timeoutId: window.setTimeout(replayModalClose, 1200), // 宿主失联时恢复官方关闭能力。
          }
          window.parent.postMessage(
            { type: MODAL_OVERLAY_PREPARE_CLOSE_MESSAGE_TYPE },
            window.location.origin,
          )
        }

        /** @param {MouseEvent} event 原生关闭按钮的捕获阶段点击。 @returns {void} 只延后明确的关闭命令。 */
        const prepareModalClose = (event) => {
          if (
            replayingModalClose ||
            !hostSupportsModalCloseHandshake ||
            window.parent === window
          )
            return
          const dialog = visibleModalDialogs().at(-1) // 仅最上层官方模态框可发起本轮关闭。
          const button = event.target?.closest?.('button') // 精确取用户实际点击的按钮，不依赖上游哈希类名。
          const label = String(
            button?.getAttribute?.('aria-label') || button?.textContent || '',
          ).trim() // 官方关闭按钮的可访问名称。
          if (
            !dialog?.contains?.(button) ||
            !['关闭', '关闭弹窗', 'Close', 'Close dialog'].includes(label)
          )
            return
          event.preventDefault()
          event.stopImmediatePropagation()
          requestModalClose({ button, dialog }) // 过期弹窗卸载时不向新弹窗重放旧点击。
        }

        /** @param {KeyboardEvent} event 官方模态框内的 Escape。 @returns {void} 子菜单仍由 Harness 先关闭。 */
        const prepareModalEscape = (event) => {
          if (
            event.key !== 'Escape' ||
            event.isComposing ||
            replayingModalClose ||
            !hostSupportsModalCloseHandshake ||
            window.parent === window
          )
            return
          const dialog = visibleModalDialogs().at(-1) // 只处理当前最上层弹窗。
          if (!dialog?.contains?.(event.target)) return
          const nestedPopup = [
            ...document.querySelectorAll(
              '[role="menu"], [role="listbox"], [role="combobox"][aria-expanded="true"]',
            ),
          ].some((element) => element.getClientRects?.().length > 0) // 下拉选项仍按 Harness 自己的 Escape 顺序关闭。
          if (nestedPopup) return
          event.preventDefault()
          event.stopImmediatePropagation()
          requestModalClose({ target: event.target, dialog })
        }

        /** @param {MessageEvent} event 同源宿主的遮罩就绪回执。 @returns {void} 不接收配置内容。 */
        const resumeModalClose = (event) => {
          if (
            !window.parent ||
            window.parent === window ||
            event?.source !== window.parent ||
            event.origin !== window.location.origin ||
            event.data?.type !== MODAL_OVERLAY_CLOSE_READY_MESSAGE_TYPE
          )
            return
          replayModalClose()
        }

        /** @param {MessageEvent} event 当前主页面的协议能力声明。 @returns {void} 不读取用户或设置数据。 */
        const enableModalCloseHandshake = (event) => {
          if (
            !window.parent ||
            window.parent === window ||
            event?.source !== window.parent ||
            event.origin !== window.location.origin ||
            event.data?.type !== MODAL_OVERLAY_CLOSE_SUPPORTED_MESSAGE_TYPE
          )
            return
          hostSupportsModalCloseHandshake = true
        }

        let observedModal = null // 当前被 ResizeObserver 追踪的官方模态框，避免每次 Mutation 重建观察器。
        let modalResizeObserver = null // 官方模态框尺寸变化时重新发布 iframe 内几何。
        const observeModal = (dialog) => {
          if (dialog === observedModal) return
          modalResizeObserver?.disconnect()
          modalResizeObserver = null
          observedModal = dialog ?? null
          if (observedModal === null || typeof ResizeObserver !== 'function')
            return
          modalResizeObserver = new ResizeObserver(() => {
            reconcile()
          })
          modalResizeObserver.observe(observedModal)
        }

        const closeModalFromHost = (event) => {
          if (
            !window.parent ||
            window.parent === window ||
            event?.source !== window.parent ||
            event.origin !== window.location.origin ||
            event.data?.type !== MODAL_OVERLAY_CLOSE_MESSAGE_TYPE
          )
            return
          const dialog = visibleModalDialogs().at(-1)
          const mask = dialog === undefined ? null : modalMaskFor(dialog)
          if (typeof mask?.click !== 'function') return
          mask.click() // 让官方 Modal/SettingsPanel 自己执行 onClose、焦点归还和状态清理。
          queueMicrotask(reconcile)
        }

        let chromeDisposed = false // 卸载后排队的观察批次不得重新修改 UI 或提交几何。
        let reconcileQueued = false // 同一微任务合并 React 产生的一批局部属性/节点变化。
        const localObservers = new Map() // 只观察官方模态框几何变化，聊天正文从不注册局部观察器。
        const chromeSelector = '[role="dialog"]' // 当前固定版官方稳定语义标记，不依赖 CSS Module 类名。
        const scheduleReconcile = () => {
          if (chromeDisposed || reconcileQueued) return
          reconcileQueued = true
          queueMicrotask(() => {
            reconcileQueued = false
            if (!chromeDisposed) reconcile()
          })
        }
        const reconcile = () => {
          if (reconciling) return
          reconciling = true
          try {
            const dialogs = visibleModalDialogs()
            if (!dialogs.length) clearPendingModalClose()
            publishModalOverlay(
              dialogs.length > 0,
              dialogs.at(-1),
              dialogs.length,
            )
            observeModal(dialogs.at(-1))
            const roots = new Set([
              ...document.querySelectorAll(chromeSelector),
              ...dialogs,
            ]) // 全页只做已确认语义区域发现，不遍历正文文字。
            for (const [root, localObserver] of localObservers) {
              if (roots.has(root) && root.isConnected !== false) continue
              localObserver.disconnect()
              localObservers.delete(root)
            }
            for (const root of roots) {
              if (root.closest?.('[data-conversation-region="chat"]')) continue // 即使文档正文含伪 UI 语义，也不能进入 chrome 适配。
              if (!localObservers.has(root)) {
                const localObserver = new MutationObserver(scheduleReconcile) // 模态框局部属性/内容变化按批处理，不监听消息流或改写内容。
                localObserver.observe(root, {
                  childList: true,
                  subtree: true,
                  attributes: true,
                  attributeFilter: [
                    'aria-label',
                    'placeholder',
                    'data-placeholder',
                    'hidden',
                    'open',
                    'style',
                    'data-phase',
                  ],
                })
                localObservers.set(root, localObserver)
              }
            }
          } finally {
            reconciling = false
          }
        }
        const observer = new MutationObserver((records) => {
          if (!Array.isArray(records) || !records.length) {
            scheduleReconcile()
            return
          } // 离线公开 Observer Fake 可请求一次完整 chrome 发现。
          const relevant = records.some((record) => {
            if (record.target?.closest?.('[data-conversation-region="chat"]'))
              return false
            if (record.target?.closest?.(chromeSelector)) return true
            return [
              ...(record.addedNodes ?? []),
              ...(record.removedNodes ?? []),
            ].some(
              (node) =>
                node.nodeType === 1 &&
                (node.matches?.(chromeSelector) ||
                  node.querySelector?.(chromeSelector)),
            )
          }) // 普通聊天文本/消息节点不触发全局适配；仅区域装卸需要重新发现。
          if (relevant) scheduleReconcile()
        })
        observer.observe(document.body, { childList: true, subtree: true }) // 根只发现语义区域装卸；字符与属性变化限制在上述局部 Owner。
        document.body.addEventListener?.('click', prepareModalClose, true) // 捕获明确的原生关闭按钮，普通弹窗操作保持 Harness 所有。
        window.addEventListener?.('keydown', prepareModalEscape, true) // 在官方监听前接管最上层模态框的 Escape 时序。
        window.addEventListener?.('message', closeModalFromHost)
        window.addEventListener?.('message', resumeModalClose)
        window.addEventListener?.('message', enableModalCloseHandshake)
        window.addEventListener?.('resize', scheduleReconcile)
        window.visualViewport?.addEventListener?.('resize', scheduleReconcile)
        scheduleReconcile()
        return () => {
          observer.disconnect()
          chromeDisposed = true
          for (const localObserver of localObservers.values())
            localObserver.disconnect()
          localObservers.clear()
          clearPendingModalClose()
          modalResizeObserver?.disconnect()
          modalResizeObserver = null
          observedModal = null
          document.body.removeEventListener?.('click', prepareModalClose, true)
          window.removeEventListener?.('keydown', prepareModalEscape, true)
          window.removeEventListener?.('message', closeModalFromHost)
          window.removeEventListener?.('message', resumeModalClose)
          window.removeEventListener?.('message', enableModalCloseHandshake)
          window.removeEventListener?.('resize', scheduleReconcile)
          window.visualViewport?.removeEventListener?.(
            'resize',
            scheduleReconcile,
          )
          publishModalOverlay(false)
        }
      }, 'adminsmart-client-ui: brand and conversation chrome')
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
