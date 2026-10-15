/** Publish an administrator's official Harness provider to the managed backend without exposing its key to the browser. */

const ROUTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/u // 后端稳定身份加 agent- 前缀后仍在长度限制内。
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u // 仅允许官方 Credentials 服务接受的环境引用。
const providerMutationTails = new WeakMap() // 同一 Runtime 的自动发布与管理员增删共用串行边界。
const providerConfirmations = new WeakMap() // 当前Host生命周期内已成功发布身份；显式重试与自动同步共享确认，不保存跨Host推测归属。

/**
 * 将同一 Host 的供应商发布、撤销及原生删除按提交顺序执行。
 * @param {object} ctx 当前 Host Context。
 * @param {() => Promise<unknown>} work 一次 Provider 发布或变更。
 * @returns {Promise<unknown>} 当前动作结果，失败不阻塞下一次操作。
 * @throws {Error} 当前 work 的真实错误，不自动重放动作。
 */
export async function runManagedProviderMutation(ctx, work) {
  const previous = providerMutationTails.get(ctx) ?? Promise.resolve() // 只等待同一 Runtime 先前的模型目录动作。
  const current = previous.then(work, work) // 前一个动作失败也允许本次修复或重试。
  const tail = current.then(() => undefined, () => undefined) // 尾队列不保留失败或敏感返回值。
  providerMutationTails.set(ctx, tail)
  try { return await current } finally { if (providerMutationTails.get(ctx) === tail) providerMutationTails.delete(ctx) }
}

/**
 * 从官方 Host 服务读取已保存供应商、模型元数据和凭据，形成带原生来源标记的共享请求。
 * @param {object} ctx 官方 Context；configEditor 提供实际原始配置，credentials 只在当前请求栈解引用凭据。
 * @param {string} routeId 管理员选择的已保存官方供应商路由，不接受客户端模型规格或凭据。
 * @returns {Promise<object>} 签名后端请求；native options 保留官方原始元数据及缺省语义，调用方不得记录或返回 apiKey。
 * @throws {Error} 供应商、模型能力、思考元数据结构或凭据不完整时拒绝发布，不写回官方配置。
 */
