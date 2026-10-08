/** AdminSmart Harness Host routes and client-module owner. */

import { mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AdminModelError, deleteAdminModels, discoverAdminModels, listAdminModels, saveAdminModels } from './admin-models.mjs'
import { installFeedbackMutationSync, installFeedbackRoute } from './feedback.mjs'
import { installManagedProviderSync, listOfficialProviderModels, publishManagedProvider, runManagedProviderMutation, updateOfficialModelReasoning } from './model-provider.mjs'
import { installSharedUiPolicy } from './shared-ui-policy.mjs'
import { installUiPolicyHttp } from './ui-policy-http.mjs'
import { installShortcutPolicyHttp } from '../shared-shortcuts/src/shortcut-policy-http.mjs'
import { readWorkspaceView, writeWorkspaceView } from './workspace-view.mjs'

export const name = 'adminsmart-client-ui-host'
export const inject = ['workspaceRegistry', 'sessionPersistence', 'sessions', 'webServer', 'messageFeedback', 'configEditor', 'credentials', 'settings', 'llm']

const SESSION_WEB_ACCESS_ROUTE = '/adminsmart/sessions/web-access' // 当前 Session 公开联网开关的同源 Host 路由。
const MODEL_PREFERENCE_ROUTE = '/adminsmart/model-preference' // 当前用户和业务模式最近主动模型选择的同源 Host 路由。
const WORKSPACE_VIEW_ROUTE = '/adminsmart/workspace-view' // 当前用户官方侧栏视图的同源持久化入口。
const MODEL_REASONING_ROUTE = '/adminsmart/model-reasoning' // 管理员插件维护 Chat 模型 reasoning 元数据的同源 Host 路由。
const MODEL_POLICY_ROUTE = '/adminsmart/model-policy' // 兼容旧管理员默认模型入口；旧白名单不再限制用户。
const MODEL_PROVIDER_PUBLISH_ROUTE = '/adminsmart/model-provider/publish' // 保留受控手动重试入口；正式同步由官方设置与凭据事件触发。
const ADMIN_MODELS_ROUTE = '/adminsmart/admin-models' // 开发与生产共用的管理员 Provider/Credentials 安全编辑桥接。
const ADMIN_MODELS_DISCOVER_ROUTE = '/adminsmart/admin-models/discover' // 管理员显式调用官方 LLM 模型发现服务的有界桥接。
const PRIVATE_MODEL_REASONING_ROUTE = '/adminsmart/private-model-reasoning' // 管理员私有 Provider 的逐模型等级，与后端发布状态无关。
const MODEL_CONFIGURATION_ROUTE = '/adminsmart/model-configuration' // 已保存 Provider 的聊天思考等级及新会话兜底入口；LightRAG 模型由后端独立固定。
const MODEL_DEFAULTS_ROUTE = '/adminsmart/model-defaults' // 登录用户可读取当前受管模型的非敏感逐模型默认等级。
const ADMINSMART_REASONING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) // 与固定 Harness pi-ai 配置可接受的等级键一致。
const ADMINSMART_VISIBLE_REASONING_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']) // 新的多选管理动作只允许业务界面展示的五档。
const AURASEARCH_LOGO_ROUTE = '/adminsmart/assets/aurasearch-logo.jpg' // Client-visible product logo route owned by this plugin.
const AURASEARCH_LOGO_PATH = fileURLToPath(new URL('../assets/aurasearch-logo.jpg', import.meta.url)) // Repository-owned operator-provided artwork.
const MAXIMUM_HOST_JSON_BODY_BYTES = 64 * 1024 // Host 控制路由默认的 JSON 请求体上限，限制开关、模型及偏好输入占用的内存。
const INTERNAL_RUNTIME_WORKSPACE_TITLE = '知识库工作区' // 当前业务模式唯一的官方 Workspace 标识；只绑定 Runtime cwd，不承担租户或 LightRAG 隔离。
const SESSION_WEB_ACCESS_STATE_VERSION = 1 // Runtime 私有联网状态文件的结构版本。
const SESSION_WEB_ACCESS_STATE_FILE = 'session-web-access.json' // Host UI 与 Agent Guard 共享的固定状态文件名。
const MODEL_PREFERENCE_STATE_VERSION = 1 // 用户模型偏好文件的结构版本。
const MODEL_PREFERENCE_STATE_FILE = 'model-preference.json' // 当前隔离 Runtime Home 内唯一的模型偏好文件。
const WORKSPACE_VIEW_STATE_FILE = 'workspace-view.json' // 官方视图设置按用户和业务模式保存在隔离 Runtime Home。
const MAXIMUM_SESSION_WEB_ACCESS_STATE_BYTES = 256 * 1024 // 防止损坏状态文件造成无界读取。
const MAXIMUM_MODEL_PREFERENCE_STATE_BYTES = 16 * 1024 // 单个模型选择不允许形成无界状态文件。
const MAXIMUM_SESSION_WEB_ACCESS_ENTRIES = 2_000 // 限制长期历史会话的状态文件规模。
const MAXIMUM_SESSION_ID_LENGTH = 200 // 对齐 Harness Session 身份的防御性文本上限。

/** Read one required Runtime environment value without exposing it. */
function requiredEnvironment(variableName) {
  const environmentValue = String(process.env[variableName] ?? '').trim() // Runtime-only value; never logged or persisted by this plugin.
  if (!environmentValue) throw new Error(`AdminSmart Harness 缺少运行配置：${variableName}`)
  return environmentValue
}
/** @returns {Promise<object>} 当前管理员 Host 专用的签名业务模型发布参数，不进入浏览器响应。 */
async function managedProviderOptions() {
  return {
    apiBase: requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, ''), // 固定回环后端地址。
    token: await readRuntimeCapabilityToken(), // 当前 Runtime 的签名能力。
    userId: requiredEnvironment('ADMINSMART_AGENT_USER_ID'), // 可信管理员主键。
    modeId: requiredEnvironment('ADMINSMART_AGENT_MODE_ID'), // 服务端白名单业务模式。
    presetId: requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'), // 服务端白名单 Agent Preset。
  }
}
/**
 * 在各 Host 路由自己的字段校验前读取有界 JSON 正文。
 * @param {import('node:http').IncomingMessage} request 当前浏览器请求的正文流；内容只在本次调用中使用。
 * @param {number} maximumBytes 当前路由允许的最大字节数；较大视图快照可以显式指定上限。
 * @returns {Promise<unknown>} 已解析的 JSON 值；空正文返回空对象，业务字段由调用路由继续验证。
 * @throws {Error} 正文超出上限、请求流失败或 JSON 无效时拒绝，不保留部分正文。
 * @sideEffects 消费当前请求流，不写入文件或日志。
 */
