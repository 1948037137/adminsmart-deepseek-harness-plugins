/** 通过签名共享模型快照热更新普通用户官方pi-ai目录；会话选择与管理员私有供应商保持原生所有权。 */
import { watchUiPolicyEvents } from './shared-ui-policy.mjs'

const MANAGED_NAMESPACE = 'adminsmart-managed-llm' // 普通用户唯一受管官方pi-ai实例，不访问管理员llm-pi-ai。
const REQUEST_MS = 8_000 // 签名能力读取、HTTP与完整响应体共用八秒总预算。
const MAXIMUM_BODY_BYTES = 512 * 1024 // 即使缺失Content-Length也严格限制完整JSON字节。
const REFRESH_MS = 30_000 // SSE暂不可用时只做低频完整回读。
const ROUTE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u // 共享目录只接受后端生成的稳定提供方身份。

/** @param {unknown} value JSON对象候选。 @returns {boolean} 是否为非数组记录。 */
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

/**
 * 生成键顺序无关的公开配置身份，比较同修订及相同目录，不规范化模型或思考线值。
 * @param {unknown} value 已经从有界JSON读取的配置。
 * @returns {string} 确定性JSON文本，仅留在Host内存，不记录或返回。
 */
function identity(value) {
  const ordered = item => Array.isArray(item) ? item.map(ordered) : record(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])])) : item // 数组顺序保留官方模型目录次序。
  return JSON.stringify(ordered(value))
}

/**
 * 在总预算与卸载信号内等待一个真实异步操作。
 * @param {Promise<unknown>} operation 凭据文件、HTTP或响应reader的当前操作。
 * @param {AbortSignal} signal 总预算或生命周期取消。
 * @returns {Promise<unknown>} 真实结果；取消时不等待忽略signal的外部Promise。
 * @throws {Error} 固定连接失败，不传递底层地址、正文或凭据。
 */
function bounded(operation, signal) {
  if (signal.aborted) return Promise.reject(new Error('共享模型同步已取消'))
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('共享模型同步已取消')) // 不输出原生取消原因或外部异常。
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/**
 * 从流式HTTP实体读取有限JSON，不使用无法执行流式上限的response.json回退。
 * @param {Response} response 固定回环API响应。
 * @param {AbortSignal} signal 读取总预算及卸载信号。
 * @returns {Promise<object>} 已解析JSON，随后继续验证路由与身份边界。
 * @throws {Error} 实体过大、无流、UTF-8/JSON损坏或取消时固定拒绝。
 */
