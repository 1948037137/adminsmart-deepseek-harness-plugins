/** 真正的官方 Preset、Agent Loop 和 in-process provider；模型流及 HTTP 全部为离线 Fake。 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.ADMINSMART_DSH_ROOT = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || resolve(import.meta.dirname, '../../../../deepseek-harness-runtime')) // 默认固定共享 RC2，也支持只读候选安装。
const { loadRuntimeModule, runtimeRequire } = await import('../../src/runtime.mjs') // 公开入口解析器及锚定同一安装树的 Loader resolver。
export const llmModule = await loadRuntimeModule('@deepseek-ai/dsh-llm') // 官方结构化流、消息身份和 Fake 基类。
export const sessionModule = await loadRuntimeModule('@deepseek-ai/dsh-session') // 真实不可变 Session 与事件验证。
export const subagentModule = await loadRuntimeModule('@deepseek-ai/dsh-subagent') // 深度、组合和生命周期均使用官方实现。
const { Context } = await loadRuntimeModule('@deepseek-ai/cordis') // 当前固定 Cordis 注册图。
const { default: Loader } = await loadRuntimeModule('@deepseek-ai/cordis-plugin-loader') // 真实 Preset 的子插件装载器。
const { default: Include } = await loadRuntimeModule('@deepseek-ai/cordis-plugin-include') // 官方内置 include 名称。
const { default: Group } = await loadRuntimeModule('@deepseek-ai/cordis-plugin-group') // 官方内置 group 名称。
const { default: SystemPrompt } = await loadRuntimeModule('@deepseek-ai/dsh-system-prompt') // 正式组装提示词并执行 scope 权限快照。
const { default: ToolRuntime } = await loadRuntimeModule('@deepseek-ai/dsh-tools') // 所有断言经过真实 Tool Schema、guard 和结果管道。
const { default: WebRuntime } = await loadRuntimeModule('@deepseek-ai/dsh-web') // 只绑定 Fake 搜索及抓取，不访问真实网页。
const { default: Projections } = await loadRuntimeModule('@deepseek-ai/dsh-session-projection') // 子会话相关官方投影。
const { default: AgentRegistry } = await loadRuntimeModule('@deepseek-ai/dsh-agent') // 验证真实 isOwnedBy，不能用手写父 ID 冒充。
const { default: AgentLoop } = await loadRuntimeModule('@deepseek-ai/dsh-agent-loop') // 并行、取消及 quiescent teardown 不由测试重写。
const { default: AgentPresets } = await loadRuntimeModule('@deepseek-ai/dsh-agent-preset-registry') // 测试官方 live Preset 继承。
const SpawnInProcess = await loadRuntimeModule('@deepseek-ai/dsh-subagent-spawn-in-process') // 官方 provider，仅在本进程使用 Fake LLM。
const { default: InputStore } = await loadRuntimeModule('@deepseek-ai/dsh-attachment-local') // 文件只由官方 Store 保存于合成目录。

/**
 * 将测试描述的工具调用转为官方原生块。
 * @param {string} name 工具的注册名称。
 * @param {object} args 合成 JSON 参数，不包含真实业务数据。
 * @param {string} id 当前测试唯一的结构化调用身份。
 * @returns {object} 官方 ToolCallBlock 形状。
 * @sideEffects 无。
 */
export function call(name, args, id = `fixture-${name}`) {
  return { type: 'tool-call', id, name, arguments: JSON.stringify(args) }
}

/**
 * 等待测试门闩，同时保留官方取消行为。
 * @param {Promise<unknown>} pending 由测试逻辑释放的门闩。
 * @param {AbortSignal} signal 官方模型执行取消信号。
 * @returns {Promise<unknown>} 门闩结果。
 * @throws {Error} 取消时立即结束，测试清理不能遗留挂起 driver。
 * @sideEffects 临时添加取消监听，返回前一定移除。
 */
export async function cancellable(pending, signal) {
  signal.throwIfAborted()
  let rejectAbort // 当前等待拥有的取消拒绝器，不能控制其它子代理。
  const aborted = new Promise((_resolve, reject) => { rejectAbort = reject }) // 不创建后台任务或定时线程。
  const onAbort = () => rejectAbort(signal.reason ?? new Error('fixture cancelled')) // 转发官方取消原因。
  signal.addEventListener('abort', onAbort, { once: true })
  try { return await Promise.race([pending, aborted]) } finally { signal.removeEventListener('abort', onAbort) }
}

