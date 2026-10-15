/** AdminSmart LightRAG model-facing Tool collection plugin for DeepSeek Harness. */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { KNOWLEDGE_EVIDENCE_PREAMBLE, KNOWLEDGE_EVIDENCE_POSTAMBLE } from './prompts/knowledge-evidence.mjs'

export const name = 'adminsmart-lightrag-tools'
export const inject = ['tools']

const DEFAULT_API_BASE = 'http://127.0.0.1:9099' // 开发 FastAPI 回环地址；生产由受管 Runtime 环境覆盖。
const DEFAULT_TIMEOUT_MS = 120_000 // 官方相关性检索必须拥有有界协作式超时。
const MAX_QUERY_CHARACTERS = 4_000 // 模型检索问题的硬上限，避免异常参数无界进入后端和审计上下文。
const MAX_KEYWORDS_PER_LIST = 64 // LightRAG 1.5.7 单组官方关键词的请求上限。
const MAX_KEYWORD_CHARACTERS = 512 // LightRAG 1.5.7 单个官方关键词的字符上限。
const TOOL_NAME = 'search_knowledge' // 当前知识能力域唯一需要暴露的工具；后续相关工具继续在本插件内注册。
const UNTRUSTED_EVIDENCE_BEGIN = '--- BEGIN UNTRUSTED KNOWLEDGE EVIDENCE ---' // 模型可见证据起始边界，不属于工具调用协议。
const UNTRUSTED_EVIDENCE_END = '--- END UNTRUSTED KNOWLEDGE EVIDENCE ---' // 模型可见证据结束边界，阻止正文尾部伪指令延续。
const SOURCE_ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u // 官方Value Schema DSL不支持pattern，执行层单独核对后端可选加载身份。
const HARNESS_ROOT = resolve(requiredEnvironment('ADMINSMART_DSH_ROOT')) // 固定官方 Harness npm 运行项目根；模块导入阶段完成解析，Preset apply 保持同步。
const HARNESS_REQUIRE = createRequire(pathToFileURL(resolve(HARNESS_ROOT, 'package.json'))) // 从唯一共享 npm 项目解析官方发布包，禁止回退到源码仓库路径。
const TOOLS_MODULE_URL = pathToFileURL(HARNESS_REQUIRE.resolve('@deepseek-ai/dsh-tools')).href // 官方 Tool Runtime 包公开入口。
const { defineTool } = await import(TOOLS_MODULE_URL) // Loader 在调用 apply 前完成顶层依赖加载，避免异步注册逃离 Agent Preset 贡献窗口。
const KNOWLEDGE_RESULT_SCHEMA = {
  type: 'object', // FastAPI 返回的规范知识证据对象。
  additionalProperties: false, // 未声明字段不能进入模型上下文或程序化工具调用方。
  properties: {
    question: { type: 'string', required: true }, // 当前结果必须回答的完整问题。
    scope: { type: 'string', enum: ['focused'], required: true }, // 官方 Query API 当前只提供相关性检索。
    queries: { type: 'array', items: { type: 'string' }, required: true }, // 后端实际执行且去重的检索查询。
    knowledgeFound: { type: 'boolean', required: true }, // 本人空间是否返回候选片段；不代表已确认问题主体、属性、单位或时间。
    evidence: {
      type: 'array', // 按稳定 rank 返回的模型可读证据集合。
      required: true, // 成功结果必须显式返回证据集合，即使当前为空。
      items: {
        type: 'object', // 一条已通过本人归属和版本复核的证据。
        additionalProperties: false, // 防止后端内部字段意外进入 Harness Session。
        properties: {
          rank: { type: 'integer', required: true }, // 当前结果内的一基稳定序号。
          title: { type: 'string', required: true }, // 文档业务标题快照。
          fileName: { type: 'string', required: true }, // 用户可辨认的原文件名。
          content: { type: 'string', required: true }, // 受 Token 预算约束的原始证据正文。
          score: { type: 'number', required: true }, // LightRAG 相关度或全文展开的零值。
          location: { type: 'string', required: true }, // 页码或位置；未知时为空字符串。
          tokenCount: { type: 'integer', required: true }, // 当前证据正文的估算 Token 数。
          sourceAssetId: { type: 'string' }, // 后端唯一核验的当前用户原件UUID；缺省则不猜测，UUID由执行层校验，selected仍重新鉴权。
        },
      },
    },
    sourceCount: { type: 'integer', required: true }, // 最终证据覆盖的唯一业务文档数量。
    chunkCount: { type: 'integer', required: true }, // 最终提供给模型的正文切片数量。
    totalCandidateCount: { type: 'integer', required: true }, // 裁剪前确认的候选切片数量。
    tokenBudget: { type: 'integer', required: true }, // 当前工具允许使用的总证据 Token。
    usedTokens: { type: 'integer', required: true }, // 最终证据正文实际使用的估算 Token。
    truncated: { type: 'boolean', required: true }, // 是否因候选、文档或 Token 上限发生裁剪。
    completeCoverage: { type: 'boolean', required: true }, // 官方接口不支持全量遍历，因此当前固定为 false。
    answerBoundary: { type: 'string', required: true }, // 最终回答必须遵守的证据和完整性边界。
  },
} // Harness 在工具主体返回后再次验证规范结果。

