import { realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { runtimeRoot } from './runtime.mjs'
import { sessionFiles } from './session-files.mjs'

export const NATIVE_FILE_TOOL_NAMES = Object.freeze(['read', 'read_image', 'write', 'edit', 'pwsh', 'bash', 'skill', 'present']) // 完整保留官方工具协议，业务只施加范围与权限约束。
const OFFICE_SKILLS = new Set(['office-docx', 'office-xlsx', 'office-pptx']) // 知识模式只开放官方办公技能，不加载任意服务器技能。
const READING_TOOLS = new Set(['read', 'read_image']) // 原生读取可访问当前工作区、授权附件及官方只读技能资源。
const WRITING_TOOLS = new Set(['write', 'edit']) // 文本改写只能发生在业务工作目录。

/** @returns {string} Gateway 注入的业务工作目录，缺失时仅供离线开发使用当前 cwd。 */
export function businessRoot() {
  return resolve(process.env.ADMINSMART_AGENT_BUSINESS_ROOT || process.cwd())
}

/** @param {string} root 授权根。 @param {string} candidate 待验证路径。 @returns {boolean} 是否位于根目录或其后代。 */
export function within(root, candidate) {
  const delta = relative(root, candidate) // 使用系统路径语义，不采用字符串前缀判断兄弟目录。
  return delta === '' || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith(`..${sep}`))
}

/**
 * 对现存文件及待创建文件解析真实祖先，避免符号链接把文件工具带出授权范围。
 * @param {string} path 操作系统绝对路径。
 * @returns {string} 真实路径或真实祖先下的待创建路径；官方 Guard 要求同步返回。
 * @throws {Error} 非不存在错误直接拒绝，不把访问失败当成不存在。
 */
function canonical(path) {
  try { return realpathSync(path) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const parent = dirname(path) // 待创建对象的直接父目录。
    if (parent === path) throw error
    return resolve(canonical(parent), relative(parent, path))
  }
}

/**
 * 判断显式文件路径的授权范围；此检查不声称拦截命令内部的任意文件读取。
 * @param {object} ctx 当前业务 Context，持有官方 AttachmentStore。
 * @param {object} execution 官方已解析的工具调用及 live Agent。
 * @param {unknown} value 模型提供的文件路径。
 * @param {boolean} write 是否要求写入权限。
 * @returns {boolean} 普通文件工具可读或可写时为真。
 */
export function permitsPath(ctx, execution, value, write = false) {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/u.test(value) || /^\\\\|^\/\/|^[A-Za-z]+:\/\//u.test(value)) return false
  if (process.platform === 'win32' && value.replace(/^[A-Za-z]:/u, '').includes(':')) return false
  const root = canonical(businessRoot()) // 每次读取真实根，路径链接变化不能复用旧字符串授权。
  const candidate = canonical(resolve(root, value)) // 相对路径始终从受管业务根解析。
  if (within(root, candidate)) {
    try {
      const entry = statSync(candidate) // 硬链接没有可确认的唯一文件归属，普通文件工具不能据路径授权。
      if (entry.isFile() && entry.nlink > 1) return false
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    return true
  }
  if (write) return false
  const assets = canonical(resolve(runtimeRoot, 'node_modules/@deepseek-ai/dsh-skill-office/assets')) // 仅官方办公技能目录可作为只读资源。
  if (within(assets, candidate)) return true
  for (const reference of sessionFiles(execution.agent?.session).values()) {
    const source = reference.mediaType ? ctx.attachments.imageHostPath(reference) : ctx.attachments.fileHostPath(reference) // 来源必须由官方 Store 从已授权引用计算。
    if (source && canonical(source) === candidate) return true
  }
  return false
}

/**
 * 对官方文件、命令和交付工具实施业务层检查，不解析或重写原生工具实现。
 * @param {object} ctx 当前业务 Context，包含公开 sandboxPolicy 与附件服务。
 * @param {object} execution 当前工具调用；命令本身的读取范围仍依赖提示词。
 * @returns {string|undefined} 同步拒绝原因或允许；任何检查异常均拒绝。
 */
export function nativeExecutionDenial(ctx, execution) {
  try {
    const args = execution.arguments ?? {} // 参数已经过官方工具 Schema 校验，身份仍来自 live Agent。
    if (args.sandbox_permissions !== undefined) {
      if (args.sandbox_permissions !== 'workspace-write') return '知识业务不允许提高文件权限或绕过写入沙箱'
      const current = ctx.sandboxPolicy.resolve({ session: execution.agent?.session }) // 仅允许原生 SDK 的同模式 no-op，不允许从更窄模式升权。
      if (current.mode !== 'workspace-write' || canonical(resolve(current.workspaceRoot)) !== canonical(businessRoot())) return '知识业务不允许提高当前会话的文件权限'
      if (typeof args.justification !== 'string' || !args.justification.trim()) return '官方工具要求非空 justification。请填写本次办公目的（例如读取本人已上传的附件）；权限只能保持 workspace-write，不是申请更高权限。'
    }
    if (READING_TOOLS.has(execution.name) || WRITING_TOOLS.has(execution.name)) {
      return permitsPath(ctx, execution, args.file_path, WRITING_TOOLS.has(execution.name)) ? undefined : '文件路径不属于当前业务目录或本会话授权附件'
    }
    if (execution.name === 'skill') return OFFICE_SKILLS.has(args.name) ? undefined : '当前知识业务只开放官方办公技能'
    if (execution.name === 'present') {
      for (const file of args.files ?? []) if (!permitsPath(ctx, execution, file.path, true)) return '只能交付当前业务目录内的文件'
      return undefined
    }
    if (['pwsh', 'bash'].includes(execution.name)) {
      if (args.run_in_background === true) return '知识业务命令不允许后台常驻运行'
      if (!execution.agent?.session) return '当前业务会话不可用'
      const policy = ctx.sandboxPolicy.resolve({ session: execution.agent.session }) // 官方会话沙箱状态不能被隐藏的历史覆盖放宽。
      const root = canonical(businessRoot()) // 已批准的业务根，不接受模型改变权限根。
      if (policy.mode !== 'workspace-write' || canonical(resolve(policy.workspaceRoot)) !== root) return '当前会话的写入沙箱不属于受管业务目录'
      const cwd = canonical(resolve(root, args.workdir || '.')) // 允许业务根内子目录，不允许通过工作目录绕到其它位置。
      return within(root, cwd) ? undefined : '命令工作目录必须位于当前业务目录'
    }
    return undefined
  } catch { return '当前业务文件权限无法确认，请重新连接后重试' }
}
