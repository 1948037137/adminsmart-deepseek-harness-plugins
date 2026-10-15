/** 将当前用户知识原件桥接为 Harness 原生 FileBlock 的 Agent Tool。 */

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildKnowledgeFileManifest, KNOWLEDGE_FILE_IDENTITY_RULE } from './prompts/knowledge-files.mjs'
import { installSessionFileProjection, sessionFiles, sessionFileState, KNOWLEDGE_IMPORT_RESERVATION_EVENT } from './session-files.mjs'
import { authorizedSessionFamily } from './session-authority.mjs'

const MAX_KNOWLEDGE_FILE_BYTES = 64 * 1024 * 1024 // 单个受管知识原件导入预算；这里只管资源，不解析文件内容。

export const name = 'adminsmart-knowledge-attachments'
export const inject = ['tools', 'attachments', 'sessionProjections'] // 正式原件访问通过官方投影增量恢复授权，不重复全扫会话日志。

const DEFAULT_API_BASE = 'http://127.0.0.1:9099' // 开发 FastAPI 回环地址；生产由 Gateway 环境覆盖。
const DEFAULT_TIMEOUT_MS = 300_000 // 大文件服务端流送和 Host 持久化需要比普通检索更长的有界时间。
const MAX_FILES_PER_CALL = 100 // 单次 Tool 最多挂载的文件数量，超过后由 nextOffset 继续。
const MAX_TOTAL_BYTES_PER_CALL = 1024 * 1024 * 1024 // 单次 Tool 的累计字节预算，防止无界复制知识原件。
export const MAX_FILES_PER_TURN = 128 // 一个业务轮次最多新导入的原件数量；分页不能规避资源预算。
export const MAX_TOTAL_BYTES_PER_TURN = 256 * 1024 * 1024 // 一个轮次累计原始传输预算，复用已授权相同版本不重复传输。
const turnReservations = new WeakMap() // 按可信根 Session 计量成功与失败尝试，子代理共享父回合预算，不以文件存在授权。
const TOOL_NAME = 'load_knowledge_files' // Agent 判断需要完整原件时调用的通用能力。
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']) // Harness 0.1.7-rc.2 原生图片附件格式。