/**
 * Read one required Runtime environment value without exposing it.
 *
 * @param {string} variableName - 由 Gateway 注入且不允许模型控制的环境变量名称。
 * @returns {string} 去除首尾空白后的受管配置值。
 * @throws {Error} 当必需配置不存在或为空时抛出不包含配置值的稳定错误。
 * @sideEffects 仅读取当前进程环境，不记录或修改配置。
 */
function requiredEnvironment(variableName) {
  const environmentValue = String(process.env[variableName] ?? '').trim() // 当前受管 Runtime 独占的非模型配置值。
  if (!environmentValue) throw new Error('AdminSmart Harness 运行配置不完整')
  return environmentValue
}

/**
 * Resolve and validate the managed FastAPI loopback root.
 *
 * @returns {string} 不含尾部斜杠、凭证、查询串或片段的本机 HTTP API 根地址。
 * @throws {Error} 当配置无法解析、不是 HTTP 或目标主机不是明确回环地址时拒绝启动调用。
 * @sideEffects 仅读取当前进程环境；不会发起网络请求。
 */
function resolveManagedApiBase() {
  const configuredApiBase = String(process.env.ADMINSMART_AGENT_API_BASE ?? DEFAULT_API_BASE).trim() // Gateway 注入或开发默认的内部 API 根。
  let parsedApiBase // 解析后的 URL 用于结构化校验协议、主机和无凭证约束。
  try {
    parsedApiBase = new URL(configuredApiBase)
  } catch {
    throw new Error('AdminSmart Agent 内部 API 配置无效')
  }
  const normalizedHostname = parsedApiBase.hostname.replace(/^\[|\]$/g, '').toLowerCase() // WHATWG URL 对 IPv6 主机可能保留方括号，校验前统一移除。
  const isLoopbackHost = normalizedHostname === '127.0.0.1'
    || normalizedHostname === 'localhost'
    || normalizedHostname === '::1' // 只允许 Gateway 与 FastAPI 使用的明确本机回环名称。
  if (
    parsedApiBase.protocol !== 'http:'
    || !isLoopbackHost
    || parsedApiBase.username
    || parsedApiBase.password
    || parsedApiBase.pathname !== '/'
    || parsedApiBase.search
    || parsedApiBase.hash
  ) {
    throw new Error('AdminSmart Agent 内部 API 配置无效')
  }
  return parsedApiBase.href.replace(/\/$/, '')
}

/**
 * Load the Runtime-bound capability token from its protected file.
 *
 * @returns {Promise<string>} 仅供当前内部 API 请求使用的受管能力凭证。
 * @throws {Error} 当文件不可读或内容为空时进入 Harness 标准工具失败路径。
 * @sideEffects 读取 Gateway 创建的凭证文件；不会写入日志、Session 或工具结果。
 */