async function readJsonBody(request, maximumBytes = MAXIMUM_HOST_JSON_BODY_BYTES) {
  const chunks = [] // 当前请求的临时正文分片，完成解析后不持久化。
  let receivedBytes = 0 // 累计实际收到的字节数，防止浏览器输入造成无界缓冲。
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk) // 把当前请求分片统一为字节，保持上限计算准确。
    receivedBytes += bytes.length
    if (receivedBytes > maximumBytes) throw new Error('请求正文过大')
    chunks.push(bytes)
  }
  const bodyText = Buffer.concat(chunks).toString('utf8') // 有界控制正文只供当前路由解析，可能包含模型凭据，不写入日志或持久状态。
  return JSON.parse(bodyText || '{}')
}

/** Reject cross-site browser writes before a Session setting is read or changed. */
function assertSameOriginBrowserRequest(request) {
  const fetchSite = String(request.headers['sec-fetch-site'] ?? '').trim().toLowerCase() // 浏览器提供的 Fetch Metadata 站点关系。
  if (fetchSite && fetchSite !== 'same-origin') throw new Error('跨站请求已拒绝')
  const origin = String(request.headers.origin ?? '').trim() // 浏览器发起 CORS 相关请求时携带的来源。
  if (!origin) return
  const host = String(request.headers.host ?? '').trim() // 当前 Harness Host 的同源主机和端口。
  let parsedOrigin // 结构化来源用于比较协议和完整 host。
  try {
    parsedOrigin = new URL(origin)
  } catch {
    throw new Error('请求来源无效')
  }
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.host !== host) {
    throw new Error('跨站请求已拒绝')
  }
}

/** Normalize one loaded Harness Session id used only as an in-file map key. */
function normalizeSessionId(value) {
  const sessionId = String(value ?? '').trim() // 当前 UI Slot 提交的官方 SessionSnapshot.sessionId。
  if (!sessionId || sessionId.length > MAXIMUM_SESSION_ID_LENGTH || /[\u0000-\u001f\u007f]/u.test(sessionId)) {
    throw new Error('会话身份无效')
  }
  return sessionId
}

/** Read the current Runtime capability token for a Host-to-FastAPI admin call. */
async function readRuntimeCapabilityToken() {
  const tokenPath = resolve(requiredEnvironment('ADMINSMART_AGENT_TOKEN_FILE')) // Gateway-owned protected capability file; never returned to the browser.
  const token = String(await readFile(tokenPath, 'utf8')).trim() // Token remains in the current server call stack only.
  if (!token) throw new Error('Runtime 能力凭证为空')
  return token
}

/** Call the protected backend reasoning catalog without forwarding browser credentials. */
async function requestModelReasoningCatalog(method, body) {
  if (requiredEnvironment('ADMINSMART_AGENT_IS_ADMIN') !== '1') throw new Error('仅管理员可维护模型思考等级')
  const token = await readRuntimeCapabilityToken() // Signed Runtime capability binds the call to the authenticated tenant and admin role.
  const apiBase = requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, '') // FastAPI loopback origin selected by the signed lease.
  const response = await fetch(`${apiBase}/internal/agent-model/v1/reasoning`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, // Internal capability never reaches the browser response.
      'Content-Type': 'application/json',
      'X-AdminSmart-User-Id': requiredEnvironment('ADMINSMART_AGENT_USER_ID'), // Runtime subject is server-injected, not client-supplied.
      'X-AdminSmart-Agent-Mode-Id': requiredEnvironment('ADMINSMART_AGENT_MODE_ID'), // Fixed business mode from the signed Runtime.
      'X-AdminSmart-Agent-Preset-Id': requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'), // Fixed preset from the server allowlist.
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json().catch(() => null) // Backend returns only bounded model metadata and stable error envelopes.
  if (!response.ok || payload === null || typeof payload !== 'object') throw new Error('模型思考等级暂时不可用')
  if (payload.error !== undefined) throw new Error(String(payload.error.message || '模型思考等级暂时不可用'))
  return payload
}

/** Call the protected backend model-policy catalog without forwarding browser credentials. */
async function requestModelPolicy(method, body) {
  if (requiredEnvironment('ADMINSMART_AGENT_IS_ADMIN') !== '1') throw new Error('仅管理员可维护模型策略')
  const token = await readRuntimeCapabilityToken() // Runtime 能力只在 Host 到 FastAPI 的当前调用栈中存在。
  const apiBase = requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, '') // 当前签名租约绑定的 FastAPI 回环地址。
  const response = await fetch(`${apiBase}/internal/agent-model/v1/model-policy`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, // 内部能力凭证永远不进入浏览器响应。
      'Content-Type': 'application/json',
      'X-AdminSmart-User-Id': requiredEnvironment('ADMINSMART_AGENT_USER_ID'), // 用户身份由 Runtime 环境注入。
      'X-AdminSmart-Agent-Mode-Id': requiredEnvironment('ADMINSMART_AGENT_MODE_ID'), // 业务模式由服务端租约固定。
      'X-AdminSmart-Agent-Preset-Id': requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'), // Agent Preset 由服务端白名单固定。
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json().catch(() => null) // 只接受有界的非敏感模型目录 JSON。
  if (!response.ok || payload === null || typeof payload !== 'object') throw new Error('模型策略暂时不可用')
  if (payload.error !== undefined) throw new Error(String(payload.error.message || '模型策略暂时不可用'))
  return payload
}

