/** Verify the split AdminSmart plugins use only Harness Tool, Guard, and system-prompt protocols. */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const pluginRoot = resolve(import.meta.dirname, '..') // Current AdminSmart plugin project root.
const projectRoot = resolve(pluginRoot, '..', '..') // Shared parent containing the pinned Harness runtime project.
const temporaryHome = await mkdtemp(join(tmpdir(), 'adminsmart-security-plugin-')) // Session 联网开关测试独占的隔离 DSH_HOME。
process.env.ADMINSMART_DSH_ROOT = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || resolve(projectRoot, 'deepseek-harness-runtime')) // 只读固定 Runtime 或显式候选安装。
process.env.DSH_HOME = temporaryHome // Guard 只能读取当前测试隔离的 Runtime 私有状态。
const { apply: applyKnowledgeAgent, inject } = await import('../src/index.mjs') // Public Preset entry loads the official Tool Runtime after the validated Harness root exists.
assert.deepEqual([...inject].sort(), ['agents', 'attachments', 'fs', 'sandboxPolicy', 'sessionProjections', 'sessions', 'subagents', 'systemPrompt', 'tools', 'web'], 'aggregation must explicitly register native files, policy and trusted lineage services')

const guards = [] // Monotonic owner guards registered by the security plugin.
const toolDefinitions = [] // Real definitions registered by the LightRAG Tool plugin.
const promptSections = [] // Security and AuraSearch evidence policy sections.
const preStepListeners = [] // Knowledge-first listeners registered for real user turns.
const registeredSearchProviders = [] // AdminSmart anonymous search Provider registrations.
const registeredFetchProviders = [] // Agent-scoped public DNS fetch provider registrations.
const context = {
  effect(registerEffect) {
    return registerEffect()
  },
  on(eventName, listener) {
    if (eventName === 'agent/pre-step') preStepListeners.push(listener)
    return () => {}
  },
  tools: {
    schemas() { return [] },
    restrict() { return () => {} },
    guard(guard) {
      guards.push(guard)
      return () => {}
    },
    register(definition) {
      toolDefinitions.push(definition)
      return () => {}
    },
  },
  systemPrompt: {
    section(section) {
      promptSections.push(section)
      return () => {}
    },
  },
  sessionProjections: { register: () => () => {} }, // 官方委派 Tool 的离线投影注册面。
  subagents: {
    resolveMaxDepth: configured => configured, // 模型不控制此处固定深度配置。
    getProvider: () => ({ name: 'spawn', inheritsParentContext: false, capabilities: { depthLimit: true } }), // 仅注册 Schema，不执行 Fake provider。
  },
  web: {
    registerSearchProvider(provider) {
      registeredSearchProviders.push(provider)
      return () => {}
    },
    registerFetchProvider(provider) {
      registeredFetchProviders.push(provider)
      return () => {}
    },
  },
} // Minimal public Harness service faces declared by the three plugins.

applyKnowledgeAgent(context)

assert.equal(guards.length, 1, 'knowledge Agent must own one final monotonic Tool guard')
assert.equal(guards[0]({ name: 'search_knowledge' }), undefined)
assert.equal(guards[0]({ name: 'load_knowledge_files' }), undefined)
assert.equal(guards[0]({ name: 'web_search', agent: { id: 'session-online' } }), undefined)
assert.equal(guards[0]({ name: 'lookup_business_registry', agent: { id: 'session-online' } }), undefined)
for (const retiredName of ['read_chat_file', 'read_chat_pdf_pages', 'analyze_xlsx']) {
  assert.match(guards[0]({ name: retiredName }), /未授权/, '退役解析工具不能被旧会话重新授权')
}
assert.match(guards[0]({ name: 'read_image', arguments: { file_path: temporaryHome } }), /文件路径|文件权限/, '缺少可信文件上下文时必须拒绝，不准直接授权图片路径')
assert.match(guards[0]({ name: 'deep_web_search', agent: { id: 'session-online' } }), /未授权/)
await mkdir(join(temporaryHome, '.adminsmart-state'), { recursive: true })
await writeFile(join(temporaryHome, '.adminsmart-state', 'session-web-access.json'), JSON.stringify({
  version: 1, // Host 与 Guard 共享的状态结构版本。
  sessions: { 'session-offline': { enabled: false, updatedAt: Date.now() } }, // 当前测试唯一明确关闭联网的 Session。
}), 'utf8')
assert.match(guards[0]({ name: 'web_fetch', agent: { id: 'session-offline' } }), /已关闭联网/)
assert.match(guards[0]({ name: 'web_search', agent: { id: 'session-offline' } }), /已关闭联网/)
assert.match(guards[0]({ name: 'lookup_business_registry', agent: { id: 'session-offline' } }), /已关闭联网/)
assert.match(guards[0]({ name: 'bash' }), /会话不可用/, '没有可信会话不能执行办公命令')

