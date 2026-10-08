/** AuraSearch knowledge business plugin composed from internal security, policy, and LightRAG capability modules. */

import { apply as applySecurity } from './security.mjs'
import { apply as applyKnowledgeFirst } from './knowledge-first.mjs'
import { apply as applyKnowledgePolicy } from './knowledge-policy.mjs'
import { apply as applyLightRagTool } from './lightrag-tool.mjs'
import { apply as applyAnySearchProvider } from './anysearch-provider.mjs'
import { apply as applyPublicWebFetchProvider } from './public-web-fetch-provider.mjs'
import { apply as applyBusinessRegistryTool } from './business-registry-tool.mjs'
import { apply as applyKnowledgeAttachments } from './knowledge-attachments.mjs'
import { apply as applyKnowledgeDelegation } from './knowledge-delegation.mjs'
import { apply as applyDocumentRender } from './document-render.mjs'

export const name = 'adminsmart-knowledge-agent'
export const inject = [
  'tools', // 显式注入当前 Agent 工具注册与执行服务。
  'systemPrompt', // 显式注入当前业务提示词贡献服务。
  'attachments', // 文件与 PDF 页面只能通过官方 AttachmentStore 读取和存储。
  'fs', // 官方文件工具和工作目录使用同一个公开文件系统。
  'sandboxPolicy', // 原生命令必须保留官方 workspace-write 状态。
  'web', // Search and fetch providers use separate official Web capability registrations.
  'subagents', // 原生前台委派使用 Host 注册的官方同进程 provider。
  'sessionProjections', // 官方子代理 Tool 的会话投影注册依赖。
  'agents', // 复核子代理真实运行时所有权，不能只相信持久父会话 ID。
  'sessions', // 父附件和联网权限只沿 live 官方 Session 关系继承。
]

/**
 * Mount every cohesive AuraSearch capability in one Agent Preset context.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Agent-scoped Cordis context supplied by the AuraSearch Preset.
 * @returns {void} All Tool, Guard, and prompt contributions are registered synchronously in the same scope layer.
 */
export function apply(ctx) {
  applyLightRagTool(ctx)
  applyAnySearchProvider(ctx)
  applyPublicWebFetchProvider(ctx)
  applyBusinessRegistryTool(ctx)
  applyKnowledgeAttachments(ctx)
  applyDocumentRender(ctx)
  applyKnowledgeDelegation(ctx)
  applySecurity(ctx)
  applyKnowledgeFirst(ctx)
  applyKnowledgePolicy(ctx)
}