export async function buildManagedProvider(ctx, routeId) {
  if (!ROUTE_PATTERN.test(routeId)) throw new Error('供应商身份无效')
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'llm-pi-ai') // 只允许官方可编辑的管理员 pi-ai 实例。
  const profile = entry?.options?.config?.providers?.[routeId] // 不能让浏览器提交地址、模型规格或 Key。
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('请先保存模型供应商')
  const reference = String(profile.apiKeyEnv ?? '').trim() // Native Models 编辑器已将新 Key 写入独立凭据记录。
  if (!CREDENTIAL_REF_PATTERN.test(reference) || reference.startsWith('ADMINSMART_')) throw new Error('供应商凭据引用无效')
  const resolved = await ctx.credentials.resolve(reference) // 明文只在当前 Host 请求栈中存在，不经浏览器返回。
  const apiKey = String(resolved?.value ?? '').trim() // 未配置 Key 时禁止向后端发布空连接。
  if (!apiKey) throw new Error('请先在模型供应商中保存 API Key')
  const protocol = String(profile.api ?? '').trim() // 官方当前 pi-ai 配置使用的真实线协议。
  if (!['openai-responses', 'openai-completions', 'anthropic-messages'].includes(protocol)) throw new Error('供应商 API 协议不受支持')
  const baseUrl = String(profile.baseURL ?? '').trim() // 后端再次按固定网络边界校验 URL。
  const displayName = String(profile.displayName ?? routeId).trim() // 官方提供方显示名，不用于权限身份。
  const rawModels = Array.isArray(profile.models) ? profile.models : [] // 只发布管理员明确保存的模型条目。
  if (!baseUrl || !displayName || rawModels.length < 1 || rawModels.length > 50) throw new Error('请先补全供应商地址和模型目录')
  const effectiveProfile = ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'llm-pi-ai')?.value?.providers?.[routeId] // 仅为历史条目的上下文窗口保留官方路由默认值，不读取密钥或推断输出能力。
  const nativeProviderOptions = {
    ...(profile.reasoning === undefined ? {} : { reasoning: profile.reasoning }), // 只镜像实际保存的官方默认，不从生效配置或业务目录补值。
  } // 即使为空也标记本次来自原生配置，后端不得继承旧业务默认覆盖。
  const models = await Promise.all(rawModels.map(async model => {
    const resolvedModel = await ctx.llm.resolveModelInfo(routeId, String(model?.id ?? '')).catch(() => null) // 官方公开 LLM 服务给出模型实际上下文和输入能力。
    const rawReasoningEfforts = model?.reasoningEfforts // 原始官方三态：省略、明确false或精确线值映射，不能用UI等级身份重造。
    if (rawReasoningEfforts !== undefined && rawReasoningEfforts !== false
      && (!rawReasoningEfforts || typeof rawReasoningEfforts !== 'object' || Array.isArray(rawReasoningEfforts))) {
      throw new Error('官方模型思考元数据无效，请在模型设置中确认')
    }
    const nativeModelOptions = {
      ...(rawReasoningEfforts === undefined ? {} : {
        reasoningEfforts: rawReasoningEfforts === false ? false : { ...rawReasoningEfforts }, // 明确无能力保持false，映射复制为分离快照。
      }),
    } // 空对象仍表示原生来源；后端不能复用历史模型覆盖。
    const efforts = rawReasoningEfforts && typeof rawReasoningEfforts === 'object'
      ? { ...rawReasoningEfforts } : {} // 仅保留既有兼容请求字段，执行以nativeModelOptions三态为准。
    const input = Array.isArray(model?.input) && model.input.length ? model.input : resolvedModel?.inputModalities ?? [] // 缺省输入模态从官方解析模型获取。
    return {
      modelName: String(model?.id ?? '').trim(), // 上游真实模型 ID。
      displayName: String(model?.name ?? model?.id ?? '').trim(), // 管理员在官方目录中填写的模型名称。
      contextWindow: Number(model?.contextWindow ?? resolvedModel?.context?.contextWindow ?? effectiveProfile?.defaultContextWindow), // 优先显式容量，再使用官方解析或路由默认上下文。
      maxOutputTokens: model?.maxTokens == null ? null : Number(model.maxTokens), // 未声明时保留未知，不能把 Harness 的运行回退值写成模型能力。
      supportsVision: input.includes('image'), // 与官方模型模态保持一致。
      reasoningEfforts: efforts, // 官方配置的等级到供应商线值映射。
      nativeModelOptions, // 原生来源的模型能力，独立于旧业务目录的默认和开关字段。
      enabled: true, // 只发布实际保存在提供方目录中的条目。
    }
  })) // 后端 Pydantic 继续执行范围、类型和模型唯一性校验。
  if (models.some(model => !model.modelName || !model.displayName || !Number.isInteger(model.contextWindow) || model.contextWindow < 1024 || (model.maxOutputTokens !== null && (!Number.isInteger(model.maxOutputTokens) || model.maxOutputTokens < 1)))) {
    throw new Error('请先检查每个模型的上下文窗口和已填写的最大输出 token 数')
  }
  return {
    displayName, // 受管模型目录的供应商展示名称。
    baseUrl, // 管理员确认的供应商 API 根地址。
    apiProtocol: protocol, // 模型代理协议由官方编辑器已保存配置决定。
    apiKey, // 仅用于本次 Host 到 FastAPI 的回环提交，不返回客户端。
    nativeProviderOptions, // 原生供应商默认的来源标记，未配置时不从旧业务数据推导。
    models, // 当前官方供应商完整模型集合。
    enabled: true, // 已保存且启用的共享供应商模型对全部登录用户可见。
  }
}

/**
 * Publish one saved official provider through the signed internal API.
 * @param {object} ctx Official Host Context with the two model services.
 * @param {string} routeId Explicit official route; all other fields are read from Host services.
 * @param {object} options Trusted Runtime origin, actor claims and capability token.
 * @returns {Promise<object>} Safe provider roster without credentials.
 * @throws {Error} On authentication, validation or backend write failure.
 */
