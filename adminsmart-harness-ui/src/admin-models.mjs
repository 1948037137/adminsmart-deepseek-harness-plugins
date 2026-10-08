/** Administrator-only public-web model editing through official Harness Host services. */

import { createHash, randomBytes } from 'node:crypto'

const ROUTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/u // 固定 pi-ai Provider 路由身份边界。
const OWNED_CREDENTIAL_PATTERN = /^DSH_MODEL_[A-F0-9]{24}$/u // 仅清理由此管理页生成的官方 Credential 引用。
const SUPPORTED_PROTOCOLS = new Set(['openai-responses', 'openai-completions', 'anthropic-messages']) // 当前受管代理支持的线协议。
const MAXIMUM_MODELS = 50 // 与现有受管发布链路的单供应商模型上限一致。

/** Safe validation or concurrency failure that may be shown to an administrator without secrets. */
export class AdminModelError extends Error {}

/** @param {unknown} value 管理员提交的显示文本。 @param {string} name 字段中文名。 @param {number} limit 长度上限。 @returns {string} 有界、无控制字符的文本。 */
function boundedText(value, name, limit) {
  const text = typeof value === 'string' ? value.trim() : '' // 不把对象或数字隐式转成配置文本。
  if (!text || text.length > limit || /[\u0000-\u001f\u007f]/u.test(text)) throw new AdminModelError(`${name}无效`)
  return text
}

/** @param {unknown} value 管理员提交的 API 地址。 @returns {string} 不带认证信息的标准 HTTP(S) 根地址。 */
function validatedBaseUrl(value) {
  const source = boundedText(value, '供应商地址', 2048) // URL 不允许换行或无界正文。
  let parsed // 结构化 URL 解析，避免字符串前缀绕过协议边界。
  try { parsed = new URL(source) } catch { throw new AdminModelError('供应商地址无效') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) // 只有本机代理可以使用明文 HTTP。
  if (!(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback))
    || parsed.username || parsed.password || parsed.search || parsed.hash) throw new AdminModelError('供应商地址必须是无凭据的 HTTPS 地址')
  return parsed.href.replace(/\/$/u, '')
}

/** @param {unknown} value 单个模型编辑草稿。 @returns {object} 官方 pi-ai 模型的有界非敏感配置。 */
function validatedModel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdminModelError('模型配置无效')
  const id = boundedText(value.id, '模型 ID', 120) // 上游真实模型身份，不接受控制字符。
  const name = boundedText(value.name || value.id, '模型名称', 120) // 官方选择器展示名称。
  const contextWindow = Number(value.contextWindow) // 模型真实上下文窗口，由管理员确认。
  const hasMaxTokens = value.maxTokens !== undefined && value.maxTokens !== null && String(value.maxTokens).trim() !== '' // Harness 允许省略模型级输出上限。
  const maxTokens = hasMaxTokens ? Number(value.maxTokens) : undefined // 已确认时才覆盖官方模型目录或路由默认值。
  if (!Number.isInteger(contextWindow) || contextWindow < 1024 || contextWindow > 20_000_000
    || (hasMaxTokens && (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > contextWindow))) throw new AdminModelError('模型 token 容量无效')
  const input = Array.isArray(value.input) ? [...new Set(value.input)] : ['text'] // 不声明图片时仅按文本模型处理。
  if (!input.length || input.some(item => !['text', 'image'].includes(item)) || !input.includes('text')) throw new AdminModelError('模型输入类型无效')
  return { id, name, contextWindow, ...(hasMaxTokens ? { maxTokens } : {}), input }
}