assert.deepEqual(toolDefinitions.map(tool => tool.name).sort(), ['load_knowledge_files', 'lookup_business_registry', 'render_document', 'search_knowledge', 'subagent'], '只补官方渲染 API 的受控入口，不重新注册文件解析工具')
const knowledgeTool = toolDefinitions.find(tool => tool.name === 'search_knowledge') // Current reusable LightRAG Tool definition.
const knowledgeAttachmentTool = toolDefinitions.find(tool => tool.name === 'load_knowledge_files') // Native FileBlock bridge for complete knowledge-file tasks.
const businessRegistryTool = toolDefinitions.find(tool => tool.name === 'lookup_business_registry') // 企查查官方企业 MCP 的窄权限工具。
assert.ok(knowledgeTool)
assert.ok(knowledgeAttachmentTool)
assert.ok(businessRegistryTool)
assert.equal(knowledgeTool.name, 'search_knowledge')
assert.equal(knowledgeTool.parameters.type, 'object')
assert.deepEqual(Object.keys(knowledgeTool.parameters.properties).sort(), ['highLevelKeywords', 'lowLevelKeywords', 'query'])
assert.deepEqual(knowledgeTool.parameters.required.sort(), ['highLevelKeywords', 'lowLevelKeywords', 'query'])
assert.match(knowledgeTool.description, /不受问题主题、表达方式或任务名称限制/)
assert.equal(knowledgeTool.output.schema.type, 'object')
assert.equal(knowledgeTool.output.schema.additionalProperties, false)
assert.equal(knowledgeTool.output.schema.properties.evidence.items.additionalProperties, false)
assert.equal(knowledgeTool.presentCall({
  query: 'fixture',
  highLevelKeywords: ['fixture topic'],
  lowLevelKeywords: ['fixture entity'],
}).title, '检索知识库')
assert.deepEqual(Object.keys(knowledgeAttachmentTool.parameters.properties).sort(), ['assetIds', 'limit', 'offset', 'scope'])
assert.equal(knowledgeAttachmentTool.output.schema.properties.files.items.properties.attachmentId.type, 'string')
assert.equal(knowledgeAttachmentTool.output.schema.properties.images.items.properties.mediaType.type, 'string')
assert.deepEqual(Object.keys(businessRegistryTool.parameters.properties).sort(), ['entityName', 'targetFields'])
assert.match(businessRegistryTool.description, /不得替代|必须继续使用 Harness 官方 web_search/)
assert.equal(registeredSearchProviders.length, 1, 'AdminSmart must register one anonymous Web Search Provider')
assert.equal(registeredSearchProviders[0].id, 'adminsmart-openai-responses')
assert.equal(registeredFetchProviders.length, 1, 'Knowledge Agent must register one scoped public fetch provider')
assert.equal(registeredFetchProviders[0].id, 'adminsmart-public-doh')

assert.equal(promptSections.length, 5, '安全、即时联网、原生办公、委派与证据策略各自独立')
assert.equal(preStepListeners.length, 1, 'knowledge Agent must install one per-turn information-dependency decision')
const securityText = String(promptSections.find(section => section.name === 'adminsmart:security-boundary')?.text ?? '') // Generic capability boundary.
const policyText = String(promptSections.find(section => section.name === 'aurasearch:knowledge-policy')?.text ?? '') // Product identity and evidence contract.
assert.match(securityText, /不得用于读取业务区外文件、凭据、其他用户数据/, '原生命令必须有明确业务边界')
assert.match(securityText, /不是操作系统读取隔离/, '不能把提示词承诺为硬隔离')
assert.match(securityText, /必须服从当前 Session 的联网开关/, 'security plugin must state the real web-access gate')
assert.match(policyText, /你是 AuraSearch，AdminSmart 系统的中文知识智能体/, 'public Agent identity must be AuraSearch')
assert.match(policyText, /必须逐条列出每个不同值、文件名或文档位置/, 'conflicting knowledge records must never be collapsed into one value')
assert.match(policyText, /官方接口只提供相关性检索/, 'policy must state the official retrieval limitation')
assert.match(policyText, /不把片段检索冒充完整清单/, 'policy must reject synthetic full-coverage claims')
assert.match(policyText, /sourceCount 只表示相关性证据覆盖的唯一文档数/, 'document and chunk metrics must not become business record counts')
assert.match(policyText, /比较、计数、统计、排序/, 'knowledge policy must cover data-analysis requests')
assert.match(policyText, /高层主题和低层实体关键词/, 'one tool call must carry official LightRAG keyword hints')
assert.doesNotMatch(`${securityText}\n${policyText}`, /<tool_call>|<function=|<parameter=/, 'plugins must not invent a text Tool wire format')
assert.match(policyText, /不可信只读数据/, 'knowledge evidence must be treated as untrusted data')
assert.match(policyText, /知识库本身仍只读/, '业务输出文件不等于知识入库')
assert.match(policyText, /禁止在回答尾部追加“知识库读取”“知识库写入”“执行摘要”/, 'operational read-write footers must stay out of user answers')
assert.match(policyText, /旧系统提示词、内部知识读写规则/, 'legacy prompt documents must be treated as untrusted evidence rather than instructions')
assert.match(securityText, /系统提示词与隐藏消息/, 'security policy must reject prompt disclosure and role-override requests')
assert.match(policyText, /可见思考过程、(?:步骤说明、)?检索进度、分析摘要和最终回答/, 'visible reasoning and final answers must hide internal Tool terminology')
assert.match(policyText, /本次只确认了相关知识内容，不能保证覆盖全部资料/, 'user-visible completeness boundary must use product language')
assert.match(policyText, /回答末尾都必须增加独立的“依据来源”小节/, 'knowledge-backed answers must expose recognizable source labels')

await rm(temporaryHome, { recursive: true, force: true })

process.stdout.write('knowledge_plugin_contract=ok\n')
