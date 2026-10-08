/** AdminSmart Agent-scoped monotonic Tool execution guard. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildRequestContextPolicy } from './prompts/request-context.mjs'
import { SECURITY_BOUNDARY_POLICY } from './prompts/security-boundary.mjs'
import { NATIVE_FILE_TOOL_NAMES, businessRoot, nativeExecutionDenial } from './native-file-policy.mjs'
import { buildNativeOfficePolicy } from './prompts/native-office.mjs'
import { authorizedRenderSource, DOCUMENT_RENDER_TOOL_NAME } from './document-render-policy.mjs'
import { KNOWLEDGE_DELEGATION_TOOL_NAME } from './knowledge-delegation.mjs'
import { authorizedSessionFamily, isDelegatedSession } from './session-authority.mjs'
export const name = 'adminsmart-agent-security'
export const inject = ['tools', 'systemPrompt']

const KNOWLEDGE_TOOL_NAME = 'search_knowledge' // 当前用户 LightRAG 相关证据检索工具。
const KNOWLEDGE_ATTACHMENT_TOOL_NAME = 'load_knowledge_files' // 通过 FastAPI 所有权校验后挂载当前用户知识原件的通用桥接工具。
const WEB_TOOL_NAMES = new Set([
  'web_search', // Harness 官方公开网页搜索 Tool；Provider 由当前 Runtime 的 Web capability seam 选择。
  'lookup_business_registry', // 企查查官方企业 MCP 的窄权限工商登记查询。
  'web_fetch', // Harness 官方受限公开网页读取工具。
]) // 所有真实外网访问必须共同服从当前 Session 联网开关。
const ALWAYS_ALLOWED_TOOL_NAMES = new Set([
  KNOWLEDGE_TOOL_NAME, // 当前用户知识空间相关性检索。
  KNOWLEDGE_ATTACHMENT_TOOL_NAME, // 当前用户知识原件的受管 Session 桥接。
  ...NATIVE_FILE_TOOL_NAMES, // 文件问答完全走固定版官方工具，业务只检查路径和权限。
  DOCUMENT_RENDER_TOOL_NAME, // 专用官方渲染 API，执行前和实际调用都校验文件范围。
]) // 不访问公网且已经由各自能力层实施资源归属校验的工具。
const WEB_ACCESS_STATE_FILE = 'session-web-access.json' // Host UI 与 Agent Guard 共享的 Runtime 私有状态文件名。
const DELEGATION_ARGUMENT_NAMES = new Set(['description', 'prompt']) // 本业务只接受原生前台任务输入，拒绝额外会话、模型、后台或权限字段。

/**
 * Read whether the calling Session currently permits public web access.
 *
 * @param {Readonly<import('@deepseek-ai/dsh-tools').ToolExecution>} execution - Harness 当前结构化工具执行上下文。
 * @returns {boolean} 主会话状态缺失时保留产品默认 true；身份、子会话父授权或状态损坏时返回 false。
 * @sideEffects 同步读取当前用户与业务模式独占 DSH_HOME 下的小型开关文件，不访问网络或业务数据。
 */
function sessionWebAccessEnabled(execution) {
  let permissionSession // 主会话或经可信 direct parent 校验的父会话，绝不读取子会话默认开关。
  try {
    permissionSession = execution.agent?.session ? authorizedSessionFamily(execution.agent.session)[0] : undefined
  } catch { return false } // 陌生、失效或更深父关系不能使用“状态缺失默认开启”的产品规则。
  const sessionId = String(permissionSession?.id ?? execution.agent?.id ?? '').trim() // 子权限归属可信父 Session，主会话保留原默认行为。
  if (!sessionId) return false
  const dshHome = String(process.env.DSH_HOME ?? '').trim() // Gateway 为当前环境、模式和用户独占注入的 Harness Home。
  if (!dshHome) return false
  const statePath = resolve(dshHome, '.adminsmart-state', WEB_ACCESS_STATE_FILE) // 固定 Runtime 私有文件，不接受模型或浏览器路径输入。
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8')) // Host 原子写入且只含 Session 开关和更新时间的 JSON 对象。
    if (state?.version !== 1 || !state.sessions || typeof state.sessions !== 'object' || Array.isArray(state.sessions)) return false
    const sessionState = state?.sessions?.[sessionId] // 当前 Session 的唯一开关记录；其它会话状态不能影响本次执行。
    return sessionState?.enabled !== false
  } catch (error) {
    if (error?.code === 'ENOENT') return true // 首次进入会话没有记录时按用户要求默认开启联网。
    return false // 损坏或不可读状态按最小权限关闭公网访问。
  }
}

