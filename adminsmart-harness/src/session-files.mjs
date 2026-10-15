/** 基于官方增量投影恢复会话文件权限；缓存只加速可信事件折叠，不能凭文件存在授予访问。 */
import { authorizedSessionFamily } from './session-authority.mjs'
import { loadRuntimeModule } from './runtime.mjs'

const { z } = await loadRuntimeModule('zod') // 与固定 Runtime 共用公开 Schema 库，投影恢复不得接受未经验证的状态。
const KNOWLEDGE_FILE_TOOL = 'load_knowledge_files' // 唯一经过主应用归属校验的知识原件导入工具。
export const SESSION_FILES_PROJECTION_KEY = 'adminsmart-authorized-session-files' // 仅 Host 使用的投影，不向浏览器广播权限清单。
export const KNOWLEDGE_IMPORT_RESERVATION_EVENT = 'plugin:adminsmart/knowledge-import-reservation' // 官方可忽略插件记录，仅持久计量，不授予附件权限或改变消息surface。
const referenceSchema = z.object({
  attachmentId: z.string().min(1), // 官方内容寻址身份，不能以模型提供的文件路径代替。
  name: z.string().optional(), // 官方引用名称，读取路径仍由Store计算。
  bytes: z.number().int().nonnegative().optional(), // 文件或规范化图片的实际编码大小。
  mediaType: z.string().optional(), // 图片准入类型，普通文件引用不必声明。
  width: z.number().int().positive().optional(), // 官方规范化光栅宽度，不从文字猜测。
  height: z.number().int().positive().optional(), // 官方规范化光栅高度。
}).passthrough() // 官方引用由 AttachmentStore 再校验；这里只验证恢复结构。
const bindingSchema = z.object({
  assetId: z.string().min(1), // 当前用户后端原件资产身份，仅供当前成功引用匹配。
  sha256: z.string().regex(/^[a-f0-9]{64}$/u), // 原始内容摘要，规范化图片摘要可能不同。
  bytes: z.number().int().nonnegative(), // 最新后端清单的原始字节大小。
  attachmentId: z.string().min(1), // 当前成功FileBlock/ImageBlock的实际官方身份。
  name: z.string(), // 与成功附件块一致的名称，避免同摘要多名称混配。
}).strict() // 原始摘要到规范化图片引用的映射，来源必须是成功 Tool 的私有元数据。
const stateSchema = z.object({
  pending: z.array(z.object({
    callId: z.string().min(1), // 原始调用身份，任意新同名调用覆盖旧待处理身份。
    seq: z.number().int().nonnegative(), // 原始事件序号，结果sourceEventSeqs必须一致。
    turn: z.number().int().nonnegative(), // 执行轮次，相同callId跨轮次仍不匹配。
    step: z.number().int().nonnegative(), // 执行步骤，不能用别步结果授予权限。
  }).strict()), // 本会话未结束调用，不能跨父子日志配对。
  files: z.array(referenceSchema), // 原始成功事件的引用；压缩替换消息不新增权限。
  bindings: z.array(bindingSchema), // 来源摘要映射本身不授权，仍需匹配当前文件权限与新的后端清单。
  turn: z.number().int().nonnegative(), // 官方当前轮次，只用于资源计量，不承担身份隔离。
  importedFiles: z.number().int().nonnegative(), // 当前轮次成功导入的新原件数量；复用已授权引用不重复消耗预算。
  importedBytes: z.number().int().nonnegative(), // 当前轮次成功传输的原始字节数，用于恢复后的累计预算。
  reservedFiles: z.number().int().nonnegative(), // 当前可信根轮次在下载前已预留的数量，包含子代理与失败尝试。
  reservedBytes: z.number().int().nonnegative(), // 当前可信根轮次在下载前预留的源字节，Runtime重启不能清空已消耗预算。
}).strict() // 官方 Cache 恢复前验证；字段或语义变更必须提升版本。

