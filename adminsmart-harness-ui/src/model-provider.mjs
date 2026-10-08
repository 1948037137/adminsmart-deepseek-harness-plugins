/** Publish an administrator's official Harness provider to the managed backend without exposing its key to the browser. */

const ROUTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/u // 后端稳定身份加 agent- 前缀后仍在长度限制内。
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u // 仅允许官方 Credentials 服务接受的环境引用。
const REASONING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) // 固定 Harness 可选择的思考等级。
const providerMutationTails = new WeakMap() // 同一 Runtime 的自动发布与管理员增删共用串行边界。

/** @param {object} ctx 当前 Host Context。 @param {() => Promise<unknown>} work 一次 Provider 发布或变更。 @returns {Promise<unknown>} 当前动作结果；失败不阻塞下一次操作。 */
export async function runManagedProviderMutation(ctx, work) {
  const previous = providerMutationTails.get(ctx) ?? Promise.resolve() // 只等待同一 Runtime 先前的模型目录动作。
  const current = previous.then(work, work) // 前一个动作失败也允许本次修复或重试。
  const tail = current.then(() => undefined, () => undefined) // 尾队列不保留失败或敏感返回值。
  providerMutationTails.set(ctx, tail)
  try { return await current } finally { if (providerMutationTails.get(ctx) === tail) providerMutationTails.delete(ctx) }
}

/**
 * Read one administrator's official model capabilities without touching its credential.
 * @param {object} ctx Host Context exposing the public ConfigEditor.
 * @param {string} routeId Saved pi-ai provider route, not a backend provider id.
 * @returns {Array<{id:string,name:string,reasoningEfforts:object}>} Detached client-safe model rows.
 * @throws {Error} When the requested provider has not been saved.
 */
export function listOfficialProviderModels(ctx, routeId) {
  if (!ROUTE_PATTERN.test(routeId)) throw new Error('供应商身份无效')
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'llm-pi-ai') // 官方私有模型设置的唯一属主。
  const profile = entry?.options?.config?.providers?.[routeId] // 不读取 apiKeyEnv 的值或其它提供方配置。
  if (!profile || !Array.isArray(profile.models)) throw new Error('请先保存模型供应商')
  return profile.models.map(model => ({
    id: String(model?.id ?? '').trim(), // 官方模型目录使用的真实模型 ID。
    name: String(model?.name ?? model?.id ?? '').trim(), // 管理员可读名称。
    reasoningEfforts: model?.reasoningEfforts && typeof model.reasoningEfforts === 'object' && !Array.isArray(model.reasoningEfforts)
      ? { ...model.reasoningEfforts } : {}, // false 表示尚未开启可选等级，表层用空集合表示。
  })).filter(model => model.id) // 损坏条目不能成为写入目标。
}

/**
 * Validate the exact per-model effort map before editing the official profile.
 * @param {object} efforts Browser-submitted level to provider-wire-value mapping.
 * @returns {object} Detached, bounded map accepted by the fixed Harness schema.
 * @throws {Error} On unknown levels, missing non-off wire values or control characters.
 */
function validatedReasoningEfforts(efforts) {
  if (!efforts || typeof efforts !== 'object' || Array.isArray(efforts)) throw new Error('模型思考等级配置无效')
  const result = {} // 每个级别独立校验后才交给 ConfigEditor。
  for (const [level, raw] of Object.entries(efforts)) {
    if (!REASONING_LEVELS.has(level)) throw new Error('模型思考等级不受支持')
    if (level === 'off' && raw === null) { result.off = null; continue }
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 120 || /[\u0000-\u001f\u007f]/u.test(raw)) throw new Error('思考等级线协议值无效')
    result[level] = raw.trim()
  }
  return result
}