/** @param {unknown} value Provider 草稿。 @param {boolean} creating 是否首次创建。 @returns {object} 可交给官方 ConfigEditor 的非敏感字段与可选 Key。 */
function validatedProvider(value, creating) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdminModelError('供应商配置无效')
  const displayName = boundedText(value.displayName, '供应商名称', 80) // 官方目录和业务目录共用的显示名称。
  const api = String(value.api ?? '').trim() // 固定 Harness pi-ai 的线协议字段。
  if (!SUPPORTED_PROTOCOLS.has(api)) throw new AdminModelError('供应商 API 协议无效')
  const baseURL = validatedBaseUrl(value.baseURL) // 保存前验证网络地址结构。
  const models = Array.isArray(value.models) ? value.models.map(validatedModel) : [] // 完整模型集合，供官方配置热重载。
  if (models.length < 1 || models.length > MAXIMUM_MODELS || new Set(models.map(model => model.id)).size !== models.length) throw new AdminModelError('请配置 1 至 50 个不重复模型')
  if (value.apiKey !== undefined && typeof value.apiKey !== 'string') throw new AdminModelError('API Key 无效')
  const apiKey = value.apiKey === undefined ? '' : value.apiKey.trim() // 明文只在本次 Host 请求栈和官方 Credentials.set 中存在。
  if ((creating && !apiKey) || apiKey.length > 4096 || /[\u0000-\u001f\u007f]/u.test(apiKey)) throw new AdminModelError('API Key 无效')
  return { displayName, api, baseURL, models, apiKey }
}

/** @param {object} ctx 官方 ConfigEditor 所在 Host。 @returns {object} 管理员私有的官方 pi-ai 配置条目。 */
function editableEntry(ctx) {
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'llm-pi-ai') // 只操作已挂载的管理员私有 Provider 编辑器。
  if (!entry) throw new AdminModelError('官方模型编辑器暂不可用')
  return entry
}

/** @param {object} profile 官方 Provider 配置。 @returns {string} 不含 Key 明文的并发校验指纹。 */
function profileFingerprint(profile) {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex') // 只对固定 Profile 对象计算，不记录或返回凭据值。
}

/** @param {unknown} value 已保存的官方 API 根。 @returns {string} 仅在不包含 URL 凭据时返回安全展示值。 */
function safeBaseUrl(value) {
  try {
    const url = new URL(String(value ?? '')) // 历史 Profile 可能含凭据或查询串，不允许通过新管理页回显。
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? url.href.replace(/\/$/u, '') : ''
  } catch { return '' }
}

/** @param {object} ctx 官方 Host Context。 @returns {Promise<object>} 管理员非敏感模型目录。 */
export async function listAdminModels(ctx) {
  const providers = editableEntry(ctx).options?.config?.providers ?? {} // 当前管理员 Runtime 实际保存的 Provider 配置。
  const rows = await Promise.all(Object.entries(providers).filter(([routeId]) => ROUTE_PATTERN.test(routeId)).map(async ([routeId, profile]) => {
    const credentialRef = String(profile?.apiKeyEnv ?? '').trim() // 仅用于 Host 内部查询就绪状态，永不返回浏览器。
    const credential = credentialRef ? await ctx.credentials.describe(credentialRef) : null // 官方 Credentials 的安全摘要。
    return {
      routeId, // 官方 pi-ai 配置项身份。
      displayName: String(profile?.displayName ?? routeId), // 目录显示名称。
      api: String(profile?.api ?? ''), // 实际线协议。
      baseURL: safeBaseUrl(profile?.baseURL), // 含历史 URL 凭据的 Profile 不得经浏览器回显。
      credentialConfigured: credential?.configured === true, // 只给浏览器“已配置”状态。
      fingerprint: profileFingerprint(profile), // 并发编辑比较当前 Provider 配置。
      models: Array.isArray(profile?.models) ? profile.models.map(model => ({
        id: String(model?.id ?? ''), // 上游模型 ID。
        name: String(model?.name ?? model?.id ?? ''), // 官方选择器名称。
        contextWindow: Number(model?.contextWindow ?? 0), // 已显式保存的上下文容量。
        maxTokens: model?.maxTokens == null ? null : Number(model.maxTokens), // 未覆盖官方输出容量时保持空值，不伪装为 0。
        input: Array.isArray(model?.input) ? [...model.input] : ['text'], // 已声明的输入模态。
        reasoningEfforts: model?.reasoningEfforts && typeof model.reasoningEfforts === 'object' ? { ...model.reasoningEfforts } : {} // 现有思考等级只读展示，编辑由已实现的模型配置席位承担。
      })) : []
    }
  }))
  return { providers: rows }
}

