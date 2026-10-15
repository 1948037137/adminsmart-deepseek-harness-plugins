/** 通过官方模块登记和同 fiber ConfigForms 服务接线保留全部原生消费者。 */
window.__ModuleLoader__.load({
  id: '@adminsmart/dsh-shared-settings', // 自有 wrapper 身份，与原始官方 module 保持区分。
  factory: (require) => {
    const { jsx } = require('react/jsx-runtime') // 官方平台提供 React 单例，不重复打包。
    const inject = ['modules', 'remote', 'remote.settings', 'slots'] // 不依赖 locale/theme，保证设置提供者不会产生服务循环。
    const OFFICIAL_MODULE = '@deepseek-ai/dsh-client-ui-settings/client' // 固定公开 Client 导出身份。
    const OFFICIAL_MODULE_ID = '@deepseek-ai/dsh-client-ui-settings' // 官方公开loadCache使用的包根登记身份。
    const OFFICIAL_URL = './adminsmart/shared-settings/official-client.js' // Host 仅读当前固定 SDK 的原始发布字节。
    const NATIVE_ADAPTER_URL = './adminsmart/native-policy-client.mjs' // 固定同源原生策略纯模块，版本只取可信Host注入。
    const ADAPTER_URL = './adminsmart/ui-policy-client.mjs' // 自有纯浏览器适配器的既有固定资源。
    const MODULE_LOAD_TIMEOUT_MS = 5_000 // script、三个模块导入及双策略首次读取共用的整体启动预算。
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
      if (startup.signal.aborted || startup.cancelled())
        return Promise.reject(new Error('共享设置启动已取消'))
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
        const watcher = setInterval(() => {
          if (startup.cancelled()) cancelled()
        }, DISPOSE_CHECK_INTERVAL_MS) // uid是官方公开生命周期元数据，不读取或改写私有fiber状态。
        watcher.unref?.()
        startup.signal.addEventListener('abort', cancelled, { once: true })
        Promise.resolve()
          .then(operation)
          .then(
            (value) =>
              Date.now() >= startup.deadline
                ? finish(new Error(label))
                : finish(null, value),
            () => finish(new Error(label)),
          ) // 迟到microtask也必须遵守绝对截止时间。
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
          await bounded(
            () =>
              new Promise((resolve, reject) => {
                const script = document.createElement('script') // 先执行固定原始字节，绝不先等待未知import。
                const loaded = () => resolve() // 原始模块工厂已由其官方load完成登记。
                const failed = () =>
                  reject(new Error('官方共享设置模块暂不可用')) // 资源失败由共同预算转为稳定错误。
                cleanup = () => {
                  script.removeEventListener?.('load', loaded)
                  script.removeEventListener?.('error', failed)
                  script.remove()
                }
                const resourceUrl = new URL(OFFICIAL_URL, window.location.href) // 固定同源原始模块资源，不接受浏览器指定包或路径。
                const revision =
                  window.__ADMINSMART_SHARED_SETTINGS_CLIENT_REVISION__ // Host 通过官方 index 注入的公开代码身份。
                if (
                  typeof revision === 'string' &&
                  /^[a-f0-9]{64}$/u.test(revision)
                )
                  resourceUrl.searchParams.set('rev', revision)
                script.src = resourceUrl.href
                script.async = true
                script.addEventListener('load', loaded, { once: true })
                script.addEventListener('error', failed, { once: true })
                document.head.append(script)
              }),
            '官方共享设置资源加载失败或超时',
            startup,
          )
        } finally {
          cleanup()
        }
      }
      return bounded(
        () => modules.import(OFFICIAL_MODULE, '', {}),
        '官方共享设置模块解析失败或超时',
        startup,
      ) // 已登记后才导入；即使传输面保持pending也有界结束。
    }

    /**
     * 显示共享保存反馈，便于管理员确认持久化失败和并发冲突。
     * @param {object} props 官方 renderer 从两个公开状态 Observable 生成的 hook。
     * @param {Function} props.usePolicyStatusGeneral 订阅旧八字段保存状态，不读取 DOM 或私有 store。
     * @param {Function} props.usePolicyStatusNative 订阅原生及混合双 CAS 保存状态。
     * @returns {object|null} 错误/保存状态提示；正常无错误时保持原生布局。
     */
    function PolicyStatus({ usePolicyStatusGeneral, usePolicyStatusNative }) {
      const generalState = usePolicyStatusGeneral((value) => value) // 旧General region 的独立反馈。
      const nativeState = usePolicyStatusNative((value) => value) // 原生及混合region 的独立反馈，不能被General成功状态遮盖。
      const error = nativeState.error || generalState.error // 任一实际失败都显示同一业务反馈区域。
      const notice = nativeState.notice || generalState.notice // 已保存但实时同步延迟不重发写入。
      if (error) return jsx('p', { role: 'alert', children: error })
      if (notice) return jsx('p', { role: 'status', children: notice })
      return generalState.saving || nativeState.saving
        ? jsx('p', { role: 'status', children: '正在保存共享设置…' })
        : null
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
      let bootstrap // 代码尚未解析时也要记住连接代际，迟到HTML票据不能越过该边界。
      let controller // General提供方尚未创建时不发假请求，创建后重置沿用原合并读取器。
      let resetSeen = false // 首代际若早于模块加载完成，创建票据时立即撤销。
      ctx.on('connection/reset', () => {
        resetSeen = true
        bootstrap?.expire() // 首次代际也代表订阅边界，不能保留尚未消费的旧HTML回答。
        void controller?.reset() // Host namespace修订按连接重新确认；旧在途读写不能污染新代际或阻止修订回0。
      })
      const startup = {
        deadline: Date.now() + MODULE_LOAD_TIMEOUT_MS, // 资源、导入和首次策略读取总共最多等待五秒。
        signal: cancellation.signal, // 卸载后的迟到结果不能注册服务。
        cancelled: () => ctx.fiber.uid === null, // 只读取官方公开uid生命周期，不操作私有fiber字段。
      }
      ctx.effect(
        () => () => cancellation.abort(),
        'adminsmart-shared-settings: startup cancellation',
      )
      try {
        const [official, module, nativeModule] = await Promise.all([
          loadOfficial(ctx.modules, startup), // 原始官方资源仍先 script 登记，再通过公开 ModuleSystem 导入。
          bounded(
            () => {
              const resourceUrl = new URL(ADAPTER_URL, window.location.href) // 固定同源纯模块；页面查询和浏览器输入不能选择路径。
              const revision = window.__ADMINSMART_UI_POLICY_CLIENT_REVISION__ // Host 通过原生 index-inject 公开当前静态代码哈希。
              if (
                typeof revision === 'string' &&
                /^[a-f0-9]{64}$/u.test(revision)
              )
                resourceUrl.searchParams.set('rev', revision)
              return import(resourceUrl.href)
            },
            '共享设置适配模块加载失败或超时',
            startup,
          ),
          bounded(
            () => {
              const resourceUrl = new URL(
                NATIVE_ADAPTER_URL,
                window.location.href,
              ) // 不从页面query推断模块路径。
              const revision =
                window.__ADMINSMART_NATIVE_POLICY_CLIENT_REVISION__ // 静态字节身份，不能当政策CAS。
              if (
                typeof revision === 'string' &&
                /^[a-f0-9]{64}$/u.test(revision)
              )
                resourceUrl.searchParams.set('rev', revision)
              return import(resourceUrl.href)
            },
            '原生设置适配模块加载失败或超时',
            startup,
          ), // 与原始官方和旧General纯模块同时获取，不添加代码串行阶段。
          // 自有纯模块与官方资源没有读取依赖，使用同一预算并行获取。
        ]) // 三份代码都确认后才创建原生服务；任何失败或卸载仍阻止服务激活。
        if (startup.cancelled()) return
        if (typeof official.apply !== 'function')
          throw new Error('官方共享设置模块协议无效')
        official.apply(ctx)
        const native = ctx.get('configForms', false) // apply期间提供方尚未active，公开false允许读取自身原服务。
        bootstrap = module.createPolicyBootstrapReads?.(window.__ADMINSMART_SETTINGS_BOOTSTRAP__, {
          isNativePolicy: nativeModule.isNativePolicy, // 通过同一已加载固定 Native 模块校验独立 region。
          remote: ctx.remote, // 启动包只为两个自有首次读取提供回答，不替换官方 Remote 传输。
        }) // 缺失、损坏、版本错误或未确认时返回 null，保留原来的完整 GET 门禁。
        delete window.__ADMINSMART_SETTINGS_BOOTSTRAP__ // 当前页面仅消费一次；重连、重装与恢复不能重放旧 HTML 快照。
        if (resetSeen) bootstrap?.expire() // 模块下载期间的早到重置必须使整个启动包失效。
        controller = module.installUiPolicyClient({
          configForms: native,
          remote: ctx.remote,
          ...bootstrap?.general, // 有效启动包先提供安全 General；管理员 Models ensure 仍需真正的完整官方目录。
        }) // 所有环境采用相同共享数据源。
        ctx.effect(
          () => () => controller.dispose(),
          'adminsmart-shared-settings: shared forms',
        )
        const nativeController = nativeModule.installNativePolicyClient({
          general: controller, // 旧八字段的独立持久化和 CAS 真源。
          remote: ctx.remote, // 当前 Runtime 的公开原生设置描述。
          ctx, // 官方 Slot 和卸载生命周期接线，不渲染替代设置组件。
          ...bootstrap?.native, // Native 使用独立一次读取及原始 CAS，不与 General 修订或就绪状态混用。
        }) // 独立GET与General/Schema读取并行，仍使用官方UI消费同一ConfigForms。
        ctx.effect(
          () => () => nativeController.dispose(),
          'adminsmart-shared-settings: native forms',
        )
        await bounded(
          () => Promise.all([controller.ready, nativeController.ready]),
          '共享设置首次读取失败或超时',
          startup,
        ) // 提供方保持pending，官方消费者不会先按系统主题呈现。
        if (startup.cancelled()) return
        const initial = controller.getSnapshot() // ready Promise也会在读取失败后结算，必须检查实际接受状态。
        const unconfigured =
          initial.status === 'loading' &&
          initial.revision === 0 &&
          initial.error === null // 已验证的revision 0/settings null表示管理员尚未发布策略；不冒充已采用，也不拒绝合法空态。
        if (initial.status !== 'ready' && !unconfigured)
          throw new Error('共享设置首次读取未完成，请重新连接')
        ctx.set('configForms', nativeController.configForms) // 只在权威读取确认后由同一提供方fiber公开替换服务值。
        ctx.provide('adminsmartPersonalTheme', controller.personalTheme) // 只公开本人主题状态Observable；官方ThemeRuntime仍拥有明暗渲染与选择逻辑。
        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register(
            {
              name: 'settings.general.item', // 管理员原生General页中的持久化反馈。
              id: 'adminsmart-shared-policy-status', // 自有固定席位，不替换原生设置行。
              order: 95, // 状态反馈位于版本信息之前。
              inject: () => ({
                hooks: {
                  policyStatusGeneral: controller, // 保留旧八字段的独立保存反馈。
                  policyStatusNative: nativeController, // 原生和混合保存经原始renderer公开hook反馈。
                },
              }), // 同一原始状态区域使用公开Observable，不替换官方表单或布局。
            },
            PolicyStatus,
          ),
        )
      } catch (error) {
        if (!startup.cancelled() && !startup.signal.aborted) throw error // 真实加载失败必须显式失败，卸载取消安静结束。
      }
    }
    return { inject, apply }
  },
})
