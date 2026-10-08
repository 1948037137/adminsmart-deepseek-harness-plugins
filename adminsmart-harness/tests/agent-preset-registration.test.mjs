/** Verify the official Agent Preset Loader retains the AuraSearch Tool contribution. */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pluginRoot = resolve(import.meta.dirname, '..') // Current AdminSmart Harness plugin package root.
const projectRoot = resolve(pluginRoot, '..', '..') // Shared multi-project root containing plugins and the pinned npm runtime project.
const harnessRoot = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || resolve(projectRoot, 'deepseek-harness-runtime')) // 兼容性测试可指定隔离候选安装，不替换正式共享库。
const runtimeRequire = createRequire(resolve(harnessRoot, 'package.json')) // Package resolver anchored at the exact shared npm dependency tree.
const loadRuntimeModule = async moduleName => await import(pathToFileURL(runtimeRequire.resolve(moduleName)).href) // Resolve the same built packages used by production Harness.

process.env.ADMINSMART_DSH_ROOT = harnessRoot // The plugin may read only official built Tool Runtime modules from this path.
const knowledgePlugin = await import('../src/index.mjs') // 检查真正由 Preset Loader 挂载的聚合插件依赖声明。
assert.ok(knowledgePlugin.inject.includes('attachments'), 'file tools require an explicit attachment service')
assert.ok(knowledgePlugin.inject.includes('fs'), 'native file integration uses the public filesystem')
assert.ok(knowledgePlugin.inject.includes('web'), 'anonymous search Provider must use the Harness Web capability')

const { Context } = await loadRuntimeModule('@deepseek-ai/cordis') // Official Cordis application context.
const { default: Loader } = await loadRuntimeModule('@deepseek-ai/cordis-plugin-loader') // Agent Preset composition loader.
const { default: Include } = await loadRuntimeModule('@deepseek-ai/cordis-plugin-include') // Builtin include row used by the Loader.
const { default: Group } = await loadRuntimeModule('@deepseek-ai/cordis-plugin-group') // Builtin group row available to preset compositions.
const { default: LlmRuntime } = await loadRuntimeModule('@deepseek-ai/dsh-llm') // Agent Registry dependency; no adapter or network provider is mounted.
const { default: SessionStore, SessionId } = await loadRuntimeModule('@deepseek-ai/dsh-session') // In-memory Session identity for the offline Agent.
const { default: SystemPrompt } = await loadRuntimeModule('@deepseek-ai/dsh-system-prompt') // Prompt contribution registry required by the security and policy plugins.
const { default: ToolRuntime } = await loadRuntimeModule('@deepseek-ai/dsh-tools') // Authoritative Tool registration and schema service under test.
const { default: WebRuntime } = await loadRuntimeModule('@deepseek-ai/dsh-web') // 官方 Web 服务配离线 Provider，绝不联网。
const { default: SessionProjectionRegistry } = await loadRuntimeModule('@deepseek-ai/dsh-session-projection') // Agent Registry Session projection dependency.
const { default: AgentRegistry, agentEvents } = await loadRuntimeModule('@deepseek-ai/dsh-agent') // 真实 Agent 作用域和官方请求前事件。
const TimeContext = await loadRuntimeModule('@deepseek-ai/dsh-time-context') // 固定版本官方时钟插件。
const { default: AgentLoop } = await loadRuntimeModule('@deepseek-ai/dsh-agent-loop') // Provides the production Agent scope creation path without executing a turn.
const { default: AgentPreset } = await loadRuntimeModule('@deepseek-ai/dsh-agent-preset') // Official declarative row that registers the production preset definition.
const { default: AgentPresetRegistry } = await loadRuntimeModule('@deepseek-ai/dsh-agent-preset-registry') // Official service that resolves and mounts a registered preset into an Agent scope.
const { default: SubagentRuntime } = await loadRuntimeModule('@deepseek-ai/dsh-subagent') // 原生委派依赖，测试不启动模型。
const SpawnInProcess = await loadRuntimeModule('@deepseek-ai/dsh-subagent-spawn-in-process') // stock 同进程 provider，不自行实现子代理。