/**
 * Read one saved pi-ai provider and its credential through official Host services.
 * @param {object} ctx Official Context with configEditor and credentials.
 * @param {string} routeId Official Provider route selected by the administrator.
 * @returns {Promise<object>} Bounded backend request object; caller must not log or return apiKey.
 * @throws {Error} If the provider, its model capabilities, or its credential is incomplete.
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
  const models = await Promise.all(rawModels.map(async model => {
    const resolvedModel = await ctx.llm.resolveModelInfo(routeId, String(model?.id ?? '')).catch(() => null) // 官方公开 LLM 服务给出模型实际上下文和输入能力。
    const efforts = model?.reasoningEfforts && typeof model.reasoningEfforts === 'object' && !Array.isArray(model.reasoningEfforts)
      ? model.reasoningEfforts : {} // 未声明思考能力不伪造线值。
    const input = Array.isArray(model?.input) && model.input.length ? model.input : resolvedModel?.inputModalities ?? [] // 缺省输入模态从官方解析模型获取。
    return {
      modelName: String(model?.id ?? '').trim(), // 上游真实模型 ID。
      displayName: String(model?.name ?? model?.id ?? '').trim(), // 管理员在官方目录中填写的模型名称。
      contextWindow: Number(model?.contextWindow ?? resolvedModel?.context?.contextWindow ?? effectiveProfile?.defaultContextWindow), // 优先显式容量，再使用官方解析或路由默认上下文。
      maxOutputTokens: model?.maxTokens == null ? null : Number(model.maxTokens), // 未声明时保留未知，不能把 Harness 的运行回退值写成模型能力。
      supportsVision: input.includes('image'), // 与官方模型模态保持一致。
      reasoningEfforts: efforts, // 官方配置的等级到供应商线值映射。
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
  return payload
}

/**
 * Synchronize saved administrator providers after official settings or credential commits.
 * @param {object} ctx Host Context with ConfigEditor, Credentials and lifecycle events.
 * @param {object} options Trusted backend identity and a short-lived capability reader.
 * @returns {void} Lifecycle owns its debounce timer and event listeners.
 * @throws {never} Individual incomplete providers remain private until a later official commit.
 */
export function installManagedProviderSync(ctx, options) {
  let timer = null // 官方设置与随后提交的凭据合并为一次受管同步。
  let running = false // 避免快速连续保存重叠更新同一后端模型目录。
  let pending = false // 当前同步期间再次保存时，结束后重放最新 Profile。
  let disposed = false // Runtime 卸载后不再计划写入。
  const synchronize = async () => {
    if (running) { pending = true; return }
    running = true
    try {
      await runManagedProviderMutation(ctx, async () => {
        const entry = ctx.configEditor.entries().find(row => row.options.id === 'llm-pi-ai') // 串行边界内读取最新官方 Profile。
        const routes = Object.keys(entry?.options?.config?.providers ?? {}).filter(route => ROUTE_PATTERN.test(route)) // 只同步仍存在的 Provider。
        for (const route of routes) {
          if (disposed) break
          try {
            await publishManagedProvider(ctx, route, { ...options, token: await options.readToken() })
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
  ctx.effect(() => {
    const offSettings = ctx.on('settings/document-updated', ns => { if (ns === 'llm-pi-ai') schedule() }) // 官方编辑器完成配置提交后读取完整 Profile。
    const offCredential = ctx.on('credentials/reference-updated', () => schedule()) // Key 保存后重新读取官方 Credentials，避免配置先写、Key 后写的竞态。
    schedule() // 已存在的管理员供应商在 Runtime 冷启动后也进入共享目录。
    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      offSettings?.()
      offCredential?.()
    }
  }, 'adminsmart-client-ui: synchronize official providers')
}

/**
 * Mirror a saved reasoning map into the administrator's official editable model profile.
 * @param {object} ctx Host Context exposing the public ConfigEditor.
 * @param {string} routeId Official provider identity in this administrator's isolated Home.
 * @param {string} modelName Official model id, not the backend stable database id.
 * @param {object} efforts Already validated backend reasoning levels and wire values.
 * @returns {Promise<void>} After the official Loader has reconciled the scoped pi-ai entry.
 * @throws {Error} If this administrator has no matching editable model.
 */
export async function updateOfficialModelReasoning(ctx, routeId, modelName, efforts) {
  if (!ROUTE_PATTERN.test(routeId) || !modelName) throw new Error('官方模型思考配置无效')
  const validatedEfforts = validatedReasoningEfforts(efforts) // 不允许坏字段进入官方热重载事务。
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'llm-pi-ai') // 固定的管理员私有编辑器条目。
  if (!entry) throw new Error('官方模型编辑器暂不可用')
  await ctx.configEditor.edit(entry, current => {
    const providers = current.providers && typeof current.providers === 'object' ? current.providers : {} // 当前官方 Profile 的实际保存状态。
    const profile = providers[routeId] // 只修改当前管理员已经保存的提供方。
    if (!profile || !Array.isArray(profile.models) || !profile.models.some(model => model?.id === modelName)) throw new Error('官方模型已变化，请刷新后重试')
    const models = profile.models.map(model => model.id === modelName
      ? { ...model, reasoningEfforts: Object.keys(validatedEfforts).length ? { ...validatedEfforts } : false }
      : model) // 全部关闭时显式 false，避免又继承固定目录的思考能力。
    return { ...current, providers: { ...providers, [routeId]: { ...profile, models } } }
  })
}