async function readProfile(response, signal) {
  const declared = response.headers?.get?.('content-length') // 提前拒绝超限声明，但不把缺失声明视为无限可读。
  if (declared !== null && declared !== undefined && (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_BODY_BYTES)) throw new Error('共享模型响应无效')
  if (!response.body?.getReader) throw new Error('共享模型响应无效')
  const reader = response.body.getReader() // 读取只由当前Host动作持有，不能交给Client。
  const decoder = new TextDecoder('utf-8', { fatal: true }) // 跨块文本精确解码，坏编码不能悄悄替换后进入配置。
  let bytes = 0 // 真实接收字节数，与字符数量无关。
  let text = '' // 唯一有界JSON正文，解析失败也不得输出。
  try {
    while (true) {
      const { done, value } = await bounded(reader.read(), signal) // done控制结束；value仅作为本次JSON字节块。
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error('共享模型响应无效')
      bytes += value.byteLength
      if (bytes > MAXIMUM_BODY_BYTES) throw new Error('共享模型响应过大')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  } finally {
    void reader.cancel().catch(() => {}) // 取消不能额外延长八秒预算，底层故障保持不公开。
    try { reader.releaseLock() } catch { /* 超时后未结算的read由取消释放，不输出其底层状态。 */ }
  }
}

/**
 * 核验后端冷启动编译器的共享代理结果，不接受真实供应商连接或跨用户头。
 * @param {object} payload 有界签名GET的JSON实体。
 * @param {object} options 可信Runtime身份。
 * @returns {object} 原始Provider配置的分离快照，不推导模型能力、默认思考或会话选择。
 * @throws {Error} 版本、路由、内部Key引用、Subject或代理地址不符合固定边界。
 */
function validateProfile(payload, options) {
  if (!record(payload) || Object.keys(payload).length !== 4 || !['revision', 'providers', 'defaultProvider', 'defaultModel'].every(key => Object.hasOwn(payload, key))
    || !Number.isSafeInteger(payload.revision) || payload.revision < 0 || !record(payload.providers)
    || typeof payload.defaultProvider !== 'string' || typeof payload.defaultModel !== 'string'
    || Boolean(payload.defaultProvider) !== Boolean(payload.defaultModel)) throw new Error('共享模型响应无效')
  for (const [id, profile] of Object.entries(payload.providers)) {
    if (!ROUTE_ID.test(id) || !record(profile) || profile.apiKeyEnv !== 'ADMINSMART_AGENT_MODEL_TOKEN'
      || Object.hasOwn(profile, 'apiKey') || !['openai-responses', 'openai-completions', 'anthropic-messages'].includes(profile.api)
      || profile.baseURL !== `${options.apiBase}/internal/agent-model${profile.api === 'anthropic-messages' ? '' : '/v1'}`
      || !record(profile.headers) || !Array.isArray(profile.models) || !profile.models.length) throw new Error('共享模型代理配置无效')
    const expected = {
      'X-AdminSmart-User-Id': options.userId, // 与签名Runtime subject完全一致。
      'X-AdminSmart-Agent-Mode-Id': options.modeId, // 与受管业务模式一致。
      'X-AdminSmart-Agent-Preset-Id': options.presetId, // 与固定Preset一致。
    }
    if (Object.entries(expected).some(([key, value]) => profile.headers[key] !== value)
      || Object.keys(profile.headers).some(key => !Object.hasOwn(expected, key) && key !== 'X-AdminSmart-Model-Provider-Id')
      || id !== 'adminsmart-models' && !Object.hasOwn(profile.headers, 'X-AdminSmart-Model-Provider-Id')
      || Object.hasOwn(profile.headers, 'X-AdminSmart-Model-Provider-Id') && !ROUTE_ID.test(profile.headers['X-AdminSmart-Model-Provider-Id'])) throw new Error('共享模型身份配置无效')
  }
  if (payload.defaultProvider && (!payload.providers[payload.defaultProvider]?.models.some(model => model?.id === payload.defaultModel))) throw new Error('共享模型默认目录无效') // 明确空默认不猜首个供应商；用户仍可使用官方选择器选择其余合法模型。
  return structuredClone(payload)
}

/**
 * 安装受管普通用户模型目录同步；管理员仅保留其原始官方PrivateProvider供给路径。
 * @param {object} ctx 官方Host Context，settings必须为真实SettingsForms。
 * @param {object} trustedOptions Gateway可信apiBase/readToken/userId/modeId/presetId/isAdmin，不来自浏览器。
 * @param {object} [helpers] 隔离能力替换，不改变产品身份或目录合同。
 * @param {Function} [helpers.watchEvents] Fake失效订阅或官方共享解码订阅。
 * @param {Function} [helpers.fetchImpl] Fake签名GET或真实固定回环fetch。
 * @returns {{refresh:Function,dispose:Function,status:Function,getSnapshot:Function}} 有界回读、卸载与无敏感数据的状态。
 * @sideEffects 普通角色读取共享目录并通过官方providers单字段set热采用；不写默认模型、Session或reasoningEffort。
 */
export function installManagedModelSync(ctx, trustedOptions, { watchEvents, fetchImpl = globalThis.fetch } = {}) {
  const url = new URL(trustedOptions.apiBase) // 构造时核定固定回环根，签名能力不会发送到外部URL。
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || typeof trustedOptions.isAdmin !== 'boolean' || typeof trustedOptions.readToken !== 'function') throw new Error('共享模型同步配置无效')
  const options = { ...trustedOptions, apiBase: url.origin, userId: String(trustedOptions.userId), modeId: String(trustedOptions.modeId), presetId: String(trustedOptions.presetId) } // 只采用服务端固定身份，响应再次逐项核验。
  let disposed = false // 卸载后的响应与SSE不得进入目录。
  let accepted = null // 最近实际采用的完整签名快照；失败不能清空已确认目录。
  let pending = null // 所有回读与采用串行共用同一Promise，避免并行SDK变更。
  let again = false // 在途SSE或显式刷新合并为结束后的最新回读。
  let minimumRevision = -1 // 新失效通知抬高最低可采用修订，迟到GET不能降级。
  let active = null // 当前八秒请求的取消拥有者。
  let state = Object.freeze({ status: options.isAdmin ? 'private' : 'loading', revision: null, error: null }) // 不返回提供方头、路由、模型正文或令牌。
  let poll = null // 普通用户低频补偿；管理员不创建额外全局模型读取。
  let stopEvents = () => {} // 当前Host拥有的唯一models订阅释放函数。

  /** @returns {Promise<void>} 合并签名读取与原始SettingsForms单字段采用，失败保留已确认配置。 */
  const refresh = () => {
    if (disposed || options.isAdmin) return Promise.resolve()
    if (pending) { again = true; return pending }
    pending = (async () => {
      do {
        again = false
        const controller = new AbortController() // 当前完整请求预算，不复用已过期或已卸载的signal。
        active = controller
        const timeout = setTimeout(() => controller.abort(), REQUEST_MS) // 包含readToken、fetch和分块JSON读取。
        timeout.unref?.()
        try {
          const token = await bounded(options.readToken(), controller.signal) // 明文仅留在当前Host请求栈，任何失败均不记录。
          if (typeof token !== 'string' || !token.trim() || disposed) throw new Error('共享模型同步不可用')
          const response = await bounded(fetchImpl(`${options.apiBase}/internal/agent-model/v1/harness-profile`, {
            method: 'GET', redirect: 'error', cache: 'no-store', headers: {
              Authorization: `Bearer ${token}`, // 内部Runtime能力，不是供应商Key。
              'X-AdminSmart-User-Id': options.userId, // Subject交叉校验头。
              'X-AdminSmart-Agent-Mode-Id': options.modeId, // 模式白名单头。
              'X-AdminSmart-Agent-Preset-Id': options.presetId, // Preset白名单头。
            }, signal: controller.signal,
          }), controller.signal)
          if (!response.ok) throw new Error('共享模型同步不可用')
          const confirmed = validateProfile(await readProfile(response, controller.signal), options) // 官方字段保持原样，SDK负责完整模型Schema校验。
          if (disposed || controller.signal.aborted || confirmed.revision < minimumRevision || accepted && confirmed.revision < accepted.revision) continue
          if (accepted && confirmed.revision === accepted.revision && identity(confirmed) !== identity(accepted)) throw new Error('共享模型修订内容不一致')
          if (!accepted || identity(accepted.providers) !== identity(confirmed.providers)) {
            const row = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === MANAGED_NAMESPACE) // 仅普通用户官方volatile目录，不能触达管理员私有模型。
            if (!row || !Number.isSafeInteger(row.revision)) throw new Error('官方共享模型配置尚未就绪')
            if (disposed || confirmed.revision < minimumRevision) continue
            await ctx.settings.mutate(MANAGED_NAMESPACE, [{ op: 'set', path: ['providers'], value: confirmed.providers }], row.revision) // 完整单字段替换才能撤销Provider；update的deepmerge不满足此合同。
          }
          if (disposed) continue
          accepted = confirmed
          minimumRevision = Math.max(minimumRevision, confirmed.revision)
          state = Object.freeze({ status: 'ready', revision: confirmed.revision, error: null })
        } catch {
          if (!disposed) state = Object.freeze({ status: 'unavailable', revision: accepted?.revision ?? null, error: '共享模型同步暂不可用，将保留已确认配置并重试' }) // 不泄漏SDK异常、签名或HTTP正文。
        } finally {
          clearTimeout(timeout)
          if (active === controller) active = null
        }
      } while (again && !disposed)
    })().finally(() => { pending = null })
    return pending
  }
  if (!options.isAdmin) {
    const watch = watchEvents ?? ((settings, callback) => watchUiPolicyEvents(settings, callback, { kind: 'models', fetchImpl })) // 复用严格有限事件解码，不维护另一套SSE协议。
    stopEvents = watch(options, event => {
      if (disposed || event?.kind !== null && event?.kind !== 'models') return
      if (event?.kind === 'models') {
        if (!Number.isSafeInteger(event.revision) || event.revision < 1 || event.revision <= minimumRevision) return
        minimumRevision = event.revision
      }
      return refresh()
    })
    poll = setInterval(() => { void refresh() }, REFRESH_MS)
    poll.unref?.()
    void refresh()
  }
  return { refresh, status: () => state, getSnapshot: () => state, dispose() {
    disposed = true
    active?.abort()
    if (poll !== null) clearInterval(poll)
    stopEvents?.()
  } }
}
