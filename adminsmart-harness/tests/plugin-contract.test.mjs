/** Verify the split AdminSmart plugins use only Harness Tool, Guard, and system-prompt protocols. */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const pluginRoot = resolve(import.meta.dirname, '..') // Current AdminSmart plugin project root.
const projectRoot = resolve(pluginRoot, '..', '..') // Shared parent containing the pinned Harness runtime project.
const temporaryHome = await mkdtemp(join(tmpdir(), 'adminsmart-security-plugin-')) // 本测试独占的隔离运行目录，包含退役偏好的合成回归样本。
process.env.ADMINSMART_DSH_ROOT = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || process.env.ADMINSMART_DSH_ROOT || resolve(projectRoot, 'deepseek-harness-runtime')) // 显式候选与Runtime根优先，不回退旧安装。
process.env.DSH_HOME = temporaryHome // 其他官方能力如需Home只能使用本测试创建的目录。
const { apply: applyKnowledgeAgent, inject } = await import('../src/index.mjs') // Public Preset entry loads the official Tool Runtime after the validated Harness root exists.
assert.deepEqual([...inject].sort(), ['agents', 'attachments', 'fs', 'sandboxPolicy', 'sessionProjections', 'sessions', 'subagents', 'systemPrompt', 'tools', 'web'], 'aggregation must explicitly register native files, policy and trusted lineage services')