/**
 * 通过官方 LLM 发现服务查询草稿地址；旧密钥只在 Host 内解析且不返回客户端。
 * @param {object} ctx 官方 LLM、ConfigEditor 与 Credentials 服务。
 * @param {object} request 当前编辑草稿的协议、地址、可选新 Key 和已保存配置指纹。
 * @returns {Promise<object>} 有界候选模型元数据，容量未知时保留空值供管理员填写。
 * @throws {AdminModelError} 地址、权限范围、凭据或官方发现失败。
 */
export async function discoverAdminModels(ctx, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new AdminModelError('供应商草稿无效')
  const api = String(request.api ?? '').trim() // 官方发现服务实际使用的线协议。
  if (!SUPPORTED_PROTOCOLS.has(api)) throw new AdminModelError('供应商 API 协议无效')
  const baseURL = validatedBaseUrl(request.baseURL) // 管理员提交的网络地址沿用保存时的安全边界。
  if (request.apiKey !== undefined && typeof request.apiKey !== 'string') throw new AdminModelError('API Key 无效')
  let apiKey = String(request.apiKey ?? '').trim() // 新 Key 仅在本次发现调用栈中使用，不进入 Profile。
  if (apiKey.length > 4096 || /[\u0000-\u001f\u007f]/u.test(apiKey)) throw new AdminModelError('API Key 无效')
  if (!apiKey && request.routeId !== undefined) {
    const routeId = boundedText(request.routeId, '供应商身份', 48) // 无明文新 Key 时仅可使用当前已保存的路由。
    const fingerprint = boundedText(request.fingerprint, '配置修订', 64) // 防止旧页面读取后来轮换的凭据。
    const profile = editableEntry(ctx).options?.config?.providers?.[routeId] // 当前管理员私有 Profile，不读取其它用户目录。
    if (!ROUTE_PATTERN.test(routeId) || !profile || profileFingerprint(profile) !== fingerprint) throw new AdminModelError('模型供应商配置已变化，请刷新后重试')
    const credentialRef = String(profile.apiKeyEnv ?? '').trim() // 只在 Host 内解引用官方 Credential。
    const resolved = credentialRef ? await ctx.credentials.resolve(credentialRef) : null // 明文不返回浏览器或日志。
    apiKey = String(resolved?.value ?? '').trim()
  }
  if (!apiKey) throw new AdminModelError('请先填写 API Key')
  let discovered // 官方服务负责协议发现、超时信号和网络访问。
  try {
    discovered = await ctx.llm.discoverModels('llm-pi-ai', { baseURL, api, apiKey }, AbortSignal.timeout(15_000))
  } catch {
    throw new AdminModelError('获取可用模型失败，请检查 API 地址、协议和密钥')
  }
  const seen = new Set() // 上游目录可能重复，同一模型 ID 只展示一次。
  const models = [] // 只投影有限的非敏感候选字段。
  for (const candidate of Array.isArray(discovered) ? discovered : []) {
    if (models.length >= 200) break
    let id // 不可信供应商目录项必须先验证身份长度和字符。
    try { id = boundedText(candidate?.id, '模型 ID', 120) } catch { continue }
    if (seen.has(id)) continue
    seen.add(id)
    const name = typeof candidate.name === 'string' && candidate.name.trim() && candidate.name.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(candidate.name)
      ? candidate.name.trim() : id // 无有效展示名时沿用模型 ID。
    const contextWindow = Number(candidate.contextWindow) // 未披露的容量不得猜测。
    const maxTokens = Number(candidate.maxTokens) // 未披露的输出上限留给管理员确认。
    const input = Array.isArray(candidate.inputModalities) && candidate.inputModalities.includes('image')
      ? ['text', 'image'] : ['text'] // 仅保留当前表单支持的输入模态。
    models.push({
      id, // 供应商实际接受的模型身份。
      name, // 管理页展示名称。
      contextWindow: Number.isInteger(contextWindow) && contextWindow >= 1024 && contextWindow <= 20_000_000 ? contextWindow : null, // 有效才预填上下文窗口。
      maxTokens: Number.isInteger(maxTokens) && maxTokens > 0 && (!Number.isInteger(contextWindow) || maxTokens <= contextWindow) ? maxTokens : null, // 与已知上下文容量不冲突时才预填。
      input // 官方发现返回的已知图片输入能力。
    })
  }
  return { models }
}