const HARNESS_ROOT = resolve(requiredEnvironment('ADMINSMART_DSH_ROOT')) // 只从固定 0.1.7-rc.2 Runtime 解析公开 Tool API。
const HARNESS_REQUIRE = createRequire(pathToFileURL(resolve(HARNESS_ROOT, 'package.json'))) // 禁止回退到已删除的上游源码仓库。
const { defineTool } = await import(pathToFileURL(HARNESS_REQUIRE.resolve('@deepseek-ai/dsh-tools')).href) // 使用官方结构化 Tool 注册协议。
const { appendPluginRecord } = await import(pathToFileURL(HARNESS_REQUIRE.resolve('@deepseek-ai/dsh-session')).href) // 下载计量通过当前版官方插件记录持久化，不绕过日志协议或直接修改Session存储。

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scope: { type: 'string', enum: ['list', 'all', 'selected'], required: true }, // list 只枚举；all/selected 才把文件写入 AttachmentStore。
    files: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attachmentId: { type: 'string', required: true }, // 官方 AttachmentStore 内容身份。
          name: { type: 'string', required: true }, // 用户可识别文件名。
          bytes: { type: 'integer', required: true }, // Host 实际持久化的文件大小。
        },
      },
    },
    images: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attachmentId: { type: 'string', required: true }, // 官方图片 AttachmentStore 身份。
          mediaType: { type: 'string', enum: [...IMAGE_MEDIA_TYPES], required: true }, // 实际验证并保存的图片格式。
          bytes: { type: 'integer', required: true }, // 规范化图片编码字节数。
          width: { type: 'integer', required: true }, // 规范化图片宽度。
          height: { type: 'integer', required: true }, // 规范化图片高度。
          name: { type: 'string', required: true }, // 用户可识别文件名。
        },
      },
    },
    sourceFiles: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          assetId: { type: 'string', required: true }, // 主应用资产身份，仅用于当前 Tool 结果内部对应关系。
          documentId: { type: 'string', required: true }, // 官方文档身份，未绑定时为空字符串。
          name: { type: 'string', required: true }, // 原件显示名。
          bytes: { type: 'integer', required: true }, // 原件数据库记录大小。
        },
      },
    },
    skippedFiles: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          assetId: { type: 'string', required: true }, // 未挂载原件的主应用资产身份。
          name: { type: 'string', required: true }, // 用户可识别文件名。
          bytes: { type: 'integer', required: true }, // 原件数据库记录大小。
          reason: { type: 'string', required: true }, // 稳定限制原因，不含路径或内部异常。
        },
      },
    },
    nextOffset: { type: 'integer', required: true }, // -1 表示当前范围已经完整挂载。
    truncated: { type: 'boolean', required: true }, // 是否仍有下一页或达到本次字节预算。
    fullCoverage: { type: 'boolean', required: true }, // 只在当前请求范围所有原件确实挂载或合法复用且无下一页时为真。
    reusedCount: { type: 'integer', required: true }, // 已有会话授权且与新清单摘要一致的原件数，不表示重复读取过正文。
    transferredBytes: { type: 'integer', required: true }, // 本次实际成功传输的源字节，不包括复用附件。
    newFileCount: { type: 'integer', required: true }, // 本次真正新传输成功的原件数，供官方投影恢复累计预算。
    budgetExceeded: { type: 'string', enum: ['none', 'call', 'turn'], required: true }, // 回合超限不能靠同轮分页规避，需缩小范围或新用户轮次。
    remainingAssetIds: { type: 'array', required: true, items: { type: 'string' } }, // 当前页尚未挂载的选择身份，selected 分批时不按文件名猜测。
    importedBindings: {
      type: 'array', required: true,
      items: { type: 'object', additionalProperties: false, properties: {
        assetId: { type: 'string', required: true }, // 来源资产，只供成功工具私有元数据恢复，不赋予跨会话权限。
        sha256: { type: 'string', required: true }, // 最新可信清单的原始内容摘要；图片规范化后的摘要可能不同。
        bytes: { type: 'integer', required: true }, // 来源原始字节数，避免错误复用同名但大小不同的文件。
        attachmentId: { type: 'string', required: true }, // 本次实际保存或已授权复用的官方内容身份。
        name: { type: 'string', required: true }, // 与成功结果直接附件块相同的显示名。
      } },
    }, // 只映射经成功工具接受的 FileBlock/ImageBlock，不能以映射代替附件授权。
    note: { type: 'string', required: true }, // 模型可见的证据边界和下一步提示。
  },
} // Harness 在 Tool 主体返回后验证的规范桥接结果，未声明字段不能进入 Session。

/**
 * 读取 Gateway 注入的必需运行配置。
 *
 * @param {string} variableName - 受管环境变量名称，不能由模型控制。
 * @returns {string} 去除外围空白的配置值。
 * @throws {Error} 配置缺失时抛出稳定错误，不暴露真实值。
 * @sideEffects 只读取当前 Runtime 环境，不写入文件或日志。
 */
function requiredEnvironment(variableName) {
  const value = String(process.env[variableName] ?? '').trim() // 当前租户 Runtime 独占的非模型配置。
  if (!value) throw new Error('AdminSmart Agent 运行配置不完整')
  return value
}

/**
 * 解析并限制内部 FastAPI 回环地址。
 *
 * @returns {string} 不含凭证、查询串和片段的 HTTP 回环根地址。
 * @throws {Error} 地址不是受管本机 HTTP 端点时拒绝启动调用。
 * @sideEffects 只解析环境变量，不发起网络请求。
 */