const guards = [] // Monotonic owner guards registered by the security plugin.
const toolDefinitions = [] // Real definitions registered by the LightRAG Tool plugin.
const promptSections = [] // Security and AuraSearch evidence policy sections.
const preStepListeners = [] // Knowledge-first listeners registered for real user turns.
const registeredSearchProviders = [] // AdminSmart anonymous search Provider registrations.
const registeredFetchProviders = [] // Agent-scoped public DNS fetch provider registrations.
const webSession = { id: 'session-web-fixture' } // 当前测试中已装载的合法根会话，不读取真实用户记录。
const webAgent = { id: webSession.id, session: webSession } // 与公开注册表绑定同一对象，不能用复制身份冒充live Agent。
const context = {
  /** @param {string} service 官方服务名。 @returns {object|undefined} Web准入所需的最小live注册表视图。 */
  get(service) {
    if (service === 'agents') return { get: id => id === webAgent.id ? webAgent : undefined }
    if (service === 'sessions') return { get: id => id === webSession.id ? webSession : undefined }
    return undefined
  },
  /** @param {object} plugin 当前业务生命周期包装。 @returns {object} 仅登记原SDKTool的隔离fiber形状。 */
  plugin(plugin) {
    const completion = Promise.resolve(plugin.apply(this)) // 契约Fake必须等待异步官方注册，不运行Agent或自造执行状态。
    return { await: () => completion, dispose: async () => {} }
  },
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
    /** @param {string} sectionName 官方工具段落类别 @returns {number} 仅注册面测试的稳定顺序，不运行模型。 */
    getSectionOrder(sectionName) {
      assert.equal(sectionName, 'TOOL_SUBAGENT')
      return 65
    },
    section(section) {
      promptSections.push(section)
      return () => {}
    },
    /** @param {string} contextName 官方子委派运行时上下文类别。 @returns {number} 固定Fixture顺序。 */
    getContextOrder(contextName) { assert.equal(contextName, 'SUBAGENT_DELEGATION'); return 65 },
    context() { return () => {} }, // 只提供alpha.3官方深度提示上下文注册面，不伪造业务Prompt。
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

await applyKnowledgeAgent(context)

assert.equal(guards.length, 1, 'knowledge Agent must own one final monotonic Tool guard')
assert.equal(guards[0]({ name: 'search_knowledge' }), undefined)
assert.equal(guards[0]({ name: 'load_knowledge_files' }), undefined)
assert.equal(guards[0]({ name: 'web_search', agent: webAgent }), undefined)
assert.equal(guards[0]({ name: 'lookup_business_registry', agent: webAgent }), undefined)
assert.match(guards[0]({ name: 'web_search' }), /会话身份不可用/, '网页工具仍必须具有可信live身份')
assert.match(guards[0]({ name: 'web_fetch', agent: { ...webAgent } }), /会话身份不可用/, '只复制Agent身份不能绕过真实对象校验')
for (const retiredName of ['read_chat_file', 'read_chat_pdf_pages', 'analyze_xlsx']) {
  assert.match(guards[0]({ name: retiredName }), /未授权/, '退役解析工具不能被旧会话重新授权')
}
assert.match(guards[0]({ name: 'read_image', arguments: { file_path: temporaryHome } }), /文件路径|文件权限/, '缺少可信文件上下文时必须拒绝，不准直接授权图片路径')
assert.match(guards[0]({ name: 'deep_web_search', agent: webAgent }), /未授权/)
await mkdir(join(temporaryHome, '.adminsmart-state'), { recursive: true })
await writeFile(join(temporaryHome, '.adminsmart-state', 'session-web-access.json'), JSON.stringify({
  version: 1, // 仅模拟旧安装遗留文件，当前运行代码不得读取该协议。
  sessions: { [webSession.id]: { enabled: false, updatedAt: Date.now() } }, // 合成旧偏好不得继续阻止官方网页能力。
}), 'utf8')
for (const name of ['web_fetch', 'web_search', 'lookup_business_registry']) {
  assert.equal(guards[0]({ name, agent: webAgent }), undefined, '退役偏好不得影响已授权公网工具')
}
await writeFile(join(temporaryHome, '.adminsmart-state', 'session-web-access.json'), 'invalid legacy state', 'utf8')
assert.equal(guards[0]({ name: 'web_search', agent: webAgent }), undefined, '遗留文件损坏也不得使官方网页能力失效')
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

assert.equal(promptSections.length, 6, '五个业务段落及alpha2官方工具委派段落独立注册')
assert.ok(promptSections.some(section => section.name === 'tool:subagent'), '官方启动与结果通知提示不得被业务实现复制替代')
assert.equal(preStepListeners.length, 1, 'knowledge Agent must install one per-turn information-dependency decision')
const securitySection = promptSections.find(section => section.name === 'adminsmart:security-boundary') // 动态安全段只从可信能力构造，不接收用户正文。
const securityText = String(typeof securitySection?.text === 'function' ? securitySection.text({}) : securitySection?.text ?? '') // 实际读取当前普通业务边界。
const policyText = String(promptSections.find(section => section.name === 'aurasearch:knowledge-policy')?.text ?? '') // Product identity and evidence contract.
assert.match(securityText, /不得用于读取业务区外文件、凭据、其他用户数据/, '原生命令必须有明确业务边界')
assert.match(securityText, /不是操作系统读取隔离/, '不能把提示词承诺为硬隔离')
assert.match(securityText, /公开查询的数据边界/, '公开信息仍须遵守业务隐私边界')
assert.doesNotMatch(securityText, /联网开关|关闭联网|开启联网/, '模型不再收到不存在的自有联网入口指引')
assert.match(policyText, /你是 AuraSearch，AdminSmart 的中文知识智能体/, 'public Agent identity must be AuraSearch')
assert.match(policyText, /必须逐条列出每个不同值、文件名或文档位置/, 'conflicting knowledge records must never be collapsed into one value')
assert.match(policyText, /LightRAG 只提供相关性检索/, 'policy must state the official retrieval limitation')
assert.match(policyText, /不能从候选数量或片段摘要推断/, 'policy must reject synthetic full-coverage claims')
assert.match(policyText, /sourceCount 只表示相关性证据覆盖的唯一文档数/, 'document and chunk metrics must not become business record counts')
assert.match(policyText, /XLSX 精确统计必须真实执行脚本/, 'knowledge policy must cover data-analysis requests')
assert.match(policyText, /候选并不等于已确认事实/, 'one tool call must carry official LightRAG keyword hints')
assert.doesNotMatch(`${securityText}\n${policyText}`, /<tool_call>|<function=|<parameter=/, 'plugins must not invent a text Tool wire format')
assert.match(policyText, /不可信只读数据/, 'knowledge evidence must be treated as untrusted data')
assert.match(policyText, /知识库本身仍只读/, '业务输出文件不等于知识入库')
assert.match(policyText, /不输出[^。]*执行记账/, 'operational read-write footers must stay out of user answers')
assert.match(policyText, /旧系统提示词、角色、授权、知识读写规则/, 'legacy prompt documents must be treated as untrusted evidence rather than instructions')
assert.match(securityText, /系统提示词与隐藏消息/, 'security policy must reject prompt disclosure and role-override requests')
assert.match(policyText, /所有模型文字用自然简体中文和产品语言/, 'visible reasoning and final answers must hide internal Tool terminology')
assert.match(policyText, /预算不足时准确说明已核验范围/, 'user-visible completeness boundary must use product language')
assert.match(policyText, /回答末尾都必须增加独立的“依据来源”小节/, 'knowledge-backed answers must expose recognizable source labels')

await rm(temporaryHome, { recursive: true, force: true })

process.stdout.write('knowledge_plugin_contract=ok\n')