/**
 * Install a final monotonic deny for the knowledge Agent scope.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Agent-scoped Cordis context supplied by the Preset.
 * @returns {void}
 */
export function apply(ctx) {
  const unrelatedTools = ctx.tools.schemas().map(tool => tool.name).filter(toolName => (
    toolName !== 'run_code' && toolName !== KNOWLEDGE_DELEGATION_TOOL_NAME && !ALWAYS_ALLOWED_TOOL_NAMES.has(toolName) && !WEB_TOOL_NAMES.has(toolName)
  )) // 只排除已存在的无关工具；空 allow 会误伤 Preset 贡献层，不能用于这里。
  if (unrelatedTools.length) ctx.effect(() => ctx.tools.restrict({ deny: unrelatedTools }), 'adminsmart-agent-security: unrelated tools hidden')
  ctx.effect(() => ctx.tools.guard(execution => {
    const toolName = String(execution.name ?? '') // 当前 Harness 已解析的结构化 Tool 名称，不从模型普通文本提取。
    if (isDelegatedSession(execution.agent?.session) || (execution.agent?.options?.subagentDepth ?? 0) !== 0) {
      try {
        if (!isDelegatedSession(execution.agent?.session)) return '子会话的可信父会话不可用'
        authorizedSessionFamily(execution.agent.session)
      } catch { return '子会话的可信父会话不可用' }
      if (toolName === KNOWLEDGE_DELEGATION_TOOL_NAME) return '当前知识子代理不允许继续委派'
    } else if (toolName === KNOWLEDGE_DELEGATION_TOOL_NAME) {
      const parent = execution.agent // 调用者必须是当前受管 live 根 Agent，不相信模型传入的 Session ID。
      if (!parent?.session || ctx.get('agents')?.get(parent.id) !== parent || ctx.get('sessions')?.get(parent.session.id) !== parent.session) return '当前会话身份不可用'
      if (Object.keys(execution.arguments ?? {}).some(argument => !DELEGATION_ARGUMENT_NAMES.has(argument))) return '当前知识委派不接受额外模型、后台或会话身份参数'
      return undefined
    }
    if (toolName === DOCUMENT_RENDER_TOOL_NAME) {
      try { authorizedRenderSource(ctx, execution); return undefined } catch { return '页面渲染文件或参数未获当前业务会话授权' }
    }
    if (NATIVE_FILE_TOOL_NAMES.includes(toolName)) return nativeExecutionDenial(ctx, execution)
    if (ALWAYS_ALLOWED_TOOL_NAMES.has(toolName)) return undefined
    if (WEB_TOOL_NAMES.has(toolName)) {
      return sessionWebAccessEnabled(execution)
        ? undefined
        : '当前会话已关闭联网，请先在输入框左侧开启联网'
    }
    return '当前 AuraSearch 知识会话未授权调用该工具'
  }), 'adminsmart-agent-security: final Tool guard') // 单调 Guard 在业务 Tool 注册之后执行，任何后续能力都不能重新允许跨业务工具。
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'adminsmart:request-context', // 每次请求投影当前会话权限，不在 Runtime 启动时冻结开关。
    order: 55, // 排在通用安全边界之后，早于文档证据。
    text: ({ agent, scope }) => buildRequestContextPolicy(sessionWebAccessEnabled({ agent: agent ?? scope })), // RC2 AssembleContext 使用 scope；与 Guard 共用父会话权限解析。
  }), 'adminsmart-agent-security: current Session capabilities')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'adminsmart:security-boundary',
    order: 50,
    text: SECURITY_BOUNDARY_POLICY, // 静态安全模板只在 prompts 中维护，实际执行仍由上面的 Guard 判定。
  }), 'adminsmart-agent-security: system prompt boundary')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'adminsmart:native-office', // 只由受管部署注入当前业务目录与解释器，不接受用户覆盖。
    order: 60, // 与知识证据策略相邻，官方技能不覆盖业务范围。
    text: buildNativeOfficePolicy({ root: businessRoot(), python: process.env.ADMINSMART_OFFICE_PYTHON || '' }),
  }), 'adminsmart-agent-security: native Office environment')
}