/**
 * 新增或编辑管理员私有的官方 Provider；不把 Key 写进 Profile 或响应。
 * @param {object} ctx 官方 ConfigEditor 与 Credentials 服务。
 * @param {object} request 有界浏览器草稿，更新时携带 routeId 与 fingerprint。
 * @returns {Promise<object>} 保存后的非敏感目录和本次路由身份。
 * @throws {Error} 字段非法、旧配置已变化、官方热重载或凭据保存失败。
 */
export async function saveAdminModels(ctx, request) {
  const creating = request?.routeId === undefined // 服务端决定新路由和新凭据引用，浏览器不能选择任意身份。
  const draft = validatedProvider(request, creating) // 明文 Key 只保留在本次函数栈中。
  const routeId = creating ? `model-${randomBytes(9).toString('hex')}` : boundedText(request.routeId, '供应商身份', 48) // 新增身份不可预测，编辑必须匹配已保存路由。
  if (!ROUTE_PATTERN.test(routeId)) throw new AdminModelError('供应商身份无效')
  const expectedFingerprint = creating ? '' : boundedText(request.fingerprint, '配置修订', 64) // 并发管理员页面不能静默覆盖彼此更改。
  const newCredentialRef = draft.apiKey ? `DSH_MODEL_${randomBytes(12).toString('hex').toUpperCase()}` : '' // 每次轮换使用独立官方 Credential Ref，避免误改共用环境变量。
  const entry = editableEntry(ctx) // 写入边界始终是固定官方 pi-ai 条目。
  let previousCredentialRef = '' // 配置成功后只清理被本次轮换替换的自有旧引用。
  if (newCredentialRef) await ctx.credentials.set(newCredentialRef, draft.apiKey) // Key 只进入官方受保护 Credentials 存储。
  try {
    await ctx.configEditor.edit(entry, current => {
      const providers = current?.providers && typeof current.providers === 'object' && !Array.isArray(current.providers) ? current.providers : {} // 最新受锁保护配置。
      const previous = providers[routeId] // 当前路由已有配置，用于并发比较和保留高级字段。
      if (creating ? previous !== undefined : !previous || profileFingerprint(previous) !== expectedFingerprint) throw new AdminModelError('模型供应商配置已变化，请刷新后重试')
      previousCredentialRef = String(previous?.apiKeyEnv ?? '') // 不读取旧 Key 明文，且仅在编辑成功后尝试清理。
      const priorModels = new Map((Array.isArray(previous?.models) ? previous.models : []).map(model => [model.id, model])) // 未在本表编辑的高级模型字段不被擦除。
      const models = draft.models.map(model => {
        const saved = {
          ...(priorModels.get(model.id) ?? {}), // 保留官方高级兼容配置和已选思考线值。
          ...model, // 只替换管理员在本表明确编辑的模型字段。
          reasoningEfforts: priorModels.get(model.id)?.reasoningEfforts ?? false // 新模型默认不开启思考，之后按模型单独配置。
        }
        if (model.maxTokens === undefined) delete saved.maxTokens // 管理员清空旧覆盖值时，必须恢复 Harness 原生继承行为。
        return saved
      })
      const profile = {
        ...(previous ?? {}), // 保留未暴露给公网表单的官方高级 Provider 字段。
        displayName: draft.displayName, // 管理员确认的名称。
        api: draft.api, // 官方 pi-ai 协议。
        baseURL: draft.baseURL, // 已验证的 API 根。
        apiKeyEnv: newCredentialRef || previous?.apiKeyEnv, // 无 Key 草稿时原凭据引用原样保留。
        models // 完整已确认模型集合。
      }
      return { ...current, providers: { ...providers, [routeId]: profile } }
    })
  } catch (error) {
    if (newCredentialRef) await ctx.credentials.unset(newCredentialRef).catch(() => {}) // 配置提交失败时回收本次新建的孤立 Credential。
    throw error
  }
  if (newCredentialRef && OWNED_CREDENTIAL_PATTERN.test(previousCredentialRef)) {
    const inUse = Object.values(editableEntry(ctx).options?.config?.providers ?? {}).some(provider => provider?.apiKeyEnv === previousCredentialRef) // 其它 Provider 仍引用时必须保留。
    if (!inUse) await ctx.credentials.unset(previousCredentialRef).catch(() => {}) // 清理失败只留下受保护的孤立记录，不撤销已提交的配置。
  }
  return { routeId, ...(await listAdminModels(ctx)) }
}

