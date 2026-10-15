/** 当前签名 Runtime 的个人明暗设置；只调用官方 SettingsForms，不读写 Profile 文件。 */

export const PERSONAL_THEME_ROUTE = '/adminsmart/personal-theme' // Gateway 已认证并绑定当前用户的固定入口，正文不能指定其他身份。
const MAXIMUM_BODY_BYTES = 128 // 个人偏好仅接收一个有限枚举，禁止夹带字体、模型或任意设置。

/**
 * 读取当前用户官方 Theme 命名空间的公开状态。
 * @param {object} settings 当前 Runtime 的官方 SettingsForms 服务。
 * @returns {object} 单个偏好及官方命名空间修订，不返回字体、路径或其他配置。
 * @throws {Error} 官方命名空间未就绪或有效值不合法；交给入口转为固定错误。
 */
export function readPersonalTheme(settings) {
  const row = settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === 'ui-theme') // 服务只属于已签名当前用户，无法从浏览器选择 Profile。
  if (!row || !['light', 'dark', 'system'].includes(row.value?.preference) || !Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error('个人主题尚未就绪')
  return { preference: row.value.preference, revision: row.revision } // system 只为保留存量官方偏好；新用户模板明确为 light。
}

/**
 * 注册本人主题读取与单字段写入；普通用户也可写此字段，其他设置权限不改变。
 * @param {object} ctx 已由 Gateway 签名身份隔离的官方 Host Context。
 * @param {object} helpers 现有受管 HTTP 输入边界。
 * @param {Function} helpers.assertSameOrigin 校验浏览器来源，不替代 Gateway 的身份认证。
 * @param {Function} helpers.readJsonBody 读取受限 JSON 正文，禁止无界请求。
 * @returns {void} 所有路由随当前 Cordis fiber 卸载。
 * @sideEffects PUT 仅通过官方 CAS 更新 ui-theme.preference，绝不写入全站策略或其他用户 Runtime。
 */
export function installPersonalThemeHttp(ctx, helpers) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', // 不接受任意子路径或配置 namespace。
    path: PERSONAL_THEME_ROUTE, // 只由 Gateway 选定当前 Runtime，不读取浏览器用户ID。
    async handler(request, response) {
      if (!['GET', 'PUT'].includes(request.method)) {
        response.writeHead(405, { allow: 'GET, PUT', 'cache-control': 'no-store' })
        response.end()
        return
      }
      let status = 503 // 未确认保存前默认失败，不能用乐观状态回复成功。
      try {
        status = 403
        helpers.assertSameOrigin(request)
        status = 503
        const settings = ctx.get('settings') // 官方当前用户 Profile 的唯一持久化属主，不接触凭据或数据库。
        if (!settings) throw new Error('个人主题尚未就绪')
        if (request.method === 'PUT') {
          status = 400
          const body = await helpers.readJsonBody(request, MAXIMUM_BODY_BYTES) // 本人主题只接收mode，不接受用户ID、任意配置或调用方选择的修订。
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'mode') || !['light', 'dark'].includes(body.mode)) throw new Error('个人主题请求无效')
          status = 503
          const current = readPersonalTheme(settings) // 读官方即时修订，避免并发字体设置被整段覆盖。
          if (current.preference !== body.mode) await settings.update('ui-theme', { preference: body.mode }, current.revision)
        }
        status = 503
        const accepted = readPersonalTheme(settings) // 完成官方持久化后再次读取，回复的只能是已接受值。
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        response.end(JSON.stringify(accepted))
      } catch {
        const message = status === 403 ? '个人主题访问已拒绝' : status === 400 ? '个人主题请求无效' : '个人主题暂不可用' // 固定错误不把未知写失败误报成并发冲突，也不包含Profile、用户ID或底层异常。
        response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        response.end(JSON.stringify({ error: { code: 'personal_theme_rejected', message } }))
      }
    },
  }), 'adminsmart-client-ui: personal theme only')
}