/**
 * 创建隔离的真实官方执行图，默认拒绝所有 HTTP；每次测试结束完全释放。
 * @param {import('node:test').TestContext} t 当前测试生命周期。
 * @returns {Promise<object>} 官方 Context、可控 Fake 模型、事件、计数和测试操作。
 * @throws {Error} 任意意外 fetch 或不符合官方协议的注册会直接失败。
 * @sideEffects 临时设置进程环境、创建合成存储、安装 Fake；清理恢复原环境及 fetch。
 */
export async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'adminsmart-native-delegation-')) // 本测试唯一的数据与状态根。
  const originalEnvironment = { ...process.env } // 只在内存保存原环境，不输出任何已有敏感配置。
  const originalFetch = globalThis.fetch // 清理时恢复，不允许目标测试意外走真实网络。
  const context = new Context() // 真正的 Cordis 图，不启动 Gateway 或 Web Server。
  const fibers = [] // 本测试持有的插件，用逆序卸载等待所有官方 driver 结束。
  const handles = [] // 本测试创建的根 Agent；子 handle 完全由官方 provider 管理。
  const requests = [] // Fake 请求只含合成数据，可断言实际作用域与模型路由。
  const outcomes = [] // 官方 tools/result 终态，不依赖模型自述判断成功。
  const ended = [] // 官方子代理生命周期事件，检查取消及错误不会遗留运行。
  const counts = { search: 0, fetch: 0, api: 0 } // 三个独立 Fake 能力的实际到达计数。
  const state = { reply: async () => [{ type: 'text', text: 'fixture complete' }] } // 每项测试替换的固定脚本，不调用真实模型。
  let callSequence = 0 // 本测试 Tool 执行的唯一 callId 序列。
  globalThis.fetch = async () => { throw new Error('离线委派测试禁止真实网络') }
  process.env.DSH_HOME = home
  process.env.ADMINSMART_AGENT_BUSINESS_ROOT = home // 当前测试的业务根与真实 Session cwd、沙箱策略保持一致。
  process.env.ADMINSMART_AGENT_API_BASE = 'http://127.0.0.1:19099'
  process.env.ADMINSMART_AGENT_USER_ID = '42'
  process.env.ADMINSMART_AGENT_MODE_ID = 'knowledge'
  process.env.ADMINSMART_AGENT_PRESET_ID = 'adminsmart-knowledge'
  process.env.ADMINSMART_AGENT_TOKEN_FILE = join(home, 'fixture-capability')
  await writeFile(process.env.ADMINSMART_AGENT_TOKEN_FILE, 'fixture-capability-token')
  t.after(async () => {
    for (const handle of handles.reverse()) await handle.dispose()
    for (const fiber of fibers.reverse()) await fiber.dispose()
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key]
    Object.assign(process.env, originalEnvironment)
    assert.ok(home.startsWith(join(tmpdir(), 'adminsmart-native-delegation-')), '仅清理本测试创建的绝对临时目录')
    await rm(home, { recursive: true, force: true })
  })
  /** @param {object} plugin 官方模块 @param {object} config 本测试配置 @returns {Promise<void>} 保留 disposer 的注册完成状态。 */
  const mount = async (plugin, config) => { fibers.push(await context.plugin(plugin, config)) }
  await mount(Loader)
  context.loader.builtins.include = Include
  context.loader.builtins.group = Group
  await mount(llmModule.default)
  await mount(sessionModule.default)
  await mount(SystemPrompt, { personaPrefix: '' })
  await mount(ToolRuntime, { mode: 'native' })
  context.provide('fs', {}) // 本图只验证委派；原生文件路径另有独立目标测试。
  context.provide('sandboxPolicy', { defaultMode: 'workspace-write', workspaceRoot: home, overrideOf: () => undefined, resolve: () => ({ mode: 'workspace-write', workspaceRoot: home }) })
  await mount(InputStore, { dshHome: home })
  await mount(WebRuntime, { searchProvider: 'fixture', fetchProvider: 'fixture' })
  context.web.registerSearchProvider({
    id: 'fixture', // 仅离线图选择的 provider，不探测真实服务。
    available: () => true, // 固定 Fixture 状态，没有网络健康检查。
    search: async () => { counts.search += 1; return { sources: [{ url: 'https://example.test/fixture', title: 'fixture', snippet: 'synthetic evidence' }], truncated: false } }, // 实际抵达时才计数。
  })
  context.web.registerFetchProvider({
    id: 'fixture', // 抓取与搜索独立验证禁网边界。
    available: () => true, // 无外部连接。
    fetch: async () => { counts.fetch += 1; return { url: 'https://example.test/fixture', statusCode: 200, body: { kind: 'text', content: 'synthetic page' }, truncated: false } }, // 合成公开页。
  })
  await mount(AgentRegistry)
  await mount(Projections)
  await mount(AgentLoop, { agents: [], maxParallelToolCalls: 2 })
  await mount(subagentModule.default, { maxDepth: 1, maxActiveSubagents: 2 })
  await mount(SpawnInProcess, { providerName: 'spawn' })
  await mount(AgentPresets, { default: 'adminsmart-knowledge' })
  const knowledgeUrl = pathToFileURL(resolve(import.meta.dirname, '../../src/index.mjs')).href // 实际业务入口，不替换其安全或工具实现。
  const webToolUrl = pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-tool-web')).href // 测试 Loader 不从插件仓库目录另找依赖。
  const disposePreset = await context.agentPresets.register({
    id: 'adminsmart-knowledge', // 与真实 Session 的业务组合身份一致。
    name: 'offline readonly knowledge', // 仅测试可见元数据。
    plugins: [
      { id: 'knowledge', name: knowledgeUrl }, // 真实聚合插件贡献原生委派和六个业务能力。
      { id: 'web', name: webToolUrl, config: { search: true, fetch: true } }, // 官方原生 Web Tool。
    ],
  })
  fibers.push({ dispose: disposePreset })
  /** 合成模型适配器只发官方流，Agent Loop 与 Tool 调度仍是真实运行实现。 */
  class FakeAdapter extends llmModule.LlmAdapter {
    /** @param {object} options 官方请求 @returns {AsyncGenerator<object>} 固定脚本生成的结构化块与终态；异常和取消由官方规范化。 */
    async *stream(options) {
      requests.push(options)
      const response = await state.reply(options, context.agents.get(options.sessionId)) // 脚本只能使用本测试对象，不访问真实服务。
      const blocks = Array.isArray(response) ? response : response.blocks // 合成模型输出，传入官方流装配器验证。
      for (let index = 0; index < blocks.length; index += 1) {
        yield { type: 'block-start', index, blockType: blocks[index].type }
        yield { type: 'block-end', index, block: blocks[index] }
      }
      yield { type: 'finish', reason: response.reason ?? { kind: blocks.some(block => block.type === 'tool-call') ? 'tool-calls' : 'stop' } }
    }
  }
  context.llm.registerAdapter(['fixture'], new FakeAdapter())
  context.on('tools/result', (execution, result) => { outcomes.push({ execution, result }) })
  context.on('subagent/end', event => { ended.push(event) })
  return {
    context, state, requests, outcomes, ended, counts, home,
    /** @param {string} id 合成根会话身份 @returns {Promise<object>} 已挂载真实知识 Preset 的根 Agent。 */
    async parent(id = 'fixture-parent') {
      const handle = await context.agents.create({
        sessionId: sessionModule.SessionId(id), // 测试 ID 不来自用户文件或真实会话。
        agentOptions: { provider: 'fixture', model: 'fixture-model' }, // 子模型必须继承此官方父路由。
        setup: agentCtx => context.agentPresets.mount(agentCtx, 'adminsmart-knowledge').then(() => undefined), // 正式公开 Preset 入口。
      })
      handles.push(handle)
      return handle.agent
    },
    /** @param {object} agent 真实执行 Agent @param {string} name 注册工具 @param {object} args 合成参数 @param {AbortSignal} signal 协作取消 @returns {Promise<object>} 官方规范工具终态。 */
    execute(agent, name, args = {}, signal = new AbortController().signal) {
      return context.tools.execute({ callId: `fixture-call-${++callSequence}`, name, arguments: args, agent, signal })
    },
    /** @param {object} sessions 固定 Session 开关记录 @returns {Promise<void>} 只写入本测试 home 的权限文件。 */
    async webState(sessions) {
      await mkdir(join(home, '.adminsmart-state'), { recursive: true })
      await writeFile(join(home, '.adminsmart-state/session-web-access.json'), JSON.stringify({ version: 1, sessions }))
    },
  }
}
