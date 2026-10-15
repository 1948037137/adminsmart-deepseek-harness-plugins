/** 官方Remote Client的同fiber装配桥；所有会话、模型、Workspace与UI状态均使用原始模块。 */
window.__ModuleLoader__.load({
  id: '@adminsmart/dsh-official-remotes', // 独立自有装配身份，不冒充原Boot Graph行。
  factory: () => {
    const inject = [
      'modules',
      'connection',
      'fileUpload',
      'typert',
      'remote',
      'remote.commands',
      'remote.session',
      'remote.subagents',
      'remote.workspace',
    ] // 完整原Session/Workspace公开服务依赖，缺项保持真实pending。
    const timeoutMs = 5_000 // 两模块解析共用的启动预算，不无限等待未知导入。
    /**
     * 等待已由官方经典script预登记的模块，卸载或超时后禁止迟到apply。
     * @param {object} ctx 当前官方Client Context。
     * @param {AbortSignal} signal 当前启动卸载取消。
     * @returns {Promise<object[]>} 两个原始公开模块导出，未创建任何替代服务。
     * @throws {Error} 预登记缺失、原始模块无效、超时或取消。
     */
    function load(ctx, signal) {
      return new Promise((resolve, reject) => {
        let settled = false // 取消、失败与成功只能结算一次。
        const finish = (error, value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          clearInterval(watcher)
          signal.removeEventListener('abort', cancelled)
          error ? reject(error) : resolve(value)
        }
        const cancelled = () => finish(new Error('官方Remote Client启动已取消')) // 不传播下层异常或敏感原因。
        const timer = setTimeout(
          () => finish(new Error('官方Remote Client加载失败或超时')),
          timeoutMs,
        ) // 两个公开import共用一个总预算。
        const watcher = setInterval(() => {
          if (ctx.fiber.uid === null) cancelled()
        }, 25) // 官方公开fiber生命周期可取消不响应signal的模块导入。
        signal.addEventListener('abort', cancelled, { once: true })
        Promise.all([
          ctx.modules.import(
            '@deepseek-ai/dsh-api-session-controller/client',
            '',
            {},
          ),
          ctx.modules.import(
            '@deepseek-ai/dsh-api-workspace-controller/client',
            '',
            {},
          ),
        ]).then(
          (value) => finish(null, value),
          () => finish(new Error('官方Remote Client加载失败或超时')),
        )
      })
    }
    /**
     * 在同一真实提供方fiber调用原Session与Workspace的公开apply。
     * @param {object} ctx 官方Client Context，包含两个原始模块所需完整依赖。
     * @returns {Promise<void>} 原始服务发布后消费者按官方依赖生命周期启动。
     * @throws {Error} 固定原始注册缺失或模块协议无效；不放行伪服务。
     */
    async function apply(ctx) {
      const cancellation = new AbortController() // 当前wrapper唯一启动取消信号，不影响其它插件。
      ctx.effect(
        () => () => cancellation.abort(),
        'adminsmart-official-remotes: startup cancellation',
      )
      try {
        const [session, workspace] = await load(ctx, cancellation.signal) // 原始模块工厂保持官方身份和memoized exports。
        if (ctx.fiber.uid === null || cancellation.signal.aborted) return
        if (
          typeof session?.apply !== 'function' ||
          typeof workspace?.apply !== 'function'
        )
          throw new Error('官方Remote Client模块协议无效')
        session.apply(ctx) // SessionRoot、模型选择、发送、控制流和缓存全部由原始Client实现。
        workspace.apply(ctx) // 原始Workspace状态、命令与follow流同fiber装配，没有自造数据/菜单。
      } catch (error) {
        if (ctx.fiber.uid !== null && !cancellation.signal.aborted) throw error
      }
    }
    return { inject, apply }
  },
})
