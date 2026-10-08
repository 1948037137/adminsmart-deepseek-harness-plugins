/** 仅转发八项 General 设置的同源 Host 桥；身份、角色与能力令牌只由服务端提供。 */

export const UI_POLICY_ROUTE = '/adminsmart/ui-policy' // 当前签名用户 Runtime 的有限 GET/PUT 入口。
export const UI_POLICY_CLIENT_ROUTE = '/adminsmart/ui-policy-client.mjs' // 自有纯浏览器模块的固定资源入口。
const POLICY_FIELDS = Object.freeze(['locale', 'theme', 'fontSize', 'transcriptView', 'performanceUsage', 'busyEnter', 'linkOpening', 'developerTools']) // 唯一允许过桥的八个 General 字段。
const TRANSCRIPT_VALUES = new Set(['compact', 'standard', 'detailed', 'verbose', 'normal', 'expanded', null]) // RC2 当前、旧值和未指定模式，不接受显示文案。
const MAXIMUM_BODY_BYTES = 4_096 // 八项展示设置请求的资源上限，禁止无界 Profile 文档。
const REQUEST_TIMEOUT_MS = 5_000 // Host 到现有后端接口的有界请求超时。
export const UI_POLICY_DELIVERY_HEADER = 'X-AdminSmart-UI-Policy-Delivery' // 已提交策略的安全分发状态，只通过 Header 传输。

/** 稳定 HTTP 失败信息，不携带上游正文、能力令牌或内部异常。 */
export class UiPolicyHttpError extends Error {
  /** @param {number} status 安全 HTTP 状态。 @param {string} code 稳定业务错误码。 @param {string} message 用户可理解提示。 */
  constructor(status, code, message) {
    super(message)
    this.status = status // 同源路由响应状态，不转抄任意上游状态。
    this.code = code // 客户端区分冲突、拒绝和临时失败的稳定分类。
  }
}

/** @param {unknown} value 未信任的请求或响应设置。 @returns {boolean} 是否为完整 RC2 General 白名单。 */
export function isUiPolicySettings(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === POLICY_FIELDS.length
    && POLICY_FIELDS.every(field => Object.hasOwn(value, field))
    && (value.locale === null || typeof value.locale === 'string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(value.locale))
    && ['light', 'dark', 'system'].includes(value.theme)
    && Number.isInteger(value.fontSize) && value.fontSize >= 10 && value.fontSize <= 22
    && TRANSCRIPT_VALUES.has(value.transcriptView)
    && ['compact', 'detailed'].includes(value.performanceUsage)
    && ['queue', 'steer'].includes(value.busyEnter)
    && ['sidebar', 'new-tab'].includes(value.linkOpening)
    && typeof value.developerTools === 'boolean'
}

/**
 * 复制合法策略，不能让上游额外数据、原型或共享对象引用进入浏览器。
 * @param {unknown} payload 未校验的现有后端 revision/settings 响应。
 * @returns {object} 只有两个既有字段的完整响应。
 * @throws {UiPolicyHttpError} 响应、修订或任意展示字段非法。
 */
function policyEnvelope(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).length !== 2 || !Object.hasOwn(payload, 'settings')
    || !Number.isSafeInteger(payload.revision) || payload.revision < 0
    || (payload.settings === null ? payload.revision !== 0 : payload.revision < 1 || !isUiPolicySettings(payload.settings))) {
    throw new UiPolicyHttpError(502, 'agent_ui_policy_invalid', '全局智能体界面设置响应无效')
  }
  return {
    revision: payload.revision, // 现有独立 UI CAS 修订。
    settings: payload.settings === null ? null : Object.fromEntries(POLICY_FIELDS.map(field => [field, payload.settings[field]])), // 精确字段复制，不复制任意 Profile。
  }
}

/**
 * 调用现有签名后端 UI 策略 API，浏览器不能提供身份、角色或目标 URL。
 * @param {object} options Gateway 注入的可信 Runtime options。
 * @param {string} options.apiBase 受控后端根地址。
 * @param {() => Promise<string>} options.readToken 每次读取当前服务端能力令牌，不向浏览器公开。
 * @param {string} options.userId 签名租约绑定的用户身份。
 * @param {string} options.modeId 服务端选定业务模式。
 * @param {string} options.presetId 服务端选定 Agent Preset。
 * @param {boolean} options.isAdmin 可信管理员标记，不能从请求体取得。
 * @param {(status: 'delivered'|'delayed') => void} [options.onDelivery] 已校验的保存成功分发状态，不修改稳定 JSON 信封。
 * @param {'GET'|'PUT'} method 固定支持的操作。
 * @param {object|undefined} body PUT 只接受 expectedRevision/settings。
 * @returns {Promise<object>} 经完整白名单校验的非敏感策略信封。
 * @throws {UiPolicyHttpError} 权限、输入、CAS、传输或响应失败。
 */
