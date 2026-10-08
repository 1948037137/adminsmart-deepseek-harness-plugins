/** 签名快捷键同源HTTP桥；浏览器不能选择身份、目标URL、路径或动作。 */
import { shortcutDocument } from './shared-shortcuts-client.mjs'

export const SHORTCUT_POLICY_ROUTE = '/adminsmart/shortcut-policy' // 当前Runtime固定偏好GET/PUT路径。
export const SHORTCUT_POLICY_EVENTS_ROUTE = '/adminsmart/shortcut-policy/events' // 当前Runtime固定失效事件流。
export const SHORTCUT_POLICY_CLIENT_ROUTE = '/adminsmart/shared-shortcuts-client.mjs' // 自有canonical纯浏览器factory固定资源。
const MAXIMUM_BYTES = 32_768 // 当前官方指令/六设备文档的有限传输预算。
const REQUEST_TIMEOUT_MS = 5_000 // 单次回环数据库接口的有界等待。
const STREAM_TIMEOUT_MS = 70_000 // 官方内部租约流六十秒结束，Host额外限制异常连接。
const EVENT_BUFFER_LIMIT = 16_384 // 流只允许无文档失效消息，不能携带无界正文。
const FIXED = Object.freeze([
  { code: 'Enter', modifiers: [] }, { code: 'Enter', modifiers: ['shift'] },
  { code: 'Enter', modifiers: ['control'] }, { code: 'Enter', modifiers: ['meta'] },
  { code: 'Slash', modifiers: [] }, { code: 'Digit2', modifiers: ['shift'] },
  { code: 'ArrowUp', modifiers: [] }, { code: 'ArrowDown', modifiers: [] }, { code: 'Escape', modifiers: [] },
]) // 当前官方输入/菜单/审批/停止的固定组合，用官方protocol检查保留冲突。

