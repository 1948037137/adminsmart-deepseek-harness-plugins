/** 经官方前台 one-shot Tool 委派只读知识任务；生命周期和并行调度完全归 Harness。 */

import { loadRuntimeModule } from './runtime.mjs'
import { bindSessionParent, isDelegatedSession } from './session-authority.mjs'
import { KNOWLEDGE_DELEGATION_POLICY } from './prompts/knowledge-delegation.mjs'

const { apply: applyNativeSubagent } = await loadRuntimeModule('@deepseek-ai/dsh-tool-subagent') // 固定官方公开入口，不复制 Tool 或 Agent Loop。

export const KNOWLEDGE_DELEGATION_TOOL_NAME = 'subagent' // 复用 Harness 原生委派名称和 UI 协议。
export const READONLY_CHILD_TOOL_NAMES = Object.freeze([
  'search_knowledge', // 当前 Runtime 可信用户的知识相关性检索。
  'load_knowledge_files', // 经能力令牌与资源归属校验加载只读知识原件。
  'read', // 官方文字读取仍由当前业务 Guard 检查路径。
  'read_image', // 官方图片读取及当前聊天模型能力检查。
  'render_document', // 同一父文件边界下的受控官方页面 API；子代理不能选择额外路径或输出目录。
  'skill', // 官方办公工作流，不加载任意服务器技能。
  'pwsh', // 办公脚本只在相同业务工作目录运行，继承部分写入沙箱。
  'bash', // 非 Windows 部署使用官方 Bash 工具。
  'web_search', // 服从父会话联网开关的公开搜索。
  'web_fetch', // 服从父会话联网开关的公开网页读取。
  'lookup_business_registry', // 服从父会话联网开关的窄权限工商查询。
]) // 不包含递归委派、控制、任务、Shell、PTC、文件系统或 model-facing 模型选择。

/**
 * 验证一层 in-process 子会话的可信父身份，持久 header 与运行时归属必须一致。
 * @param {import('@deepseek-ai/cordis').Context} ctx 当前知识 Preset 的受管 Context。
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent 当前待校验子 Agent。
 * @returns {import('@deepseek-ai/dsh-agent').Agent | undefined} 合法且仍 live 的直接父 Agent；其它情况拒绝。
 * @sideEffects 仅读取官方 live 注册表、header 和 Preset 组合，不访问会话正文或网络。
 */
export function trustedDelegationParent(ctx, agent) {
  const session = agent?.session // 工具携带的真实子会话，不由 description 或 prompt 决定。
  const header = session?.header // Harness 验证并冻结的持久父子关系。
  if (header?.origin !== 'subagent' || header.delegationDepth !== 1 || !header.parentSession || header.parentSession === session.id) return undefined
  const agents = ctx.get('agents') // 官方运行时所有权注册表，不能仅通过相同 Session ID 推断归属。
  const sessions = ctx.get('sessions') // 官方 live Session 注册表，不读取持久存储目录。
  if (agents?.get(agent.id) !== agent || sessions?.get(session.id) !== session) return undefined
  const parent = agents.get(header.parentSession) // 只解析官方 direct parent，不遍历其它用户或兄弟会话。
  if (!parent || parent.session !== sessions.get(header.parentSession) || isDelegatedSession(parent.session)
    || (parent.options?.subagentDepth ?? 0) !== 0) return undefined
  if (!agents.isOwnedBy(agent.id, parent)) return undefined
  const presets = ctx.get('agentPresets') // 固定 Runtime 的公开 live Preset 组合服务。
  const parentPreset = presets?.composedPreset(parent.ctx) // 不依赖父 header 中可能已过期的 Preset。
  if (!parentPreset || presets.composedPreset(agent.ctx) !== parentPreset) return undefined
  return parent
}

/**
 * 安装官方委派 Tool、子会话只读约束和静态业务策略。
 * @param {import('@deepseek-ai/cordis').Context} ctx 知识 Preset 贡献层；Host 必须提供官方 subagents/spawn 等依赖。
 * @returns {void} 注册均由 Cordis 作用域管理，不产生自有执行引擎或任务队列。
 * @throws {Error} 官方能力缺失、父子身份无效或过滤器无法施加时失败，不降级为宽权限委派。
 * @sideEffects 注册工具、提示词和创建监听；子授权只存在内存并随生命周期释放。
 */
export function apply(ctx) {
  ctx.effect(() => ctx.on('agent/created', ({ agent }) => {
    if (!isDelegatedSession(agent.session)) return undefined
    const resolveParent = () => trustedDelegationParent(ctx, agent) // 每次附件和权限读取都复核 live 身份，父失效后不继续使用旧授权。
    const parent = resolveParent() // 子代理第一次请求前必须验证官方创建关系。
    if (!parent) throw new Error('子会话的可信父会话不可用')
    agent.ctx.effect(() => bindSessionParent(agent.session, () => resolveParent()?.session), 'adminsmart: trusted parent Session')
    const allowedTools = ctx.tools.schemas(parent).map(tool => tool.name).filter(toolName => READONLY_CHILD_TOOL_NAMES.includes(toolName)) // 子集合只与父当前可见只读能力取交集。
    agent.ctx.effect(() => agent.ctx.tools.restrict({ allow: allowedTools }), 'adminsmart: parent readonly Tool intersection')
    agent.ctx.effect(() => agent.ctx.tools.guard(execution => {
      const currentParent = resolveParent() // 后续父权限、归属或生命周期变化不能被创建时快照掩盖。
      if (!currentParent) return '子会话的可信父会话不可用'
      return ctx.tools.get(execution.name, currentParent) ? undefined : '父会话未授权调用该工具'
    }), 'adminsmart: live parent Tool visibility')
    return undefined
  }), 'adminsmart: readonly child initialization')
  applyNativeSubagent(ctx, {
    provider: 'spawn', // 仅使用官方同进程 fresh-context provider，不开放 fork、ACP 或外部 MCP。
    toolName: KNOWLEDGE_DELEGATION_TOOL_NAME, // 原生 Tool/结果协议保留，客户端使用官方子代理视图。
    modelSelectionSettings: false, // 模型参数不出现在 Schema，强行传入也由官方 Tool 拒绝。
    enableRunInBackground: false, // 前台单次调用，官方持有取消、结果收集及 dispose。
    backgroundMode: 'one-shot', // 不装载 continuable 控制或 job 工具。
    maxDepth: 1, // 官方 provider 根据持久深度校验，重启或伪造子调用不能递归。
  })
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'adminsmart:knowledge-delegation', // 独立策略，不把可执行权限依赖于模型遵循提示词。
    order: 65, // 在安全与当前权限之后解释委派选择，保留既有知识证据策略。
    text: KNOWLEDGE_DELEGATION_POLICY, // 静态模板集中维护，没有动态用户数据或占位符。
  }), 'adminsmart: readonly delegation policy')
}