const temporaryRoot = await mkdtemp(join(tmpdir(), 'aurasearch-preset-registration-')) // Isolated preset root removed after the assertion.
process.env.DSH_HOME = temporaryRoot // Guard 的状态只能来自当前测试隔离目录。
const pluginUrl = relativePath => pathToFileURL(resolve(pluginRoot, relativePath)).href // Loader-compatible absolute file URL for one repository plugin entry.
const yaml = runtimeRequire('js-yaml') // 结构化读取真实生产组合，不能用手写最小组合掩盖缺失工具。
const jsType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => {
  if (value === "process.platform !== 'win32'") return process.platform !== 'win32'
  if (value === "process.platform === 'win32'") return process.platform === 'win32'
  throw new Error('离线测试不执行任意 YAML JavaScript')
} }) // 只映射已确认的平台条件，不使用 eval。
const productionComposition = yaml.load(await readFile(
  resolve(pluginRoot, '../adminsmart-harness-platform/presets/adminsmart-knowledge/agent.cordis.yml'), 'utf8',
), { schema: yaml.DEFAULT_SCHEMA.extend([jsType]) }) // 本次验证真实 Preset 的工具挂载；不执行无关的长会话压缩。
const presetPlugins = productionComposition
  .filter(entry => entry.id !== 'compaction')
  .map(entry => ({
    ...entry,
    name: entry.id === 'adminsmart-knowledge-agent'
      ? pluginUrl('src/index.mjs')
      : pathToFileURL(runtimeRequire.resolve(entry.name)).href, // 隔离测试不运行 CLI fallback，按共享安装树解析同一官方公开入口。
  })) // 直接注册当前固定版公开 Preset 定义，避免依赖已经移除的 Preset 目录扫描。

