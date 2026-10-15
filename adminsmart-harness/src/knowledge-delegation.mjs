/** 经官方托管激活委派只读知识任务；启动回执、完成通知和生命周期完全归 Harness。 */

import { loadRuntimeModule } from './runtime.mjs'
import { bindSessionParent, isDelegatedSession } from './session-authority.mjs'
import { buildKnowledgeDelegationPolicy } from './prompts/knowledge-delegation.mjs'
import { knowledgePluginCapabilities, selectedKnowledgeTeam, selectedKnowledgeToolNames, TEAM_TOOL_NAMES } from './plugin-capabilities.mjs'

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
  'web_search', // 继承父会话实际工具范围的公开搜索。
  'web_fetch', // 继承父会话实际工具范围的公开网页读取。
  'lookup_business_registry', // 继承父会话实际工具范围的窄权限工商查询。
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
 * @returns {Promise<void>} 官方委派初始化完成后才发布业务装配成功；注册均由Cordis作用域管理。
 * @throws {Error} 官方能力缺失、父子身份无效或过滤器无法施加时失败，不降级为宽权限委派。
 * @sideEffects 注册工具、提示词和创建监听；子授权只存在内存并随生命周期释放。
 */
export async function apply(ctx) {
  ctx.effect(() => ctx.on('agent/created', ({ agent }) => {
    if (!isDelegatedSession(agent.session)) return undefined
    const resolveParent = () => trustedDelegationParent(ctx, agent) // 每次附件和权限读取都复核 live 身份，父失效后不继续使用旧授权。
    const parent = resolveParent() // 子代理第一次请求前必须验证官方创建关系。
    if (!parent) throw new Error('子会话的可信父会话不可用')
    agent.ctx.effect(() => bindSessionParent(agent.session, () => resolveParent()?.session), 'adminsmart: trusted parent Session')
    agent.ctx.effect(() => {
      let release // 当前父能力交集的官方限制，可信共享选择变化后先撤回再重新计算。
      const refresh = () => {
        release?.()
        const selected = selectedKnowledgeToolNames(ctx, { child: true }) // 管理员已选能力可继承，创建后代入口始终排除。
        const allowedTools = ctx.tools.schemas(parent).map(tool => tool.name).filter(toolName => !TEAM_TOOL_NAMES.includes(toolName) && toolName !== 'structured_output' && (READONLY_CHILD_TOOL_NAMES.includes(toolName) || selected.has(toolName))) // 官方Team/结构化工具为Agent局部注册，不能加入global restrict；其执行仍由最终Guard核验。
        release = agent.ctx.tools.restrict({ allow: allowedTools })
      } // 不注册、复制或实现任何官方工具。
      refresh()
      const observer = agent.ctx.inject?.(['adminsmartPluginCapabilities'], owner => {
        refresh()
        owner.effect(() => owner.get('adminsmartPluginCapabilities').subscribe(refresh)) // 可选Hostface迟到也可订阅，不阻塞业务主fiber初始化。
      })
      return () => { void observer?.dispose(); release?.() }
    }, 'adminsmart: parent authorized Tool intersection')
    agent.ctx.effect(() => agent.ctx.tools.guard(execution => {
      const currentParent = resolveParent() // 后续父权限、归属或生命周期变化不能被创建时快照掩盖。
      if (!currentParent) return '子会话的可信父会话不可用'
      if (execution.name === 'structured_output' && selectedKnowledgeToolNames(ctx, { child: true }).has('structured_output') && agent.ctx.tools.get(execution.name, agent)) return undefined // 官方Ralph输出约束由子运行独占，不要求父拥有相同工具。
      return ctx.tools.get(execution.name, currentParent) ? undefined : '父会话未授权调用该工具'
    }), 'adminsmart: live parent Tool visibility')
    return undefined
  }), 'adminsmart: readonly child initialization')
  let legacy // 当前普通委派的独立官方注册fiber；Team选择后整体释放，不只在UI隐藏重复工具。
  let disposed = false // 所属业务scope卸载后不创建迟到的注册。
  let synchronizing = Promise.resolve() // 仅串行装配/释放既有官方插件，不承载Agent执行或任务调度。
  const reconcile = async () => {
    if (disposed) return
    if (selectedKnowledgeTeam(ctx)) {
      const previous = legacy // 拿走旧fiber后再释放，重复选择不会二次dispose或重建。
      legacy = undefined
      await previous?.dispose()
      return
    }
    if (legacy) return
    legacy = ctx.plugin({
      name: 'adminsmart-legacy-knowledge-delegation', // 仅拥有原SDK注册的生命周期，不替换原工具实现。
      inject: ['tools', 'subagents', 'systemPrompt', 'sessionProjections'], // 正式SDK公开所需依赖，保持同Preset scope。
      async apply(owner) {
        await applyNativeSubagent(owner, {
          provider: 'spawn', // 普通知识模式保留官方fresh上下文，同模型且只允许一层。
          toolName: KNOWLEDGE_DELEGATION_TOOL_NAME, // 原生Tool与客户端协议保持官方身份。
          modelSelectionSettings: false, // 不开放模型或思考选择参数。
          maxDepth: 1, // 单层深度由官方运行时再次核验。
          // 省略独立agentPreset/allowedAgentPresets，官方继承父当前live业务组合。
        })
      },
    })
    await legacy.await()
  } // 官方Team域、tools与成员生命周期由已选Bundle自己提供。
  await reconcile()
  ctx.effect(() => {
    const changed = () => {
      synchronizing = synchronizing.then(reconcile).catch(() => { ctx.logger?.warn?.('官方委派能力装配暂不可用') }) // 失败不伪造就绪；原Guard按实时选择拒绝旧入口。
    }
    const observer = ctx.inject?.(['adminsmartPluginCapabilities'], owner => {
      changed()
      owner.effect(() => owner.get('adminsmartPluginCapabilities').subscribe(changed)) // 初值可能晚于Preset定义，独立inject只负责订阅，不等待可选Host服务。
    })
    return () => { disposed = true; void observer?.dispose() } // 子fiber由官方父scope统一释放，不在自身dispose中等待自身。
  }, 'adminsmart: official delegation selection lifecycle')
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'adminsmart:knowledge-delegation', // 独立策略，不把可执行权限依赖于模型遵循提示词。
    order: 65, // 在安全与当前权限之后解释委派选择，保留既有知识证据策略。
    text: () => buildKnowledgeDelegationPolicy({ ...knowledgePluginCapabilities(ctx), team: selectedKnowledgeTeam(ctx) }), // 当前可信能力由纯模板说明，不把正文或凭据注入策略。
  }), 'adminsmart: readonly delegation policy')
}