/** 仅向当前已签名浏览器公开稳定HTTP故障，内部异常永不回显。 */
export class ShortcutPolicyHttpError extends Error {
  /** @param {number} status HTTP分类 @param {string} code 稳定机器码 @param {string} message 脱敏中文提示。 */
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

/**
 * 使用当前固定安装的公开./protocol验证文档，不构造动作或操作私有registry。
 * @param {unknown} value 未校验偏好文档。
 * @param {object} protocol Host按受管harnessRequire解析的官方./protocol导出。
 * @returns {object} 官方可解析且通过设备准入的受控偏好文档。
 * @throws {ShortcutPolicyHttpError} 文档/键码/保留键或显式冲突非法，或公共协议未装配。
 */
export function validateShortcutDocument(value, protocol) {
  if (!protocol?.parseShortcutDocument || !protocol?.bindingIssue || !protocol?.effectiveShortcuts) throw new ShortcutPolicyHttpError(503, 'agent_shortcut_protocol_unavailable', '快捷键公开协议暂不可用')
  try {
    const document = shortcutDocument(value) // 有限字段、命令、键码和数量先收紧，不接受任意扩展指令。
    const parsed = protocol.parseShortcutDocument(JSON.stringify(document)) // 官方版本/键码/字段解析，不使用普通文本模拟工具或动作。
    if (typeof parsed === 'string') throw new Error('invalid document')
    for (const [profile, overrides] of Object.entries(parsed.profiles)) {
      const [runtime, platform] = profile.split(':') // 已受控的六种运行界面与设备系统。
      const definitions = Object.keys(overrides).map(id => ({ id, defaults: {} })) // 仅校验显式override，不伪造未知官方默认键位。
      definitions.push({ id: 'fixed.input', defaults: {}, fixed: FIXED }) // 真实官方固定组合的纯声明，保留键不能被偏好抢占。
      const rows = protocol.effectiveShortcuts(definitions, parsed, runtime, platform) // 使用官方冲突、双键及设备准入算法。
      if (rows.some(row => row.issue !== null || row.conflicts.length)) throw new Error('unsupported binding')
    }
    return parsed
  } catch (error) {
    if (error instanceof ShortcutPolicyHttpError) throw error
    throw new ShortcutPolicyHttpError(400, 'agent_shortcut_policy_invalid', '快捷键文档不符合官方协议')
  }
}

/** @param {object} options 服务端绑定Runtime身份 @param {string} token 当次签名能力 @returns {object} 固定受控认证头。 */
const identityHeaders = (options, token) => ({
  Authorization: `Bearer ${token}`, // Token仅存在服务端当前调用栈，不向浏览器回显。
  'X-AdminSmart-User-Id': options.userId, // 与Runtime能力绑定的身份，不能采纳浏览器Header。
  'X-AdminSmart-Agent-Mode-Id': options.modeId, // 服务端白名单业务模式。
  'X-AdminSmart-Agent-Preset-Id': options.presetId, // 服务端白名单Agent Preset。
})

/**
 * 在读入时限制回环响应，超限立即取消reader，不先分配无界JSON正文。
 * @param {Response} response 已完成状态检查的固定回环响应。
 * @returns {Promise<object>} 仍待上层DTO校验的JSON对象。
 * @throws {Error} 响应超限、空流或JSON损坏。
 */
async function boundedJson(response) {
  if (!response.body?.getReader) throw new Error('response body unavailable')
  const reader = response.body.getReader() // 有限响应reader，不读取第三方或用户文件。
  const decoder = new TextDecoder() // UTF-8增量解码，不以字节块边界截断中文。
  let size = 0 // 已接受字节数，用于严格资源上限。
  let raw = '' // 受限JSON文本，超限前立即停止积累。
  try {
    while (true) {
      const { done, value } = await reader.read() // 标准reader纯临时传输字节。
      if (done) break
      size += value.byteLength
      if (size > MAXIMUM_BYTES) throw new Error('response too large')
      raw += decoder.decode(value, { stream: true })
    }
    return JSON.parse(raw + decoder.decode())
  } finally { await reader.cancel().catch(() => {}) }
}

/**
 * 转发有限GET/PUT，后端管理员验签和CAS仍是权威。
 * @param {object} options 固定apiBase/readToken/userId/modeId/presetId/isAdmin，不含浏览器输入。
 * @param {'GET'|'PUT'} method 当前受限操作。
 * @param {object|undefined} body 管理员expectedRevision/document。
 * @param {object} [helpers] 官方protocol与离线fetch替身。
 * @returns {Promise<object>} revision/document/writable及安全分发Header状态。
 * @throws {ShortcutPolicyHttpError} 权限、文档、CAS或回环接口失败。
 */
export async function requestShortcutPolicy(options, method, body, { protocol = options.shortcutProtocol, fetchImpl = globalThis.fetch } = {}) {
  if (!['GET', 'PUT'].includes(method)) throw new ShortcutPolicyHttpError(405, 'agent_shortcut_policy_method', '请求方法不受支持')
  if (method === 'PUT') {
    if (options.isAdmin !== true) throw new ShortcutPolicyHttpError(403, 'agent_admin_required', '管理员权限不足')
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
      || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw new ShortcutPolicyHttpError(400, 'agent_shortcut_policy_invalid', '快捷键保存请求无效')
    validateShortcutDocument(body.document, protocol)
  }
  try {
    const token = await options.readToken() // 每次请求实时读受保护的Runtime能力，不缓存或打印。
    const response = await fetchImpl(`${options.apiBase}/internal/agent-model/v1/shortcut-policy`, {
      method, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { ...identityHeaders(options, token), 'Content-Type': 'application/json' },
      ...(method === 'PUT' ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      if (response.status === 409) throw new ShortcutPolicyHttpError(409, 'agent_shortcut_policy_conflict', '快捷键已被其他管理员更新，请重新查看后保存')
      if ([401, 403].includes(response.status)) throw new ShortcutPolicyHttpError(403, 'agent_shortcut_policy_denied', '快捷键设置访问已拒绝')
      throw new ShortcutPolicyHttpError(503, 'agent_shortcut_policy_unavailable', '快捷键设置暂不可用')
    }
    const payload = await boundedJson(response) // 不把任意上游数据直接转发浏览器，字节上限在读入过程中执行。
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 2
      || !Number.isSafeInteger(payload.revision) || payload.revision < 0 || !Object.hasOwn(payload, 'document')
      || (payload.document === null ? payload.revision !== 0 : payload.revision < 1)) throw new Error('invalid envelope')
    return {
      revision: payload.revision, // 独立快捷键全局CAS修订。
      document: payload.document === null ? null : validateShortcutDocument(payload.document, protocol), // 双重协议校验后的纯偏好，不携带身份或权限对象。
      writable: options.isAdmin === true, // 来自签名Runtime角色的界面能力提示，后端PUT仍再次授权。
      delivery: response.headers?.get?.('X-AdminSmart-UI-Policy-Delivery') === 'delayed' ? 'delayed' : 'delivered', // 通知失败与数据库保存成功明确区分。
    }
  } catch (error) {
    if (error instanceof ShortcutPolicyHttpError) throw error
    throw new ShortcutPolicyHttpError(503, 'agent_shortcut_policy_unavailable', '快捷键设置暂不可用')
  }
}

/** @param {object} response 官方webServer响应 @param {Error} error 内部失败 @returns {void} 只返回安全错误。 */
const sendError = (response, error) => {
  const safe = error instanceof ShortcutPolicyHttpError ? error : new ShortcutPolicyHttpError(503, 'agent_shortcut_policy_unavailable', '快捷键设置暂不可用') // 不转抄内部异常正文。
  response.writeHead(safe.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify({ error: { code: safe.code, message: safe.message } }))
}

/**
 * 在既有Host安装固定同源GET/PUT/SSE和自有factory资源，不开启任意代理。
 * @param {object} ctx 官方Context，仅用公开effect/webServer.register。
 * @param {object} options 服务端可信Runtime装配，不接受浏览器role/user。
 * @param {object} helpers 同源、有界JSON、固定资源及公开官方protocol。
 * @param {Function} helpers.assertSameOrigin 既有Gateway同源验证。
 * @param {Function} helpers.readJsonBody 既有有界请求体解析。
 * @param {Function} helpers.readClientModule 唯一canonical自有浏览器factory源码读取。
 * @param {object} helpers.protocol 当前固定版本官方./protocol导出。
 * @returns {void} 所有路由由Cordis effect卸载，SSE自行限制生命周期。
 */
export function installShortcutPolicyHttp(ctx, options, helpers) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: SHORTCUT_POLICY_ROUTE,
    async handler(request, response) {
      try {
        if (!['GET', 'PUT'].includes(request.method)) throw new ShortcutPolicyHttpError(405, 'agent_shortcut_policy_method', '请求方法不受支持')
        try { helpers.assertSameOrigin(request) } catch { throw new ShortcutPolicyHttpError(403, 'agent_shortcut_policy_origin', '跨站请求已拒绝') }
        if (request.method === 'PUT' && options.isAdmin !== true) throw new ShortcutPolicyHttpError(403, 'agent_admin_required', '管理员权限不足')
        let body // 管理员有界偏好请求，GET没有写入正文。
        if (request.method === 'PUT') {
          try { body = await helpers.readJsonBody(request, MAXIMUM_BYTES) } catch { throw new ShortcutPolicyHttpError(400, 'agent_shortcut_policy_invalid', '快捷键保存请求无效') }
        }
        const saved = await requestShortcutPolicy(options, request.method, body, helpers) // 唯一固定签名回环API。
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'X-AdminSmart-UI-Policy-Delivery': saved.delivery })
        response.end(JSON.stringify({ revision: saved.revision, document: saved.document, writable: saved.writable }))
      } catch (error) { sendError(response, error) }
    },
  }), 'adminsmart-shared-shortcuts: signed preferences')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: SHORTCUT_POLICY_CLIENT_ROUTE,
    async handler(request, response) {
      try {
        if (!['GET', 'HEAD'].includes(request.method)) throw new ShortcutPolicyHttpError(405, 'agent_shortcut_policy_method', '请求方法不受支持')
        try { helpers.assertSameOrigin(request) } catch { throw new ShortcutPolicyHttpError(403, 'agent_shortcut_policy_origin', '跨站请求已拒绝') }
        const source = await helpers.readClientModule() // 唯一固定自有factory，不映射任意URL到本地文件。
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        response.end(request.method === 'HEAD' ? undefined : source)
      } catch (error) { sendError(response, error) }
    },
  }), 'adminsmart-shared-shortcuts: canonical browser factory')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: SHORTCUT_POLICY_EVENTS_ROUTE,
    async handler(request, response) {
      const controller = new AbortController() // 每个浏览器流独立取消，绝不转发浏览器认证信息。
      const closed = () => controller.abort() // 当前真实响应断连时立即停止内部阻塞读。
      const timeout = setTimeout(closed, STREAM_TIMEOUT_MS) // 回环流异常时仍有有界生命周期。
      timeout.unref?.()
      response.on?.('close', closed)
      try {
        if (request.method !== 'GET') throw new ShortcutPolicyHttpError(405, 'agent_shortcut_policy_method', '请求方法不受支持')
        try { helpers.assertSameOrigin(request) } catch { throw new ShortcutPolicyHttpError(403, 'agent_shortcut_policy_origin', '跨站请求已拒绝') }
        const token = await options.readToken() // 重连每次取当前签名能力；不接收浏览器Token或Last-Event-ID。
        const upstream = await (helpers.fetchImpl ?? globalThis.fetch)(`${options.apiBase}/internal/agent-model/v1/shortcut-policy/events`, { method: 'GET', redirect: 'error', signal: controller.signal, headers: identityHeaders(options, token) })
        if (!upstream.ok || !upstream.body?.getReader) throw new ShortcutPolicyHttpError(503, 'agent_shortcut_policy_events_unavailable', '快捷键实时同步暂不可用')
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff' })
        const reader = upstream.body.getReader() // 当前签名流的标准reader。
        const decoder = new TextDecoder() // 事件UTF-8逐帧解码。
        let buffer = '' // 只保留一个有限未完整帧，不缓存策略内容。
        try {
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read() // 纯临时传输字节。
            if (done) break
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/gu, '\n')
            if (buffer.length > EVENT_BUFFER_LIMIT) throw new Error('event too large')
            let boundary // 当前完整SSE帧边界。
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, boundary) // 不允许将任意上游正文转发浏览器。
              buffer = buffer.slice(boundary + 2)
              const lines = frame.split('\n') // 只解析标准event/data/id字段。
              const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() // 只允许固定恢复/失效/不可用类型。
              const data = JSON.parse(lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')) // 事件内容不能携带文档或身份。
              if (!data || typeof data !== 'object' || Array.isArray(data)
                || (!(['ready', 'resync', 'unavailable'].includes(event) && Object.keys(data).length === 0)
                && !(event === 'policy-invalidated' && Object.keys(data).length === 2 && data.kind === 'shortcuts' && Number.isSafeInteger(data.revision) && data.revision > 0))) throw new Error('invalid event')
              response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) // 浏览器只收到精确无敏感信息的通知字段。
            }
          }
        } finally { await reader.cancel().catch(() => {}) }
      } catch (error) {
        if (!response.headersSent) sendError(response, error)
        else if (!controller.signal.aborted) response.write('event: unavailable\ndata: {}\n\n')
      } finally { controller.abort(); clearTimeout(timeout); response.off?.('close', closed); if (!response.writableEnded) response.end() }
    },
  }), 'adminsmart-shared-shortcuts: bounded signed invalidation stream')
}