export async function requestUiPolicy(options, method, body) {
  if (!['GET', 'PUT'].includes(method)) throw new UiPolicyHttpError(405, 'agent_ui_policy_method', '请求方法不受支持')
  if (method === 'PUT') {
    if (options.isAdmin !== true) throw new UiPolicyHttpError(403, 'agent_admin_required', '管理员权限不足')
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
      || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || !isUiPolicySettings(body.settings)) {
      throw new UiPolicyHttpError(400, 'agent_ui_policy_invalid', '通用设置请求无效')
    }
  }
  try {
    const token = await options.readToken() // 能力令牌只在当前服务端调用栈与固定认证头内存在。
    const response = await fetch(`${options.apiBase}/internal/agent-model/v1/ui-policy`, {
      method, // 不接受任意方法或裸代理请求。
      redirect: 'error', // 认证能力不能跟随重定向。
      headers: {
        Authorization: `Bearer ${token}`, // 唯一服务端读取的签名能力。
        'Content-Type': 'application/json', // 有限 JSON Schema 传输。
        'X-AdminSmart-User-Id': options.userId, // 不采纳浏览器伪造的用户 Header。
        'X-AdminSmart-Agent-Mode-Id': options.modeId, // 不采纳浏览器选择的业务模式。
        'X-AdminSmart-Agent-Preset-Id': options.presetId, // 不采纳浏览器选择的 Preset。
      },
      ...(method === 'PUT' ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), // 不让业务服务故障长期阻塞 Host。
    })
    if (!response.ok) {
      if (response.status === 409) throw new UiPolicyHttpError(409, 'agent_ui_policy_conflict', '界面设置已被更新，请重试')
      if ([401, 403].includes(response.status)) throw new UiPolicyHttpError(403, 'agent_ui_policy_denied', '通用设置访问已拒绝')
      throw new UiPolicyHttpError(503, 'agent_ui_policy_unavailable', '通用设置暂时不可用')
    }
    const policy = policyEnvelope(await response.json()) // body 仍严格保持 revision/settings，不混入运输元数据。
    if (method === 'PUT') {
      const delivery = response.headers?.get?.(UI_POLICY_DELIVERY_HEADER) // 只读取安全枚举，不转发任意后端 Header。
      options.onDelivery?.(delivery === 'delayed' ? 'delayed' : 'delivered')
    }
    return policy
  } catch (error) {
    if (error instanceof UiPolicyHttpError) throw error
    throw new UiPolicyHttpError(503, 'agent_ui_policy_unavailable', '通用设置暂时不可用')
  }
}

/**
 * 注册仅供当前签名 Runtime 使用的有限桥及自有浏览器资源。
 * @param {object} ctx 官方 Host Context，只使用 effect/webServer.register。
 * @param {object} options 与原 Host 策略同步共用的可信 options，不包含浏览器输入。
 * @param {object} helpers 同源验证、有界 JSON 读取和固定自有资源读取能力。
 * @param {(request: object) => void} helpers.assertSameOrigin 校验 Gateway 转发后的同源浏览器请求。
 * @param {(request: object, maximumBytes: number) => Promise<object>} helpers.readJsonBody 有界 JSON 解析。
 * @param {() => Promise<string>} helpers.readClientModule 只读取本插件固定 JS 文件，不能由 URL 决定路径。
 * @returns {void} Cordis effect 管理路由卸载。
 * @remarks 浏览器 Cookie 由既有 Gateway 验签和绑定 Runtime，插件不读取或转发 Cookie；PUT 后端仍再次验证管理员能力。
 */
export function installUiPolicyHttp(ctx, options, helpers) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', // 不匹配任意子路径或服务器文件。
    path: UI_POLICY_ROUTE, // 固定的同源八项设置入口。
    async handler(request, response) {
      if (!['GET', 'PUT'].includes(request.method)) {
        response.writeHead(405, { allow: 'GET, PUT', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        try { helpers.assertSameOrigin(request) } catch { throw new UiPolicyHttpError(403, 'agent_ui_policy_origin', '跨站请求已拒绝') }
        if (request.method === 'PUT' && options.isAdmin !== true) throw new UiPolicyHttpError(403, 'agent_admin_required', '管理员权限不足')
        let body // 当前管理员有界 CAS 输入，不含身份字段。
        if (request.method === 'PUT') {
          try { body = await helpers.readJsonBody(request, MAXIMUM_BODY_BYTES) } catch { throw new UiPolicyHttpError(400, 'agent_ui_policy_invalid', '通用设置请求无效') }
        }
        let delivery = 'delivered' // 每次请求独立状态，不能复用另一管理员提交的 Header。
        const policy = await requestUiPolicy({ ...options, onDelivery: status => { delivery = status } }, request.method, body) // 唯一后端调用，不读取 Credential 或任意配置。
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8', // 稳定有限 JSON 响应。
          'cache-control': 'no-store', // 共享策略每次从数据库确认，不能读取旧缓存。
          'x-content-type-options': 'nosniff', // 浏览器不得将策略响应当脚本执行。
          ...(request.method === 'PUT' ? { 'x-adminsmart-ui-policy-delivery': delivery } : {}), // 发布失败仍保留已保存 body，Client 可展示实时分发延迟。
        })
        response.end(JSON.stringify({ ...policy, writable: options.isAdmin === true && policy.settings !== null })) // 只公开界面写能力提示，不公开用户身份或认证信息。
      } catch (error) {
        const safe = error instanceof UiPolicyHttpError ? error : new UiPolicyHttpError(503, 'agent_ui_policy_unavailable', '通用设置暂时不可用') // 任意底层异常转为稳定安全提示。
        response.writeHead(safe.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        response.end(JSON.stringify({ error: { code: safe.code, message: safe.message } }))
      }
    },
  }), 'adminsmart-client-ui: bounded General policy HTTP')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', // 不做动态文件或目录映射。
    path: UI_POLICY_CLIENT_ROUTE, // 只公开一个自有纯浏览器模块。
    async handler(request, response) {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        const source = await helpers.readClientModule() // 唯一固定自有文件，不读第三方构建文件。
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        response.end(request.method === 'HEAD' ? undefined : source)
      } catch {
        response.writeHead(503, { 'cache-control': 'no-store' })
        response.end()
      }
    },
  }), 'adminsmart-client-ui: General bridge browser module')
}
