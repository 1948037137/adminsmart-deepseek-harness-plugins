/** 独立Graph consumer；canonical偏好桥只由固定同源模块加载，不复制进品牌bundle。 */
window.__ModuleLoader__.load({
  id: '@adminsmart/dsh-client-shared-shortcuts', // 与Host Profile和package manifest一致的唯一模块身份。
  factory: () => {
    /** @param {object} ctx 官方Context @returns {void} 装配公开shortcut服务生命周期。 */
    const apply = ctx => {
      ctx.effect(() => {
        let disposed = false // 迟到模块import不能复活卸载的桥。
        let bridge = null // 当前独立配置桥，卸载时释放网络与公开订阅。
        let alert = null // 用户可见的全局保存/同步故障区域，不输出内部实现异常。
        /** @param {string} message 安全中文说明 @returns {void} 给用户显示可操作失败。 */
        const notifyError = message => {
          if (disposed) return
          if (!message) { alert?.remove(); alert = null; return } // 同文档重复发布已经收敛时删除旧提示，不创建只有按钮的空错误框。
          if (!alert) {
            alert = document.createElement('div')
            alert.setAttribute('role', 'alert')
            alert.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:10000;padding:12px;max-width:360px;background:#332f27;color:#fff;border-radius:8px;font-size:13px;'
            document.body.appendChild(alert)
          }
          alert.replaceChildren()
          const text = document.createElement('span') // 不解析错误为HTML或脚本。
          text.textContent = message
          alert.appendChild(text)
          const retry = document.createElement('button') // 键盘可达的明确重试入口。
          retry.type = 'button'
          retry.textContent = '重试同步'
          retry.addEventListener('click', () => { void bridge?.retry(); void bridge?.refresh() })
          alert.appendChild(retry)
          const close = document.createElement('button') // 用户可关闭提示，故障不会阻断聊天。
          close.type = 'button'
          close.textContent = '关闭'
          close.addEventListener('click', () => { alert?.remove(); alert = null })
          alert.appendChild(close)
        }
        const moduleUrl = new URL('./adminsmart/shared-shortcuts-client.mjs', window.location.href) // 固定同源资源；URL构造会丢弃页面query，不让地址栏决定代码版本。
        const moduleRevision = window.__ADMINSMART_SHARED_SHORTCUTS_CLIENT_REVISION__ // 唯一可信来源是当前Host在官方index中注入的代码SHA。
        if (typeof moduleRevision === 'string' && /^[a-f0-9]{64}$/u.test(moduleRevision)) moduleUrl.searchParams.set('rev', moduleRevision) // 无有效HostSHA时兼容legacy不缓存入口，不猜测或沿用页面参数。
        import(moduleUrl.href).then(({ installSharedShortcutsClient }) => {
          if (!disposed) bridge = installSharedShortcutsClient({ shortcuts: ctx.shortcuts, notifyError })
        }).catch(() => notifyError('共享快捷键加载失败，请刷新后重试'))
        return () => { disposed = true; bridge?.dispose(); alert?.remove() }
      }, 'adminsmart-shared-shortcuts: public configuration bridge')
    }
    return { inject: ['shortcuts'], apply } // 唯一运行依赖是官方快捷键服务，不注入私有Store或默认配置。
  },
})
