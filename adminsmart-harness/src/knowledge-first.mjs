/** 在每个真实用户回合的首个模型步骤注入知识优先判定，不执行查询或替代模型工具调用。 */

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { KNOWLEDGE_FIRST_TURN_POLICY } from './prompts/knowledge-first-turn.mjs'

export const name = 'aurasearch-knowledge-first' // Preset 内稳定的每轮信息依赖判定插件标识。
const KNOWLEDGE_FIRST_SOURCE_KIND = `plugin:${name}` // V4 Session 使用当前插件拥有的来源种类，不再接受旧版通用 plugin 包装。

/**
 * 读取一个必需的受管 Runtime 环境变量。
 * @param {string} variableName Gateway 注入且不允许模型控制的环境变量名称。
 * @returns {string} 去除外围空白的配置值。
 * @throws {Error} 配置缺失时拒绝加载插件，但不泄露其它环境内容。
 * @sideEffects 仅读取当前进程环境。
 */
function requiredEnvironment(variableName) {
  const environmentValue = String(process.env[variableName] ?? '').trim() // 当前插件解析固定官方 npm 包所需的部署配置。
  if (!environmentValue) throw new Error('AdminSmart Harness 运行配置不完整')
  return environmentValue
}

const HARNESS_ROOT = resolve(requiredEnvironment('ADMINSMART_DSH_ROOT')) // 开发和生产共用的固定官方 Harness npm 运行项目根。
const HARNESS_REQUIRE = createRequire(pathToFileURL(resolve(HARNESS_ROOT, 'package.json'))) // 模块解析严格锚定固定安装，不回退到上游源码目录。
const LLM_MODULE_URL = pathToFileURL(HARNESS_REQUIRE.resolve('@deepseek-ai/dsh-llm')).href // 官方用户消息构造器的公开发布入口。
const { boundContextSummary, createUserMessage } = await import(LLM_MODULE_URL) // 顶层加载保证 apply 保持同步并处于 Preset 贡献窗口。
const NOTICE_SUMMARY = boundContextSummary('知识优先判定') // UI 可折叠的一行来源摘要，不暴露内部策略正文。

/**
 * 判断当前步骤是否包含用户直接提交的新输入。
 * @param {readonly import('@deepseek-ai/dsh-llm').UserMessage[]} messages 当前步骤从 Agent Inbox 认领的原始消息。
 * @returns {boolean} 至少存在一条来源为真实用户的消息时返回 true。
 * @sideEffects 无；不读取消息正文，也不修改消息对象。
 */
function hasDirectUserInput(messages) {
  return messages.some(message => message?.source?.kind === 'user')
}

/**
 * 判断当前准入结果是否已经包含本插件生成的判定消息。
 * @param {readonly import('@deepseek-ai/dsh-llm').UserMessage[]} messages 当前 waterfall 已准入的完整用户角色消息。
 * @returns {boolean} 已存在同源消息时返回 true，防止异常重复注册造成规则叠加。
 * @sideEffects 无。
 */
function hasKnowledgeFirstNotice(messages) {
  return messages.some(message => (
    message?.source?.kind === KNOWLEDGE_FIRST_SOURCE_KIND
    && message.source.form === 'notice'
  ))
}

/**
 * 构造一条只对当前模型请求生效的知识优先判定消息。
 * @returns {import('@deepseek-ai/dsh-llm').UserMessage} 带官方身份和插件来源的不可变用户角色上下文。
 * @sideEffects 由官方构造器生成新的消息 ID，不写入文件、网络或业务存储。
 */
function createKnowledgeFirstNotice() {
  return createUserMessage({
    content: [{
      type: 'text', // 当前规则只有文本，不夹带附件、路径或用户正文。
      text: KNOWLEDGE_FIRST_TURN_POLICY, // 集中维护的信息依赖与来源优先级规则。
    }],
    source: {
      kind: KNOWLEDGE_FIRST_SOURCE_KIND, // 当前插件独占的 V4 来源身份，和真实用户输入严格区分。
      form: 'notice', // 每个真实用户回合的一次性判定，不覆盖系统提示词快照。
      summary: NOTICE_SUMMARY, // 客户端只需展示稳定简短来源摘要。
    },
  })
}

/**
 * 为真实用户回合的首个模型步骤安装知识优先判定。
 * @param {import('@deepseek-ai/cordis').Context} ctx Agent Preset 提供的官方事件作用域。
 * @returns {void} 监听器由 Cordis effect 随 Agent 作用域自动释放。
 * @sideEffects 在首步准入消息末尾追加一条插件上下文；不查询知识库、不调用模型或网络。
 */
export function apply(ctx) {
  ctx.effect(() => ctx.on('agent/pre-step', async ({ messages, signal, step }, next) => {
    const decision = await next() // 先保留其它插件和 Agent Loop 已经完成的准入、拒绝与系统上下文组装。
    if (decision.kind === 'reject' || signal.aborted || step !== 1) return decision
    if (!hasDirectUserInput(messages) || hasKnowledgeFirstNotice(decision.messages)) return decision
    return {
      ...decision,
      messages: [...decision.messages, createKnowledgeFirstNotice()], // 放在本轮输入末尾提高判定可见性，但不修改原始用户消息。
    }
  }), 'aurasearch: per-turn knowledge-first decision')
}
