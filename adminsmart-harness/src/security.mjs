/** AdminSmart Agent-scoped monotonic Tool execution guard. */

import { resolve } from 'node:path'

import { buildRequestContextPolicy } from './prompts/request-context.mjs'
import { NATIVE_FILE_TOOL_NAMES, businessRoot, nativeExecutionDenial, worktreeExecutionDenial } from './native-file-policy.mjs'
import { buildNativeOfficePolicy } from './prompts/native-office.mjs'
import { authorizedRenderSource, DOCUMENT_RENDER_TOOL_NAME } from './document-render-policy.mjs'
import { KNOWLEDGE_DELEGATION_TOOL_NAME } from './knowledge-delegation.mjs'
import { authorizedSessionFamily, isDelegatedSession } from './session-authority.mjs'
import { knowledgePluginCapabilities, selectedKnowledgeTeam, selectedKnowledgeToolNames } from './plugin-capabilities.mjs'
import { buildSecurityBoundaryPolicy } from './prompts/security-boundary.mjs'
export const name = 'adminsmart-agent-security'
export const inject = ['tools', 'systemPrompt']

const KNOWLEDGE_TOOL_NAME = 'search_knowledge' // 当前用户 LightRAG 相关证据检索工具。
const KNOWLEDGE_ATTACHMENT_TOOL_NAME = 'load_knowledge_files' // 通过 FastAPI 所有权校验后挂载当前用户知识原件的通用桥接工具。
const WEB_TOOL_NAMES = new Set([
  'web_search', // Harness 官方公开网页搜索 Tool；Provider 由当前 Runtime 的 Web capability seam 选择。
  'lookup_business_registry', // 企查查官方企业 MCP 的窄权限工商登记查询。
  'web_fetch', // Harness 官方受限公开网页读取工具。
]) // 公开信息能力沿用原生工具及受管Provider，不额外维护会话联网偏好。
const ALWAYS_ALLOWED_TOOL_NAMES = new Set([
  KNOWLEDGE_TOOL_NAME, // 当前用户知识空间相关性检索。
  KNOWLEDGE_ATTACHMENT_TOOL_NAME, // 当前用户知识原件的受管 Session 桥接。
  ...NATIVE_FILE_TOOL_NAMES, // 文件问答完全走固定版官方工具，业务只检查路径和权限。
  DOCUMENT_RENDER_TOOL_NAME, // 专用官方渲染 API，执行前和实际调用都校验文件范围。
]) // 不访问公网且已经由各自能力层实施资源归属校验的工具。
const DELEGATION_ARGUMENT_NAMES = new Set(['description', 'prompt', 'cwd']) // alpha2 官方委派参数；cwd只能复用父当前目录，模型、会话、后台与权限参数仍拒绝。

