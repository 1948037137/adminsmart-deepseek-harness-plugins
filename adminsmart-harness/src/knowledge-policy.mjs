/** 把集中维护的知识回答契约贡献到当前 Agent，不承担模板组装或业务查询。 */

import { KNOWLEDGE_ANSWER_POLICY } from './prompts/knowledge-answer.mjs'

export const name = 'aurasearch-knowledge-policy' // Preset 内稳定的业务策略标识。
export const inject = ['systemPrompt'] // 只依赖官方提示词注册服务，不访问存储或网络。

/**
 * 注册当前知识 Agent 的回答、来源和失败边界。
 * @param {import('@deepseek-ai/cordis').Context} ctx Preset 提供的 Agent 作用域。
 * @returns {void} 随作用域生命周期安装并释放静态段落。
 */
export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'aurasearch:knowledge-policy', // 避免重复挂载时出现同义规则叠加。
    order: 100, // 排在共享安全边界和即时能力状态之后。
    text: KNOWLEDGE_ANSWER_POLICY, // 只使用版本化静态模板，不插入不可信消息。
  }), 'aurasearch: knowledge answering policy')
}