try {
  const context = new Context() // Offline Harness service graph; no web server, model adapter, database, or external client is mounted.
  context.baseUrl = `${pathToFileURL(temporaryRoot).href}/` // Relative Loader resolution stays inside the temporary preset root.
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.builtins.group = Group
  await context.plugin(LlmRuntime)
  await context.plugin(SessionStore)
  await context.plugin(SystemPrompt, { persona: '' })
  await context.plugin(ToolRuntime)
  context.provide('fs', {}) // 文件执行在独立路径测试覆盖，本测试不得打开真实文件。
  context.provide('sandboxPolicy', { defaultMode: 'workspace-write', resolve: () => ({ mode: 'workspace-write', workspaceRoot: temporaryRoot }) })
  context.provide('shellEnv', { collect: () => ({}) })
  context.provide('shell', { sandboxMode: 'workspace-write', resolve() { throw new Error('离线装配不得执行命令') } })
  await context.plugin((await loadRuntimeModule('@deepseek-ai/dsh-skill')).default)
  context.provide('attachments', {
    async *readFileStream() { throw new Error('离线 Preset 测试禁止读取附件') }, // 只满足显式依赖，任何意外文件访问立即失败。
  })
  await context.plugin(WebRuntime, { searchProvider: 'fixture', fetchProvider: 'fixture' })
  let searchCalls = 0 // 精确统计通过最终 Guard 后抵达搜索 Provider 的次数。
  let fetchCalls = 0 // 精确统计通过最终 Guard 后抵达网页 Provider 的次数。
  context.web.registerSearchProvider({
    id: 'fixture', // 仅本测试使用的 Provider 身份。
    available: () => true, // 不做真实连通性探测。
    search: async () => {
      searchCalls += 1
      return { sources: [{ url: 'https://example.test/source', title: 'Fixture', snippet: 'offline web evidence' }], truncated: false }
    },
  })
  context.web.registerFetchProvider({
    id: 'fixture', // 与搜索种类独立的同名离线 Provider。
    available: () => true,
    fetch: async () => {
      fetchCalls += 1
      return { url: 'https://example.test/source', statusCode: 200, body: { kind: 'text', content: 'offline page' }, truncated: false }
    },
  })
  await context.plugin(AgentRegistry)
  await context.plugin(SessionProjectionRegistry)
  await context.plugin(SubagentRuntime, { maxDepth: 1, maxActiveSubagents: 2 })
  await context.plugin(SpawnInProcess, { providerName: 'spawn' })
  await context.plugin(AgentLoop, { agents: [] })
  await context.plugin(TimeContext, { timeZone: 'Asia/Shanghai', refreshIntervalMs: 0 })
  await context.plugin(AgentPresetRegistry, {
    default: 'adminsmart-knowledge', // The offline Agent resolves the same stable preset id as AuraSearch production Sessions.
  })
  await context.plugin(AgentPreset, {
    id: 'adminsmart-knowledge',
    name: 'AuraSearch Tool Registration Test',
    plugins: presetPlugins,
  })
  const agentPresetRegistry = context.get('agentPresets') // 固定版 Harness 通过公开服务查询接口访问 Preset Registry，避免依赖 Context 动态属性。
  assert.ok(agentPresetRegistry, 'Agent Preset Registry must be available before creating the offline Agent')
  const handle = await context.agents.create({
    sessionId: SessionId('offline-aurasearch-tool-registration'), // Stable non-user Session identity used only in memory.
    setup: async agentContext => void await agentPresetRegistry.mount(agentContext, 'adminsmart-knowledge'), // Official mount path that previously lost the asynchronous Tool contribution.
  })
  const toolNames = context.tools.schemas(handle.agent).map(tool => tool.name).sort() // Exact model-facing Tool surface for the mounted Agent scope.
  assert.deepEqual(toolNames, ['edit', 'load_knowledge_files', 'lookup_business_registry', 'present', 'pwsh', 'read', 'read_image', 'render_document', 'search_knowledge', 'skill', 'subagent', 'web_fetch', 'web_search', 'write'])
  const execute = (name, args) => context.tools.execute({
    callId: `fixture-${name}-${searchCalls}-${fetchCalls}`, // 只关联当前离线测试调用。
    name, // Harness 已注册工具。
    arguments: args, // 真实工具 Schema 验证这些测试参数。
    agent: handle.agent, // 真实 Preset Agent，Guard 必须在其 scope 中生效。
    signal: new AbortController().signal, // 不调用真实模型的单次工具生命周期。
  })
  assert.equal((await execute('web_fetch', { url: 'https://example.test/source' })).isError, false)
  assert.equal(searchCalls, 0)
  assert.equal(fetchCalls, 1)
  await mkdir(join(temporaryRoot, '.adminsmart-state'), { recursive: true })
  await writeFile(join(temporaryRoot, '.adminsmart-state/session-web-access.json'), JSON.stringify({
    version: 1,
    sessions: { [handle.agent.id]: { enabled: false, updatedAt: Date.now() } },
  })) // 与 UI Host 持久化同一协议，模拟用户关闭联网。
  assert.equal((await execute('web_fetch', { url: 'https://example.test/source' })).isError, true)
  assert.equal(searchCalls, 0, '关闭联网后不得调用 Harness WebSearchProvider')
  assert.equal(fetchCalls, 1, '关闭后不得再次到达网页 Provider')
  const preparation = await agentEvents(context, handle.agent).waterfall(
    'agent/pre-step',
    { agent: handle.agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal }, // 官方 pre-step 事件必须携带当前 Agent，时钟插件才能读取对应 Session 投影。
    async () => ({ kind: 'enter', messages: [] }),
  ) // 实际调用官方请求准备路径，完全不调用模型。
  const clockMessage = preparation.messages.find(message => message.source?.kind === 'time-context') // 固定版 Harness 通过 source.kind 标记模型可见的可信时间快照。
  assert.ok(clockMessage, '必须把官方时钟加入本次请求，而不是只在配置里写了插件名')
  const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()) // 隔离测试按真实系统时钟核对当日，不硬编码测试日期。
  assert.ok(clockMessage.content.some(part => part.text?.includes(shanghaiDate)))
  assert.ok(clockMessage.content.some(part => part.text?.includes('Asia/Shanghai')))
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

process.stdout.write('agent_preset_tool_registration=ok\n')