function resolveManagedApiBase() {
  const configured = String(process.env.ADMINSMART_AGENT_API_BASE ?? DEFAULT_API_BASE).trim() // Gateway 注入的回环 API 根。
  let parsed // 结构化 URL 校验对象；解析失败时不会保留原始配置到错误消息。
  try {
    parsed = new URL(configured)
  } catch {
    throw new Error('AdminSmart Agent 内部 API 配置无效')
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase() // 兼容 IPv6 回环文本。
  const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' // 只允许本机桥接。
  if (parsed.protocol !== 'http:' || !loopback || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('AdminSmart Agent 内部 API 配置无效')
  }
  return parsed.href.replace(/\/$/u, '')
}

/**
 * 从 Gateway 保护文件读取当前 Runtime 能力令牌。
 *
 * @returns {Promise<string>} 仅供本次 FastAPI 内部请求使用的能力令牌。
 * @throws {Error} 文件不可读或为空时拒绝调用。
 * @sideEffects 读取受保护文件，不把令牌写入 Session、日志或 Tool 结果。
 */
async function loadCapabilityToken() {
  const tokenPath = resolve(requiredEnvironment('ADMINSMART_AGENT_TOKEN_FILE')) // 绝对路径只来自 Gateway 环境，不接受模型输入。
  let token // 当前调用唯一能力令牌，只进入内部请求头。
  try {
    token = String(await readFile(tokenPath, 'utf8')).trim()
  } catch {
    throw new Error('AdminSmart Agent 能力凭证不可用')
  }
  if (!token) throw new Error('AdminSmart Agent 能力凭证为空')
  return token
}

/**
 * 构造一次内部知识文件请求的受管身份头。
 *
 * @param {string} token - 当前 Runtime 能力令牌。
 * @param {string} sessionId - 当前 Harness Session 身份，仅用于审计和文件事件归属。
 * @returns {Record<string,string>} 不含正文和用户秘密的内部请求头。
 * @sideEffects 无。
 */
function agentHeaders(token, sessionId) {
  const headers = {
    'X-AdminSmart-Agent-Token': token,
    'X-AdminSmart-User-Id': requiredEnvironment('ADMINSMART_AGENT_USER_ID'),
    'X-AdminSmart-Agent-Mode-Id': requiredEnvironment('ADMINSMART_AGENT_MODE_ID'),
    'X-AdminSmart-Agent-Preset-Id': requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'),
  } // 用户、模式和 Preset 必须来自 Gateway，不接受模型伪造。
  if (sessionId) headers['X-AdminSmart-Session-Id'] = sessionId
  return headers
}

/**
 * 识别 Harness 原生光栅图片类型，优先使用入库 MIME，缺失时再使用文件扩展名。
 *
 * @param {{mediaType?:string,name?:string}} source - 后端已经过所有权校验的原件描述。
 * @returns {string} Harness 接受的图片媒体类型；非图片返回空字符串。
 * @sideEffects 无；实际字节类型仍由官方 AttachmentStore 解码校验。
 */
function imageMediaTypeOf(source) {
  const declaredMediaType = String(source.mediaType || '').toLowerCase() // 原件上传协议记录的媒体类型。
  if (IMAGE_MEDIA_TYPES.has(declaredMediaType)) return declaredMediaType
  const extension = String(source.name || '').toLowerCase().match(/\.[^./\\]+$/u)?.[0] || '' // basename 的小写扩展名。
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[extension] || ''
}

/**
 * 把 Fetch 响应体包装为带取消检查的异步字节流。
 *
 * @param {Response} response - 已通过 HTTP 状态校验的内部文件响应。
 * @param {AbortSignal} signal - Harness Tool 取消信号。
 * @param {number} maxBytes 最新可信清单或图片准入的硬字节上限；超长响应在写入 Store 前停止。
 * @returns {AsyncGenerator<Uint8Array>} 按网络顺序输出的原件字节块。
 * @throws {Error} 响应缺少正文或调用被取消时失败。
 * @sideEffects 消费一次响应流，不在内存中聚合整份文件。
 */
async function* responseBytes(response, signal, maxBytes) {
  if (!response.body) throw new Error('知识文件响应没有正文')
  const reader = response.body.getReader() // 当前响应体唯一读取器，finally 必须释放锁。
  let bytes = 0 // 当前流累计字节，不能只在完整落盘后才发现预算越界。
  try {
    while (true) {
      signal.throwIfAborted()
      const part = await reader.read()
      if (part.done) return
      if (part.value?.byteLength) {
        bytes += part.value.byteLength
        if (bytes > maxBytes) throw new Error('知识原件响应超过已确认大小限制')
        yield part.value
      }
    }
  } finally {
    await reader.cancel().catch(() => {}) // 错误、超限或取消后释放底层传输，不留下继续下载的正文。
    reader.releaseLock()
  }
}

/**
 * 在官方图片准入前有界收集一份原件并校验原始内容摘要。
 *
 * @param {Response} response - 已通过 HTTP 状态校验的知识图片响应。
 * @param {AbortSignal} signal - Harness Tool 取消信号。
 * @param {number} maxBytes - 当前官方图片存储允许的原始字节上限。
 * @returns {Promise<{data:Uint8Array,sha256:string}>} 原始图片字节和 SHA-256。
 * @throws {Error} 响应超过图片上限或被取消时失败。
 * @sideEffects 消费一次响应流；只为官方图片准入聚合，不处理通用文件。
 */
async function responseBuffer(response, signal, maxBytes) {
  const chunks = [] // 当前知识图片的有界网络字节块。
  const digest = createHash('sha256') // 与主应用原件摘要比较的增量哈希器。
  let size = 0 // 当前已经接收的原始图片字节数。
  for await (const chunk of responseBytes(response, signal, maxBytes)) {
    size += chunk.byteLength
    if (size > maxBytes) throw new Error('知识图片超过当前模型附件上限')
    digest.update(chunk)
    chunks.push(Buffer.from(chunk))
  }
  return { data: Buffer.concat(chunks, size), sha256: digest.digest('hex') }
}

/**
 * 解析内部响应的稳定成功外壳。
 *
 * @param {Response} response - FastAPI 内部响应。
 * @returns {Promise<any>} 已验证 HTTP 和业务状态的 data 对象。
 * @throws {Error} 非成功响应时抛出模型可理解的稳定错误。
 * @sideEffects 消费 JSON 响应正文，不记录内部响应细节。
 */
async function responseData(response) {
  const payload = await response.json().catch(() => null) // 非 JSON 响应不能进入模型上下文。
  if (!response.ok || !payload || payload.code !== 200 || !payload.data) {
    throw new Error(response.status >= 500 ? '知识文件服务暂时不可用，请稍后重试' : '知识文件未能加载')
  }
  return payload.data
}

/**
 * 将结构化 Tool 结果投影为模型可读取的原生文件块。
 *
 * @param {unknown} _args - 已由 Harness Schema 校验的调用参数；渲染不依赖模型输入。
 * @param {any} value - 已由 Harness 输出 Schema 校验的桥接结果。
 * @returns {Array<object>} 文本边界和 FileBlock 的有序内容。
 * @sideEffects 无；不访问网络、文件或能力令牌。
 */
function renderKnowledgeAttachments(_args, value) {
  const manifest = value.scope === 'list'
    ? {
        scope: value.scope,
        availableSourceFiles: value.sourceFiles.map(file => ({ assetId: file.assetId, name: file.name, bytes: file.bytes })),
        nextOffset: value.nextOffset,
        truncated: value.truncated,
        fullCoverage: value.fullCoverage, // 列表只表明清单覆盖，不声称原件已加载。
        note: value.note,
        identityRule: 'assetId 只用于后续 selected 加载，不能作为原生文件路径或附件身份。',
      }
    : {
        scope: value.scope,
        loadedFiles: value.files,
        loadedImages: value.images.map(image => ({ attachmentId: image.attachmentId, name: image.name, bytes: image.bytes, mediaType: image.mediaType })),
        skippedFiles: value.skippedFiles.map(file => ({ name: file.name, bytes: file.bytes, reason: file.reason })),
        nextOffset: value.nextOffset,
        truncated: value.truncated,
        fullCoverage: value.fullCoverage, // 完整性由实际挂载、跳过及下一页共同决定。
        reusedCount: value.reusedCount, // 明确哪些引用复用，避免把重复挂载当新解析。
        budgetExceeded: value.budgetExceeded, // 模型必须遵守整轮限制，不反复分页消耗资源。
        remainingAssetIds: value.remainingAssetIds, // 仅当前已授权清单中的未处理身份。
        note: value.note,
        identityRule: KNOWLEDGE_FILE_IDENTITY_RULE, // 内容身份与真实路径的模型指引集中在所属提示词模块。
      } // 列表模式公开选择身份；加载模式只突出真正进入 Session 的官方附件身份。
  const content = [{
    type: 'text', // 官方文本块先向模型展示不可信清单边界。
    text: buildKnowledgeFileManifest(manifest), // 只输出结构化清单和官方读取指引，不输出服务器凭据或文件正文。
  }] // 模型先看到不可信清单边界，再收到官方文件或图片引用。
  for (const file of value.files) {
    content.push({ type: 'file', attachment: { attachmentId: file.attachmentId, name: file.name, bytes: file.bytes } })
  }
  for (const image of value.images) {
    content.push({ type: 'image', attachment: {
      attachmentId: image.attachmentId,
      mediaType: image.mediaType,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
      name: image.name,
    } })
  }
  return content
}

/**
 * 注册当前用户知识文件的通用 Session 桥接能力。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - 当前知识 Agent Preset 的 Host Context。
 * @returns {void} 同步注册一个结构化 Tool。
 * @sideEffects 注册 Tool；每次调用会读取受管 API 并把原件写入官方 AttachmentStore。
 */
export function apply(ctx) {
  installSessionFileProjection(ctx) // 先注册官方增量 fold，Guard 和当前 Tool 随后读取同一可信派生授权。
  ctx.effect(() => ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: '把当前用户有权访问的知识原件挂载到当前 Session，保持后台权限校验和官方附件存储；需要完整、跨文件或全部资料时调用，不接受服务器路径。挂载后使用 Harness 官方文件、办公技能和业务目录内的命令读取。',
    parameters: {
      scope: { type: 'string', enum: ['list', 'all', 'selected'], description: 'list 只列出当前用户稳定知识原件；all 加载全部；selected 只加载 assetIds 指定的文件。' },
      assetIds: { type: 'array', items: { type: 'string' }, description: '之前清单返回的资产 UUID；只在 selected 范围使用。' },
      offset: { type: 'integer', description: 'all 范围的分页偏移；返回 nextOffset 后继续调用。' },
      limit: { type: 'integer', description: '本次最多挂载的文件数量，默认由系统限制。' },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: renderKnowledgeAttachments,
      presentationMeta: (_args, value) => ({ knowledgeFileImports: value.importedBindings, knowledgeImportBudget: { files: value.newFileCount, bytes: value.transferredBytes } }), // 官方仅在成功结果提交时保存映射与用量；失败或未接受结果不授权。
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    isConcurrencySafe: () => false,
    presentCall: () => ({ card: 'generic', title: '加载知识文件', kind: 'read' }),
    async execute(args, exec) {
       const sessionId = String(exec.agent?.session?.id ?? '').trim().slice(0, 200) // 文件引用必须归属当前真实 Session。
      if (!sessionId) throw new Error('当前 Session 身份不可用')
      const apiBase = resolveManagedApiBase() // 只允许 Gateway 绑定的 FastAPI 回环地址。
      const token = await loadCapabilityToken() // 令牌只在当前调用内存中存在。
      const headers = agentHeaders(token, sessionId) // 服务端再次校验用户、模式、Preset 和 Session。
      const requestedScope = String(args.scope || 'list') // 未显式要求加载时先列出，避免无意复制全部知识原件。
       const selectedAssetIds = requestedScope === 'selected' && Array.isArray(args.assetIds) ? [...new Set(args.assetIds)] : [] // 去重后的请求范围，用于报告超出单次上限的未处理身份。
       const requestedOffset = requestedScope === 'selected' ? 0 : Math.max(0, Number.isSafeInteger(args.offset) ? args.offset : 0) // 下一页从实际请求偏移延续，不使用模型错误的负数或浮点数。
      const manifestResponse = await fetch(`${apiBase}/internal/agent-tools/knowledge/attachments/manifest`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: requestedScope === 'selected' ? 'selected' : 'all',
           assetIds: selectedAssetIds.slice(0, MAX_FILES_PER_CALL),
           offset: requestedOffset,
          limit: Math.max(1, Math.min(MAX_FILES_PER_CALL, Number.isSafeInteger(args.limit) ? args.limit : MAX_FILES_PER_CALL)),
        }),
        signal: exec.signal,
      }) // FastAPI 只返回当前用户稳定原件的有界清单。
      const manifest = await responseData(manifestResponse) // 清单只包含资产元数据，不含服务器路径和正文。
      const files = [] // 官方 AttachmentStore 返回的可持久 FileAttachmentRef 元数据。
      const images = [] // 官方 AttachmentStore 返回的规范化 ImageAttachmentRef 元数据。
      const manifestFiles = (manifest.files ?? []).map(source => ({
        assetId: String(source.assetId),
        documentId: String(source.documentId || ''),
        name: String(source.name),
        bytes: Number(source.bytes),
      })) // list 模式也必须把安全资产身份和文件名返回给模型，供 selected 后续调用。
      if (requestedScope === 'list') {
        return {
          scope: 'list',
          files,
          images,
          sourceFiles: manifestFiles,
          skippedFiles: [],
          nextOffset: Number(manifest.nextOffset ?? -1),
          truncated: Boolean(manifest.truncated),
           fullCoverage: false,
           reusedCount: 0,
           transferredBytes: 0,
           newFileCount: 0,
           budgetExceeded: 'none',
           remainingAssetIds: [],
           importedBindings: [],
          note: String(manifest.note || `已列出 ${manifestFiles.length} 个知识文件。`),
        }
      }
      const sourceFiles = manifestFiles // 当前清单页所有可选原件；真正已挂载文件由 files 和后续 FileBlock 表示。
      const skippedFiles = [] // 超过单文件桥接上限的原件必须显式报告，不能让整个 Tool 在中途失败。
       const importedBindings = [] // 当前成功结果的原始摘要/官方引用映射，供持久恢复后安全复用规范化图片。
       const family = authorizedSessionFamily(exec.agent.session) // 父归属每次实时验证，不缓存模型提供的父身份。
       const rootSession = family[0] // 一层子代理与父回合共享同一个资源预算。
       const rootState = sessionFileState(rootSession, ctx.sessionProjections) // 官方 fold 的累计成功用量，可在 Runtime 重启后恢复。
       let reservation = turnReservations.get(rootSession) // 失败尝试的预留用量也计入当前 live 回合，防止反复失败无限下载。
       if (!reservation || reservation.turn !== rootState.turn) {
         reservation = { turn: rootState.turn, files: Math.max(rootState.importedFiles, rootState.reservedFiles), bytes: Math.max(rootState.importedBytes, rootState.reservedBytes) }
         turnReservations.set(rootSession, reservation)
       } else {
         reservation.files = Math.max(reservation.files, rootState.importedFiles, rootState.reservedFiles)
         reservation.bytes = Math.max(reservation.bytes, rootState.importedBytes, rootState.reservedBytes)
       }
       const authorized = [...sessionFiles(exec.agent.session, ctx.sessionProjections).values()] // 已接受成功事件中的引用；Store 中存在文件本身不授权。
       const bindings = family.flatMap(session => sessionFileState(session, ctx.sessionProjections).bindings) // 私有来源映射仍需匹配当前原件清单与授权引用。
       let reusedCount = 0 // 相同版本再次调用只返回已有引用，不重新向 API 传输内容。
       let newFileCount = 0 // 本次实际新传输成功数量，不把 list 或复用计入预算。
       let budgetExceeded = 'none' // 单次预算可继续分页，整轮预算必须明确停止当前轮次继续传输。
      let totalBytes = 0 // 当前 Tool 复制到 Runtime 的累计字节数。
      let stoppedByBudget = false // 达到本次累计字节预算时保留可继续读取的页偏移。
      let processedCount = 0 // 已处理清单项数量，用于 all 范围从精确下一项继续。
      const saveKnowledgeFileStream = ctx.attachments.saveFileStream // 原件导入直接使用官方 AttachmentStore 的流式入口。
      if (typeof saveKnowledgeFileStream !== 'function') throw new Error('当前 Runtime 未挂载知识文件附件能力')
      for (const source of manifest.files ?? []) {
        exec.signal.throwIfAborted()
        const imageMediaType = imageMediaTypeOf(source) // 图片使用官方多模态准入，其它格式保持 FileBlock。
        const sourceLimit = imageMediaType
          ? Number(ctx.attachments.imageLimits?.maxImageBytes || 0)
          : MAX_KNOWLEDGE_FILE_BYTES // 当前原件的最大允许字节数；图片服从 Store，通用文件服从知识桥接限制。
         if (!Number.isSafeInteger(source.bytes) || source.bytes < 0 || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(source.sha256)) throw new Error('知识原件清单的内容身份无效')
         const binding = bindings.find(item => item.assetId === String(source.assetId) && item.sha256 === source.sha256 && item.bytes === source.bytes && item.name === source.name) // 不按basename或旧摘要猜测当前原件版本。
         const reusable = authorized.find(reference => reference.name === source.name && (imageMediaType
           ? IMAGE_MEDIA_TYPES.has(reference.mediaType) && binding?.attachmentId === reference.attachmentId
           : !reference.mediaType && reference.bytes === source.bytes && reference.attachmentId === `sha256:${source.sha256}`)) // 必须同时满足当前Session授权和最新源版本。
         if (reusable) {
           if (imageMediaType) images.push({
             attachmentId: reusable.attachmentId, // 只返回RESULT_SCHEMA明确声明的官方内容身份。
             mediaType: reusable.mediaType, // 实际规范化媒体类型可能与原始上传格式不同。
             bytes: reusable.bytes, // 规范化后的编码大小。
             width: reusable.width, // 官方图片引用的内在宽度。
             height: reusable.height, // 官方图片引用的内在高度。
             name: reusable.name, // 与当前可信源名称一致的显示名。
           })
           else files.push({ attachmentId: reusable.attachmentId, name: reusable.name, bytes: reusable.bytes })
           importedBindings.push({ assetId: String(source.assetId), sha256: source.sha256, bytes: source.bytes, attachmentId: reusable.attachmentId, name: reusable.name })
           reusedCount += 1
           processedCount += 1
           continue
         }
        if (!Number.isSafeInteger(sourceLimit) || sourceLimit <= 0 || Number(source.bytes || 0) > sourceLimit) {
          skippedFiles.push({
            assetId: String(source.assetId),
            name: String(source.name),
            bytes: Number(source.bytes),
             reason: imageMediaType ? '图片超过当前 Session 原生图片上限' : '文件超过当前 Session 知识原件导入上限',
          })
          processedCount += 1
          continue
        }
        if (totalBytes + Number(source.bytes || 0) > MAX_TOTAL_BYTES_PER_CALL) {
           budgetExceeded = 'call'
          stoppedByBudget = true
          break
        }
         if (reservation.files >= MAX_FILES_PER_TURN || reservation.bytes + source.bytes > MAX_TOTAL_BYTES_PER_TURN) {
           budgetExceeded = 'turn'
           stoppedByBudget = true
           break
         }
         reservation.files += 1 // 先预留，再发起可能失败的原件请求；失败不得被无限次同轮重试规避预算。
         reservation.bytes += source.bytes // 新清单和官方Store均验证真实字节，超长响应仍会被流边界拒绝。
         if (typeof rootSession.append === 'function') appendPluginRecord(rootSession, KNOWLEDGE_IMPORT_RESERVATION_EVENT, {
           turn: reservation.turn, // 子代理仍使用已验证的父业务回合，不能以自己的轮次逃避根预算。
           files: reservation.files, // 完整后状态保证回放和重连幂等，不含资产身份或文件正文。
           bytes: reservation.bytes, // 下载前持久预留，失败或Runtime恢复均保留实际资源约束。
         }) // 正式Session总是通过官方记录；旧纯Fixture只保留进程弱引用预算。
        const streamResponse = await fetch(`${apiBase}/internal/agent-tools/knowledge/attachments/${encodeURIComponent(source.assetId)}/content`, {
          method: 'GET',
          headers,
          signal: exec.signal,
        }) // 单资产原件流仍由同一能力令牌、用户、模式、Preset 和 Session 校验。
        if (!streamResponse.ok) throw new Error('知识文件读取暂时失败，请稍后重试')
        if (imageMediaType) {
          const original = await responseBuffer(streamResponse, exec.signal, sourceLimit) // 官方 saveImages 需要完整但有界的原始光栅字节。
          if (original.data.byteLength !== Number(source.bytes) || original.sha256 !== String(source.sha256)) throw new Error('知识图片完整性校验失败')
          const [reference] = await ctx.attachments.saveImages([{ data: original.data, mediaType: imageMediaType, name: source.name }]) // 官方规范化图片引用。
          if (!reference) throw new Error('知识图片保存结果不完整')
          totalBytes += original.data.byteLength
          images.push({
            attachmentId: String(reference.attachmentId),
            mediaType: String(reference.mediaType),
            bytes: Number(reference.bytes),
            width: Number(reference.width),
            height: Number(reference.height),
            name: String(reference.name || source.name),
          })
           importedBindings.push({ assetId: String(source.assetId), sha256: source.sha256, bytes: source.bytes, attachmentId: reference.attachmentId, name: reference.name || source.name })
        } else {
          const reference = await saveKnowledgeFileStream.call(ctx.attachments, {
            name: source.name,
             data: responseBytes(streamResponse, exec.signal, source.bytes),
            signal: exec.signal,
          }) // 官方内容寻址的通用文件引用。
          if (Number(reference.bytes) !== Number(source.bytes)) throw new Error('知识文件完整性校验失败')
          if (String(reference.attachmentId) !== `sha256:${String(source.sha256)}`) throw new Error('知识文件完整性校验失败')
          totalBytes += Number(reference.bytes)
          files.push({ attachmentId: String(reference.attachmentId), name: String(reference.name), bytes: Number(reference.bytes) })
           importedBindings.push({ assetId: String(source.assetId), sha256: source.sha256, bytes: source.bytes, attachmentId: reference.attachmentId, name: reference.name })
        }
         newFileCount += 1
        processedCount += 1
      }
      const loadedCount = files.length + images.length // 已成功进入当前 Session 的文件与图片总数。
      const budgetTruncated = stoppedByBudget || processedCount < (manifest.files ?? []).length // 当前清单页是否仍有未处理原件。
      const nextOffset = stoppedByBudget
         ? (requestedScope === 'all' ? requestedOffset + processedCount : -1)
        : Number(manifest.nextOffset ?? -1) // all 范围继续精确分页；selected 范围通过剩余 assetId 分批重试。
       const remainingAssetIds = [...new Set([...(manifest.files ?? []).slice(processedCount).map(source => String(source.assetId)), ...selectedAssetIds.filter(assetId => !importedBindings.some(binding => binding.assetId === assetId) && !skippedFiles.some(source => source.assetId === assetId))])] // 明确所有selected未挂载项，不能因请求截断声称完整。
       const fullCoverage = !Boolean(manifest.truncated) && !budgetTruncated && skippedFiles.length === 0 && remainingAssetIds.length === 0 && (requestedScope === 'selected' || requestedOffset === 0) // 从中间页开始只能证明该页完成，不能把尾页当整库完整覆盖。
      return {
        scope: requestedScope,
        files,
        images,
        sourceFiles,
        skippedFiles,
        nextOffset,
         truncated: Boolean(manifest.truncated) || budgetTruncated || skippedFiles.length > 0 || remainingAssetIds.length > 0,
          fullCoverage,
         reusedCount,
         transferredBytes: totalBytes,
         newFileCount,
         budgetExceeded,
          remainingAssetIds,
         importedBindings,
        note: stoppedByBudget
           ? budgetExceeded === 'turn'
             ? `已挂载或复用 ${loadedCount} 个知识附件；达到本回合累计原件限制（${MAX_FILES_PER_TURN}个/${MAX_TOTAL_BYTES_PER_TURN}字节），当前范围未完整覆盖，不能在同轮通过分页继续下载。请基于已有证据回答并明确未覆盖范围，或由用户新一轮缩小范围。`
             : requestedScope === 'all'
            ? `已挂载 ${loadedCount} 个知识附件；本次达到累计文件预算，请根据 nextOffset 继续加载。`
            : `已挂载 ${loadedCount} 个知识附件；本次达到累计文件预算，请把尚未出现于 files 或 images 的 assetId 分批重新提交。`
          : skippedFiles.length
            ? `已挂载 ${loadedCount} 个知识附件，另有 ${skippedFiles.length} 个附件超过当前 Session 原生限制。`
            : String(manifest.note || `已挂载 ${loadedCount} 个知识附件。`),
      }
    },
  })), 'adminsmart-knowledge-attachments: load knowledge files')
}
