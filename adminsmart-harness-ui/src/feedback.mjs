import { timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'

export const FEEDBACK_READ_ROUTE = '/adminsmart/feedback/read' // 仅供通过主应用 admin 授权的 Gateway 回环请求读取评分。
export const FEEDBACK_MUTATION_PATH = '/internal/agent-tools/knowledge/feedback-mutation' // Runtime 官方反馈事件增量写入当前环境主应用索引的固定路径。
const MAXIMUM_SCANNED_SESSIONS = 20 // 每次最多检查的会话数，空反馈历史不能造成无界遍历。
const MAXIMUM_EXCERPT_LENGTH = 4096 // 管理列表的问题及回答只返回有界片段，不返回系统、工具或附件原文。
const MAXIMUM_CURSOR_LENGTH = 2048 // 连续读取游标的输入边界，不承担身份或权限证明。
const FEEDBACK_DELIVERY_TIMEOUT_MS = 60_000 // 后端可能等待正在执行的管理员全量同步释放事务锁。
const FEEDBACK_DELIVERY_RETRY_DELAYS_MS = [0, 250, 1_000] // 短暂 API 重启或连接复用故障允许有界重试，不形成无限后台任务。

/** @param {string} value 官方语义文本。 @returns {{text:string,truncated:boolean}} 不拆分 Unicode 字符的片段和截断标记。 */
function excerpt(value) {
  const points = Array.from(String(value || '')) // 当前官方消息语义文本的字符序列。
  return { text: points.slice(0, MAXIMUM_EXCERPT_LENGTH).join(''), truncated: points.length > MAXIMUM_EXCERPT_LENGTH }
}

/** @param {object} message 固定 SDK 派生的消息。 @returns {string} 只取公开 TextBlock，拒绝 reasoning、tool-call、tool-result、附件及未知块的正文。 */
function feedbackText(message) {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/** @param {object[]} surfaceEvents 官方当前消息表面事件。 @param {string} messageId 被评价 assistant 消息。 @param {Function} deriveEventMessage 固定 SDK 投影。 @returns {object} 有界问题与回答片段。 */
export function feedbackContentForMessage(surfaceEvents, messageId, deriveEventMessage) {
  let latestQuestion = excerpt('') // 当前遍历位置之前最近的 user 消息。
  for (const event of surfaceEvents || []) {
    if (!['user/message', 'assistant/message'].includes(event?.type)) continue
    const message = deriveEventMessage(event) // Harness 公开结构化投影，未知或非消息事件不自行解析。
    if (message?.role === 'user') {
      latestQuestion = excerpt(feedbackText(message))
      continue
    }
    if (message?.role === 'assistant' && String(message.id) === String(messageId)) {
      const answer = excerpt(feedbackText(message)) // 当前目标回答的唯一有界 TextBlock 投影。
      return {
        question: latestQuestion.text, // 当前回答前最近用户问题的有界文本。
        answer: answer.text, // 只取回答 TextBlock，不包含推理和工具参数。
        contentAvailable: true,
        questionTruncated: latestQuestion.truncated,
        answerTruncated: answer.truncated,
      }
    }
  }
  return { question: '', answer: '', contentAvailable: false, questionTruncated: false, answerTruncated: false }
}

/** @param {object} event 官方 feedback/message-put 或 delete 事件。 @param {object[]} surfaceEvents 当前官方表面。 @param {Function} deriveEventMessage 固定 SDK 投影。 @returns {object|null} 后端单条增量契约。 */
export function feedbackMutationPayload(event, surfaceEvents, deriveEventMessage) {
  if (event?.type === 'feedback/message-put') {
    const item = event.data?.item // 官方实质写入后的完整当前反馈值。
    const sessionId = String(event.data?.sessionId ?? '').trim() // Session 身份只来自官方事件。
    const messageId = String(item?.messageId ?? '').trim() // 消息身份只来自官方反馈当前值。
    if (!sessionId || !messageId || !['positive', 'negative'].includes(item?.rating) || !Number.isSafeInteger(item?.createdAt) || !Number.isSafeInteger(item?.updatedAt) || !Number.isSafeInteger(event.time)) return null
    const content = feedbackContentForMessage(surfaceEvents, messageId, deriveEventMessage) // 当前消息表面可能已不含历史目标，但评分仍可同步。
    return {
      operation: 'upsert',
      sessionId,
      messageId,
      rating: item.rating,
      note: String(item.note ?? ''),
      category: item.category ?? null,
      ...content,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      occurredAt: Math.max(event.time, item.updatedAt),
    }
  }
  if (event?.type === 'feedback/message-delete') {
    const sessionId = String(event.data?.sessionId ?? '').trim() // 删除事件包含权威所属 Session。
    const messageId = String(event.data?.messageId ?? '').trim() // 删除事件包含权威目标消息。
    if (!sessionId || !messageId || !Number.isSafeInteger(event.time)) return null
    return { operation: 'delete', sessionId, messageId, occurredAt: event.time }
  }
  return null
}

/** @param {string} value Runtime 注入的 FastAPI 回环根。 @returns {string} 无路径、凭据或查询的 IPv4 回环根。 */
function normalizeApiBase(value) {
  const parsed = new URL(String(value || '').trim()) // 标准 URL 解析拒绝字符串前缀绕过。
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('反馈同步地址无效')
  return parsed.origin
}

/** @param {string} capabilityTokenPath Gateway 受保护能力文件。 @returns {Promise<string>} 当前 Runtime 能力证明。 */
async function readCapabilityToken(capabilityTokenPath) {
  const tokenMetadata = await stat(capabilityTokenPath) // 读取前检查普通文件和大小，拒绝异常替换。
  if (!tokenMetadata.isFile() || tokenMetadata.size < 1 || tokenMetadata.size > 8192) throw new Error('反馈同步能力无效')
  const capabilityToken = (await readFile(capabilityTokenPath, 'utf8')).trim() // Token 只进入回环请求头，不写入日志或用户 Session。
  if (!capabilityToken) throw new Error('反馈同步能力无效')
  return capabilityToken
}

/** @param {object} payload 单条官方反馈增量。 @param {object} dependencies 受管 Runtime API、身份和能力文件。 @returns {Promise<void>} 后端接受后完成。 */
export async function deliverFeedbackMutation(payload, dependencies) {
  const apiBase = normalizeApiBase(dependencies.apiBase) // 每次调用使用同一受管回环根，不允许反馈正文选择目标地址。
  const capabilityToken = await readCapabilityToken(dependencies.capabilityTokenPath) // FastAPI 交叉验证 Runtime、用户、模式和 Preset。
  let lastError // 最终失败仅用于控制重试，不输出响应正文或反馈内容。
  for (const delayMs of FEEDBACK_DELIVERY_RETRY_DELAYS_MS) {
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
    try {
      const response = await fetch(`${apiBase}${FEEDBACK_MUTATION_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AdminSmart-Agent-Token': capabilityToken,
          'X-AdminSmart-User-Id': dependencies.ownerUserId,
          'X-AdminSmart-Agent-Mode-Id': dependencies.agentModeId,
          'X-AdminSmart-Agent-Preset-Id': dependencies.agentPresetId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(FEEDBACK_DELIVERY_TIMEOUT_MS),
      })
      await response.body?.cancel() // 不解析内部响应正文；显式释放 Undici 流以便连接复用且不积压资源。
      if (response.ok) return
      lastError = new Error(`feedback mutation status ${response.status}`) // 不读取可能含内部错误信息的响应正文。
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('feedback mutation delivery failed')
}

/** @param {object} ctx Harness Host Context。 @param {object} dependencies SDK 投影、环境身份和回环能力。 @returns {void} 注册官方反馈事件观察器。 */
export function installFeedbackMutationSync(ctx, dependencies) {
  const pendingTasks = new Set() // 插件释放前需要排空的有限回环投递任务。
  const inFlightKeys = new Set() // 活跃和冷事件偶发重复时只保留一个相同版本投递。
  let disposed = false // 释放后拒绝登记新任务，但等待已经接受的官方事件完成投递。

  /** @param {object} event 官方反馈事件。 @param {object[]} surfaceEvents 对应当前表面。 @returns {void} 事件回调同步返回，网络工作在微任务中执行。 */
  function schedule(event, surfaceEvents) {
    let payload // 只有完整通过官方事件和消息投影校验的增量才允许进入后台投递。
    try {
      payload = feedbackMutationPayload(event, surfaceEvents, dependencies.deriveEventMessage)
    } catch {
      console.warn('AdminSmart feedback incremental projection failed') // 观察器失败不能影响官方反馈写入，也不记录正文或身份。
      return
    }
    if (!payload || disposed) return
    const mutationKey = `${payload.operation}:${payload.sessionId}:${payload.messageId}:${payload.updatedAt ?? payload.occurredAt}` // 不含正文的进程内去重键。
    if (inFlightKeys.has(mutationKey)) return
    inFlightKeys.add(mutationKey)
    let task // finally 需要引用当前 Promise 以从集合删除。
    task = Promise.resolve()
      .then(() => deliverFeedbackMutation(payload, dependencies))
      .catch(() => console.warn('AdminSmart feedback incremental sync failed')) // 只记录稳定类别，不记录用户、会话、消息或正文。
      .finally(() => {
        inFlightKeys.delete(mutationKey)
        pendingTasks.delete(task)
      })
    pendingTasks.add(task)
  }

  ctx.effect(() => {
    const stopLive = ctx.on('session/event', (session, event) => {
      if (!['feedback/message-put', 'feedback/message-delete'].includes(event?.type)) return
      try {
        const surfaceEvents = session.surface.nodes.map(seq => session.eventAt(seq)).filter(Boolean) // 官方 live surface 的稳定事件快照。
        schedule(event, surfaceEvents)
      } catch {
        console.warn('AdminSmart live feedback observation failed') // Host 观察失败不能向用户反馈提交路径抛出异常。
      }
    })
    const stopCold = ctx.on('feedback/committed', inspection => {
      try {
        const events = structuredClone(inspection.events) // 官方要求观察者在转移所有权前深拷贝借用的持久前缀。
        const event = events.at(-1) // 冷反馈实质修改保证是已提交前缀的最后事件。
        if (!['feedback/message-put', 'feedback/message-delete'].includes(event?.type)) return
        const eventBySeq = new Map(events.map(candidate => [candidate.seq, candidate])) // foldSurface 返回 seq，按身份取得当前表面事件。
        const surfaceEvents = dependencies.foldSurface(events).nodes.map(seq => eventBySeq.get(seq)).filter(Boolean)
        schedule(event, surfaceEvents)
      } catch {
        console.warn('AdminSmart cold feedback observation failed') // 已提交的官方写入永远不能因索引观察失败回滚或报错。
      }
    })
    return async () => {
      disposed = true
      stopLive()
      stopCold()
      await Promise.allSettled([...pendingTasks])
    }
  }, 'adminsmart-client-ui: immediate feedback index sync')
}

/**
 * 从公开反馈服务及公开 SessionQuery 读取当前 Runtime 的连续评分批次。
 * @param {object} ctx 官方 Host Context，仅读取 messageFeedback 和 sessionQuery 服务。
 * @param {object} query cursor 为上一批游标，limit 为 1–50 条，rating 为空或官方评分枚举。
 * @param {object} dependencies ownerUserId/agentModeId/agentPresetId 来自受管进程；deriveEventMessage 来自固定 SDK 公开消息投影入口。
 * @returns {Promise<object>} 评分与片段、下一批游标及会话检查范围，不构造全局反馈总数。
 * @throws {Error} 游标过期、参数无效、原生目录服务不可用；局部会话读取失败计数返回。
 */
export async function readRuntimeFeedback(ctx, query, dependencies) {
  const { ownerUserId, agentModeId, agentPresetId, deriveEventMessage } = dependencies // 可信 Runtime 用户、模式、Preset 与固定 SDK 消息投影。
  const limit = Number(query.limit ?? 20) // 本次允许返回的评分条数。
  const rating = query.rating ?? null // 本次只读筛选，不修改任何评分。
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || ![null, 'positive', 'negative'].includes(rating)) throw new Error('反馈查询参数无效')
  let cursor = null // 已检查作用域及版本的连续读取位置。
  if (query.cursor) {
    if (typeof query.cursor !== 'string' || query.cursor.length > MAXIMUM_CURSOR_LENGTH) throw new Error('反馈游标无效')
    cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))
    if (cursor.version !== 1 || cursor.ownerUserId !== ownerUserId || cursor.agentModeId !== agentModeId || cursor.rating !== rating || !Number.isSafeInteger(cursor.anchor) || typeof cursor.sessionId !== 'string' || (cursor.messageId !== null && typeof cursor.messageId !== 'string')) throw new Error('反馈游标已失效，请刷新')
  }
  const records = await ctx.sessionQuery.filterSessions([]) // 官方逻辑目录，绝不读取第三方文件或数据库。
  const anchor = cursor?.anchor ?? Date.now() // 固定首批会话创建时间上界，后续新会话不改变当前连续读取位置。
  const scoped = records.filter(record => record.header.origin !== 'subagent' && (record.header.delegationDepth ?? 0) === 0 && (!record.header.agentPreset || record.header.agentPreset === agentPresetId) && record.header.createdAt <= anchor)
    .sort((left, right) => right.header.createdAt - left.header.createdAt || String(left.header.id).localeCompare(String(right.header.id))) // 不用 Workspace 分组，普通分支会话保留，动态 subagent 排除。
  const start = cursor ? scoped.findIndex(record => String(record.header.id) === cursor.sessionId) : 0 // 游标只允许指向当前受管用户与模式内的逻辑会话。
  if (cursor && start < 0) throw new Error('反馈游标已失效，请刷新')
  let index = Math.max(0, start + (cursor && cursor.messageId === null ? 1 : 0)) // 完整读完会话的游标进入下一会话，条目游标留在当前会话。
  let visited = 0 // 本次实际检查的会话数。
  let unavailableSessions = 0 // 本次读取失败的会话数，不将故障冒充空反馈。
  let nextCursor = null // 仍有未读取条目或会话时返回的连续读取位置。
  const rows = [] // 当前实际读取到的原生评分条目。

  /** @param {string} sessionId 当前逻辑会话身份。 @param {string|null} messageId 最后返回的评分消息，空值表示会话已读完。 @returns {string} 不包含凭据的作用域绑定游标。 */
  function encodeCursor(sessionId, messageId) {
    return Buffer.from(JSON.stringify({ version: 1, ownerUserId, agentModeId, rating, anchor, sessionId, messageId })).toString('base64url')
  }

  while (index < scoped.length && visited < MAXIMUM_SCANNED_SESSIONS) {
    const sessionId = String(scoped[index].header.id) // 当前逻辑目录内已授权会话，不从任意路径或外部 Workspace 取得。
    visited += 1
    let items // 官方服务当前评分，按创建时间和消息身份保持稳定顺序。
    let surface // 仅当当前会话存在匹配评分时读取的官方消息表面。
    try {
      const result = await ctx.messageFeedback.list({ sessionId }) // 原生持久反馈的唯一数据源。
      if (!result.ok) throw new Error('原生反馈暂不可用')
      items = result.value.items.filter(item => rating === null || item.rating === rating)
        .sort((left, right) => left.createdAt - right.createdAt || String(left.messageId).localeCompare(String(right.messageId)))
      if (items.length) surface = await ctx.sessionQuery.readSurface(sessionId)
    } catch {
      unavailableSessions += 1
      index += 1
      continue
    }
    const resumedItem = cursor?.sessionId === sessionId && cursor.messageId !== null ? items.findIndex(item => String(item.messageId) === cursor.messageId) : -1 // 条目游标只能恢复到仍存在且符合当前筛选的评分。
    if (cursor?.sessionId === sessionId && cursor.messageId !== null && resumedItem < 0) throw new Error('反馈已变化，请刷新')
    const contentByMessage = new Map() // 被评价消息身份到官方当前表面片段的映射，不包含系统提示词或工具事件。
    let latestQuestion = excerpt('') // 当前 assistant 消息之前最近一条用户问题片段。
    for (const event of surface?.events || []) {
      if (!['user/message', 'assistant/message'].includes(event.type)) continue
      const message = deriveEventMessage(event) // 固定 SDK 的结构化消息投影，禁止自行解析伪工具文本。
      if (message?.role === 'user') latestQuestion = excerpt(feedbackText(message))
      else if (message?.role === 'assistant') contentByMessage.set(String(message.id), { question: latestQuestion, answer: excerpt(feedbackText(message)) })
    }
    for (let itemIndex = resumedItem + 1; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex] // 当前官方反馈版本的不可变值，管理页不修改评分或备注。
      const content = contentByMessage.get(String(item.messageId)) // 当前公开表面可能不再包含历史目标，评分仍须保留。
      rows.push({
        ownerUserId, // 受管进程唯一用户身份，不取浏览器正文中的 userId。
        sessionId, // 当前 Runtime 逻辑目录中的原生会话。
        messageId: String(item.messageId), // 原生评分目标，不伪造业务记录主键。
        rating: item.rating, // 官方 positive/negative 枚举。
        note: String(item.note || ''), // 用户原样提交的评价备注。
        category: item.category ?? null, // 当前固定版本公开的原生反馈分类，不使用旧版伴随存储文档猜测。
        question: content?.question.text || '', // 有界问题片段。
        answer: content?.answer.text || '', // 有界回答片段。
        contentAvailable: Boolean(content), // 对应当前消息表面是否仍可读取。
        questionTruncated: content?.question.truncated || false, // 片段不等同于完整问题正文。
        answerTruncated: content?.answer.truncated || false, // 片段不等同于完整回答正文。
        createdAt: item.createdAt, // 原生反馈首次记录的 Unix 毫秒时间。
        updatedAt: item.updatedAt // 原生反馈实质修改的 Unix 毫秒时间。
      })
      if (rows.length >= limit) {
        nextCursor = itemIndex < items.length - 1 ? encodeCursor(sessionId, String(item.messageId)) : index < scoped.length - 1 ? encodeCursor(sessionId, null) : null
        return { rows, nextCursor, scannedSessions: index + 1, totalSessions: scoped.length, unavailableSessions }
      }
    }
    index += 1
  }
  if (index < scoped.length && index > 0) nextCursor = encodeCursor(String(scoped[index - 1].header.id), null)
  return { rows, nextCursor, scannedSessions: index, totalSessions: scoped.length, unavailableSessions }
}

/**
 * 安装 Gateway 专用反馈读取路由，只接受回环连接和受管能力文件的 Bearer 证明。
 * @param {object} ctx 固定 Harness 的 webServer/反馈/SessionQuery Context。
 * @param {object} dependencies capabilityTokenPath 为 Gateway 自有受保护能力文件；readJsonBody 为有界 JSON 读取器，其余字段见 readRuntimeFeedback。
 * @returns {void} 通过 ctx.effect 注册路由，插件释放时同步移除。
 */
export function installFeedbackRoute(ctx, dependencies) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', // 使用官方精确路由协议，不能覆盖默认 Web 或已有路径。
    path: FEEDBACK_READ_ROUTE, // 专用路径不注册 Tool 或模型可见上下文。
    async handler(request, response) {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        const remote = String(request.socket?.remoteAddress || '').replace(/^::ffff:/, '') // 真实 TCP 对端，不信任 X-Forwarded-For。
        const authorization = String(request.headers.authorization || '') // 当前内部请求凭据，禁止记录或返回。
        const tokenMetadata = await stat(dependencies.capabilityTokenPath) // Gateway 自有单文件大小校验，不读取第三方存储。
        if (!['127.0.0.1', '::1'].includes(remote) || !tokenMetadata.isFile() || tokenMetadata.size > 8192) throw new Error('反馈授权无效')
        const capability = (await readFile(dependencies.capabilityTokenPath, 'utf8')).trim() // 受管单文件中的能力证明，空文件必须保持拒绝。
        if (!capability) throw new Error('反馈授权无效')
        const expected = Buffer.from(`Bearer ${capability}`) // 仅在调用栈中使用的受管 Runtime 证明。
        const actual = Buffer.from(authorization) // 不从浏览器 Cookie 或 Origin 推断管理员权限。
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('反馈授权无效')
      } catch {
        response.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ error: '反馈阅读未授权' }))
        return
      }
      try {
        const query = await dependencies.readJsonBody(request) // 参数仅读取游标、评分和数量，用户作用域由进程环境固定。
        const result = await readRuntimeFeedback(ctx, query, dependencies) // 只使用固定版公开服务，不读内部反馈伴随文件。
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify(result))
      } catch {
        response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ error: '反馈读取暂不可用，请刷新后重试' }))
      }
    }
  }), 'adminsmart-client-ui: Gateway feedback read route')
}
