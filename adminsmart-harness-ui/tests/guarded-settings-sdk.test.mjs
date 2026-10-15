/** 真实官方 Remote/Gateway/SettingsForms 删除前置保护；Profile、Credentials 和资格判定均隔离 Fake。 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { GENERAL_SETTINGS_NAMESPACES } from '../src/ui-policy-client.mjs'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 测试明确指定的当前官方安装，不读取用户runtime或真实密钥。

test('供应商删除错误只采用固定迁移分类，未知或恶意code不回显内部地址和密钥标记', { skip: !runtimeRoot }, async () => {
  const { providerDeletionError } = await import('../src/guarded-settings-controller.mjs') // 正式纯错误映射，不调用Provider或业务后台。
  for (const [code, expected] of [
    ['fixed_knowledge_connection_missing', /独立知识连接尚未准备好/u],
    ['fixed_knowledge_connection_migration_failed', /独立知识连接保存失败/u],
    ['fixed_knowledge_provider_ambiguous', /旧知识连接来源不能唯一确认/u],
  ]) {
    const error = providerDeletionError(code) // 只有正式固定机器分类可作为公开reason。
    assert.equal(error.code, code)
    assert.match(error.message, expected)
    assert.doesNotMatch(error.message, /https?:\/\/|sk-fixture-private|C:\\/u)
  }
  for (const code of [undefined, null, {}, 'unknown-fixture', 'https://private.example.test/sk-fixture-private?path=C:\\synthetic']) {
    const error = providerDeletionError(code) // 用户输入和上游任意错误文本一律走同一安全回退。
    assert.equal(error.code, 'provider_deletion_unconfirmed')
    assert.match(error.message, /供应商删除状态尚未确认/u)
    assert.doesNotMatch(error.message, /private\.example|sk-fixture-private|unknown-fixture|C:\\/u)
  }
})

test('官方继承Remote先拒绝默认Key/Provider删除，原生CAS/非默认删除及update深合并仍完整', { skip: !runtimeRoot }, async () => {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 所有类来自同一固定alpha.3安装。
  assert.equal(require('@deepseek-ai/dsh/package.json').version, '0.2.1-alpha.3')
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
  const { default: Registry } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-registry')).href)
  const { default: Gateway } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-gateway')).href)
  const { default: RemoteAccess } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-remote-access')).href) // 原始非Owner策略服务，不能用allallow Fake代替真实Gateway依赖。
  const { Peer } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-connection')).href) // 进程内调用也必须显式携带公开Peer身份。
  const { SettingsForms } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-settings')).href)
  const { Config } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-pi-ai')).href)
  const { remoteMethods } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-protocol')).href)
  const { installGuardedSettingsControllers } = await import('../src/guarded-settings-controller.mjs')
  const { installManagedProviderSync } = await import('../src/model-provider.mjs')
  const temporary = await mkdtemp(join(tmpdir(), 'adminsmart-native-settings-')) // 官方Settings legacy探针只看到本测试空Home。
  const ctx = new Context() // 实际服务fiber及Gateway dispatch，而非直接模拟RPC答案。
  const peer = new Peer(ctx, { principal: { kind: 'owner' } }) // 与实际管理员独立Runtime浏览器相同的HostOwner，不自动等同全站角色授权。
  let saved = { providers: {
    required: { api: 'openai-responses', baseURL: 'https://models.example.test/v1', apiKeyEnv: 'REQUIRED_FIXTURE_REF', models: [{ id: 'required-model' }] }, // 被默认用途引用的合成Provider。
    optional: { api: 'openai-responses', baseURL: 'https://models.example.test/v1', apiKeyEnv: 'OPTIONAL_FIXTURE_REF', models: [{ id: 'optional-model' }] }, // 可以正常删除的合成Provider。
  } }
  const entry = { id: 'llm-pi-ai', options: { id: 'llm-pi-ai', config: saved }, fiber: { uid: 'synthetic-entry', state: 2, runtime: { Config }, ctx, config: Config(saved) } } // Config真正解析，ConfigEditor仅替代落盘事务。
  const writes = [] // 原生资格保护失败时底层ConfigEditor不得被触达。
  const unsetRefs = [] // 只记录引用身份，不包含任何Key值。
  const checks = [] // 只读资格请求针对实际路由，不能扫其它管理员目录。
  let checkUnavailable = false // 后端资格故障必须失败关闭，Key和Profile仍完整。
  let changeDefaultAfterCheck = false // 另一个客户端在资格读取后改变共享默认用途的合成竞态。
  let rejectLockedDelete = false // 后台锁内再次验证的拒绝，必须阻止真正super.unset。
  let rejectNativeUnset = false // 原生Credentials拒绝时只补偿当前Profile，不重试Key删除。
  const backendRequests = [] // POST/DELETE顺序证明，不打印凭据请求体。
  const originalFetch = globalThis.fetch // 真实网络能力全程由本测试Fake接管。
  ctx.provide('profileContext', { home: temporary, name: 'fixture' })
  ctx.provide('loader', { await: async () => {} })
  ctx.provide('configEditor', {
    documentPath: join(temporary, 'synthetic.patch.yml'), // 不会创建或写入该路径。
    entries: () => [entry],
    configuration: () => [{ entry, inherited: {}, override: saved }], // SettingsForms自己决定deepmerge与原生Schema边界。
    async edit(_entry, change) {
      const candidate = change(saved, {}) // 使用官方SettingsForms真实change，不能自行猜merge行为。
      const parsed = Config(candidate) // Schema失败前不会记录写入。
      writes.push(true)
      saved = candidate
      entry.options.config = saved
      entry.fiber.config = parsed
    },
  })
  ctx.provide('credentials', {
    resolve: async () => ({ value: 'synthetic-key' }), // 仅供隔离发布Fake使用，不代表真实Key。
    describe: async () => ({ configured: true, writable: true }), // 当前只是合成配置状态。
    unset: async ref => { if (rejectNativeUnset) throw new Error('synthetic-native-refusal'); unsetRefs.push(ref) }, // 资格拒绝时不得执行此副作用。
    set: async () => {}, // 原始Credentials set协议仍由官方控制器负责。
  })
  ctx.provide('llm', { resolveModelInfo: async () => ({ context: { contextWindow: 128000 }, inputModalities: ['text'] }) })
  const registry = ctx.plugin(Registry)
  await registry.await()
  const { TYPERT } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-settings-controller/typert')).href) // 与Profile显式装载相同的官方严格RPC Schema，继承不改变可选参数契约。
  ctx.typert.register(TYPERT)
  const access = ctx.plugin(RemoteAccess) // Gateway实际询问原生访问服务；Owner仍会进入业务删除保护。
  await access.await()
  const gateway = ctx.plugin(Gateway)
  await gateway.await()
  const settings = ctx.plugin(SettingsForms)
  await settings.await()
  globalThis.fetch = async (_url, options) => {
    backendRequests.push(options.method)
    if (options.method === 'DELETE' && rejectLockedDelete) return { ok: false, status: 400, json: async () => ({ error: { code: 'chat_provider_in_use' } }) }
    return { ok: true, status: 200, json: async () => ({ providers: [] }) }
  }
  const syncOwner = ctx.extend() // 两个Client共用当前Host的确认映射与发布串行队列，隔离不同Host归属。
  const synchronization = installManagedProviderSync(syncOwner, { apiBase: 'http://127.0.0.1:9098', readToken: async () => 'fixture-capability', userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge' })
  await new Promise(resolve => setTimeout(resolve, 350)) // 只等待隔离去抖，确认本Host已发布的两个合成路由。
  assert.deepEqual(backendRequests, ['POST', 'POST'])
  const guard = installGuardedSettingsControllers(ctx, async route => {
    checks.push(route)
    if (route === 'required' || checkUnavailable) throw new Error('synthetic-denied')
    if (changeDefaultAfterCheck) rejectLockedDelete = true // 资格返回后模拟另一Client改变默认，actual DELETE须再次拒绝。
  }, synchronization.withDeletion)
  await guard.await()
  const invoke = (namespace, method, args) => ctx.typertGateway.invoke({ namespace, method, args, peer }) // 实际公开Gateway会反射继承Remote markers、显式Peer及参数身份。
  try {
    assert.ok(remoteMethods(ctx.settingsController).some(method => method.method === 'mutate'))
    assert.ok(remoteMethods(ctx.credentialsController).some(method => method.method === 'unset'))
    const described = await invoke('settings', 'describe', {}) // 管理员Models的合法原生读不能因RemoteAccess装配被误锁。
    assert.equal(described.writable, true)
    const models = described.namespaces.find(row => row.ns === 'llm-pi-ai') // 来自真实SettingsForms的当前Provider描述，不读取Key值。
    assert.deepEqual(Object.keys(models.value.providers), ['required', 'optional'])
    assert.equal(models.value.providers.required.models[0].id, 'required-model')
    await assert.rejects(invoke('credentials', 'unset', { ref: 'REQUIRED_FIXTURE_REF' }), error => error.code === 'credential/rejected')
    assert.equal(unsetRefs.length, 0)
    await assert.rejects(invoke('settings', 'mutate', { ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', 'required'] }], expectedRevision: undefined }), error => error.code === 'settings/rejected')
    assert.equal(writes.length, 0)
    for (const operation of [
      { op: 'set', path: ['providers'], value: {} }, // 祖先整段替换不能绕过默认保护。
      { op: 'unset', path: ['providers'] }, // 祖先unset会影响全部已有Provider。
      { op: 'set', path: ['providers', 'required'], value: null }, // Schema能把null解析为空Provider，仍须保护。
      { op: 'set', path: ['providers', 'required'], value: {} }, // 重置模型/Key引用同样不能绕过。
      { op: 'set', path: ['providers', 'required', 'models'], value: [] }, // 单独清空模型数组使原Provider失去能力。
      { op: 'unset', path: ['providers', 'required', 'models'] }, // 原生字段unset同样不能绕过用途保护。
      { op: 'unset', path: ['providers', 'required', 'models', '0'] }, // 官方公开数组路径是字符串索引，移除最后模型必须保护。
      { op: 'unset', path: ['providers', 'required', 'apiKeyEnv'] }, // 配置引用删除即使未直接调用Credentials也需要保护。
    ]) await assert.rejects(invoke('settings', 'mutate', { ns: 'llm-pi-ai', ops: [operation], expectedRevision: undefined }), error => error.code === 'settings/rejected')
    await assert.rejects(invoke('settings', 'replace', { ns: 'llm-pi-ai', section: {}, expectedRevision: undefined }), error => error.code === 'settings/rejected')
    await assert.rejects(invoke('settings', 'update', { ns: 'llm-pi-ai', patch: { providers: { required: null } }, expectedRevision: undefined }), error => error.code === 'settings/rejected')
    await assert.rejects(invoke('settings', 'update', { ns: 'llm-pi-ai', patch: { providers: { required: { models: [] } } }, expectedRevision: undefined }), error => error.code === 'settings/rejected')
    await assert.rejects(invoke('settings', 'update', { ns: 'llm-pi-ai', patch: { providers: { required: { apiKeyEnv: null } } }, expectedRevision: undefined }), error => error.code === 'settings/rejected')
    await assert.rejects(invoke('settings', 'replace', { ns: 'llm-pi-ai', section: { providers: { required: { api: 'openai-responses', models: [{ id: 'required-model' }] }, optional: saved.providers.optional } }, expectedRevision: undefined }), error => error.code === 'settings/rejected')
    const beforeEmptyMerge = checks.length // 官方 update 的空providers真实deepmerge，不应误判删除其它路由。
    await invoke('settings', 'update', { ns: 'llm-pi-ai', patch: { providers: {} }, expectedRevision: undefined })
    assert.equal(checks.length, beforeEmptyMerge)
    assert.deepEqual(Object.keys(saved.providers), ['required', 'optional'])
    const beforeOptionalMerge = checks.length // 只更新另一个Provider名称不访问默认删除资格。
    await invoke('settings', 'update', { ns: 'llm-pi-ai', patch: { providers: { optional: { displayName: 'Optional Renamed' } } }, expectedRevision: undefined })
    assert.equal(checks.length, beforeOptionalMerge)
    assert.equal(saved.providers.required.models[0].id, 'required-model')
    const beforeNormalModelEdit = checks.length // 非空模型调整与合法Key引用替换保持官方编辑能力。
    await invoke('settings', 'update', { ns: 'llm-pi-ai', patch: { providers: { required: { models: [{ id: 'required-model', contextWindow: 256000 }], apiKeyEnv: 'REPLACED_FIXTURE_REF' } } }, expectedRevision: undefined })
    assert.equal(checks.length, beforeNormalModelEdit)
    await assert.rejects(invoke('settings', 'update', { ns: 'llm-pi-ai', patch: {}, expectedRevision: -99 }), error => error.code === 'settings/conflict') // 原生CAS拒绝保持原错误语义。
    checkUnavailable = true
    await assert.rejects(invoke('credentials', 'unset', { ref: 'OPTIONAL_FIXTURE_REF' }), error => error.code === 'credential/rejected')
    assert.equal(unsetRefs.length, 0)
    checkUnavailable = false
    changeDefaultAfterCheck = true
    await assert.rejects(invoke('credentials', 'unset', { ref: 'OPTIONAL_FIXTURE_REF' }), error => error.code === 'credential/rejected')
    assert.equal(unsetRefs.length, 0)
    assert.ok(saved.providers.optional)
    changeDefaultAfterCheck = false
    rejectLockedDelete = false
    rejectNativeUnset = true
    const beforeCompensation = backendRequests.length // 真正后端撤销后super失败只能发布当前仍存在的Profile一次。
    await assert.rejects(invoke('credentials', 'unset', { ref: 'OPTIONAL_FIXTURE_REF' }), error => error.code === 'credential/rejected')
    assert.deepEqual(backendRequests.slice(beforeCompensation), ['DELETE', 'POST'])
    assert.equal(unsetRefs.length, 0)
    rejectNativeUnset = false
    await invoke('credentials', 'unset', { ref: 'OPTIONAL_FIXTURE_REF' })
    assert.deepEqual(unsetRefs, ['OPTIONAL_FIXTURE_REF'])
    await invoke('settings', 'mutate', { ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', 'optional'] }], expectedRevision: undefined })
    assert.deepEqual(Object.keys(saved.providers), ['required'])
  } finally {
    await guard.dispose(); await settings.dispose(); await gateway.dispose(); await peer.dispose(); await access.dispose(); await registry.dispose(); await ctx.fiber.dispose()
    globalThis.fetch = originalFetch
    await rm(temporary, { recursive: true, force: true }) // 只清理本测试创建的独占空Home。
  }
})

test('普通用户HostOwner只读Settings保持业务边界，Models和Credentials写入口仍未注册', { skip: !runtimeRoot }, async () => {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 原SDK身份、Schema及Remote共同锚定已安装alpha.3。
  assert.equal(require('@deepseek-ai/dsh/package.json').version, '0.2.1-alpha.3')
  const load = name => import(pathToFileURL(require.resolve(name)).href) // 包名均为本测试固定源码常量，不接受路径参数。
  const { Context } = await load('@deepseek-ai/cordis')
  const { default: Registry } = await load('@deepseek-ai/dsh-typert-registry')
  const { default: RemoteAccess } = await load('@deepseek-ai/dsh-api-remote-access')
  const { default: Gateway } = await load('@deepseek-ai/dsh-api-gateway')
  const { Peer } = await load('@deepseek-ai/dsh-client-connection')
  const { AdminSmartReadOnlySettings } = await import('../src/read-only-settings.mjs') // 与正式普通Runtime相同的业务只读控制器。
  const descriptors = [] // 只提供官方Schema解析的合成General及被禁止的模型诱饵。
  for (const ns of GENERAL_SETTINGS_NAMESPACES) {
    const module = await load('@deepseek-ai/dsh-client-' + ns) // 原始公开展示Schema，避免Fake跳过alpha.3字段变化。
    const config = module.Config(ns === 'ui-settings' ? { enabled: false } : {}) // 明确false不能被普通角色误补为默认开启。
    descriptors.push({
      ns: ns === 'ui-settings' ? 'adminsmart-shared-settings' : ns, // 普通Runtime唯一owned配置别名。
      schema: module.Config.toJSON(), // 官方序列化验证合同。
      value: Object.fromEntries(Object.entries(config).map(([field, value]) => [field, value.get()])), // 从原Volatile读取有效值。
      applies: 'live', // 官方General支持当前运行时采用。
      revision: 0, // 仅合成namespace版本。
      secrets: [], // 白名单General没有凭据值。
    })
  }
  descriptors.push({ ns: 'llm-pi-ai', value: { providers: { private: { headers: { Authorization: 'synthetic-private-canary' } } } }, schema: {}, revision: 0 }) // 未标secret的模型数据也不能泄漏给普通只读Remote。
  const ctx = new Context() // 无文件、网络、模型或生产数据的真实服务树。
  const peer = new Peer(ctx, { principal: { kind: 'owner' } }) // 普通用户独立Host仍为Owner，业务只读边界必须独立生效。
  ctx.provide('settings', { describe(options) { assert.deepEqual(options, { redactSecrets: true }); return structuredClone(descriptors) } }) // 只提供原始数据源；Remote/Gateway真实执行。
  const registry = ctx.plugin(Registry)
  await registry.await()
  const access = ctx.plugin(RemoteAccess)
  await access.await()
  const gateway = ctx.plugin(Gateway)
  await gateway.await()
  const controller = ctx.plugin(AdminSmartReadOnlySettings)
  await controller.await()
  const invoke = (namespace, method, args = {}) => ctx.typertGateway.invoke({ namespace, method, args, peer }) // 显式HostOwner不会绕过未注册业务能力。
  try {
    const result = await invoke('settings', 'describe') // 原General只读合同在完整RemoteAccess真实图中仍可用。
    assert.equal(result.writable, false)
    assert.equal(result.hasDocument, false)
    assert.equal(result.namespaces.length, 5)
    assert.equal(result.namespaces.find(row => row.ns === 'adminsmart-shared-settings').value.enabled, false)
    assert.doesNotMatch(JSON.stringify(result), /llm-pi-ai|synthetic-private-canary/u)
    for (const [namespace, method] of [['settings', 'mutate'], ['settings', 'update'], ['settings', 'prepareDocument'], ['credentials', 'set'], ['credentials', 'unset']]) {
      await assert.rejects(invoke(namespace, method), error => error.code === 'gateway/invocation-unavailable') // 拒绝来自实际无Remote声明，不靠UI隐藏或虚假拒绝Fixture。
    }
    assert.equal(ctx.get('credentialsController'), undefined)
  } finally { await ctx.fiber.dispose() }
})
