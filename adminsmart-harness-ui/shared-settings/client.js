/** 通过官方模块登记和同 fiber ConfigForms 服务接线保留全部原生消费者。 */
window.__ModuleLoader__.load({
  id: '@adminsmart/dsh-shared-settings', // 自有 wrapper 身份，与原始官方 module 保持区分。
  factory: require => {
    const { jsx } = require('react/jsx-runtime') // 官方平台提供 React 单例，不重复打包。
    const inject = ['modules', 'remote', 'remote.settings', 'slots'] // 不依赖 locale/theme，保证设置提供者不会产生服务循环。
    const OFFICIAL_MODULE = '@deepseek-ai/dsh-client-ui-settings/client' // 固定公开 Client 导出身份。
    const OFFICIAL_MODULE_ID = '@deepseek-ai/dsh-client-ui-settings' // 官方公开loadCache使用的包根登记身份。
    const OFFICIAL_URL = './adminsmart/shared-settings/official-client.js' // Host 仅读当前固定 SDK 的原始发布字节。
    const ADAPTER_URL = './adminsmart/ui-policy-client.mjs' // 自有纯浏览器适配器的既有固定资源。
    const MODULE_LOAD_TIMEOUT_MS = 5_000 // script、模块导入及权威General读取共用的整体启动预算。
    const DISPOSE_CHECK_INTERVAL_MS = 25 // 仅启动期间读取公开fiber.uid，卸载不能被未结束的import阻塞。

    /**
     * 在共同启动预算与公开卸载状态内等待一个异步阶段。
     * @param {Function} operation 启动当前阶段，不能在预算判断前发起未知模块导入。
     * @param {string} label 超时或失败时的稳定安全文案。
     * @param {object} startup 当前启动的deadline、signal与公开cancelled检测。
     * @returns {Promise<unknown>} 已完成阶段的结果；迟到结果不再发布。
     * @throws {Error} 超时、模块失败或卸载取消，不暴露下层堆栈与地址。
     */
    function bounded(operation, label, startup) {
      if (startup.signal.aborted || startup.cancelled()) return Promise.reject(new Error('共享设置启动已取消'))
      const remaining = startup.deadline - Date.now() // 后续阶段只能使用整体预算剩余部分。
      if (remaining <= 0) return Promise.reject(new Error(label))
      return new Promise((resolve, reject) => {
        let settled = false // 超时、卸载、正常回答只允许其中一次结算。
        const finish = (error, value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          clearInterval(watcher)
          startup.signal.removeEventListener('abort', cancelled)
          error ? reject(error) : resolve(value)
        }
        const cancelled = () => finish(new Error('共享设置启动已取消')) // 当前启动卸载后禁止迟到模块创建服务。
        const timer = setTimeout(() => finish(new Error(label)), remaining) // 各阶段共用绝对截止时间。
        const watcher = setInterval(() => { if (startup.cancelled()) cancelled() }, DISPOSE_CHECK_INTERVAL_MS) // uid是官方公开生命周期元数据，不读取或改写私有fiber状态。
        watcher.unref?.()
        startup.signal.addEventListener('abort', cancelled, { once: true })
        Promise.resolve().then(operation).then(value => Date.now() >= startup.deadline ? finish(new Error(label)) : finish(null, value), () => finish(new Error(label))) // 迟到microtask也必须遵守绝对截止时间。
      })
    }

    /**
     * 用经典 script 执行原始官方资源，只登记模块、不创建官方插件 entry。
     * @param {object} modules 官方 ClientModuleLoader。
     * @param {object} startup 整体启动预算与卸载检测。
     * @returns {Promise<object>} 原始官方 apply/inject exports。
     * @throws {Error} 固定资源加载失败或公开模块协议无效。
     */
    async function loadOfficial(modules, startup) {
      if (!modules.loadCache?.has(OFFICIAL_MODULE_ID)) {
        let cleanup = () => {} // script尚未创建时保持幂等清理，超时或卸载统一释放。
        try {
          await bounded(() => new Promise((resolve, reject) => {
            const script = document.createElement('script') // 先执行固定原始字节，绝不先等待未知import。
            const loaded = () => resolve() // 原始模块工厂已由其官方load完成登记。
            const failed = () => reject(new Error('官方共享设置模块暂不可用')) // 资源失败由共同预算转为稳定错误。
            cleanup = () => { script.removeEventListener?.('load', loaded); script.removeEventListener?.('error', failed); script.remove() }
            script.src = new URL(OFFICIAL_URL, window.location.href).href
            script.async = true
            script.addEventListener('load', loaded, { once: true })
            script.addEventListener('error', failed, { once: true })
            document.head.append(script)
          }), '官方共享设置资源加载失败或超时', startup)
        } finally { cleanup() }
      }
      return bounded(() => modules.import(OFFICIAL_MODULE, '', {}), '官方共享设置模块解析失败或超时', startup) // 已登记后才导入；即使传输面保持pending也有界结束。
    }

    /**
     * 显示共享保存反馈，便于管理员确认持久化失败和并发冲突。
     * @param {object} props 官方 renderer 从 hooks.policyStatus 生成的公开 usePolicyStatus。
     * @param {Function} props.usePolicyStatus 订阅当前保存状态，不读取 DOM 或私有 store。
     * @returns {object|null} 错误/保存状态提示；正常无错误时保持原生布局。
     */
    function PolicyStatus({ usePolicyStatus }) {
      const state = usePolicyStatus(value => value) // 官方 renderer 提供的共享策略状态。
      if (state.error) return jsx('p', { role: 'alert', children: state.error })
      if (state.notice) return jsx('p', { role: 'status', children: state.notice })
      return state.saving ? jsx('p', { role: 'status', children: '正在保存共享设置…' }) : null
    }

    /**
     * 同 fiber 先装配官方服务再接入受限 façade，所有消费者仍使用公开 configForms。
     * @param {object} ctx 当前 wrapper 的官方 Client Context。
     * @returns {Promise<void>} 权威策略及官方Schema已确认后发布服务；合法空策略保留官方默认状态。
     * @throws {Error} 官方资源、装配或首次读取无效/超时；不放行尚未确认的默认主题快照。
     * @sideEffects 注册原生生命周期、共享回读与状态 Slot，卸载统一清理。
     */
    async function apply(ctx) {
      const cancellation = new AbortController() // 公开effect清理及启动阶段共同使用的取消信号。
      const startup = {
        deadline: Date.now() + MODULE_LOAD_TIMEOUT_MS, // 资源、导入和首次策略读取总共最多等待五秒。
        signal: cancellation.signal, // 卸载后的迟到结果不能注册服务。
        cancelled: () => ctx.fiber.uid === null, // 只读取官方公开uid生命周期，不操作私有fiber字段。
      }
      ctx.effect(() => () => cancellation.abort(), 'adminsmart-shared-settings: startup cancellation')
      try {
        const official = await loadOfficial(ctx.modules, startup) // 先script登记，再导入官方原始模块。
        if (startup.cancelled()) return
        if (typeof official.apply !== 'function') throw new Error('官方共享设置模块协议无效')
        official.apply(ctx)
        const native = ctx.get('configForms', false) // apply期间提供方尚未active，公开false允许读取自身原服务。
        const module = await bounded(() => import(new URL(ADAPTER_URL, window.location.href).href), '共享设置适配模块加载失败或超时', startup) // 自有模块也必须在剩余启动预算内完成。
        if (startup.cancelled()) return
        const controller = module.installUiPolicyClient({ configForms: native, remote: ctx.remote }) // 所有环境采用相同共享数据源。
        ctx.effect(() => () => controller.dispose(), 'adminsmart-shared-settings: shared forms')
        await bounded(() => controller.ready, '共享设置首次读取失败或超时', startup) // 提供方保持pending，官方消费者不会先按系统主题呈现。
        if (startup.cancelled()) return
        const initial = controller.getSnapshot() // ready Promise也会在读取失败后结算，必须检查实际接受状态。
        const unconfigured = initial.status === 'loading' && initial.revision === 0 && initial.error === null // 已验证的revision 0/settings null表示管理员尚未发布策略；不冒充已采用，也不拒绝合法空态。
        if (initial.status !== 'ready' && !unconfigured) throw new Error('共享设置首次读取未完成，请重新连接')
        ctx.set('configForms', controller.configForms) // 只在权威读取确认后由同一提供方fiber公开替换服务值。
        ctx.on('connection/reset', () => { void controller.refresh() }) // 重连补回断线期间的管理员变化。
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item', // 管理员原生General页中的持久化反馈。
          id: 'adminsmart-shared-policy-status', // 自有固定席位，不替换原生设置行。
          order: 95, // 状态反馈位于版本信息之前。
          inject: () => ({ hooks: { policyStatus: controller } }), // 官方renderer消费稳定状态Observable。
        }, PolicyStatus))
      } catch (error) {
        if (!startup.cancelled() && !startup.signal.aborted) throw error // 真实加载失败必须显式失败，卸载取消安静结束。
      }
    }
    return { inject, apply }
  },
})