/** Set one managed model use through the same signed administrator capability as the catalog. */
async function requestModelDefault(modelId, target) {
  const token = await readRuntimeCapabilityToken() // 浏览器只提交官方路由和模型身份，能力令牌始终留在 Host。
  const response = await fetch(`${requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, '')}/internal/agent-model/v1/model-default`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`, // 只发送给受管 FastAPI 回环服务。
      'Content-Type': 'application/json',
      'X-AdminSmart-User-Id': requiredEnvironment('ADMINSMART_AGENT_USER_ID'),
      'X-AdminSmart-Agent-Mode-Id': requiredEnvironment('ADMINSMART_AGENT_MODE_ID'),
      'X-AdminSmart-Agent-Preset-Id': requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'),
    },
    body: JSON.stringify({ modelId, target }),
  })
  const payload = await response.json().catch(() => null) // 只解析不含密钥的模型用途摘要。
  if (!response.ok || !payload || payload.error) throw new Error(String(payload?.error?.message || '默认模型保存失败'))
  return payload
}

/**
 * 校验官方聊天 Provider 已保存的显式关闭线值，不根据模型名称猜测能力。
 * @param {object} model - 官方模型能力行；只读取 reasoningEfforts.off，不读取连接或凭据。
 * @returns {boolean} 是否具有非空关闭声明；已知开启档位、空值和省略参数均不能证明关闭。
 * @throws 无；本校验仅保护聊天 Profile 的能力映射，不参与固定 LightRAG 配置。
 */
function hasExplicitChatOffPolicy(model) {
  const explicitOff = model?.reasoningEfforts?.off // 管理员在官方聊天能力配置中确认的供应商关闭线值。
  if (typeof explicitOff !== 'string' || !explicitOff.trim()) return false
  const normalizedOff = explicitOff.trim().toLowerCase() // 用于识别已知开启档位及当前目录声明的同义协议值。
  return !['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'enabled', 'enable', 'on', 'true'].includes(normalizedOff)
    && !Object.entries(model.reasoningEfforts).some(([level, wireValue]) => level !== 'off'
      && typeof wireValue === 'string' && wireValue.trim().toLowerCase() === normalizedOff) // 当前目录已声明为推理档的协议值不能同时证明关闭。
}

/**
 * Join private official capabilities to the backend-owned model-use catalog without credentials.
 * @param {object} ctx - Harness Host context exposing the official ConfigEditor.
 * @param {string} routeId - Current saved Provider route, scoped to this Runtime.
 * @param {object} policy - Signed backend policy containing chat model identities and defaults.
 * @returns {object[]} Client-safe model rows; old backends without the new flag remain conservative.
 */
function configuredProviderModels(ctx, routeId, policy) {
  const models = listOfficialProviderModels(ctx, routeId) // 官方已保存模型名称与真实等级映射。
  const managed = Array.isArray(policy?.models) ? policy.models : [] // 受管模型的当前稳定身份与默认用途。
  return models.map(model => {
    const shared = managed.find(item => item?.harnessProviderId === `agent-${routeId}` && item?.modelName === model.id) // 不能按显示名串用别的供应商模型。
    return {
      id: model.id, // 官方 Provider 内真实模型身份。
      name: model.name, // 官方可读名称。
      reasoningEfforts: model.reasoningEfforts, // 只显示当前实际支持的等级和线协议值。
      managedPublished: Boolean(shared), // 官方新模型先于后台受管发布出现时，Client 只对这一行做有界重读。
      defaultReasoningEffort: shared?.defaultReasoningEffort ?? null, // 后端确认的单模型默认档位。
      isHarnessDefault: shared?.modelId === policy?.defaultChatModelId, // 新会话兜底由共享目录决定。
    }
  })
}

/** Read the bounded Runtime-private web-access state, defaulting only when it does not exist. */
export async function readSessionWebAccessState(statePath) {
  try {
    const metadata = await stat(statePath) // 文件大小在读取前受限，避免损坏文件占用无界内存。
    if (!metadata.isFile() || metadata.size > MAXIMUM_SESSION_WEB_ACCESS_STATE_BYTES) {
      throw new Error('联网状态文件无效')
    }
    const parsedState = JSON.parse(await readFile(statePath, 'utf8')) // 文件只包含开关和更新时间，不包含消息、附件或凭据。
    if (parsedState?.version !== SESSION_WEB_ACCESS_STATE_VERSION || typeof parsedState.sessions !== 'object' || parsedState.sessions === null) {
      throw new Error('联网状态文件无效')
    }
    return parsedState
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { version: SESSION_WEB_ACCESS_STATE_VERSION, sessions: {} } // 首次会话按产品要求默认开启联网。
    }
    throw error
  }
}

/** Persist one Session switch through Harness's official atomic writer and bounded history pruning. */
export async function updateSessionWebAccessState({ statePath, sessionId, enabled, withFileLock, writeFileAtomic }) {
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 }) // 目录只位于当前用户与业务模式独占 DSH_HOME。
  return withFileLock(statePath, async () => {
    let currentState // 锁内读取的上一版完整状态；损坏文件允许由本次明确用户写入修复。
    try {
      currentState = await readSessionWebAccessState(statePath)
    } catch {
      currentState = { version: SESSION_WEB_ACCESS_STATE_VERSION, sessions: {} }
    }
    const nextSessions = {
      ...currentState.sessions, // 保留其它 Session 已保存的联网选择。
      [sessionId]: {
        enabled: Boolean(enabled), // 当前 Session 的最终公网访问开关。
        updatedAt: Date.now(), // 只用于历史条目裁剪，不作为权限或业务时间依据。
      },
    } // 新对象避免在失败写入前修改已读取状态。
    const boundedSessions = Object.fromEntries(
      Object.entries(nextSessions)
        .filter(([entrySessionId, entry]) => (
          typeof entrySessionId === 'string'
          && entrySessionId.length > 0
          && entrySessionId.length <= MAXIMUM_SESSION_ID_LENGTH
          && typeof entry?.enabled === 'boolean'
          && Number.isFinite(entry?.updatedAt)
        ))
        .sort((left, right) => Number(right[1].updatedAt) - Number(left[1].updatedAt))
        .slice(0, MAXIMUM_SESSION_WEB_ACCESS_ENTRIES),
    ) // 只保留最近的合法会话开关，避免 Runtime Home 随历史无限增长。
    const serializedState = JSON.stringify({
      version: SESSION_WEB_ACCESS_STATE_VERSION, // Guard 用于拒绝未知结构版本。
      sessions: boundedSessions, // 当前 Runtime 内按 Session 隔离的联网状态。
    })
    if (Buffer.byteLength(serializedState, 'utf8') > MAXIMUM_SESSION_WEB_ACCESS_STATE_BYTES) {
      throw new Error('联网状态文件过大')
    }
    await writeFileAtomic(statePath, serializedState, { mode: 0o600, dirMode: 0o700 })
    return Boolean(boundedSessions[sessionId]?.enabled)
  })
}

/** Normalize one provider, model or reasoning identifier stored as user preference. */
function normalizeModelPreferenceIdentifier(value, fieldName, { optional = false } = {}) {
  const normalizedValue = String(value ?? '').trim() // 模型目录标识只允许有界可见文本。
  if (optional && !normalizedValue) return undefined
  if (!normalizedValue || normalizedValue.length > 200 || /[\u0000-\u001f\u007f]/u.test(normalizedValue)) {
    throw new Error(`${fieldName}无效`)
  }
  return normalizedValue
}

/** Read the current Runtime user's last explicit model selection. */
export async function readModelPreferenceState(statePath) {
  try {
    const metadata = await stat(statePath) // 读取前限制文件类型和大小，避免损坏状态占用无界内存。
    if (!metadata.isFile() || metadata.size > MAXIMUM_MODEL_PREFERENCE_STATE_BYTES) throw new Error('模型偏好文件无效')
    const parsedState = JSON.parse(await readFile(statePath, 'utf8')) // 文件不包含密钥、消息或附件。
    if (parsedState?.version !== MODEL_PREFERENCE_STATE_VERSION) throw new Error('模型偏好文件无效')
    if (parsedState.selection === null) return { version: MODEL_PREFERENCE_STATE_VERSION, selection: null }
    const selection = parsedState.selection // 当前用户最后一次主动选择的官方 Provider、模型和可选思考等级。
    return {
      version: MODEL_PREFERENCE_STATE_VERSION,
      selection: {
        provider: normalizeModelPreferenceIdentifier(selection?.provider, '模型供应商'),
        model: normalizeModelPreferenceIdentifier(selection?.model, '模型'),
        reasoningEffort: normalizeModelPreferenceIdentifier(selection?.reasoningEffort, '思考等级', { optional: true }),
        updatedAt: Number(selection?.updatedAt) || 0,
      },
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: MODEL_PREFERENCE_STATE_VERSION, selection: null }
    throw error
  }
}

/** Persist one validated user model preference through the official atomic writer. */
export async function updateModelPreferenceState({ statePath, selection, withFileLock, writeFileAtomic }) {
  const normalizedSelection = {
    provider: normalizeModelPreferenceIdentifier(selection?.provider, '模型供应商'),
    model: normalizeModelPreferenceIdentifier(selection?.model, '模型'),
    reasoningEffort: normalizeModelPreferenceIdentifier(selection?.reasoningEffort, '思考等级', { optional: true }),
    updatedAt: Date.now(),
  } // Host 只持久化公开目录身份，实际可路由性仍由当前 Session 的官方 ModelDirectory 校验。
  const serializedState = JSON.stringify({
    version: MODEL_PREFERENCE_STATE_VERSION,
    selection: normalizedSelection,
  })
  if (Buffer.byteLength(serializedState, 'utf8') > MAXIMUM_MODEL_PREFERENCE_STATE_BYTES) throw new Error('模型偏好文件过大')
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 })
  await withFileLock(statePath, async () => {
    await writeFileAtomic(statePath, serializedState, { mode: 0o600, dirMode: 0o700 })
  })
  return normalizedSelection
}


/** Collect persisted and live Session headers without duplicating one identity. */
async function runtimeSessionHeaders(ctx) {
  const headerById = new Map() // Session ID to newest available header used only for internal Workspace membership repair.
  const persistedHeaders = await ctx.sessionPersistence.list() // Durable history survives Runtime restarts.
  for (const header of persistedHeaders) headerById.set(String(header.id), header)
  const liveSessions = ctx.sessions.list() // A blank Session may become live before persistence listing refreshes.
  for (const session of liveSessions) headerById.set(String(session.id), session.header)
  return [...headerById.values()]
}

/**
 * Create the Runtime-local Workspace required by the current official Web Composer.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context containing Workspace and Session services.
 * @param {string} runtimeCwd - Current user-and-mode Runtime's neutral working directory.
 * @returns {Promise<import('@deepseek-ai/dsh-workspace').Workspace>} Official Workspace used by the current business Runtime.
 */
export async function ensureInternalRuntimeWorkspace(ctx, runtimeCwd) {
  const workspace = await ctx.workspaceRegistry.create(runtimeCwd, INTERNAL_RUNTIME_WORKSPACE_TITLE) // Canonical cwd maps to one stable official Workspace record.
  if (workspace.title !== INTERNAL_RUNTIME_WORKSPACE_TITLE) {
    await workspace.setTitle(INTERNAL_RUNTIME_WORKSPACE_TITLE) // Internal title remains deterministic if an old registration exists.
  }
  const sessionHeaders = await runtimeSessionHeaders(ctx) // Existing blank Sessions with the same cwd become usable by the official Composer.
  for (const header of sessionHeaders) {
    if (typeof header.cwd !== 'string' || header.cwd.trim() === '') continue
    let sessionPath // Canonical Session cwd prevents attaching unrelated or historical legacy-directory Sessions.
    try {
      sessionPath = await realpath(header.cwd)
    } catch {
      continue
    }
    if (sessionPath !== workspace.path) continue
    await workspace.attachSession(header.id) // Real Workspace implementation owns idempotence.
  }
  return workspace
}

/**
 * 使用官方结构化 Index Injection 在插件启动前公开当前 Runtime 的 UI 角色。
 * @param {object} ctx 提供 webserver/index-inject 事件的官方 Host Context。
 * @param {boolean} isAdmin Gateway 签名租约传入的可信管理员标记。
 * @returns {Function} 释放当前 Host 的 Index Injection 监听器。
 * @remarks 只传角色枚举，不传用户标识、Token 或模型凭据；服务端授权仍独立校验。
 */
export function installRuntimeRoleIndexInjection(ctx, isAdmin) {
  return ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global', // 官方先渲染 JSON 全局值，再启动客户端模块。
      name: '__ADMINSMART_RUNTIME_ROLE__', // 自有 Client 唯一使用的 UI 启动标记。
      value: isAdmin === true ? 'admin' : 'managed-user', // 普通用户只补原生语音启动依赖。
    })
  })
}

/**
 * 装配产品资源、Session 控制、模型管理和用户界面状态的 Host 能力。
 * @param {import('@deepseek-ai/cordis').Context} ctx 当前隔离 Runtime 的官方 Host 服务与生命周期上下文。
 * @returns {Promise<void>} 完成官方兼容 Workspace 和自有路由注册；会话搜索由官方 Workspace/SessionQuery 提供。
 * @throws {Error} 受管环境配置或必要官方服务缺失时停止装配，不降级为未授权服务。
 * @sideEffects 注册可卸载路由与监听器，在当前用户 Runtime 中创建官方兼容 Workspace 和状态目录。
 */
export async function apply(ctx) {
  installRuntimeRoleIndexInjection(ctx, process.env.ADMINSMART_AGENT_IS_ADMIN === '1')
  const harnessRoot = resolve(requiredEnvironment('ADMINSMART_DSH_ROOT')) // 唯一共享的官方 Harness npm 运行项目根。
  const harnessRequire = createRequire(pathToFileURL(resolve(harnessRoot, 'package.json'))) // 以受管项目为解析锚点，避免插件目录或全局依赖影响版本。
  const directoryPickerModuleUrl = pathToFileURL(
    harnessRequire.resolve('@deepseek-ai/dsh-host-directory-picker'),
  ).href // 官方 DirectoryPicker 服务包公开入口，用于提供不访问目录的取消能力。
  const { default: DirectoryPicker } = await import(directoryPickerModuleUrl)
  const surfaceModuleUrl = pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-session/surface')).href // 固定 SDK 公开消息投影入口，不拼接第三方源码路径。
  const { deriveEventMessage, foldSurface } = await import(surfaceModuleUrl)
  const feedbackDependencies = {
    capabilityTokenPath: requiredEnvironment('ADMINSMART_AGENT_TOKEN_FILE'), // Gateway 自有能力文件，用于读取和增量写入的 Runtime 身份证明。
    apiBase: requiredEnvironment('ADMINSMART_AGENT_API_BASE'), // 当前开发或生产 FastAPI 的签名回环根。
    ownerUserId: requiredEnvironment('ADMINSMART_AGENT_USER_ID'), // 当前受管 Runtime 的唯一用户。
    agentModeId: requiredEnvironment('ADMINSMART_AGENT_MODE_ID'), // 当前受管 Runtime 的唯一业务模式。
    agentPresetId: requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'), // 当前已挂载业务能力组合。
    deriveEventMessage, // 官方结构化消息投影，反馈预览只读取 TextBlock。
    foldSurface, // 冷反馈提交事件使用官方 surface fold 重建当前表面。
  } // 反馈读取和增量同步共享同一个可信 Runtime 身份边界。
  installFeedbackRoute(ctx, {
    ...feedbackDependencies,
    ownerUserId: Number(feedbackDependencies.ownerUserId), // 原有读取游标使用数字账号；增量请求头仍保留规范文本。
    readJsonBody, // 复用 Host 有界正文读取器。
  })
  installFeedbackMutationSync(ctx, feedbackDependencies) // 官方反馈事件提交后立即增量更新主应用索引，不扫描其它 Session。
  const atomicWriteModuleUrl = pathToFileURL(
    harnessRequire.resolve('@deepseek-ai/dsh-atomic-write'),
  ).href // 官方原子写工具保证 Windows 与 Linux 上的 Session 开关替换完整可见。
  const { withFileLock, writeFileAtomic } = await import(atomicWriteModuleUrl)
  const auraSearchLogo = await readFile(AURASEARCH_LOGO_PATH) // Immutable plugin asset cached once per isolated Runtime process.
  const webAccessStatePath = resolve(
    requiredEnvironment('DSH_HOME'),
    '.adminsmart-state',
    SESSION_WEB_ACCESS_STATE_FILE,
  ) // Gateway 已按环境、模式和用户隔离的 Runtime 私有状态路径。
  const modelPreferenceStatePath = resolve(
    requiredEnvironment('DSH_HOME'),
    '.adminsmart-state',
    MODEL_PREFERENCE_STATE_FILE,
  ) // 同一用户和业务模式的新 Session 共享最近主动模型选择，不跨 Runtime 隔离边界。
  const workspaceViewStatePath = resolve(requiredEnvironment('DSH_HOME'), '.adminsmart-state', WORKSPACE_VIEW_STATE_FILE) // 官方侧栏视图不再使用跨账号浏览器存储作为权威来源。
  const cancelledDirectoryCapability = Object.freeze({
    kind: 'native', // Official DirectoryPickerController expects a native capability descriptor.
    async pick() {
      return null // Every directory request behaves like an operator cancellation and never touches the filesystem.
    },
  }) // Stable capability identity for the full Host plugin lifetime.

  class AdminSmartCancelledDirectoryPicker extends DirectoryPicker {
    /** Return the cancellation-only directory capability required by official Workspace UI services. */
    capability() {
      return cancelledDirectoryCapability
    }
  }

  const pickerFiber = ctx.plugin(AdminSmartCancelledDirectoryPicker) // The Host plugin owns and disposes the restricted service.
  await pickerFiber.await()
  const runtimeCwd = resolve(process.cwd()) // Gateway starts each user-and-mode Runtime inside its neutral runtime-cwd directory.
  await ensureInternalRuntimeWorkspace(ctx, runtimeCwd) // Compatibility-only Workspace unlocks the official Composer without entering business logic.
  if (process.env.ADMINSMART_AGENT_IS_ADMIN !== '1') {
    const { AdminSmartReadOnlySettings } = await import('./read-only-settings.mjs') // Ordinary-only public Remote dependency resolves after the signed Runtime root exists.
    const settingsFiber = ctx.plugin(AdminSmartReadOnlySettings) // Ordinary users only receive redacted General descriptions, never settings writes or Credentials Remote.
    await settingsFiber.await()
  }
  if (process.env.ADMINSMART_AGENT_UI_POLICY_SUPPORTED !== '0') {
    const uiPolicyOptions = {
      apiBase: requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, ''), // 当前签名租约的受控后端根地址。
      readToken: readRuntimeCapabilityToken, // 每次读取服务端能力令牌，不向浏览器提供凭据。
      userId: requiredEnvironment('ADMINSMART_AGENT_USER_ID'), // Gateway 验签绑定身份，不接受浏览器 Header 或正文覆盖。
      modeId: requiredEnvironment('ADMINSMART_AGENT_MODE_ID'), // 服务端选定业务模式。
      presetId: requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'), // 服务端白名单 Agent Preset。
      isAdmin: process.env.ADMINSMART_AGENT_IS_ADMIN === '1', // 与 Runtime 绑定的可信角色，后端仍再次授权。
    } // 原生 Host 同步与有限 HTTP 桥共用同一身份、角色和 API 装配契约。
    installSharedUiPolicy(ctx, uiPolicyOptions)
    installUiPolicyHttp(ctx, uiPolicyOptions, {
      assertSameOrigin: assertSameOriginBrowserRequest, // 沿用 Gateway 转发后的同源校验，不读取浏览器 Cookie 值。
      readJsonBody, // 请求体解析仍使用既有有界实现，桥模块收紧为八项设置大小上限。
      readClientModule: () => readFile(new URL('./ui-policy-client.mjs', import.meta.url), 'utf8'), // 固定自有文件资源，URL 或输入不能选择服务器路径。
    })
    const shortcutProtocol = await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-client-shortcuts/protocol')).href) // 固定 SDK 公开协议只在服务端验证键码、保留键与冲突，不交给模型或浏览器选择包。
    installShortcutPolicyHttp(ctx, uiPolicyOptions, {
      protocol: shortcutProtocol, // 所有偏好提交都先通过当前固定官方解析与准入算法。
      assertSameOrigin: assertSameOriginBrowserRequest, // 浏览器只可访问当前登录 Runtime 的同源端点。
      readJsonBody, // 按快捷键模块预算读取完整偏好 JSON，不接收命令代码或身份字段。
      readClientModule: () => readFile(new URL('../shared-shortcuts/src/shared-shortcuts-client.mjs', import.meta.url), 'utf8'), // 唯一 canonical 浏览器配置桥，不映射任意服务器文件。
    })
  } // A production release without the new signed API keeps its existing UI settings until explicitly upgraded.
  if (process.env.ADMINSMART_AGENT_IS_ADMIN === '1') {
    installManagedProviderSync(ctx, {
      apiBase: requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, ''), // 当前签名租约的后端回环根。
      readToken: readRuntimeCapabilityToken, // Token 只在单次 Host 请求栈中读取。
      userId: requiredEnvironment('ADMINSMART_AGENT_USER_ID'), // 受管身份与能力声明交叉核对。
      modeId: requiredEnvironment('ADMINSMART_AGENT_MODE_ID'), // 固定业务模式。
      presetId: requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'), // 服务端白名单 Preset。
    })
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: AURASEARCH_LOGO_ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
        response.end()
        return
      }
      response.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': String(auraSearchLogo.length),
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : auraSearchLogo)
    },
  }), 'adminsmart-client-ui: AuraSearch logo asset')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SESSION_WEB_ACCESS_ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'PUT') {
        response.writeHead(405, { allow: 'GET, PUT', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        assertSameOriginBrowserRequest(request)
        const sessionId = normalizeSessionId(request.headers['x-adminsmart-session']) // 只接受当前 Client Slot 的官方 Session 身份。
        if (request.method === 'PUT' && ctx.sessions.get(sessionId) === undefined) throw new Error('会话不存在或尚未加载') // GET 可在 Session 恢复前读取默认值；写入仍要求真实会话。
        let enabled // 返回给当前页面的最终联网开关状态。
        if (request.method === 'GET') {
          const state = await readSessionWebAccessState(webAccessStatePath) // 缺失条目按默认开启解释。
          enabled = state.sessions[sessionId]?.enabled !== false
        } else {
          const requestBody = await readJsonBody(request) // PUT 正文只允许一个布尔开关字段。
          if (typeof requestBody.enabled !== 'boolean') throw new Error('联网开关值无效')
          enabled = await updateSessionWebAccessState({
            statePath: webAccessStatePath, // 当前 Runtime 唯一状态文件。
            sessionId, // 已确认属于当前加载 Runtime 的 Session。
            enabled: requestBody.enabled, // 用户本次明确选择的开关值。
            withFileLock, // 官方跨进程写锁，当前单进程仍保持协议完整。
            writeFileAtomic, // 官方同目录原子替换能力。
          })
        }
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify({ enabled }))
      } catch {
        response.writeHead(400, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify({ error: '联网设置暂时不可用' }))
      }
    },
  }), 'adminsmart-client-ui: Session web access route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MODEL_PREFERENCE_ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'PUT') {
        response.writeHead(405, { allow: 'GET, PUT', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        assertSameOriginBrowserRequest(request)
        normalizeSessionId(request.headers['x-adminsmart-session']) // 有界请求关联；偏好归属是已验签用户 Runtime，不依赖会话是否仍驻留内存。
        const selection = request.method === 'GET'
          ? (await readModelPreferenceState(modelPreferenceStatePath)).selection
          : await updateModelPreferenceState({
              statePath: modelPreferenceStatePath,
              selection: (await readJsonBody(request)).selection,
              withFileLock,
              writeFileAtomic,
            })
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify({ selection }))
      } catch {
        response.writeHead(400, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify({ error: '模型偏好暂时不可用' }))
      }
    },
  }), 'adminsmart-client-ui: model preference route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: WORKSPACE_VIEW_ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'PUT') {
        response.writeHead(405, { allow: 'GET, PUT', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        assertSameOriginBrowserRequest(request)
        const view = request.method === 'GET'
          ? await readWorkspaceView(workspaceViewStatePath)
          : await writeWorkspaceView({
              path: workspaceViewStatePath,
              view: (await readJsonBody(request, 256 * 1024)).view,
              withFileLock,
              writeFileAtomic,
            }) // Official atomic writer is confined to the current Runtime Home.
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ view }))
      } catch {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ error: '工作区视图设置暂不可用' }))
      }
    },
  }), 'adminsmart-client-ui: current-user Workspace view route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PRIVATE_MODEL_REASONING_ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'PUT') {
        response.writeHead(405, { allow: 'GET, PUT', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        assertSameOriginBrowserRequest(request)
        if (requiredEnvironment('ADMINSMART_AGENT_IS_ADMIN') !== '1') throw new Error('仅管理员可维护模型思考等级')
        const body = request.method === 'PUT' ? await readJsonBody(request) : null // 写入只接受路由、模型 ID 与等级映射。
        const routeId = request.method === 'GET'
          ? new URL(request.url, 'http://localhost').searchParams.get('providerId')
          : body?.providerId // GET 查询与 PUT 正文都只命名当前私有 Provider。
        const providerId = String(routeId ?? '') // Host 再从 ConfigEditor 取得实际模型，客户端不能提供能力元数据。
        let syncWarning = '' // 私有 Profile 的保存结果不受受管目录暂时不可用的影响。
        if (request.method === 'PUT') {
          const modelId = String(body?.modelId ?? '') // 当前官方 Provider 内的模型 ID。
          await updateOfficialModelReasoning(ctx, providerId, modelId, body?.reasoningEfforts)
          try {
            const policy = await requestModelPolicy('GET') // 未发布时为空，不能把私有模型误当成普通用户白名单。
            const managed = (Array.isArray(policy?.models) ? policy.models : []).find(model => (
              model?.harnessProviderId === `agent-${providerId}` && model?.modelName === modelId
            )) // 已发布的同一个模型才同步后端等级。
            if (managed) {
              const efforts = body.reasoningEfforts // 此值已经通过官方 Profile 写入验证。
              const priorDefault = String(managed.defaultReasoningEffort ?? '') // 删除等级时不能保留失效默认档。
              await requestModelReasoningCatalog('PUT', {
                providerId: managed.providerId, modelId: managed.modelId,
                reasoningEfforts: efforts,
                defaultReasoningEffort: Object.prototype.hasOwnProperty.call(efforts, priorDefault) ? priorDefault : null,
              })
            }
          } catch {
            syncWarning = '官方模型思考等级已保存，但业务目录同步失败；请稍后重新发布此供应商。'
          }
        }
        const models = listOfficialProviderModels(ctx, providerId) // 只返回当前私有模型名与等级，不返回地址或凭据。
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ models, ...(syncWarning ? { warning: syncWarning } : {}) }))
      } catch (error) {
        const message = String(error?.message || '模型思考等级暂时不可用')
        response.writeHead(message.includes('管理员') ? 403 : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ error: message }))
      }
    },
  }), 'adminsmart-client-ui: private model reasoning route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MODEL_CONFIGURATION_ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'PUT') {
        response.writeHead(405, { allow: 'GET, PUT', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        assertSameOriginBrowserRequest(request)
        if (requiredEnvironment('ADMINSMART_AGENT_IS_ADMIN') !== '1') throw new Error('仅管理员可配置模型用途')
        const body = request.method === 'PUT' ? await readJsonBody(request) : null // UI 只提交模型身份、动作和已展示的等级 ID。
        const routeId = String(request.method === 'GET'
          ? new URL(request.url, 'http://localhost').searchParams.get('providerId') ?? ''
          : body?.providerId ?? '') // 官方私有 Provider 的稳定路由。
        const modelId = String(body?.modelId ?? '') // 当前模型在官方 Provider 内的 ID。
        if (request.method === 'PUT') {
          const action = String(body?.action ?? '') // 只维护聊天档位和新会话兜底，不接受连接配置或已退役知识动作。
          if (action === 'knowledge' || action === 'off-wire') throw new Error('LightRAG 知识模型已固定，不支持动态知识配置')
          if (!['effort', 'efforts', 'harness'].includes(action)) throw new Error('模型用途操作无效')
          const official = listOfficialProviderModels(ctx, routeId).find(model => model.id === modelId) // 写操作必须命中官方已保存模型。
          if (!official) throw new Error('官方模型不存在，请刷新后重试')
          const effort = action === 'effort' && body?.reasoningEffort !== null ? String(body?.reasoningEffort ?? '') : null // 空值表示跟随供应商。
          let configuredEfforts = official.reasoningEfforts // 发布与后端更新必须使用官方编辑器确认后的同一映射。
          if (action === 'effort' && effort !== null && !Object.prototype.hasOwnProperty.call(configuredEfforts, effort)) {
            if (!ADMINSMART_REASONING_LEVELS.has(effort) || (effort === 'off' && !Object.keys(configuredEfforts).some(level => level !== 'off'))) throw new Error('思考等级不属于当前模型')
            const wireValue = String(body?.wireValue ?? '').trim() // 首次配置第三方档位时由管理员明确提供真实协议值。
            if (!wireValue || wireValue.length > 120 || /[\u0000-\u001f\u007f]/u.test(wireValue)) throw new Error('请填写有效的供应商思考线值')
            if (effort === 'off' && !hasExplicitChatOffPolicy({ reasoningEfforts: { ...configuredEfforts, off: wireValue } })) throw new Error('关闭思考线值不能使用开启档位')
            configuredEfforts = { ...configuredEfforts, [effort]: wireValue }
            await updateOfficialModelReasoning(ctx, routeId, modelId, configuredEfforts) // 官方 Profile 是后续自动发布的唯一能力真源。
          }
          const selectedEfforts = action === 'efforts' ? body?.reasoningEfforts : undefined // 只接收五档身份集合，不接收浏览器伪造的线协议映射。
          if (action === 'efforts') {
            if (!Array.isArray(selectedEfforts) || selectedEfforts.length > ADMINSMART_VISIBLE_REASONING_LEVELS.size
              || selectedEfforts.some(level => typeof level !== 'string' || !ADMINSMART_VISIBLE_REASONING_LEVELS.has(level))
              || new Set(selectedEfforts).size !== selectedEfforts.length) throw new Error('可用思考等级无效')
            configuredEfforts = Object.fromEntries(selectedEfforts.map(level => [level,
              Object.prototype.hasOwnProperty.call(official.reasoningEfforts, level) ? official.reasoningEfforts[level] : level,
            ])) // 已保存的非同名线值保持原样；首次启用只用同名档位。
            if (selectedEfforts.length && Object.prototype.hasOwnProperty.call(official.reasoningEfforts, 'off')) {
              configuredEfforts.off = official.reasoningEfforts.off // 聊天模型已声明的 off 能力不进入五档菜单，也不被非空多选操作抹掉。
            }
            await updateOfficialModelReasoning(ctx, routeId, modelId, configuredEfforts) // 只更新官方 ConfigEditor 中这一模型的能力集合。
          }
          await publishManagedProvider(ctx, routeId, {
            apiBase: requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, ''),
            token: await readRuntimeCapabilityToken(),
            userId: requiredEnvironment('ADMINSMART_AGENT_USER_ID'),
            modeId: requiredEnvironment('ADMINSMART_AGENT_MODE_ID'),
            presetId: requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'),
          }) // 官方已存 Key 经 Host 发布到加密目录，未发布模型也能首次配置。
          const policy = await requestModelPolicy('GET') // 发布后取得后端稳定模型身份，不信任浏览器传入的连接 ID。
          const shared = (Array.isArray(policy?.models) ? policy.models : []).find(model => (
            model?.harnessProviderId === `agent-${routeId}` && model?.modelName === modelId
          )) // 一个官方模型只对应当前 Provider 下的受管行。
          if (!shared) throw new Error('业务模型同步尚未完成')
          if (action === 'effort') {
            await requestModelReasoningCatalog('PUT', {
              providerId: shared.providerId, modelId: shared.modelId,
              reasoningEfforts: configuredEfforts, defaultReasoningEffort: effort,
            })
          } else if (action === 'efforts') {
            const defaultEffort = selectedEfforts.includes(shared.defaultReasoningEffort)
              ? shared.defaultReasoningEffort : selectedEfforts[0] ?? null // 仍可用的原默认档位优先；否则使用五档顺序中的第一个。
            await requestModelReasoningCatalog('PUT', {
              providerId: shared.providerId, modelId: shared.modelId,
              reasoningEfforts: configuredEfforts, defaultReasoningEffort: defaultEffort,
            })
          } else await requestModelDefault(shared.modelId, action)
        }
        const policy = await requestModelPolicy('GET') // 始终返回服务端确认后的安全用途，不用乐观状态。
        const models = configuredProviderModels(ctx, routeId, policy)
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ models }))
      } catch (error) {
        const message = String(error?.message || '模型用途暂时不可用')
        response.writeHead(message.includes('管理员') ? 403 : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ error: message }))
      }
    },
  }), 'adminsmart-client-ui: per-model configuration route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MODEL_DEFAULTS_ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        assertSameOriginBrowserRequest(request)
        const token = await readRuntimeCapabilityToken() // 当前用户签名租约，不要求管理员身份。
        const backend = await fetch(`${requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, '')}/internal/agent-model/v1/catalog`, {
          headers: {
            Authorization: `Bearer ${token}`, // 只向受管回环后端读取当前用户可见目录。
            'X-AdminSmart-User-Id': requiredEnvironment('ADMINSMART_AGENT_USER_ID'),
            'X-AdminSmart-Agent-Mode-Id': requiredEnvironment('ADMINSMART_AGENT_MODE_ID'),
            'X-AdminSmart-Agent-Preset-Id': requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'),
          },
        })
        const catalog = await backend.json().catch(() => null) // 后端目录不含供应商 Key 或私有地址。
        if (!backend.ok || !catalog || !Array.isArray(catalog.providers)) throw new Error('模型默认等级暂时不可用')
        const defaults = catalog.providers.flatMap(provider => (Array.isArray(provider.models) ? provider.models : []).flatMap(model => (
          typeof model.defaultReasoningEffort === 'string' && model.defaultReasoningEffort
            ? [{ provider: String(provider.id), model: String(model.id), effort: model.defaultReasoningEffort }]
            : []
        ))) // 只投影当前用户目录的公开 Provider/模型/等级身份。
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ revision: catalog.revision, defaults }))
      } catch {
        response.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ error: '模型默认等级暂时不可用' }))
      }
    },
  }), 'adminsmart-client-ui: public per-model defaults route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ADMIN_MODELS_ROUTE,
    async handler(request, response) {
      if (!['GET', 'PUT', 'DELETE'].includes(request.method)) {
        response.writeHead(405, { allow: 'GET, PUT, DELETE', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        assertSameOriginBrowserRequest(request)
        if (requiredEnvironment('ADMINSMART_AGENT_IS_ADMIN') !== '1') throw new AdminModelError('仅管理员可维护模型供应商')
        const body = request.method === 'GET' ? null : await readJsonBody(request) // Key 只会在有界 PUT 请求体和当前 Host 栈中出现。
        let payload // 安全响应只含模型元数据、指纹和凭据就绪状态。
        if (request.method === 'GET') {
          payload = await listAdminModels(ctx)
        } else if (request.method === 'PUT') {
          payload = await runManagedProviderMutation(ctx, async () => {
            const saved = await saveAdminModels(ctx, body) // 保存与首次发布不能和后台同步或删除交错。
            try {
              await publishManagedProvider(ctx, saved.routeId, await managedProviderOptions())
              saved.published = true // 本次保存已在业务模型目录确认生效。
            } catch {
              saved.published = false // 官方私有配置已保存；自动同步和手动发布仍可重试。
              saved.warning = '供应商已保存，但发布到业务模型未完成，请检查连接后重试'
            }
            return saved
          })
        } else {
          payload = await runManagedProviderMutation(ctx, () => deleteAdminModels(ctx, body, async routeId => {
            const backend = await fetch(`${requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, '')}/internal/agent-model/v1/harness-providers/${encodeURIComponent(routeId)}`, {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${await readRuntimeCapabilityToken()}`, // 仅受管 Host 与 FastAPI 回环通信。
                'X-AdminSmart-User-Id': requiredEnvironment('ADMINSMART_AGENT_USER_ID'),
                'X-AdminSmart-Agent-Mode-Id': requiredEnvironment('ADMINSMART_AGENT_MODE_ID'),
                'X-AdminSmart-Agent-Preset-Id': requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'),
              },
            })
            const answer = await backend.json().catch(() => null) // 后端只返回安全目录或稳定业务错误。
            if (!backend.ok && !(backend.status === 400 && answer?.error?.code === 'chat_provider_missing')) {
              throw new AdminModelError(String(answer?.error?.message || '业务模型撤销失败'))
            }
          }, async routeId => { await publishManagedProvider(ctx, routeId, await managedProviderOptions()) }))
        }
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify(payload))
      } catch (error) {
        const message = error instanceof AdminModelError ? error.message : '模型供应商管理暂时不可用' // 官方内部异常和 Key 均不回显浏览器。
        response.writeHead(message.includes('管理员') ? 403 : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ error: message }))
      }
    },
  }), 'adminsmart-client-ui: administrator model editor route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ADMIN_MODELS_DISCOVER_ROUTE,
    async handler(request, response) {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        assertSameOriginBrowserRequest(request)
        if (requiredEnvironment('ADMINSMART_AGENT_IS_ADMIN') !== '1') throw new AdminModelError('仅管理员可获取模型目录')
        const payload = await discoverAdminModels(ctx, await readJsonBody(request)) // Key 仅在当前 Host 栈和官方发现调用中存在。
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify(payload))
      } catch (error) {
        const message = error instanceof AdminModelError ? error.message : '获取可用模型失败' // 不把上游错误和密钥回显浏览器。
        response.writeHead(message.includes('管理员') ? 403 : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ error: message }))
      }
    },
  }), 'adminsmart-client-ui: official model discovery route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MODEL_PROVIDER_PUBLISH_ROUTE,
    async handler(request, response) {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        assertSameOriginBrowserRequest(request)
        if (requiredEnvironment('ADMINSMART_AGENT_IS_ADMIN') !== '1') throw new Error('仅管理员可发布业务模型')
        const body = await readJsonBody(request) // 浏览器只允许提交官方 Provider 路由身份。
        const payload = await runManagedProviderMutation(ctx, async () => publishManagedProvider(ctx, String(body?.providerId ?? ''), await managedProviderOptions()))
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify(payload))
      } catch (error) {
        const message = String(error?.message || '业务模型发布失败') // 只来自稳定业务错误，不输出 Key 或内部堆栈。
        response.writeHead(message.includes('管理员') ? 403 : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ error: message }))
      }
    },
  }), 'adminsmart-client-ui: managed provider publish route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MODEL_REASONING_ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'PUT') {
        response.writeHead(405, { allow: 'GET, PUT', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        assertSameOriginBrowserRequest(request)
        const body = request.method === 'PUT' ? await readJsonBody(request) : null // 浏览器的私有 Provider 路由只用于成功后的官方配置回写。
        const { nativeProviderId, nativeModelName, ...managedBody } = body ?? {} // 后端 Schema 只接收受管模型身份和 reasoning 字段。
        const payload = request.method === 'GET'
          ? await requestModelReasoningCatalog('GET')
          : await requestModelReasoningCatalog('PUT', managedBody)
        if (request.method === 'PUT' && nativeProviderId && nativeModelName) {
          await updateOfficialModelReasoning(ctx, String(nativeProviderId), String(nativeModelName), managedBody.reasoningEfforts)
        }
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify(payload))
      } catch (error) {
        const message = String(error?.message || '模型思考等级暂时不可用')
        response.writeHead(message.includes('管理员') ? 403 : 400, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify({ error: message }))
      }
    },
  }), 'adminsmart-client-ui: model reasoning route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MODEL_POLICY_ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'PUT') {
        response.writeHead(405, { allow: 'GET, PUT', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        assertSameOriginBrowserRequest(request)
        const payload = request.method === 'GET'
          ? await requestModelPolicy('GET')
          : await requestModelPolicy('PUT', await readJsonBody(request))
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify(payload))
      } catch (error) {
        const message = String(error?.message || '模型策略暂时不可用')
        response.writeHead(message.includes('管理员') ? 403 : 400, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify({ error: message }))
      }
    },
  }), 'adminsmart-client-ui: model policy route')


}
