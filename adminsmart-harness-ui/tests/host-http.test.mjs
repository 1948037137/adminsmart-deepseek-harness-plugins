/** 用真实本机 HTTP 验证业务 Host 路由与退役入口，不访问模型、数据库或用户文件。 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { apply as applyHost } from '../src/index.mjs'

const temporaryRoot = await mkdtemp(join(tmpdir(), 'adminsmart-host-http-')) // 全部文件与状态只属于当前隔离测试。
const runtimeRoot = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || resolve(import.meta.dirname, '../../..', 'deepseek-harness-runtime')) // 隔离版本兼容测试可覆盖安装树，用户 Runtime 不受影响。
const runtimeRequire = createRequire(join(runtimeRoot, 'package.json')) // 防止从其它项目加载不同版本的插件。
const { Context } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/cordis')).href) // 新受管控制器仍在真实SDK子fiber中构造，HTTP传输与业务数据继续Fake。
const { default: TypertRegistry } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-typert-registry')).href) // 原控制器注册Remote所需公开协议服务，不发网络请求。
const { default: RemoteAccess } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-api-remote-access')).href) // alpha.3原Workspace/Session控制器要求真实方法级准入服务。
const workspaceContext = new Context() // 独占的Workspace/Session控制器生命周期，不复用生产根。
const oldHome = process.env.DSH_HOME // 测试结束恢复调用方的 Home 配置。
const oldRuntimeRoot = process.env.ADMINSMART_DSH_ROOT // 测试结束恢复调用方的运行目录配置。
const feedbackVariables = ['ADMINSMART_AGENT_API_BASE', 'ADMINSMART_AGENT_TOKEN_FILE', 'ADMINSMART_AGENT_USER_ID', 'ADMINSMART_AGENT_MODE_ID', 'ADMINSMART_AGENT_PRESET_ID', 'ADMINSMART_AGENT_IS_ADMIN', 'ADMINSMART_AGENT_NATIVE_BASELINE_JSON', 'ADMINSMART_AGENT_UI_POLICY_SUPPORTED'] // 受管身份与非敏感冻结基线仅供当前隔离装配，结束必须恢复。
const oldFeedbackEnvironment = new Map(feedbackVariables.map(key => [key, process.env[key]])) // 当前测试之前的环境快照，不写日志或长久配置。
const capabilityPath = join(temporaryRoot, 'capability.token') // 当前隔离测试自有证明文件，绝不读取真实 Runtime 凭据。
await writeFile(capabilityPath, 'fixture-runtime-capability', 'utf8')
Object.assign(process.env, { ADMINSMART_AGENT_API_BASE: 'http://127.0.0.1:9099', ADMINSMART_AGENT_TOKEN_FILE: capabilityPath, ADMINSMART_AGENT_USER_ID: '7', ADMINSMART_AGENT_MODE_ID: 'knowledge', ADMINSMART_AGENT_PRESET_ID: 'knowledge-agent', ADMINSMART_AGENT_IS_ADMIN: '1' })
process.env.ADMINSMART_AGENT_NATIVE_BASELINE_JSON = JSON.stringify({ subagent: { maxDepth: 1, maxActiveSubagents: 2 }, 'agent-loop': { maxParallelToolCalls: 2 } }) // 本测试冻结模板基线，未读取生产或私人 Profile。
process.env.ADMINSMART_AGENT_UI_POLICY_SUPPORTED = '1' // 完整装配旧 General 和 Native 桥，所有后端网络在下面明确替换。
process.env.DSH_HOME = temporaryRoot
process.env.ADMINSMART_DSH_ROOT = runtimeRoot
const routes = new Map() // 捕获公开 webServer.register 的真实路由处理器。
const tools = new Map() // 只收集社区附件的读取工具，不执行模型推理。
const disposers = [] // Host 与社区插件均按生命周期释放资源。
const sessionIds = new Set(['fixture-session-a', 'fixture-session-b']) // 两个隔离的模拟 Session，验证跨会话访问拒绝。
let officialConfig = {
  providers: {
    gpt: {
      displayName: 'Fixture GPT', // 保存的私有 Provider 名称，不模拟后端发布。
      api: 'openai-responses', // 官方固定版本支持的合成线协议。
      baseURL: 'https://models.example.test/v1', // 不发真实请求的合成供应商地址。
      apiKeyEnv: 'FIXTURE_PRIVATE_KEY', // 仅测试响应脱敏，不解析或写入真实凭据。
      models: [{ id: 'fixture-gpt', name: 'Fixture GPT Model', contextWindow: 128000, maxTokens: 8192, input: ['text'], reasoningEfforts: false }], // 尚未配置思考等级的合成模型。
    },
  },
} // 官方 Profile 的隔离内存快照。
const officialEntry = { options: { id: 'llm-pi-ai', config: officialConfig } } // 真实 ConfigEditor 唯一条目的简化替身。
const context = {
  logger: { warn() {} }, // 测试失败正文不能落入用户日志。
  get: key => context[key], // 新官方服务装配检查使用公开查询；真实实例在独立 SDK smoke 验证。
  provide: (name, value) => workspaceContext.provide(name, value), // 可信live能力通过正式Context服务提供方登记，不能为适配Fake而跳过运行代码。
  inject: (dependencies, callback) => workspaceContext.inject(dependencies, callback), // 使用真实Cordis依赖等待；本HTTP Fixture未装SettingsController时保持pending，不伪造bootstrap成功。
  plugin: module => {
    if (module?.name === 'adminsmart-managed-workspace') {
      const fiber = workspaceContext.plugin(module) // 完整受管factory执行真实Workspace/Session继承，不Fake其apply。
      disposers.push(() => fiber.dispose())
      return fiber
    }
    return { state: 2, await: async () => {} } // 其它Host子服务的真实装配由完整SDKassembly目标覆盖，此处专注HTTP协议。
  },
  workspaceRegistry: {
    archivedSessionIds: [], // 官方WorkspaceFeed和归档Gate的合成空集合。
    pinnedSessionIds: [], // 官方WorkspaceFeed的合成空固定集合。
    list: () => [], // 不加载真实登记，Remote首基线只消费空Fixture。
    create: async path => ({ id: 'fixture-required-workspace', title: '知识库工作区', path, attachSession: async () => {} }), // 官方恢复只作用当前测试cwd，没有磁盘工作区状态。
  },
  sessionPersistence: { list: async () => [] }, // 不加载真实会话历史。
  sessionQuery: { filterSessions: async () => [] }, // 仅返回隔离空目录，不读取用户会话。
  messageFeedback: { list: async () => ({ ok: true, value: { items: [] } }) }, // 原生空反馈服务替身，不写评级。
  configEditor: {
    entries: () => [officialEntry], // 只暴露当前管理员的内存模型目录。
    edit: async (_entry, change) => {
      officialConfig = change(officialConfig) // 执行官方可编辑 Profile 的原子候选更新。
      officialEntry.options.config = officialConfig
    },
  },
  credentials: {
    resolve: async () => { throw new Error('private reasoning must not read credentials') }, // 思考配置与 Key 完全分离。
    describe: async ref => ({ configured: ref === 'FIXTURE_PRIVATE_KEY', writable: true }), // 管理列表只能查询合成 Key 是否就绪。
  },
  settings: { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { gpt: { defaultMaxTokens: 32768 } } } }] }, // 受管共享目录继承官方有效容量。
  llm: {
    resolveModelInfo: async () => ({ context: { contextWindow: 128000 }, inputModalities: ['text'] }), // 不调用真实模型目录。
    discoverModels: async (_namespace, discovery) => {
      assert.equal(discovery.apiKey, 'fixture-one-shot-key') // 仅 Host 看见本次输入的合成凭据。
      return [{ id: 'fixture-new-model', name: 'Fixture New Model', contextWindow: 128000, maxTokens: 8192, inputModalities: ['text'] }]
    }, // 官方模型发现服务的无网络替身。
  },
  on: () => () => {}, // 当前测试不发出反馈事件，只验证路由；监听器仍按公开生命周期可释放。
  sessions: {
    get: id => sessionIds.has(id) ? { id } : undefined, // 仅实现真实 Host API，故意不提供 Client binding 方法。
    list: () => [], // 禁止引入任何真实会话。
  },
  agents: { get: () => undefined, list: () => [] }, // 禁止附件触发真实 Agent 执行，原始Controller基线为合成空Agent。
  commands: { register: () => () => {} }, // 附件命令声明不产生 UI 操作。
  tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } }, // 捕获公开工具定义。
  systemPrompt: { section: () => () => {} }, // 提示词注册不调用模型。
  webServer: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path) } }, // HTTP 测试使用同一处理器。
  effect: register => {
    const disposer = register() // 兼容 Host 同步注册与社区插件异步初始化。
    disposers.push(disposer)
    return disposer
  },
} // 测试上下文仅提供当前插件声明的公开服务。
const server = createServer((request, response) => {
  const route = routes.get(new URL(request.url, 'http://localhost').pathname) // 不解释社区附件协议或伪造其处理结果。
  if (!route) { response.writeHead(404); response.end(); return }
  Promise.resolve(route.handler(request, response)).catch(() => {
    response.writeHead(500)
    response.end()
  })
}) // 真实 node:http 自动校验请求分帧和响应终止。
const originalFetch = globalThis.fetch // 只给本测试 OS 分配的临时 HTTP origin 放行真实传输。
const unexpectedRequests = [] // 捕获意外外部访问，即使业务层转换错误也必须使测试失败。
let localOrigin = null // 服务器监听前无真实请求可放行；9099始终走隔离Fake。
globalThis.fetch = async (url, options = {}) => {
  const target = new URL(url) // 只比较精确路径，不记录任何请求凭据或正文。
  if (localOrigin && target.origin === localOrigin) return originalFetch(url, options)
  if (target.origin === 'http://127.0.0.1:9099') {
    assert.equal(options.method, 'GET')
    if (['/internal/agent-model/v1/native-policy', '/internal/agent-model/v1/ui-policy'].includes(target.pathname)) {
      return Response.json({ revision: 0, settings: null }) // 明确合法未发布策略，不播种管理员默认。
    }
    if (target.pathname === '/internal/agent-model/v1/ui-policy/events') {
      return new Response(new ReadableStream({ start(controller) { controller.close() } }), { headers: { 'content-type': 'text/event-stream' } }) // 离线空失效流，重连和卸载仍走真实生命周期。
    }
  }
  unexpectedRequests.push(target.origin + target.pathname) // 只记录不含query的地址身份，不记录header或正文。
  throw new Error('Host HTTP fixture禁止真实外部请求')
}

try {
  const registryFiber = workspaceContext.plugin(TypertRegistry) // 只提供真实Remote声明注册，不开放HTTP Gateway。
  await registryFiber.await()
  const accessFiber = workspaceContext.plugin(RemoteAccess) // 官方Owner/Peer的访问语义保留，不用全允许Fake伪造新权限服务。
  await accessFiber.await()
  for (const key of ['workspaceRegistry', 'sessionPersistence', 'sessions', 'sessionQuery', 'agents', 'llm', 'webServer']) workspaceContext.provide(key, context[key]) // 控制器复用同一合成业务状态。
  workspaceContext.provide('directoryPicker', { capability: () => ({ kind: 'native', pick: async () => null }) }) // 目录选择始终取消，不调用原生OS窗口。
  workspaceContext.provide('agentDefaultModel', { model: () => undefined, configure: async () => {} }) // 无模型调用或选择更改；真实选择保持由assembly目标验证。
  workspaceContext.provide('attachments', { imageLimits: { maxImageBytes: 1, maxImagesPerMessage: 1, maxMessageImageBytes: 1 }, listFiles: async () => [], listImages: async () => [] }) // 原始Session依赖只读取合成附件能力。
  workspaceContext.provide('fileUploads', { registerAgentResolver: () => () => {} }) // 原上传resolver注册生命周期，不启动上传或Agent。
  workspaceContext.provide('sessionProjections', { register: () => () => {}, onChanged: () => () => {} }) // HTTP不读Projection；原始完整Projection在assembly中实测。
  workspaceContext.provide('fs', {}) // 该HTTP目标不执行文件读取，真实目录只经受管canonical确认当前cwd。
  workspaceContext.provide('fileReferences', { list: async () => [] }) // 没有真实文件引用。
  workspaceContext.provide('workingDirectory', { defaultDirectory: process.cwd() }) // 原始技能目录上下文保持当前测试cwd，不读用户目录。
  workspaceContext.provide('connection', { fetch: { register: () => () => {} } }) // API文件handler只登记协议回调，本目标不调用它。
  await applyHost(context)
  await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening))
  const origin = `http://127.0.0.1:${server.address().port}` // OS 分配的短期回环端口。
  localOrigin = origin // 只放行当前临时服务，不放行其它回环业务API。
  const logoBytes = await readFile(new URL('../assets/aurasearch-logo.webp', import.meta.url)) // 与当前代码快照同一压缩品牌实体，不读真实用户图片。
  const logoRevision = createHash('sha256').update(logoBytes).digest('hex') // HTTP缓存身份必须来自实际WebP字节。
  const logoPath = '/adminsmart/assets/aurasearch-logo.webp' // 精确公共品牌路径，不提供任意文件映射。
  const logoResponse = await fetch(origin + logoPath + '?rev=' + logoRevision, { signal: AbortSignal.timeout(5000) }) // 真实回环HTTP核验MIME、实体和可信版本缓存。
  assert.equal(logoResponse.status, 200)
  assert.equal(logoResponse.headers.get('content-type'), 'image/webp')
  assert.equal(logoResponse.headers.get('content-length'), String(logoBytes.length))
  assert.equal(logoResponse.headers.get('cache-control'), 'private, max-age=31536000, immutable')
  assert.equal(logoResponse.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await logoResponse.arrayBuffer()), logoBytes)
  const logoHead = await fetch(origin + logoPath + '?rev=' + logoRevision, { method: 'HEAD', signal: AbortSignal.timeout(5000) }) // HEAD与GET同一WebP身份，不能发送图像正文。
  assert.equal(logoHead.status, 200)
  assert.equal(logoHead.headers.get('content-type'), 'image/webp')
  assert.equal(logoHead.headers.get('content-length'), String(logoBytes.length))
  assert.equal((await logoHead.arrayBuffer()).byteLength, 0)
  const unversionedLogo = await fetch(origin + logoPath, { signal: AbortSignal.timeout(5000) }) // 无版本兼容入口保持禁止缓存，发布不会永久复用旧实体。
  assert.equal(unversionedLogo.headers.get('cache-control'), 'no-store')
  await unversionedLogo.arrayBuffer()
  const invalidLogo = await fetch(origin + logoPath + '?rev=' + '0'.repeat(64), { signal: AbortSignal.timeout(5000) }) // 旧或伪造SHA不得拿到长期缓存实体。
  assert.equal(invalidLogo.status, 410)
  assert.equal(invalidLogo.headers.get('cache-control'), 'no-store')
  await invalidLogo.arrayBuffer()
  /**
   * 请求真实 HTTP 路由并确认响应在期限内结束。
   * @param {string} path 测试路由。
   * @param {object} options 请求方法、正文与协议头。
   * @returns {Promise<{status:number, body:object}>} 有限时间内的状态和 JSON。
   */
  async function request(path, options = {}) {
    const response = await fetch(origin + path, {
      ...options,
      headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', ...options.headers },
      signal: AbortSignal.timeout(5000),
    }) // 超时会使测试失败，不能把永久解析中视为通过。
    return { status: response.status, body: await response.json() }
  }
  assert.equal((await request('/adminsmart/feedback/read', { method: 'POST', body: '{}', headers: { Cookie: 'fixture-cookie' } })).status, 403)
  const feedbackResponse = await request('/adminsmart/feedback/read', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer fixture-runtime-capability' } }) // 有证明的回环只读请求，不替任何用户写反馈。
  assert.equal(feedbackResponse.status, 200)
  assert.deepEqual(feedbackResponse.body.rows, [])
  assert.doesNotMatch(JSON.stringify(feedbackResponse.body), /fixture-runtime-capability/)
  const retiredPaths = ['/adminsmart/sessions/web-access', '/adminsmart/admin-models', '/adminsmart/admin-models/discover', '/adminsmart/private-model-reasoning', '/adminsmart/model-reasoning', '/adminsmart/model-configuration', '/adminsmart/model-defaults', '/adminsmart/model-preference', '/adminsmart/workspace-view', '/adminsmart/model-policy', '/adminsmart/model-provider/publish'] // 退役能力必须停止装配，而非仅在页面隐藏；官方状态与Models保留所有权。
  for (const role of ['1', '0']) {
    process.env.ADMINSMART_AGENT_IS_ADMIN = role
    for (const path of retiredPaths) {
      assert.equal(routes.has(path), false)
      const response = await fetch(origin + path, { headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin' }, signal: AbortSignal.timeout(5000) }) // 实际隔离HTTP必须无法重新调用旧写回或默认覆盖能力。
      assert.equal(response.status, 404)
    }
  }
  process.env.ADMINSMART_AGENT_IS_ADMIN = '1'
  assert.equal(officialConfig.providers.gpt.models[0].reasoningEfforts, false) // 仅保留原始合成Profile，退役不改用户已保存能力。
  process.stdout.write('host_http_retired_routes_and_logo=ok\n')
} finally {
  server.closeAllConnections()
  await new Promise(resolveClosed => server.close(resolveClosed))
  for (const pendingDisposer of disposers.reverse()) {
    const dispose = await pendingDisposer // 等待异步插件初始化完结再释放。
    if (typeof dispose === 'function') await dispose()
  }
  await workspaceContext.fiber.dispose() // 释放真实控制器与TypertRegistry根，不能把监听器留给下个测试。
  globalThis.fetch = originalFetch // 所有Host后台循环清理完毕后恢复调用方传输。
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  if (oldRuntimeRoot === undefined) delete process.env.ADMINSMART_DSH_ROOT
  else process.env.ADMINSMART_DSH_ROOT = oldRuntimeRoot
  for (const [key, value] of oldFeedbackEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(temporaryRoot, { recursive: true, force: true })
  assert.deepEqual(unexpectedRequests, []) // 意外外部服务请求不能被业务友好错误吞掉而造成假通过。
}