export async function publishManagedProvider(ctx, routeId, options) {
  const body = await buildManagedProvider(ctx, routeId) // 浏览器永远只发送路由 ID。
  const response = await fetch(`${options.apiBase}/internal/agent-model/v1/harness-providers/${encodeURIComponent(routeId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`, // 当前 Runtime 的签名能力只发送给回环后端。
      'Content-Type': 'application/json',
      'X-AdminSmart-User-Id': options.userId, // 与能力中的 actor 交叉校验。
      'X-AdminSmart-Agent-Mode-Id': options.modeId, // 固定业务模式。
      'X-AdminSmart-Agent-Preset-Id': options.presetId, // 当前业务 Preset。
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })
  const payload = await response.json().catch(() => null) // 后端只返回无 Key 的 Provider 摘要。
  if (!response.ok || !payload || payload.error) throw new Error(String(payload?.error?.message || '业务模型发布失败'))
  providerConfirmations.get(ctx)?.add(routeId) // 只有后台实际确认成功，显式发布才进入当前Host可撤销集合。
  return payload
}

/**
 * 撤销已经由当前 Host 成功发布并确认的路由；不能用于猜测冷启动的其它管理员共享目录。
 * @param {string} routeId 当前已确认路由身份。
 * @param {object} options 与发布使用同一签名身份及回环根的请求上下文。
 * @returns {Promise<void>} 后端锁内确认独立知识连接并清理目标默认引用后完成；迁移或网络故障拒绝原生删除。
 */
async function unpublishManagedProvider(routeId, options) {
  const response = await fetch(`${options.apiBase}/internal/agent-model/v1/harness-providers/${encodeURIComponent(routeId)}`, {
    method: 'DELETE', // 后台事务锁内保留独立知识连接并清除当前目标默认引用，允许聊天池删到空。
    headers: {
      Authorization: `Bearer ${options.token}`, // 与当前管理员Runtime绑定的签名能力，绝不交给Client。
      'X-AdminSmart-User-Id': options.userId, // 当前Trusted actor，不从模型或浏览器取得。
      'X-AdminSmart-Agent-Mode-Id': options.modeId, // 当前业务模式边界。
      'X-AdminSmart-Agent-Preset-Id': options.presetId, // 当前Preset约束。
    },
    signal: AbortSignal.timeout(5000), // 删除网络故障不会永久锁住同Host同步队列。
  })
  const result = await response.json().catch(() => null) // 只用于确认稳定成功或已缺失分类，不输出底层正文。
  const missing = response.status === 400 && result?.error?.code === 'chat_provider_missing' // 同Host后续配置删除不重复撤销已经消失的共享路由。
  if (!missing && (!response.ok || !result || result.error)) {
    const error = new Error('共享供应商撤销未获后台确认') // 稳定失败不回显后台正文，原生凭据仍不删除。
    error.code = typeof result?.error?.code === 'string' ? result.error.code : 'provider_deletion_unconfirmed' // 下层分类仅供上层固定映射，不作为文案或日志。
    throw error
  }
}

/**
 * Synchronize saved administrator providers after official settings or credential commits.
 * @param {object} ctx Host Context with ConfigEditor, Credentials and lifecycle events.
 * @param {object} options Trusted backend identity and a short-lived capability reader.
 * @returns {object} 当前Host确认的删除事务入口；生命周期拥有事件、去抖和确认集合。
 * @throws {never} Individual incomplete providers remain private until a later official commit.
 */