async function loadCapabilityToken() {
  const tokenFilePath = resolve(requiredEnvironment('ADMINSMART_AGENT_TOKEN_FILE')) // 绝对路径避免 cwd 影响能力文件选择。
  let capabilityToken // 凭证仅进入当前调用内存，不写日志或工具结果。
  try {
    capabilityToken = String(await readFile(tokenFilePath, 'utf8')).trim()
  } catch {
    throw new Error('AdminSmart Agent 能力凭证不可用')
  }
  if (!capabilityToken) throw new Error('AdminSmart Agent 能力凭证文件为空')
  return capabilityToken
}

/**
 * Convert the canonical evidence object into a bounded untrusted-data envelope.
 *
 * @param {unknown} _args - 已由 Harness 校验的调用参数；渲染不依赖它，避免用户输入改变安全边界。
 * @param {unknown} value - 已通过输出 Schema 的知识证据对象。
 * @returns {{type: 'text', text: string}[]} 仅供模型消费的证据、边界和后置安全提醒。
 * @throws {TypeError} 当官方输出验证被绕过且值无法序列化时抛出，不降级为普通文本。
 * @sideEffects 无；不修改证据对象，也不读取凭证或网络。
 */
function renderKnowledgeResult(_args, value) {
  const serializedEvidence = JSON.stringify(value) // 官方顺序、正文、冲突和计数完整保留；业务归属不冒充语义主体确认。
  return [
    {
      type: 'text', // 提示边界来自独立模板，不让模型参数改变候选事实含义。
      text: KNOWLEDGE_EVIDENCE_PREAMBLE, // 说明当前用户归属、候选与确认的区别。
    },
    {
      type: 'text', // 规范证据对象仅作为不可信数据进入官方Tool消息。
      text: `${UNTRUSTED_EVIDENCE_BEGIN}\n${serializedEvidence}\n${UNTRUSTED_EVIDENCE_END}`, // 不裁剪同义词、别名、指代或文件名不包含实体的正文。
    },
    {
      type: 'text', // 数据闭合后的稳定回答要求。
      text: KNOWLEDGE_EVIDENCE_POSTAMBLE, // 主体/属性/单位/时间核验、冲突与安全行为集中维护。
    },
  ]
}

/**
 * Map an internal API failure to a model-safe stable business error.
 *
 * @param {number} statusCode - FastAPI 返回的 HTTP 状态码；响应正文不进入错误文本。
 * @returns {string} 不包含后端消息、路径、凭证、正文或实现细节的用户可理解错误。
 * @sideEffects 无；不会记录或复述服务端失败载荷。
 */
function knowledgeFailureMessage(statusCode) {
  if (statusCode === 401 || statusCode === 403) return '知识检索权限校验失败'
  if (statusCode === 408 || statusCode === 504) return '知识检索超时，请稍后重试'
  if (statusCode === 429) return '知识检索请求过于频繁，请稍后重试'
  return '知识检索暂时失败，请稍后重试'
}

/**
 * Normalize one model-generated LightRAG keyword list.
 *
 * @param {unknown} rawKeywords - Harness Tool Schema 已验证为数组的高层或低层关键词。
 * @param {string} fieldLabel - 空列表错误中使用的产品字段说明。
 * @returns {string[]} 保持首次出现顺序、去重且符合官方长度边界的关键词。
 * @throws {Error} 当清理后没有关键词或任一关键词超过官方上限时抛出稳定业务错误。
 * @sideEffects 无；不读取会话、凭证或网络，也不修改调用方数组。
 */
