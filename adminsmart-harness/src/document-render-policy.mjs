/** 官方页面渲染入口的固定参数与文件授权，不解析文档、不接受可执行内容。 */
import { realpathSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { businessRoot, permitsPath, within } from './native-file-policy.mjs'
import { sessionFiles } from './session-files.mjs'

export const DOCUMENT_RENDER_TOOL_NAME = 'render_document' // 专用官方引擎入口，不是可执行任意命令的 Shell。
export const MAX_RENDER_INPUT_BYTES = 20 * 1024 * 1024 // 只限制单次页面处理，不改变官方附件存储上限。
export const MAX_RENDER_IMAGES = 3 // 分批读取实际指定页码，不把抽样说成整份文档。
export const MAX_RENDER_PIXELS = 2_000_000 // 每张图片的像素上限，过大时明确失败，不静默裁切。
export const MAX_RENDER_DIMENSION = 2000 // 每张图片的最长边上限。
export const MAX_RENDER_OUTPUT_BYTES = 12 * 1024 * 1024 // 整批页面编码预算，不是进程 RSS 限额。
export const RENDER_TIMEOUT_MS = 45_000 // 官方转换器的运行期限；外层取消同时覆盖初始化和排队。
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp']) // 仅官方 IMAGE_FORMATS 支持的固定格式，不开放宏或任意脚本。
const WORKBOOK_EXTENSIONS = new Set(['.xls', '.xlsx', '.ods']) // 表格选择工作表/矩形；其它格式只选择物理页码。
const ARGUMENT_NAMES = new Set(['file_path', 'pages', 'sheet', 'range']) // 输出位置、代码、身份、权限和转换器配置都由服务端固定。

/**
 * 校验原生工具参数并确定固定渲染请求；多余属性不能在官方 Schema 外偷偷生效。
 * @param {object} args 模型请求，仅允许路径、最多三页或表格区域。
 * @returns {{filePath:string,extension:string,pages?:number[],sheet?:string,range?:string,skippedReason?:string}} 规范化选择；表格未指定范围时明确终止视觉检查。
 * @throws {Error} 任意越权字段、格式、页码或区域无效时拒绝，尚不读取源文件。
 */
export function renderSelection(args) {
  if (!args || typeof args !== 'object' || Object.keys(args).some(key => !ARGUMENT_NAMES.has(key))) throw new Error('页面渲染不接受命令、输出路径、权限或身份参数')
  const filePath = args.file_path // 仅路径选择，真实授权还须由当前 live Session 确认。
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.length > 4096) throw new Error('请选择当前会话文件或业务目录中的文件')
  const extension = extname(filePath).toLowerCase() // 用于选官方格式，不凭扩展名判断文件内容有效。
  const sheet = args.sheet === '' ? undefined : args.sheet // 模型协议可能补齐可选空字符串，它不代表选择了工作表。
  const range = args.range === '' ? undefined : args.range // 同样把可选空区域视为未填写，不能解释成任意范围或命令。
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error('官方页面渲染不支持此文件格式')
  if (WORKBOOK_EXTENSIONS.has(extension)) {
    if (args.pages !== undefined && (!Array.isArray(args.pages) || args.pages.length !== 0)) throw new Error('表格请使用工作表和单元格范围，不传页码')
    if (sheet === undefined) {
      if (range !== undefined) throw new Error('表格区域必须同时指定实际工作表名称')
      return { filePath, extension, skippedReason: '表格未指定实际工作表，本次不自动渲染全部工作表。需要视觉核验时先用官方办公工作流确认工作表名称，再指定 sheet。' } // 官方技能默认请求允许明确skipped，不能为无页码调用擅自扩大为整本表格。
    }
    if (typeof sheet !== 'string' || !sheet.trim() || sheet.length > 128 || /[\0\r\n]/u.test(sheet)) throw new Error('表格渲染必须指定实际工作表名称')
    if (range !== undefined && (typeof range !== 'string' || !/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/u.test(range))) throw new Error('表格区域必须是有效的 A1 单元格矩形')
    return { filePath, extension, sheet, ...(range === undefined ? {} : { range }) }
  }
  if (sheet !== undefined || range !== undefined) throw new Error('非表格文件请使用页码，不传工作表或单元格范围')
  const pages = args.pages === undefined || (Array.isArray(args.pages) && args.pages.length === 0) ? [1] : args.pages // 官方技能会省略页码或补空数组；都仅看第一页，不扩大为全部页面。
  if (!Array.isArray(pages) || !pages.length || pages.length > MAX_RENDER_IMAGES || pages.some(page => !Number.isSafeInteger(page) || page < 1 || page > 10_000) || new Set(pages).size !== pages.length) throw new Error('每次请选择一到三个不同的正整数页码')
  return { filePath, extension, pages }
}

/**
 * 确认输入属于业务目录或当前会话的官方已接受附件；官方技能资源不是可渲染业务输入。
 * @param {object} ctx 官方附件服务与当前业务 Context。
 * @param {object} execution 已解析的调用与 live Agent；不接受模型提供用户或 Session 身份。
 * @returns {{root:string,path:string,reference?:object,selection:object}} 可信输入位置和可能的官方附件引用。
 * @throws {Error} 会话、写入策略、真实路径或文件范围无法确认时失败关闭。
 */
export function authorizedRenderSource(ctx, execution) {
  if (!execution.agent?.session) throw new Error('页面渲染的当前业务会话不可用')
  const selection = renderSelection(execution.arguments) // 先拒绝隐藏参数，再检查路径，避免先读后拒绝。
  const root = realpathSync(businessRoot()) // 当前部署唯一业务根，不能由模型更改。
  const policy = ctx.sandboxPolicy.resolve({ session: execution.agent.session }) // 专用入口仍要求当前会话保留原 workspace-write 状态。
  if (policy.mode !== 'workspace-write' || realpathSync(resolve(policy.workspaceRoot)) !== root) throw new Error('当前页面渲染不属于受管业务目录')
  if (!permitsPath(ctx, execution, selection.filePath)) throw new Error('页面渲染文件不属于业务目录或当前会话附件')
  const currentDirectory = ctx.get?.('workingDirectory')?.get(execution.agent.session) ?? root // 与原生文件工具及路径Guard采用同一可信Session目录，目录切换不改变原业务根。
  const path = realpathSync(resolve(currentDirectory, selection.filePath)) // 检查和读取同一实际文件，不把子目录相对路径误定位到业务根的同名原件。
  if (within(root, path)) return { root, path, selection }
  for (const reference of sessionFiles(execution.agent.session, ctx.sessionProjections).values()) {
    if (!reference.mediaType && ctx.attachments.fileHostPath(reference) && realpathSync(ctx.attachments.fileHostPath(reference)) === path) return { root, path, reference, selection }
  }
  throw new Error('页面渲染只能处理当前业务文件或本会话已授权附件')
}