/** @returns {object} 空日志的无授权状态，所有字段均为可序列化 JSON。 */
function emptyState() {
  return {
    pending: [], // 空日志没有可匹配的知识调用。
    files: [], // 空日志不因附件目录已有文件而获得权限。
    bindings: [], // 来源版本只能由成功结果携带的私有元数据建立。
    turn: 0, // 首个官方turn/start之前的无轮次状态。
    importedFiles: 0, // 空日志没有本轮新导入文件用量。
    importedBytes: 0, // 空日志没有本轮原始字节用量。
    reservedFiles: 0, // 未开始任何原件网络传输，不预留资源。
    reservedBytes: 0, // 未发生任何原件下载预留。
  }
}

/**
 * 合并直接官方附件块，不解释正文、退役包装或嵌套对象。
 * @param {unknown} content 已提交消息内容。
 * @param {object[]} previous 已通过事件来源校验的引用。
 * @returns {object[]} 有实际变化才返回新数组，避免不相关事件产生投影更新。
 */
function mergeAttachments(content, previous) {
  const files = new Map(previous.map(reference => [reference.attachmentId + '\0' + (reference.name ?? ''), reference])) // 内容身份和显示名联合去重。
  let changed = false // 相同引用或不相关事件维持原状态引用。
  for (const block of Array.isArray(content) ? content : []) {
    if (!['file', 'image'].includes(block?.type)) continue
    const reference = block.attachment // 实际路径和字节仍需由官方 Store 验证。
    if (!reference || typeof reference.attachmentId !== 'string' || !reference.attachmentId) continue
    const key = reference.attachmentId + '\0' + (reference.name ?? '') // 不按文件名、路径或磁盘存在猜测归属。
    if (JSON.stringify(files.get(key)) === JSON.stringify(reference)) continue
    files.set(key, structuredClone(reference))
    changed = true
  }
  return changed ? [...files.values()] : previous
}

/**
 * 折叠单个官方已提交事件；替换/压缩改变模型可见历史，但不新增原件权限。
 * @param {object} state 当前 Session 的上一份纯 JSON 状态，禁止原地修改。
 * @param {object} event 已接受的官方事件，包含可信序号和来源。
 * @returns {object} 同步后状态；失败、重放和错误来源不能创建引用或摘要映射。
 */
export function applySessionFileEvent(state, event) {
  const data = event.data // 只读取元数据和直接附件块，不解析用户正文。
  if (event.type === 'turn/start' && Number.isSafeInteger(data?.turn) && data.turn >= 0) return data.turn === state.turn ? state : { ...state, turn: data.turn, importedFiles: 0, importedBytes: 0, reservedFiles: 0, reservedBytes: 0 }
  if (event.type === KNOWLEDGE_IMPORT_RESERVATION_EVENT) {
    if (data?.turn !== state.turn || !Number.isSafeInteger(data.files) || data.files < state.reservedFiles || !Number.isSafeInteger(data.bytes) || data.bytes < state.reservedBytes) return state
    return { ...state, reservedFiles: data.files, reservedBytes: data.bytes } // 记录携带完整单调后状态，回放不重加费用，也绝不建立附件授权。
  }
  if (event.type === 'tool/call') {
    const callId = data?.callId // 缺失身份不可被字符串化为有效调用。
    if (typeof callId !== 'string' || !callId) return state
    const pending = state.pending.filter(call => call.callId !== callId) // 同名任意新调用使旧知识调用失效。
    if (data.name === KNOWLEDGE_FILE_TOOL) pending.push({ callId, seq: event.seq, turn: data.turn, step: data.step })
    return pending.length === 0 && state.pending.length === 0 ? state : { ...state, pending }
  }
  if (event.type === 'user/message') {
    if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') return state
    const files = mergeAttachments(data?.message?.content ?? data?.content, state.files) // 原始用户附件可授权；文本中的伪引用无效。
    return files === state.files ? state : { ...state, files }
  }
  if (event.type !== 'tool/result' || (event.surfaceOp !== undefined && event.surfaceOp !== 'append')) return state
  const message = data?.message // V4 的直接 tool-role 消息，旧格式由官方迁移。
  const callId = message?.toolCallId // 不解释 content 中的伪工具包装。
  const call = typeof callId === 'string' && callId ? state.pending.find(candidate => candidate.callId === callId) : undefined // 只匹配本 Session 真实开始的调用。
  if (!call) return state
  const next = { ...state, pending: state.pending.filter(candidate => candidate !== call) } // 错误结果也消耗调用，禁止随后重放成成功。
  if (message.role !== 'tool' || message.source?.kind !== 'tool' || message.source.callId !== callId
    || (message.isError !== undefined && message.isError !== false)
    || data.error !== undefined || data.turn !== call.turn || data.step !== call.step) return next
  const sources = event.sourceEventSeqs // 当前 append 结果绑定原调用；合法旧历史缺省仍按多处身份核对。
  if (sources !== undefined && (!Array.isArray(sources) || sources.length !== 1 || sources[0] !== call.seq)) return next
  next.files = mergeAttachments(message.content, state.files)
  const budget = data.meta?.knowledgeImportBudget // 成功 Tool 的实际新导入用量，不接受模型参数声明的配额。
  if (Number.isSafeInteger(budget?.files) && budget.files >= 0 && Number.isSafeInteger(budget?.bytes) && budget.bytes >= 0) {
    next.importedFiles += budget.files
    next.importedBytes += budget.bytes
  }
  const imports = data.meta?.knowledgeFileImports // 官方 presentationMeta 的成功结果投影，不解析模型文本或文件正文。
  if (Array.isArray(imports)) {
    const bindings = new Map(state.bindings.map(binding => [binding.assetId, binding])) // 同一资产只保留最近成功版本。
    for (const imported of imports) {
      const accepted = bindingSchema.safeParse(imported) // 非法字段、摘要和大小都不能进入映射。
      if (!accepted.success || !next.files.some(reference => reference.attachmentId === accepted.data.attachmentId && reference.name === accepted.data.name)) continue
      bindings.set(accepted.data.assetId, accepted.data)
    }
    next.bindings = [...bindings.values()]
  }
  return next
}