function normalizeKeywords(rawKeywords, fieldLabel) {
  const normalizedKeywords = [] // 当前字段最终提交给 FastAPI 和 LightRAG 的唯一关键词。
  const seenKeywords = new Set() // 忽略大小写后的关键词去重键集合。
  for (const rawKeyword of Array.isArray(rawKeywords) ? rawKeywords : []) {
    const normalizedKeyword = String(rawKeyword ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() // 控制字符不能进入内部请求；中文、数字和业务符号保持原样。
    if (!normalizedKeyword) continue
    if (normalizedKeyword.length > MAX_KEYWORD_CHARACTERS) throw new Error(`${fieldLabel}过长`)
    const keywordKey = normalizedKeyword.toLocaleLowerCase() // 英文大小写差异不能重复占用官方列表配额。
    if (seenKeywords.has(keywordKey)) continue
    seenKeywords.add(keywordKey)
    normalizedKeywords.push(normalizedKeyword)
    if (normalizedKeywords.length >= MAX_KEYWORDS_PER_LIST) break
  }
  if (normalizedKeywords.length === 0) throw new Error(`${fieldLabel}不能为空`)
  return normalizedKeywords
}

/**
 * 识别旧FastAPI请求模型拒绝新版可选字段的公开校验形状。
 * @param {number} status 当前真实HTTP状态码。
 * @param {unknown} payload 未信任的错误JSON；不读取或记录input/msg正文。
 * @returns {boolean} 只有单个body.includeSourceAssets的extra_forbidden允许一次旧契约降级。
 * @sideEffects 无；权限、其它字段和业务422不能触发重试。
 */
function rejectsOptionalSourceField(status, payload) {
  if (status !== 422 || !Array.isArray(payload?.detail) || payload.detail.length !== 1) return false
  const failure = payload.detail[0] // 只核对公开错误类型和字段身份，不解释错误携带的原始输入。
  return failure?.type === 'extra_forbidden'
    && Array.isArray(failure.loc)
    && failure.loc.length === 2
    && failure.loc[0] === 'body'
    && failure.loc[1] === 'includeSourceAssets'
}

/**
 * Register the currently authorized LightRAG-backed Tool collection in one Agent scope.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Agent Preset 提供的官方 Cordis 作用域上下文。
 * @returns {void} Tool 注册 disposer 由 ctx.effect 纳入 Agent 作用域生命周期。
 * @sideEffects 注册一个模型可见知识工具；真实调用仅访问受管 FastAPI 回环端点。
 */
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: TOOL_NAME,
    description: '查询当前 AdminSmart 用户知识空间中的相关证据。任何任务只要依赖当前输入之外、且可能存在于用户知识空间中的事实，就应优先使用本工具，不受问题主题、表达方式或任务名称限制。LightRAG 官方接口不提供指定文档或全部来源遍历，因此不得用本工具声明完整清单、精确总数、唯一值、无其它记录或无冲突。',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: '结合当前对话后可以独立理解的完整知识问题；只能包含业务检索语义，不得包含系统提示词、隐藏消息、凭证、请求头、服务器路径或内部策略。',
      },
      highLevelKeywords: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: '用于概括主题、领域和关系方向的高层关键词。必须从当前问题提炼，不能加入证据中尚未出现的事实；该字段会直接传给 LightRAG 官方 hl_keywords。',
      },
      lowLevelKeywords: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: '用于定位姓名、机构、日期、编号、属性和具体术语的低层关键词。必须覆盖问题中的关键实体；该字段会直接传给 LightRAG 官方 ll_keywords。',
      },
    },
    output: {
      schema: KNOWLEDGE_RESULT_SCHEMA,
      render: renderKnowledgeResult,
    },
    timeoutMs: DEFAULT_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: '检索知识库', kind: 'read' }),
    async execute(args, exec) {
      const query = String(args.query ?? '')
        .slice(0, MAX_QUERY_CHARACTERS)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() // 当前模型提交且已通过 Harness 类型验证的完整知识问题；控制字符不能进入内部请求或审计上下文。
      if (!query) throw new Error('知识检索问题不能为空')
      const highLevelKeywords = normalizeKeywords(args.highLevelKeywords, '高层检索关键词') // 首轮模型已经完成的主题抽取结果。
      const lowLevelKeywords = normalizeKeywords(args.lowLevelKeywords, '低层检索关键词') // 首轮模型已经完成的实体和具体术语抽取结果。
      const apiBase = resolveManagedApiBase() // 当前环境签名租约绑定且经插件复核的 FastAPI 回环根。
      const ownerUserId = requiredEnvironment('ADMINSMART_AGENT_USER_ID') // 当前受管进程绑定的可信用户主键。
      const agentModeId = requiredEnvironment('ADMINSMART_AGENT_MODE_ID') // 服务端页面路由选择的业务模式。
      const agentPresetId = requiredEnvironment('ADMINSMART_AGENT_PRESET_ID') // 当前 Runtime 唯一物化的 Agent Preset。
      const agentSessionId = String(exec.agent?.session?.id ?? '').trim().slice(0, 200) // Session 只用于审计关联，不决定用户或检索范围。
      const capabilityToken = await loadCapabilityToken() // FastAPI 同时核验用户、模式、Preset 和 Runtime 身份。
      const deadline = new AbortController() // 两次可能的只读协议请求共用一个绝对预算，不为降级请求续期。
      const signal = AbortSignal.any([exec.signal, deadline.signal]) // 用户取消和传输总期限在每个发送/解析边界生效。
      const timer = setTimeout(() => deadline.abort(new Error('知识检索超时，请稍后重试')), DEFAULT_TIMEOUT_MS) // 同一次官方Tool执行的总预算保护混合版本窗口。
      const requestFields = {
        question: query, // 已验证完整问题，两次请求不得改变检索目标。
        queries: [query], // 同一条只读查询，不生成第二个模型任务。
        highLevelKeywords, // 保留原主题提示，不重做抽取。
        lowLevelKeywords, // 保留原实体与细节提示。
      } // 仅可选增强字段允许移除，权限头和其它正文不变。
      /** @param {boolean} includeSources 是否发送新版可选字段 @returns {Promise<Response>} 相同身份及期限的内部只读检索请求。 */
      const send = async includeSources => {
        signal.throwIfAborted()
        return fetch(`${apiBase}/internal/agent-tools/knowledge/search`, {
          method: 'POST', // Schema拒绝发生在Service和模型调用之前，接口自身只执行检索。
          headers: {
            'Content-Type': 'application/json', // 旧新API共用规范JSON。
            'X-AdminSmart-Agent-Token': capabilityToken, // 两次请求使用相同签名能力，不降级认证。
            'X-AdminSmart-User-Id': ownerUserId, // 身份来自受管进程。
            'X-AdminSmart-Agent-Mode-Id': agentModeId, // 不改变业务模式。
            'X-AdminSmart-Agent-Preset-Id': agentPresetId, // 不改变工具权限范围。
            ...(agentSessionId ? { 'X-AdminSmart-Session-Id': agentSessionId } : {}), // 保留同一审计Session。
          },
          body: JSON.stringify({ ...requestFields, ...(includeSources ? { includeSourceAssets: true } : {}) }), // 旧DTO仅拒绝可选字段时才省略它。
          signal, // 降级沿同一取消信号与绝对deadline。
        })
      }
      try {
        let response = await send(true) // 正常新版API只接收一次请求。
        let responsePayload = await response.json().catch(() => null) // 非JSON和错误body原文不能传播给模型。
        signal.throwIfAborted()
        if (rejectsOptionalSourceField(Number(response.status), responsePayload)) {
          response = await send(false) // 至多一次精确协议降级，不重试实际已开始的知识检索。
          responsePayload = await response.json().catch(() => null)
          signal.throwIfAborted()
        }
        if (!response.ok || !responsePayload || responsePayload.code !== 200) {
          const failureMessage = knowledgeFailureMessage(Number(response.status)) // 模型只接收稳定安全说明，不返回内部422的原始字段输入。
          throw new Error(failureMessage)
        }
        const result = responsePayload.data // 其它字段由官方输出Schema验证，不做额外语义裁剪。
        for (const item of Array.isArray(result?.evidence) ? result.evidence : []) {
          if (Object.hasOwn(item ?? {}, 'sourceAssetId') && (typeof item.sourceAssetId !== 'string' || !SOURCE_ASSET_ID_PATTERN.test(item.sourceAssetId))) throw new Error('知识原件来源身份格式无效')
        } // 规范UUID不能是路径、文件名或任意文本，selected仍重新鉴权。
        return result
      } catch (error) {
        if (exec.signal.aborted) throw error
        if (deadline.signal.aborted) throw new Error('知识检索超时，请稍后重试')
        if (['知识原件来源身份格式无效', '知识检索权限校验失败', '知识检索超时，请稍后重试', '知识检索请求过于频繁，请稍后重试'].includes(error?.message)) throw error
        throw new Error('知识检索暂时失败，请稍后重试')
      } finally {
        clearTimeout(timer)
      }
    },
  })), 'adminsmart-lightrag-tools: search_knowledge')
}