/**
 * 先撤销受管业务目录，再删除对应的管理员私有官方配置。
 * @param {object} ctx 官方 ConfigEditor 与 Credentials 服务。
 * @param {object} request 管理员确认的路由身份和旧配置指纹。
 * @param {(routeId:string) => Promise<void>} unpublish 受签名回环后端的撤销动作；必须在本地删除前完成。
 * @param {(routeId:string) => Promise<void>} restore 官方编辑失败后重新发布仍存在的 Profile。
 * @returns {Promise<object>} 删除后的安全 Provider 目录。
 * @throws {AdminModelError} 默认模型仍引用目标、配置已变化或官方编辑失败。
 */
export async function deleteAdminModels(ctx, request, unpublish, restore) {
  const routeId = boundedText(request?.routeId, '供应商身份', 48) // 浏览器只可指定当前官方 Provider 路由。
  const fingerprint = boundedText(request?.fingerprint, '配置修订', 64) // 防止旧页面删除后来修改过的供应商。
  if (!ROUTE_PATTERN.test(routeId) || !/^[a-f0-9]{64}$/u.test(fingerprint)) throw new AdminModelError('供应商身份或配置修订无效')
  const entry = editableEntry(ctx) // 受管私有 Profile 的官方配置条目。
  const previous = entry.options?.config?.providers?.[routeId] // 待删除的已保存 Provider。
  if (!previous || profileFingerprint(previous) !== fingerprint) throw new AdminModelError('模型供应商配置已变化，请刷新后重试')
  await unpublish(routeId) // 后端先拒绝仍被默认用途引用的目标，避免仅删除私有 Profile 后留下全员旧目录。
  try {
    await ctx.configEditor.edit(entry, current => {
      const providers = current?.providers && typeof current.providers === 'object' ? current.providers : {} // 锁内最新官方配置。
      if (!providers[routeId] || profileFingerprint(providers[routeId]) !== fingerprint) throw new AdminModelError('模型供应商配置已变化，请刷新后重试')
      const nextProviders = { ...providers } // 不改其它供应商的已保存信息。
      delete nextProviders[routeId]
      return { ...current, providers: nextProviders }
    })
  } catch {
    if (editableEntry(ctx).options?.config?.providers?.[routeId]) {
      let restored = false // 仅当前官方 Provider 仍存在时，确认业务目录是否补偿成功。
      try {
        await restore(routeId) // 当前官方配置仍存在时，用其最新状态补偿先前的业务撤销。
        restored = true
      } catch {}
      if (restored) throw new AdminModelError('官方配置未删除，业务模型已恢复；请刷新后重试')
    }
    throw new AdminModelError('业务模型已撤销，但官方配置未删除或恢复失败；请刷新并核对模型目录')
  }
  const credentialRef = String(previous.apiKeyEnv ?? '') // 只检查引用身份，不读取 Key 明文。
  const stillReferenced = Object.values(editableEntry(ctx).options?.config?.providers ?? {}).some(provider => provider?.apiKeyEnv === credentialRef) // 共享凭据不能被误删。
  if (OWNED_CREDENTIAL_PATTERN.test(credentialRef) && !stillReferenced) await ctx.credentials.unset(credentialRef).catch(() => {}) // 官方原有或环境引用不属于本插件清理范围。
  return listAdminModels(ctx)
}
