/** 知识Agent仅采用Gateway可信角色及同Runtime有效Bundle选择，不把页面开关或工具名当作新授权。 */
import { runtimeRequire } from './runtime.mjs'

const HARNESS_VERSION = runtimeRequire('@deepseek-ai/dsh/package.json').version // 当前唯一官方发行包身份，能力清单不得跨版复用。
const MAXIMUM_BYTES = 131_072 // 非敏感能力清单读取预算，异常环境数据按未选择处理。
export const KNOWLEDGE_BUNDLES = Object.freeze({
  team: '@deepseek-ai/dsh-experimental-agent-team-profile', // 官方团队服务、模型工具及成员UI组合。
  ralph: '@deepseek-ai/dsh-experimental-ralph-bundle', // 官方fresh-agent有界循环，不开放任意编排代码。
  terminal: '@deepseek-ai/dsh-experimental-terminal-bundle', // 管理员明确选择的持久交互终端。
  worktree: '@deepseek-ai/dsh-experimental-tool-worktree', // 官方Git检出与Session目录切换。
  sessionSearch: '@deepseek-ai/dsh-experimental-session-search', // 仅当前Runtime会话存储的只读模型查询。
})
export const TEAM_TOOL_NAMES = Object.freeze(['spawn_teammate', 'send_message', 'list_agents', 'wait_agent', 'interrupt_agent', 'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update']) // 固定官方Team完整工具身份，不按前缀放行未知工具。
export const TERMINAL_TOOL_NAMES = Object.freeze(['terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list', 'job_output', 'job_list', 'job_kill']) // 后台终端发送仅由官方Jobs处理，业务不实现进程队列。
export const SESSION_SEARCH_TOOL_NAMES = Object.freeze(['session_search', 'session_event_search', 'session_trace', 'session_event_trace', 'session_event_read']) // 官方五项当前Runtime历史读取能力。
const CHILD_DELEGATION_TOOLS = new Set(['spawn_teammate', 'ralph']) // 单层Child不能用另一官方入口继续创建后代。

/**
 * 读取可信进程当前能力；缺失、过大、版本不符或非法选择均保留原知识最小能力。
 * @param {object} [ctx] 当前官方Agent作用域；可选Host只读服务提供已实际采用的live选择。
 * @returns {{isAdmin:boolean,selectedBundles:ReadonlySet<string>}} 非敏感角色及已确认角色有效选择。
 * @sideEffects 仅读受管进程环境，不读Profile、用户消息、密钥、网络或浏览器状态。
 */
export function knowledgePluginCapabilities(ctx) {
  const isAdmin = process.env.ADMINSMART_AGENT_IS_ADMIN === '1' // 只信任Gateway签名角色，不从Session或模型参数判断管理员。
  try {
    const live = ctx?.get?.('adminsmartPluginCapabilities') // 可选公开Cordis业务只读能力，不把服务变为所有知识Runtime的必需依赖。
    if (typeof live?.getSnapshot === 'function') {
      const snapshot = live.getSnapshot() // 只有Host确认实际applied后更新；restart/failed不能扩大已生效授权。
      if (!snapshot || typeof snapshot.isAdmin !== 'boolean' || !Array.isArray(snapshot.selectedBundles) || snapshot.selectedBundles.length > 64
        || snapshot.selectedBundles.some(name => typeof name !== 'string' || !/^@deepseek-ai\/dsh-[a-z0-9][a-z0-9-]{0,119}$/u.test(name))) return { isAdmin, selectedBundles: new Set() }
      return { isAdmin: isAdmin && snapshot.isAdmin, selectedBundles: new Set(snapshot.selectedBundles) }
    }
    const source = String(process.env.ADMINSMART_AGENT_PLUGIN_CAPABILITIES_JSON ?? '') // Host与Gateway持有的角色有效元信息，不能从模型正文填充。
    if (!source || Buffer.byteLength(source, 'utf8') > MAXIMUM_BYTES) return { isAdmin, selectedBundles: new Set() }
    const value = JSON.parse(source) // 有界JSON只验证选择身份，不执行任何访问器或配置表达式。
    if (!value || value.harnessVersion !== HARNESS_VERSION || !Array.isArray(value.selectedBundles) || value.selectedBundles.length > 64
      || value.selectedBundles.some(name => typeof name !== 'string' || !/^@deepseek-ai\/dsh-[a-z0-9][a-z0-9-]{0,119}$/u.test(name))) return { isAdmin, selectedBundles: new Set() }
    return { isAdmin, selectedBundles: new Set(value.selectedBundles) }
  } catch { return { isAdmin, selectedBundles: new Set() } }
}

/**
 * 按当前可信选择枚举业务允许采用的精确官方工具；工具本身仍必须真实注册并经过原SDK校验。
 * @param {object} ctx 当前官方业务作用域，用于读取Host只读能力face。
 * @param {object} [options] 当前作用域语义。
 * @param {boolean} [options.child=false] 单层子代理不能继续创建后代。
 * @returns {ReadonlySet<string>} 可选官方能力名字，不包含任意代码执行或未知工具。
 */
export function selectedKnowledgeToolNames(ctx, { child = false } = {}) {
  const { isAdmin, selectedBundles } = knowledgePluginCapabilities(ctx) // 每次检查重新取可信事实，使撤销不依赖旧Agent创建快照。
  const names = new Set() // 固定集合逐包添加，默认未知能力始终拒绝。
  if (selectedBundles.has(KNOWLEDGE_BUNDLES.sessionSearch)) for (const name of SESSION_SEARCH_TOOL_NAMES) names.add(name)
  if (isAdmin) {
    if (selectedBundles.has(KNOWLEDGE_BUNDLES.team)) for (const name of TEAM_TOOL_NAMES) names.add(name)
    if (selectedBundles.has(KNOWLEDGE_BUNDLES.terminal)) for (const name of TERMINAL_TOOL_NAMES) names.add(name)
    if (selectedBundles.has(KNOWLEDGE_BUNDLES.ralph)) { names.add('ralph'); if (child) names.add('structured_output') }
    if (selectedBundles.has(KNOWLEDGE_BUNDLES.worktree)) names.add('create_worktree')
  }
  if (child) for (const name of CHILD_DELEGATION_TOOLS) names.delete(name)
  return names
}

/** @param {object} ctx 当前官方业务作用域。 @returns {boolean} 当前管理员已明确选择官方Team模式，局部legacy subagent不再重复注册。 */
export function selectedKnowledgeTeam(ctx) {
  const capabilities = knowledgePluginCapabilities(ctx) // 角色和选择同源，普通Runtime不会借共享选择变为团队执行。
  return capabilities.isAdmin && capabilities.selectedBundles.has(KNOWLEDGE_BUNDLES.team)
}