/**
 * 注册官方 Host-only Projection；Registry 管理首读、事件增量、恢复版本和生命周期。
 * @param {object} ctx 已注入 sessionProjections 的知识 Agent Context。
 * @returns {void} 同一 key 多 Preset 使用官方引用计数，不建立另一份附件数据库。
 */
export function installSessionFileProjection(ctx) {
  if (!ctx.sessionProjections) return // 仅兼容已有纯 Fixture；正式知识插件显式声明依赖。
  ctx.sessionProjections.register({ key: SESSION_FILES_PROJECTION_KEY, stateVersion: 1, stateSchema, init: emptyState, apply: applySessionFileEvent })
}

/**
 * 读取单个会话的授权投影，正式路径不进行每次全历史扫描。
 * @param {object} session 官方 live Session，或已有离线测试的只读替身。
 * @param {object} [projections] 受管 Context 的官方 Projection Registry。
 * @returns {object} 与当前可信日志同一观察切面的派生状态。
 * @throws {Error} 正式 Registry 缺少所需投影时失败关闭。
 */
export function sessionFileState(session, projections) {
  if (projections) {
    const state = projections.stateOf(session, SESSION_FILES_PROJECTION_KEY) // 当前可信日志增量是权限唯一来源；缓存仅作官方折叠加速。
    if (!state) throw new Error('当前会话文件授权投影不可用')
    return state
  }
  return typeof session.snapshotEvents === 'function' ? session.snapshotEvents().reduce(applySessionFileEvent, emptyState()) : emptyState() // 保留既有离线 Fixture/诊断入口；正式 Guard 和 Tool 均传 Registry。
}

/**
 * 读取当前会话及经 Host 实时验证的一层父会话的附件权限。
 * @param {object} session 当前官方 Session，不能只凭持久 parent ID 继承。
 * @param {object} [projections] 正式路径的官方 Projection Registry。
 * @returns {Map<string,object>} 脱离 live 投影的引用副本，调用方不能反向修改权限。
 * @throws {Error} 父归属或投影能力无法确认时拒绝。
 */
export function sessionFiles(session, projections) {
  const files = new Map() // 只合并有限引用，不扫描模型流或其它会话。
  for (const current of authorizedSessionFamily(session)) {
    for (const reference of sessionFileState(current, projections).files) files.set(reference.attachmentId + '\0' + (reference.name ?? ''), structuredClone(reference))
  }
  return files
}
