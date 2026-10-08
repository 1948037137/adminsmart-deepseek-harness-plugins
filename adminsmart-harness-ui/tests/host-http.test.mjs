/** 用真实本机 HTTP 验证 Host 开关与固定社区插件，不访问模型、数据库或用户文件。 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { apply as applyHost } from '../src/index.mjs'

const temporaryRoot = await mkdtemp(join(tmpdir(), 'adminsmart-host-http-')) // 全部文件与状态只属于当前隔离测试。
const runtimeRoot = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || resolve(import.meta.dirname, '../../..', 'deepseek-harness-runtime')) // 隔离版本兼容测试可覆盖安装树，用户 Runtime 不受影响。
const runtimeRequire = createRequire(join(runtimeRoot, 'package.json')) // 防止从其它项目加载不同版本的插件。
const oldHome = process.env.DSH_HOME // 测试结束恢复调用方的 Home 配置。
const oldRuntimeRoot = process.env.ADMINSMART_DSH_ROOT // 测试结束恢复调用方的运行目录配置。
const feedbackVariables = ['ADMINSMART_AGENT_API_BASE', 'ADMINSMART_AGENT_TOKEN_FILE', 'ADMINSMART_AGENT_USER_ID', 'ADMINSMART_AGENT_MODE_ID', 'ADMINSMART_AGENT_PRESET_ID', 'ADMINSMART_AGENT_IS_ADMIN'] // 反馈和管理员模型路由依赖的受管身份配置，验证结束必须恢复。
const oldFeedbackEnvironment = new Map(feedbackVariables.map(key => [key, process.env[key]])) // 当前测试之前的环境快照，不写日志或长久配置。
const capabilityPath = join(temporaryRoot, 'capability.token') // 当前隔离测试自有证明文件，绝不读取真实 Runtime 凭据。
await writeFile(capabilityPath, 'fixture-runtime-capability', 'utf8')
Object.assign(process.env, { ADMINSMART_AGENT_API_BASE: 'http://127.0.0.1:9099', ADMINSMART_AGENT_TOKEN_FILE: capabilityPath, ADMINSMART_AGENT_USER_ID: '7', ADMINSMART_AGENT_MODE_ID: 'knowledge', ADMINSMART_AGENT_PRESET_ID: 'knowledge-agent', ADMINSMART_AGENT_IS_ADMIN: '1' })
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
  plugin: () => ({ await: async () => {} }), // DirectoryPicker 无需启动原生对话框。
  workspaceRegistry: {
    create: async path => ({ title: '知识库工作区', path, attachSession: async () => {} }), // 只满足 Host 兼容工作区契约。
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
  agents: { get: () => undefined }, // 禁止附件触发真实 Agent 执行。
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

try {
  await applyHost(context)
  await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening))
  const origin = `http://127.0.0.1:${server.address().port}` // OS 分配的短期回环端口。
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
  const switchPath = '/adminsmart/sessions/web-access' // 自有 Host 公共控制路由。
  const workspaceViewPath = '/adminsmart/workspace-view' // 当前隔离 Runtime Home 的官方侧栏视图入口。
  const adminModelsPath = '/adminsmart/admin-models' // 只有管理员 Runtime 可读取的非敏感公网模型管理目录。
  const adminModels = await request(adminModelsPath)
  assert.equal(adminModels.status, 200)
  assert.equal(adminModels.body.providers[0].credentialConfigured, true)
  assert.doesNotMatch(JSON.stringify(adminModels.body), /FIXTURE_PRIVATE_KEY|fixture-secret|apiKeyEnv/u)
  const discovered = await request(`${adminModelsPath}/discover`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api: 'openai-responses', baseURL: 'https://models.example.test/v1', apiKey: 'fixture-one-shot-key' }),
  }) // 管理员显式查询只返回非敏感候选，不执行配置写入。
  assert.equal(discovered.status, 200)
  assert.deepEqual(discovered.body.models.map(model => model.id), ['fixture-new-model'])
  assert.doesNotMatch(JSON.stringify(discovered.body), /fixture-one-shot-key|apiKey/u)
  const view = { groupBy: 'flat', orderBy: 'manual', archivedFilter: 'show', groupExpansion: { fixture: true }, sessionOrderByAccount: { fixture: ['fixture-session-a'] } } // 不含会话正文的离线视图。
  assert.deepEqual(await request(workspaceViewPath), { status: 200, body: { view: null } })
  assert.deepEqual(await request(workspaceViewPath, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view }),
  }), { status: 200, body: { view } })
  assert.deepEqual(await request(workspaceViewPath), { status: 200, body: { view } })
  assert.equal((await request(workspaceViewPath, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: { ...view, groupBy: 'foreign' } }),
  })).status, 400)
  const preferencePath = '/adminsmart/model-preference' // Current Runtime user's last explicit selection across new Sessions.
  const chosen = { provider: 'gpt', model: 'fixture-gpt', reasoningEffort: 'high' } // No Key, URL or file content.
  assert.deepEqual(await request(preferencePath, { headers: { 'X-AdminSmart-Session': 'fixture-session-a' } }), { status: 200, body: { selection: null } })
  assert.equal((await request(preferencePath, {
    method: 'PUT', headers: { 'X-AdminSmart-Session': 'fixture-session-a', 'Content-Type': 'application/json' }, body: JSON.stringify({ selection: chosen }),
  })).status, 200)
  const restored = await request(preferencePath, { headers: { 'X-AdminSmart-Session': 'fixture-session-b' } })
  assert.equal(restored.body.selection.model, chosen.model)
  assert.equal(restored.body.selection.reasoningEffort, chosen.reasoningEffort)
  assert.equal((await request(preferencePath, {
    method: 'PUT', headers: { 'X-AdminSmart-Session': 'already-unloaded-session', 'Content-Type': 'application/json' }, body: JSON.stringify({ selection: chosen }),
  })).status, 200) // 用户偏好写入不能因为会话快速切换、卸载而被拒绝。
  assert.equal((await request(preferencePath, {
    method: 'PUT', headers: { 'X-AdminSmart-Session': '', 'Content-Type': 'application/json' }, body: JSON.stringify({ selection: chosen }),
  })).status, 400)
  const sessionHeader = { 'X-AdminSmart-Session': 'fixture-session-a' } // 当前请求绑定的会话身份。
  assert.deepEqual(await request(switchPath, { headers: sessionHeader }), { status: 200, body: { enabled: true } })
  for (const enabled of [false, true, false]) {
    const saved = await request(switchPath, {
      method: 'PUT',
      headers: { ...sessionHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }) // 每次写入之后再次 GET，验证不是客户端乐观修改。
    assert.deepEqual(saved, { status: 200, body: { enabled } })
    assert.equal((await request(switchPath, { headers: sessionHeader })).body.enabled, enabled)
  }
  assert.deepEqual(await request(switchPath, { headers: { 'X-AdminSmart-Session': 'unknown' } }), { status: 200, body: { enabled: true } })
  assert.equal((await request(switchPath, {
    method: 'PUT',
    headers: { 'X-AdminSmart-Session': 'unknown', 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  })).status, 400)
  process.stdout.write('host_http_switch=ok\n')
  assert.equal((await request('/adminsmart/feedback/read', { method: 'POST', body: '{}', headers: { Cookie: 'fixture-cookie' } })).status, 403)
  const feedbackResponse = await request('/adminsmart/feedback/read', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer fixture-runtime-capability' } }) // 有证明的回环只读请求，不替任何用户写反馈。
  assert.equal(feedbackResponse.status, 200)
  assert.deepEqual(feedbackResponse.body.rows, [])
  assert.doesNotMatch(JSON.stringify(feedbackResponse.body), /fixture-runtime-capability/)
  const privatePath = '/adminsmart/private-model-reasoning?providerId=gpt' // 未发布 Provider 仍能独立读取的同源路由。
  assert.deepEqual((await request(privatePath)).body.models, [{ id: 'fixture-gpt', name: 'Fixture GPT Model', reasoningEfforts: {} }])
  const invalidReasoning = await request('/adminsmart/private-model-reasoning', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId: 'gpt', modelId: 'fixture-gpt', reasoningEfforts: { ultra: 'ultra' } }),
  }) // 不支持的等级必须在调用官方编辑器前拒绝。
  assert.equal(invalidReasoning.status, 400)
  assert.equal(officialConfig.providers.gpt.models[0].reasoningEfforts, false)
  const originalFetch = globalThis.fetch // 当前测试仅替换 Host 到合成业务目录的网络边界。
  try {
    globalThis.fetch = (url, options) => String(url).startsWith('http://127.0.0.1:9099/internal/agent-model/')
      ? Promise.resolve({ ok: true, json: async () => ({ models: [] }) })
      : originalFetch(url, options)
    const saved = await request('/adminsmart/private-model-reasoning', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'gpt', modelId: 'fixture-gpt', reasoningEfforts: { off: null, high: 'high' } }),
    }) // 后端无发布目录时仍保存官方私有模型。
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.body.models[0].reasoningEfforts, { off: null, high: 'high' })
    assert.doesNotMatch(JSON.stringify(saved.body), /FIXTURE_PRIVATE_KEY|fixture-runtime-capability/u)
    globalThis.fetch = (url, options) => String(url).startsWith('http://127.0.0.1:9099/internal/agent-model/')
      ? Promise.reject(new Error('fixture backend unavailable'))
      : originalFetch(url, options)
    const degraded = await request('/adminsmart/private-model-reasoning', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'gpt', modelId: 'fixture-gpt', reasoningEfforts: {} }),
    }) // 业务目录暂不可用时必须如实报告私有保存成功和同步告警。
    assert.equal(degraded.status, 200)
    assert.match(degraded.body.warning, /已保存.*同步失败/u)
    assert.equal(officialConfig.providers.gpt.models[0].reasoningEfforts, false)
  } finally { globalThis.fetch = originalFetch }
  officialConfig.providers.gpt.models[0].reasoningEfforts = false // 首次保存的第三方模型尚无任何思考等级映射。
  context.credentials.resolve = async ref => ref === 'FIXTURE_PRIVATE_KEY' ? { value: 'fixture-secret' } : undefined // 私有 Key 只供 Host 到后端使用。
  const modelActions = [] // 当前测试范围内模型用途请求的非敏感记录。
  let defaultEffort = null // 假后端保存的单模型思考等级。
  let harnessDefault = null // 假后端保存的 Harness 新会话兜底身份。
  const managedModelRequests = [] // 捕获隔离假后端访问，退役知识动作不能触发发布、能力写入或默认用途调用。
  try {
    globalThis.fetch = (url, options) => {
      const address = String(url) // 测试只接管受管回环 API，真实本机 HTTP 请求交还 Node fetch。
      if (!address.startsWith('http://127.0.0.1:9099/internal/agent-model/')) return originalFetch(url, options)
      managedModelRequests.push({ address, method: options.method ?? 'GET' }) // 仅记录测试自建 API 地址和方法，不保存请求凭据或正文。
      if (address.endsWith('/harness-providers/gpt')) {
        assert.equal(JSON.parse(options.body).apiKey, 'fixture-secret')
        return Promise.resolve({ ok: true, json: async () => ({ providers: [] }) })
      }
      if (address.endsWith('/catalog')) return Promise.resolve({ ok: true, json: async () => ({
        revision: 7, providers: [{ id: 'agent-gpt', models: [{ id: 'fixture-gpt', defaultReasoningEffort: 'high' }] }],
      }) }) // 普通用户可读取当前目录的非敏感逐模型默认档位。
      if (address.endsWith('/model-policy')) return Promise.resolve({ ok: true, json: async () => ({
        models: [{ providerId: 'agent-gpt', harnessProviderId: 'agent-gpt', modelId: 'shared-fixture-gpt', modelName: officialConfig.providers.gpt.models[0].id, defaultReasoningEffort: defaultEffort }],
        defaultChatModelId: harnessDefault,
        defaultKnowledgeModelId: 'shared-fixture-gpt', // 旧后台响应字段不能阻止聊天能力清空，也不能恢复动态知识管理。
      }) })
      if (address.endsWith('/reasoning') && options.method === 'PUT') {
        const body = JSON.parse(options.body) // 等级更新必须来自官方模型能力，不接受浏览器捏造映射。
        modelActions.push(body)
        defaultEffort = body.defaultReasoningEffort
        return Promise.resolve({ ok: true, json: async () => ({ providers: [] }) })
      }
      if (address.endsWith('/model-default')) {
        const body = JSON.parse(options.body) // 当前动态默认入口只能维护 Harness 聊天兜底。
        modelActions.push(body)
        assert.equal(body.target, 'harness')
        harnessDefault = body.modelId
        return Promise.resolve({ ok: true, json: async () => ({ models: [] }) })
      }
      throw new Error('unexpected managed model route')
    }
    const route = '/adminsmart/model-configuration?providerId=gpt' // 用户可见配置只包含名字和能力，不返回 API Key。
    const listed = await request(route)
    assert.equal(listed.status, 200)
    for (const retiredField of ['knowledgeAvailable', 'knowledgeCompatible', 'isKnowledgeModel']) {
      assert.equal(Object.hasOwn(listed.body.models[0], retiredField), false) // 聊天目录不再投影固定知识处理的动态用途。
    }
    assert.equal(listed.body.models[0].managedPublished, true)
    assert.doesNotMatch(JSON.stringify(listed.body), /fixture-secret|FIXTURE_PRIVATE_KEY/u)
    const actionPath = '/adminsmart/model-configuration' // 管理动作只提交路由、模型 ID 和枚举。
    const put = (action, extra = {}) => request(actionPath, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'gpt', modelId: 'fixture-gpt', action, ...extra }),
    })
    for (const invalid of [['off'], ['minimal'], ['ultra'], ['low', 'low']]) {
      assert.equal((await put('efforts', { reasoningEfforts: invalid })).status, 400) // 多选入口拒绝隐藏档位、未知档位和重复项。
    }
    assert.equal((await put('efforts', { reasoningEfforts: ['low', 'high'] })).body.models[0].defaultReasoningEffort, 'low')
    assert.deepEqual(officialConfig.providers.gpt.models[0].reasoningEfforts, { low: 'low', high: 'high' })
    assert.equal((await put('efforts', { reasoningEfforts: ['high', 'max'] })).body.models[0].defaultReasoningEffort, 'high')
    assert.deepEqual(officialConfig.providers.gpt.models[0].reasoningEfforts, { high: 'high', max: 'max' }) // 取消 low 只移除这一档。
    assert.equal((await put('efforts', { reasoningEfforts: [] })).body.models[0].defaultReasoningEffort, null)
    assert.equal(officialConfig.providers.gpt.models[0].reasoningEfforts, false) // 聊天模型可清空可用档位，旧知识默认字段不能影响该动作。
    assert.equal((await put('effort', { reasoningEffort: 'invalid' })).status, 400)
    assert.equal((await put('effort', { reasoningEffort: 'high' })).status, 400)
    assert.equal((await put('effort', { reasoningEffort: 'high', wireValue: 'high' })).body.models[0].defaultReasoningEffort, 'high')
    assert.equal(officialConfig.providers.gpt.models[0].reasoningEfforts.high, 'high')
    const beforeRetiredProfile = JSON.stringify(officialConfig) // 旧页面知识动作不能修改官方 Profile 的任何能力或凭据字段。
    const beforeRetiredRequests = managedModelRequests.length // 已退役动作应在所有业务发布和写入之前拒绝。
    const beforeRetiredActions = modelActions.length // 动态默认与聊天能力写入记录必须保持不变。
    for (const [action, extra] of [['knowledge', {}], ['off-wire', { wireValue: '' }], ['off-wire', { wireValue: 'none' }], ['knowledge', { modelId: 'missing-old-model' }]]) {
      const retired = await put(action, extra) // 模拟旧管理员页面重发已退役动作，不访问真实模型。
      assert.equal(retired.status, 400)
      assert.equal(retired.body.error, 'LightRAG 知识模型已固定，不支持动态知识配置')
    }
    assert.equal(JSON.stringify(officialConfig), beforeRetiredProfile)
    assert.equal(managedModelRequests.length, beforeRetiredRequests)
    assert.equal(modelActions.length, beforeRetiredActions)

    officialConfig.providers.gpt.models[0].reasoningEfforts.high = 'vendor-high' // 聊天模型已有非同名档位保持原样。
    officialConfig.providers.gpt.models[0].reasoningEfforts.off = 'none' // 合法聊天 off 元数据不因知识动态入口退役而删除。
    assert.equal((await put('efforts', { reasoningEfforts: ['high', 'max'] })).body.models[0].defaultReasoningEffort, 'high')
    assert.deepEqual(officialConfig.providers.gpt.models[0].reasoningEfforts, { high: 'vendor-high', max: 'max', off: 'none' })
    assert.equal((await put('harness')).body.models[0].isHarnessDefault, true)
    assert.equal((await put('efforts', { reasoningEfforts: [] })).status, 200) // 明确清空聊天能力不会触及后端独立固定的 LightRAG 配置。
    assert.equal(officialConfig.providers.gpt.models[0].reasoningEfforts, false)
    assert.deepEqual(modelActions.map(action => action.target ?? action.defaultReasoningEffort), ['low', 'high', null, 'high', 'high', 'harness', null])

    officialConfig.providers.gpt.models[0].id = 'gpt-6.1-sol' // 用户保留的聊天模型不要求拥有知识关闭声明。
    officialConfig.providers.gpt.models[0].reasoningEfforts = { low: 'low', high: 'high' }
    const retainedChatDefault = await put('harness', { modelId: 'gpt-6.1-sol' }) // GPT-6.1 Sol 仍可作为聊天兜底。
    assert.equal(retainedChatDefault.status, 200)
    assert.equal(retainedChatDefault.body.models[0].isHarnessDefault, true)
    assert.deepEqual(officialConfig.providers.gpt.models[0].reasoningEfforts, { low: 'low', high: 'high' })
    officialConfig.providers.gpt.models[0].id = 'fixture-gpt' // 恢复后续管理员目录测试的合成身份。
    officialConfig.providers.gpt.models[0].reasoningEfforts = false
    officialConfig.providers.gpt.models.push({ id: 'gpt-5.2', name: 'GPT-5.2', reasoningEfforts: false }) // 官方新模型先于受管后台同步出现。
    const pendingSync = await request(route)
    assert.equal(pendingSync.body.models[1].managedPublished, false)
    assert.equal(Object.hasOwn(pendingSync.body.models[1], 'knowledgeAvailable'), false)
    officialConfig.providers.gpt.models.pop() // 测试自有模型在下一断言前恢复，不改真实 Provider。
    process.env.ADMINSMART_AGENT_IS_ADMIN = '0'
    try {
      const defaults = await request('/adminsmart/model-defaults')
      assert.deepEqual(defaults, { status: 200, body: { revision: 7, defaults: [{ provider: 'agent-gpt', model: 'fixture-gpt', effort: 'high' }] } })
      assert.doesNotMatch(JSON.stringify(defaults.body), /fixture-secret|FIXTURE_PRIVATE_KEY/u)
    } finally { process.env.ADMINSMART_AGENT_IS_ADMIN = '1' }
  } finally { globalThis.fetch = originalFetch }
  const currentAdminModels = await request(adminModelsPath) // 使用最新官方配置指纹编辑，不碰真实模型或凭据。
  const unconfirmedProfile = currentAdminModels.body.providers.find(provider => provider.routeId === 'gpt') // 当前隔离 Fixture 的管理员供应商。
  let publishedUnknownCap // 保存 Harness 可选字段后受管目录收到的真实 JSON 值。
  try {
    globalThis.fetch = (url, options) => {
      if (!String(url).startsWith('http://127.0.0.1:9099/internal/agent-model/')) return originalFetch(url, options) // 本地测试服务器请求照常完成。
      publishedUnknownCap = JSON.parse(options.body).models[0].maxOutputTokens
      return Promise.resolve({ ok: true, json: async () => ({ providers: [] }) }) // 受管发布仍只在隔离假后端完成。
    }
    const savedWithoutCap = await request(adminModelsPath, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routeId: 'gpt', fingerprint: unconfirmedProfile.fingerprint,
        displayName: unconfirmedProfile.displayName, api: unconfirmedProfile.api,
        baseURL: unconfirmedProfile.baseURL, apiKey: '',
        models: [{ ...unconfirmedProfile.models[0], maxTokens: '' }],
      }),
    }) // Harness 与业务目录均保留未知输出能力，不提交通用 fallback。
    assert.equal(savedWithoutCap.status, 200)
    assert.equal(savedWithoutCap.body.published, true)
    assert.equal(savedWithoutCap.body.providers.find(provider => provider.routeId === 'gpt').models[0].maxTokens, null)
    assert.equal(publishedUnknownCap, null)
    assert.doesNotMatch(JSON.stringify(savedWithoutCap.body), /fixture-secret|FIXTURE_PRIVATE_KEY/u)
  } finally { globalThis.fetch = originalFetch }
  const pendingAdminModels = await request(adminModelsPath) // 补齐输出能力前读取清空后的最新指纹。
  const pendingProvider = pendingAdminModels.body.providers.find(provider => provider.routeId === 'gpt') // 再次应用同一官方供应商。
  let publishedOutputCap = null // 仅记录合成后端收到的模型能力，不记录 Key。
  try {
    globalThis.fetch = (url, options) => {
      if (!String(url).startsWith('http://127.0.0.1:9099/internal/agent-model/')) return originalFetch(url, options)
      publishedOutputCap = JSON.parse(options.body).models[0].maxOutputTokens
      return Promise.resolve({ ok: true, json: async () => ({ providers: [] }) })
    }
    const confirmed = await request(adminModelsPath, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routeId: 'gpt', fingerprint: pendingProvider.fingerprint,
        displayName: pendingProvider.displayName, api: pendingProvider.api,
        baseURL: pendingProvider.baseURL, apiKey: '',
        models: [{ ...pendingProvider.models[0], maxTokens: 8192 }],
      }),
    }) // 管理员确认真实上限后，原业务发布路径恢复正常。
    assert.equal(confirmed.status, 200)
    assert.equal(confirmed.body.published, true)
    assert.equal(publishedOutputCap, 8192)
  } finally { globalThis.fetch = originalFetch }
  process.env.ADMINSMART_AGENT_IS_ADMIN = '0'
  try {
    assert.equal((await request(privatePath)).status, 403)
    assert.equal((await request('/adminsmart/model-configuration?providerId=gpt')).status, 403)
    assert.equal((await request(adminModelsPath)).status, 403)
    assert.equal((await request(adminModelsPath, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
    assert.equal((await request(adminModelsPath, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
    assert.equal((await request(`${adminModelsPath}/discover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
  }
  finally { process.env.ADMINSMART_AGENT_IS_ADMIN = '1' }
  assert.equal((await request(privatePath, { headers: { Origin: 'http://evil.example.test' } })).status, 400)
} finally {
  server.closeAllConnections()
  await new Promise(resolveClosed => server.close(resolveClosed))
  for (const pendingDisposer of disposers.reverse()) {
    const dispose = await pendingDisposer // 等待异步插件初始化完结再释放。
    if (typeof dispose === 'function') await dispose()
  }
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  if (oldRuntimeRoot === undefined) delete process.env.ADMINSMART_DSH_ROOT
  else process.env.ADMINSMART_DSH_ROOT = oldRuntimeRoot
  for (const [key, value] of oldFeedbackEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(temporaryRoot, { recursive: true, force: true })
}