/**
 * Install a final monotonic deny for the knowledge Agent scope.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Agent-scoped Cordis context supplied by the Preset.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.effect(() => {
    let release // 当前已知无关工具的可见性限制；可信选择更新时按真实库存重算。
    const refresh = () => {
      release?.()
      const selected = selectedKnowledgeToolNames(ctx) // 只按精确已选官方能力开放，不按包名前缀放行工具。
      const unrelatedTools = ctx.tools.schemas().map(tool => tool.name).filter(toolName => (
        toolName !== 'run_code' && toolName !== KNOWLEDGE_DELEGATION_TOOL_NAME && !ALWAYS_ALLOWED_TOOL_NAMES.has(toolName) && !WEB_TOOL_NAMES.has(toolName) && !selected.has(toolName)
      )) // 空allow会误伤Preset贡献层，仅排除当前真实存在的无关工具。
      release = unrelatedTools.length ? ctx.tools.restrict({ deny: unrelatedTools }) : undefined
    }
    refresh()
    const observer = ctx.inject?.(['adminsmartPluginCapabilities'], owner => {
      refresh()
      owner.effect(() => owner.get('adminsmartPluginCapabilities').subscribe(refresh)) // Hostface迟到时也同步真实采用状态，但不阻塞原业务装配。
    })
    return () => { void observer?.dispose(); release?.() }
  }, 'adminsmart-agent-security: unrelated tools hidden')
  ctx.effect(() => ctx.tools.guard(execution => {
    const toolName = String(execution.name ?? '') // 当前 Harness 已解析的结构化 Tool 名称，不从模型普通文本提取。
    if (isDelegatedSession(execution.agent?.session) || (execution.agent?.options?.subagentDepth ?? 0) !== 0) {
      try {
        if (!isDelegatedSession(execution.agent?.session)) return '子会话的可信父会话不可用'
        authorizedSessionFamily(execution.agent.session)
      } catch { return '子会话的可信父会话不可用' }
      if (toolName === KNOWLEDGE_DELEGATION_TOOL_NAME) return '当前知识子代理不允许继续委派'
    } else if (toolName === KNOWLEDGE_DELEGATION_TOOL_NAME) {
      if (selectedKnowledgeTeam(ctx)) return '当前管理员团队模式使用官方Team委派入口' // 异步释放旧fiber期间也不能继续使用平行委派。
      const parent = execution.agent // 调用者必须是当前受管 live 根 Agent，不相信模型传入的 Session ID。
      if (!parent?.session || ctx.get('agents')?.get(parent.id) !== parent || ctx.get('sessions')?.get(parent.session.id) !== parent.session) return '当前会话身份不可用'
      if (Object.keys(execution.arguments ?? {}).some(argument => !DELEGATION_ARGUMENT_NAMES.has(argument))) return '当前知识委派不接受额外模型、后台或会话身份参数'
      if (execution.arguments?.cwd !== undefined) {
        const parentDirectory = ctx.get('workingDirectory')?.get(parent.session) ?? businessRoot() // 官方服务提供父会话已提交的有效目录；不信任模型选择新的业务范围。
        const requestedDirectory = typeof execution.arguments.cwd === 'string' ? resolve(parentDirectory, execution.arguments.cwd) : '' // 相对输入只做继承目录的等价性判断，不允许子代理切换目录。
        const normalizeDirectory = path => process.platform === 'win32' ? path.toLowerCase() : path // Windows路径大小写不产生新的读取或写入范围。
        if (normalizeDirectory(requestedDirectory) !== normalizeDirectory(resolve(parentDirectory))) return '知识子代理必须继承父会话当前工作目录'
      }
      return undefined
    }
    const selected = selectedKnowledgeToolNames(ctx, { child: isDelegatedSession(execution.agent?.session) }) // 父子按同一可信能力源分别判定，子不能递归创建Agent。
    if (selected.has(toolName) && ctx.tools.get(toolName, execution.agent)) {
      if (!execution.agent?.session || ctx.get('agents')?.get(execution.agent.id) !== execution.agent || ctx.get('sessions')?.get(execution.agent.session.id) !== execution.agent.session) return '当前会话身份不可用'
      if (toolName === 'create_worktree') return worktreeExecutionDenial(ctx, execution)
      return undefined // 原官方Tool继续负责参数、Team成员、任务、进程或SessionStore权限；业务FastAPI身份不变。
    }
    if (toolName === DOCUMENT_RENDER_TOOL_NAME) {
      try { authorizedRenderSource(ctx, execution); return undefined } catch { return '页面渲染文件或参数未获当前业务会话授权' }
    }
    if (NATIVE_FILE_TOOL_NAMES.includes(toolName)) return nativeExecutionDenial(ctx, execution)
    if (ALWAYS_ALLOWED_TOOL_NAMES.has(toolName)) return undefined
    if (WEB_TOOL_NAMES.has(toolName)) {
      if (!execution.agent?.session || ctx.get('agents')?.get(execution.agent.id) !== execution.agent || ctx.get('sessions')?.get(execution.agent.session.id) !== execution.agent.session) return '当前会话身份不可用'
      return undefined // 官方工具负责参数与取消；子会话已经过上述可信父关系校验，旧私有偏好不再影响执行。
    }
    return '当前 AuraSearch 知识会话未授权调用该工具'
  }), 'adminsmart-agent-security: final Tool guard') // 精确已选官方能力仍经过角色、live身份与子深度，未知工具永不因管理员身份自动允许。
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'adminsmart:request-context', // 仅补官方时钟与事实核验说明，不维护额外会话联网选择。
    order: 55, // 排在通用安全边界之后，早于文档证据。
    text: () => buildRequestContextPolicy(), // 原生Web能力按当前实际挂载状态和Provider结果执行，不伪造已联网事实。
  }), 'adminsmart-agent-security: current Session capabilities')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'adminsmart:security-boundary',
    order: 50,
    text: () => buildSecurityBoundaryPolicy(knowledgePluginCapabilities(ctx)), // 角色有效能力只影响已选官方执行说明，原知识/文件/隐私边界保留。
  }), 'adminsmart-agent-security: system prompt boundary')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'adminsmart:native-office', // 只由受管部署注入当前业务目录与解释器，不接受用户覆盖。
    order: 60, // 与知识证据策略相邻，官方技能不覆盖业务范围。
    text: () => buildNativeOfficePolicy({
      root: businessRoot(), // 原用户业务根，工作树只改变其内部当前目录。
      python: process.env.ADMINSMART_OFFICE_PYTHON || '', // 部署指定办公解释器，不读取用户凭据或环境全文。
      persistentTerminal: selectedKnowledgeToolNames(ctx).has('terminal_open'), // 仅管理员真实已选独立终端，不放宽普通办公命令。
      worktree: selectedKnowledgeToolNames(ctx).has('create_worktree'), // 解释官方Session目录变更，不扩大文件根。
    }),
  }), 'adminsmart-agent-security: native Office environment')
}