export function installManagedProviderSync(ctx, options) {
  let timer = null // 官方设置与随后提交的凭据合并为一次受管同步。
  let running = false // 避免快速连续保存重叠更新同一后端模型目录。
  let pending = false // 当前同步期间再次保存时，结束后重放最新 Profile。
  let disposed = false // Runtime 卸载后不再计划写入。
  const confirmedRoutes = new Set() // 只有当前Host实际发布成功的路由可以自动撤销，不盲扫共享目录。
  providerConfirmations.set(ctx, confirmedRoutes)
  const deletingRoutes = new Set() // Key unset到原生配置删除之间暂停重发布，防止官方事件把共享目录重建。
  const currentProfiles = () => ctx.configEditor.entries().find(row => row.options.id === 'llm-pi-ai')?.options?.config?.providers ?? {} // 当前官方Profile是补偿或再次发布唯一真源，不保留Key副本。
  const synchronize = async () => {
    if (running) { pending = true; return }
    running = true
    try {
      await runManagedProviderMutation(ctx, async () => {
        const profiles = currentProfiles() // 串行边界内重新读取官方Profile，不复用旧页面草稿。
        const routes = Object.keys(profiles).filter(route => ROUTE_PATTERN.test(route)) // 只同步仍存在的 Provider。
        for (const route of [...deletingRoutes]) {
          if (!profiles[route]) { deletingRoutes.delete(route); continue }
          const reference = profiles[route]?.apiKeyEnv // 只查询官方配置状态，不解引用Key明文。
          if (reference && (await ctx.credentials.describe(reference).catch(() => null))?.configured === true) deletingRoutes.delete(route) // 用户后来通过原生设置重填Key时允许恢复发布。
        }
        for (const route of routes) {
          if (disposed) break
          if (deletingRoutes.has(route)) continue // 官方unset事件期间已有原生Profile不等于凭据仍可用。
          try {
            await publishManagedProvider(ctx, route, { ...options, token: await options.readToken() })
            confirmedRoutes.add(route)
          } catch {
            ctx.logger?.warn?.('AdminSmart 模型供应商尚未同步；请检查已保存凭据和后端状态。') // 仅记录稳定原因，不输出 Key、地址或上游响应正文。
          }
        }
      })
    } finally {
      running = false
      if (pending && !disposed) { pending = false; schedule() }
    }
  }
  const schedule = () => {
    if (disposed) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; void synchronize() }, 300)
  }
  /**
   * 在同一Host串行边界内先撤销共享，再执行原生删除；失败只重新发布当前真实Profile，不重试Key删除。
   * @param {string[]} routes 原生参数已确认属于当前管理员的受影响路由。
   * @param {() => Promise<unknown>} operation 原生super删除或配置变更。
   * @returns {Promise<unknown>} 原始官方回执；后台再次拒绝时operation完全不执行。
   */
  const withDeletion = (routes, operation) => runManagedProviderMutation(ctx, async () => {
    const affected = routes.filter(route => confirmedRoutes.has(route) && currentProfiles()[route]) // 只处理当前Host成功发布且原生仍实际存在的路由。
    const withdrawn = [] // 实际后台删除成功的路由，后续失败时只补偿这些目标。
    try {
      for (const route of affected) {
        deletingRoutes.add(route)
        await unpublishManagedProvider(route, { ...options, token: await options.readToken() })
        confirmedRoutes.delete(route)
        withdrawn.push(route)
      }
      const result = await operation() // 共享删除已获锁内确认，才允许真正删除原生Key或配置。
      for (const route of withdrawn) if (!currentProfiles()[route]) deletingRoutes.delete(route)
      return result
    } catch (error) {
      for (const route of affected) deletingRoutes.delete(route)
      for (const route of withdrawn) {
        if (disposed || !currentProfiles()[route]) continue
        try {
          await publishManagedProvider(ctx, route, { ...options, token: await options.readToken() }) // 只从仍存在的原生Profile/Credentials补偿，不保存或伪恢复Key。
          confirmedRoutes.add(route)
        } catch { ctx.logger?.warn?.('共享模型撤销后的原生操作未完成，当前配置重新发布失败；请核对供应商连接。') }
      }
      throw error // 原生CAS或Credentials失败保持其真实错误，不把补偿当作删除成功。
    }
  })
  ctx.effect(() => {
    const offSettings = ctx.on('settings/document-updated', ns => { if (ns === 'llm-pi-ai') schedule() }) // 官方编辑器完成配置提交后读取完整 Profile。
    const offCredential = ctx.on('credentials/reference-updated', () => schedule()) // Key 保存后重新读取官方 Credentials，避免配置先写、Key 后写的竞态。
    schedule() // 已存在的管理员供应商在 Runtime 冷启动后也进入共享目录。
    return () => {
      disposed = true
      if (providerConfirmations.get(ctx) === confirmedRoutes) providerConfirmations.delete(ctx)
      if (timer !== null) clearTimeout(timer)
      offSettings?.()
      offCredential?.()
    }
  }, 'adminsmart-client-ui: synchronize official providers')
  return { withDeletion } // 只导出受管动作，不暴露确认路由、Profile或凭据内容。
}
