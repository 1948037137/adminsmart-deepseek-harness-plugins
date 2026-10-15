/** 固定alpha.3官方插件管理扩展目标；真实Remote/文件保存与Fake共享CAS组合，无生产、模型或网络。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 调用方明确指定的固定SDK，不读取用户Runtime或配置。
const require = createRequire(pathToFileURL(join(runtimeRoot, 'package.json'))) // 原始类和RPC声明共用同一公开安装。
const load = name => import(pathToFileURL(require.resolve(name)).href) // 只加载当前文件固定写出的官方包。
const { Context } = await load('@deepseek-ai/cordis')
const { default: Registry } = await load('@deepseek-ai/dsh-typert-registry')
const { default: Gateway } = await load('@deepseek-ai/dsh-api-gateway')
const { OPTIONAL_BUNDLES } = await load('@deepseek-ai/dsh-app-boot')
const { remoteMethods } = await load('@deepseek-ai/dsh-typert-protocol')
const { TYPERT } = await load('@deepseek-ai/dsh-plugin-manager/typert')
const { installGuardedPluginManager } = await import('../src/guarded-plugin-manager.mjs')
const { installNativePolicy } = await import('../src/native-policy-host.mjs')
const { emptyNativePolicy, isNativePolicy } = await import('../src/native-policy-client.mjs')
const MISSING_BUNDLE = '@deepseek-ai/dsh-subagent-codex' // 固定离线目录提供但当前安装缺少的官方包，不访问注册表。
const EXTRA_ROW = 'ui-deliverables' // 历史三项之外可独立切换的正式交付展示行，不关闭根主题依赖。

/** @param {unknown} error 当前Remote业务拒绝。 @returns {boolean} 官方稳定拒绝且没有泄露Fixture内部诊断。 */
function denied(error) { return error?.code === 'gateway/bad-request' && !/synthetic-private|[A-Z]:\\/u.test(error.message) }

/**
 * 创建真实SDK管理员或普通管理服务，底层Profile只写本测试空目录。
 * @param {boolean} isAdmin 合成签名角色。
 * @param {object} options 控制官方原生失败路径。
 * @param {boolean} [options.hmrFailure=false] 只提供HMR锁但不创建根Include，原SDK真实reload返回failed。
 * @returns {Promise<object>} 管理服务、Native共享CAS、原始文件与受控传输证据。
 * @sideEffects 仅测试独占Home与Profile被创建；未安装包不会运行安装器，所有网络由Fake替代。
 */
async function fixture(isAdmin, { hmrFailure = false, hmrSuccess = false, capabilityOverride, initialSettings, liveAuto = false } = {}) {
  assert.equal(require('@deepseek-ai/dsh-plugin-manager/package.json').version, '0.2.1-alpha.3')
  const temporary = await mkdtemp(join(tmpdir(), 'adminsmart-official-management-')) // 本用例独占根，禁止访问真实Home。
  const profileDir = join(temporary, 'profile') // 官方SDK原子writer唯一可写Profile。
  const homeDir = join(temporary, 'home') // 防止home overlay或凭据落到真实用户目录。
  await mkdir(profileDir)
  await mkdir(homeDir)
  const manifestPath = join(profileDir, 'package.json') // 官方Bundle选择与锁文件目标。
  const patchPath = join(profileDir, 'cordis.patch.yml') // 官方行enabled持久化目标。
  const modules = {
    'ui-deliverables': '@deepseek-ai/dsh-client-ui-deliverables', // 历史三项以外的真实官方展示能力。
    'ui-theme': '@deepseek-ai/dsh-client-ui-theme', // 基础主题在业务保护清单中，不能因官方来源关闭。
    'ui-skill': '@deepseek-ai/dsh-client-ui-skill', // 保留旧共享策略兼容目标。
    'plugin-manager': '@deepseek-ai/dsh-plugin-manager', // 原生管理保护不得因为扩大范围解除。
    'unaddressable-theme': '@deepseek-ai/dsh-client-ui-theme', // 模块相同，但所属树不是根Include，不能借包名准入。
    'nonofficial-row': '@adminsmart/synthetic-unapproved', // 非官方诱饵没有真实外部代码或包。
  }
  await writeFile(manifestPath, JSON.stringify({ name: 'synthetic-official-management', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }), 'utf8')
  await writeFile(patchPath, '- insert:\n' + Object.entries(modules).map(([id, name]) => `    - id: ${id}\n      name: '${name}'\n`).join(''), 'utf8')
  const ctx = new Context() // 真正Cordis服务归属、Remote注册与销毁。
  const entries = Object.entries(modules).map(([id, name]) => ({
    id: 'include:' + id, // 官方库存返回的真实形状Loader identity。
    options: { id, name }, // 与本Fixture的实际磁盘Patch唯一对应。
    disabled: false, // 未有共享编辑前保持合成初始状态。
    parent: { tree: { ctx: { fiber: { entry: { id: id === 'unaddressable-theme' ? 'synthetic-nested' : 'include' } } } } }, // 原SDK决定是否可由Profile patch寻址。
    fiber: { state: 2 }, // 不启动任何实际UI或执行插件，仅提供官方库存输入。
  }))
  const routes = new Map() // 本测试所有Host路由，不监听实际端口。
  const requests = [] // 只记录GET/PUT及CAS，不记录凭据或内部Header。
  const namespaceValues = { 'ui-theme': { codeFontSize: 12 }, subagent: { maxDepth: 1, maxActiveSubagents: 2 }, 'agent-loop': { maxParallelToolCalls: 2 } } // 合成公开设置现值，用于核对普通采用不会被高权限共享记录连带阻断。
  const namespaceWrites = [] // 只记录本测试受限字体/并发操作，不执行任何模型、Shell或数据库操作。
  const commits = [] // 外部管理员动作的稳定目标和布尔意图。
  let saved = { revision: 4, settings: initialSettings ?? emptyNativePolicy() } // 旧版本初始值可显式注入验证兼容，不能从真实数据库取得。
  let refuseCommit = false // 后端CAS拒绝用于证明原生局部文件未先改写。
  let parsedBodies = 0 // 普通PUT必须在读取正文前拒绝。
  let guard // Native校验闭包在真实管理器激活后绑定，首次空GET不进行管理写入。
  const defaultCapabilities = {
    harnessVersion: '0.2.1-alpha.3', // 唯一固定官方发行版能力清单。
    allowedPluginIds: Object.keys(modules), // 真实库存仍会拒绝不可寻址、非官方和官方核心保护。
    activePluginIds: Object.keys(modules), // 当前合成live行快照，仅用于可信能力信息与保护判断。
    protectedPluginIds: ['ui-theme'], // 只读基础行独立于历史三项扩大管理范围。
    selectedBundles: [], // 初始不选择任何可选Bundle，管理员显式动作逐项保存。
    availableBundles: [...OPTIONAL_BUNDLES], // 只允许真实固定发行包已安装的11个随附组合。
    protectedBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], // 基础与Web管理通道不能热停。
    blockedPluginReasons: {}, // 此测试专测SDK/持久化协议，不运行实际业务高风险能力。
    adminOnlyBundles: {}, // 该隔离用例明确模拟角色未排除的官方SDK目录，不代表生产全员权限。
    roleExcludedBundles: [], // 正式角色隔离由独立用例覆盖，不能按hostname推断。
    blockedBundleReasons: {}, // 全部Bundle只在隔离无执行Fixture中检验管理合同。
  }
  const capabilities = capabilityOverride === null ? null : { ...defaultCapabilities, ...capabilityOverride } // 仅测试可信进程能力失效/角色差异，未覆盖字段保持同一Fixture定义。
  const permissionState = { current: liveAuto ? 'auto' : 'workspace-write', writes: 0 } // 合成官方权限服务边界，不执行或改变真实会话权限。
  ctx.provide('sessions', { list: () => [{ id: 'synthetic-live-session' }] }) // 仅当前Runtime的一条合成存活会话。
  ctx.provide('permissionPresets', { current: () => permissionState.current, set() { permissionState.writes += 1; assert.fail('受管停止保护不得自行切换会话权限') } }) // 关闭保护只读官方current，不能隐式切换danger-full-access。
  ctx.provide('profileContext', {
    name: 'fixture', // 仅本测试合成Profile名称。
    dir: profileDir, // 所有官方Manifest修改均限临时目录。
    patchPath, // 原子Patch writer目标。
    home: homeDir, // 不加载用户真实home overlay。
    cwd: temporary, // 本Fixture进程层元数据，无实际工作命令。
    installAnchor: require.resolve('@deepseek-ai/dsh/package.json'), // 真正固定CLI包含全部11shipped Bundle依赖。
    startedBundles: [], // 本Fixture没有启动任何危险Bundle，只测选择及文件协议。
    overlays: [], // 无隐藏高优先级测试覆盖。
  })
  ctx.provide('loader', { entries: () => entries, await: async () => {} }) // Fake只替代库存来源，原生SDK管理和落盘完全真实。
  ctx.provide('settings', { describe: () => Object.entries(namespaceValues).map(([ns, value]) => ({ ns, value, user: {}, revision: 0 })), async mutate(ns, ops) { namespaceWrites.push({ ns, ops: structuredClone(ops) }); for (const op of ops) namespaceValues[ns][op.path[0]] = op.value } }) // 仅设置传输端Fake；插件SDK、角色校验和Native采用顺序均为正式实现。
  ctx.provide('webServer', { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }) // 不开HTTP端口。
  if (hmrFailure) ctx.provide('hmr', { runExclusive: operation => operation(), reconcileProfile: async () => { throw new Error('synthetic-private-reload-failure') } }) // 根Include缺失是原公开SDK真实reload错误，不Fake ChangeResult。
  if (hmrSuccess) ctx.provide('hmr', { runExclusive: operation => operation(), reconcileProfile: async () => ({ warnings: [], pending: [] }) }) // 仅模块装配世界Fake成功；SDK写入、结果分类及受管两行冷物化要求均真实。
  const registry = ctx.plugin(Registry) // 原RPC类型注册器。
  await registry.await()
  ctx.typert.register(TYPERT)
  const { default: RemoteAccess } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-remote-access')).href) // alpha.3实际方法级准入服务，不能用全允许Fake绕过新权限。
  const access = ctx.plugin(RemoteAccess) // 独立Hostowner经原SDK处理，普通角色管理操作仍由业务guard拒绝。
  await access.await()
  const gateway = ctx.plugin(Gateway) // 真正远程方法参数与返回协议dispatch。
  await gateway.await()
  const { Peer } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-connection')).href) // alpha.3官方连接scope，不能构造无生命周期的假owner。
  const peer = new Peer(ctx, { principal: { kind: 'owner' } }) // 每用户独占Hostowner与业务管理员角色分离，普通管理仍被guard拒绝。
  const native = await installNativePolicy(ctx, {
    apiBase: 'https://backend.example.test', // 合成固定后端，仅Fake调用。
    readToken: async () => 'synthetic-capability', // 不读取真实凭据。
    userId: 'fixture', // 合成可信租约身份。
    modeId: 'knowledge', // 固定测试业务模式。
    presetId: 'adminsmart-knowledge', // 固定合成Preset。
    isAdmin, // 普通角色不能从正文更改事实。
  }, {
    clientModuleSource: Buffer.from('export{}'), // 隔离静态纯模块字节。
    nativeBaseline: { subagent: { maxDepth: 1, maxActiveSubagents: 2 }, 'agent-loop': { maxParallelToolCalls: 2 } }, // 与合成模板现值相同，不以官方默认8/10猜测业务继承。
    watchEvents: () => () => {}, // 不连接真实SSE。
    assertSameOrigin() {}, // 只隔离同源运输检查，角色与目标验证仍执行正式实现。
    readJsonBody: async request => { parsedBodies += 1; return request.fixtureBody }, // 本测试可读JSON请求体，普通用户不能进入。
    async fetchImpl(_url, request) {
      if (request.method === 'GET') return { ok: true, status: 200, headers: { get: () => null }, json: async () => structuredClone(saved) }
      const body = JSON.parse(request.body) // 只解析本测试合成八字段/管理策略，不保留Authorization。
      requests.push({ method: request.method, expectedRevision: body.expectedRevision })
      assert.equal(request.method, 'PUT')
      if (refuseCommit || body.expectedRevision !== saved.revision) return { ok: false, status: 409 }
      assert.ok(isNativePolicy(body.settings))
      saved = { revision: saved.revision + 1, settings: structuredClone(body.settings) }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => structuredClone(saved) }
    },
  })
  await native.refresh()
  guard = installGuardedPluginManager(ctx, {
    isAdmin, // 与Native控制器相同签名角色。
    capabilities, // 仅Fixture注入；生产必须从可信环境清单取得能力，不能靠默认全放行。
    async commitPlugin(id, enabled) { commits.push({ region: 'plugins', id, enabled }); return native.commitPlugin(id, enabled) }, // 实际Native CAS先保存，再由原SDK写本地。
    async commitBundle(name, enabled) { commits.push({ region: 'bundles', id: name, enabled }); return native.commitBundle(name, enabled) }, // 完整共享选择从同一受权真源提交。
  })
  await guard.fiber.await()
  await native.setPluginApplier(guard.applyPlugins, guard.validatePolicy) // 正式SDK原生采用及真实库存校验同源接线，完整HTTP写也先校验目标。
  const invoke = (method, args = {}) => ctx.typertGateway.invoke({ namespace: 'pluginManager', method, args, peer }) // 真正公开Gateway，不直接伪造RPC回答。
  /** @param {object} body 合成Native完整PUT。 @returns {Promise<object>} 正式受管HostHTTP路由响应。 */
  const putPolicy = async body => {
    const result = { status: undefined, headers: undefined, body: undefined } // 仅本次已结束响应，不保存秘密。
    const response = { writeHead(status, headers) { result.status = status; result.headers = headers }, end(value) { result.body = value ? JSON.parse(value) : null } } // HTTP生命周期替身，产品handler真实运行。
    await routes.get('/adminsmart/native-policy').handler({ method: 'PUT', fixtureBody: body }, response)
    return result
  }
  return { ctx, guard, native, entries, commits, requests, invoke, putPolicy, manifestPath, patchPath,
    namespaceValues, namespaceWrites, permissionState, // 仅供目标断言检查公开配置采用结果及未发生隐式权限切换。
    async acceptSharedPolicy(settings) { saved = { revision: saved.revision + 1, settings: structuredClone(settings) }; await native.refresh() }, // 模拟其他管理员提交后受权GET，不通过普通用户写入口。
    policy: () => structuredClone(saved), // 本测试Fake后端只读确认副本。
    bodies: () => parsedBodies, // 验证普通角色未解析正文。
    refuse(value) { refuseCommit = value }, // 只控制合成后端409，不改变本地文件。
    async close() {
      await ctx.fiber.dispose()
      assert.equal(dirname(resolve(temporary)), resolve(tmpdir())) // 清理前核对本次独占目标绝对父目录。
      await rm(temporary, { recursive: true, force: true }) // 只删除本测试创建的空Home及合成Profile。
    },
  }
}

test('管理员历史三项之外官方可寻址行经真实共享CAS保存，SDK restart结果保留', async () => {
  const f = await fixture(true) // 无HMR的真实原生行为必须返回restart-required。
  try {
    const rows = await f.invoke('listPlugins') // 正式子类通过实际库存开放所有受准入官方行。
    assert.equal(rows.find(row => row.patchId === EXTRA_ROW)?.readOnlyReason, undefined)
    const result = await f.invoke('setPluginEnabled', { id: 'include:' + EXTRA_ROW, enabled: false })
    assert.equal(result.application, 'restart-required')
    assert.equal(result.changed, true)
    assert.equal(f.policy().revision, 5)
    assert.equal(f.policy().settings.plugins[EXTRA_ROW], false)
    assert.deepEqual(f.requests, [{ method: 'PUT', expectedRevision: 4 }])
    assert.equal(f.native.getStatus().appliedRevision, null) // 原SDK要求重启，不能用后端成功修订冒充当前Runtime采用成功。
    assert.match(await readFile(f.patchPath, 'utf8'), /disabled: true/u)
    f.refuse(true)
    const before = await readFile(f.patchPath, 'utf8') // CAS拒绝时不先改官方局部文件。
    await assert.rejects(f.invoke('setPluginEnabled', { id: 'include:ui-skill', enabled: false }), denied)
    assert.equal(await readFile(f.patchPath, 'utf8'), before)
  } finally { await f.close() }
})

test('全部11个已安装官方optional Bundle明确选择经共享CAS，未选项不自动全开', async () => {
  const f = await fixture(true) // 仅测试实际SDKManifest选择，不执行所选高风险插件。
  try {
    const bundles = await f.invoke('listBundles') // 真CLI安装锚点完整提供11个随安装可选Bundle。
    assert.equal(OPTIONAL_BUNDLES.length, 11)
    assert.deepEqual(JSON.parse(await readFile(f.manifestPath, 'utf8')).dsh.profile.bundles, [])
    for (const name of OPTIONAL_BUNDLES) {
      const row = bundles.find(row => row.name === name) // 每个候选都必须是原SDK当前正式目录中实际存在的行。
      assert.ok(row, name)
      assert.equal(row.availability, 'installation')
      assert.equal(row.readOnlyReason, undefined)
      const result = await f.invoke('setBundleEnabled', { name, enabled: true })
      assert.equal(result.application, 'restart-required', name)
      assert.equal(result.changed, true, name)
      assert.equal(f.policy().settings.bundles[name], true)
    }
    assert.equal(f.policy().revision, 4 + OPTIONAL_BUNDLES.length)
    assert.deepEqual(JSON.parse(await readFile(f.manifestPath, 'utf8')).dsh.profile.bundles, OPTIONAL_BUNDLES)
    assert.deepEqual(f.requests.map(row => row.expectedRevision), Array.from({ length: 11 }, (_, index) => 4 + index))
  } finally { await f.close() }
})

test('普通管理RPC全拒绝，HTTP完整策略在解析前拒绝，不发布全局或运行安装器', async () => {
  const f = await fixture(false) // 普通用户独立Context不能继承管理员内部采用权限。
  try {
    for (const method of ['listPlugins', 'listBundles']) await assert.rejects(f.invoke(method), denied)
    for (const [method, args] of [
      ['setPluginEnabled', { id: 'include:' + EXTRA_ROW, enabled: false }],
      ['setBundleEnabled', { name: OPTIONAL_BUNDLES[0], enabled: true }],
      ['installBundle', { spec: MISSING_BUNDLE, options: undefined }],
    ]) await assert.rejects(f.invoke(method, args), denied)
    const response = await f.putPolicy({ expectedRevision: 4, settings: { ...emptyNativePolicy(), plugins: { [EXTRA_ROW]: false } } })
    assert.equal(response.status, 403)
    assert.equal(f.bodies(), 0)
    assert.deepEqual(f.requests, [])
    assert.deepEqual(f.commits, [])
    assert.equal(f.policy().revision, 4)
  } finally { await f.close() }
})

test('原生只读/不可寻址/非官方/缺包目标仍锁定，完整Native HTTP也不能绕过当前库存', async () => {
  const f = await fixture(true) // 管理员写入口仍以真实库存而非包名前缀决定目标。
  const previousFetch = globalThis.fetch // 本用例任何意外网络访问明确失败。
  try {
    globalThis.fetch = async () => { assert.fail('缺失官方包不得从测试访问注册表') }
    const rows = await f.invoke('listPlugins')
    assert.equal(rows.find(row => row.entryId === 'include:plugin-manager').readOnlyReason, 'management-required')
    assert.equal(rows.find(row => row.entryId === 'include:ui-theme').readOnlyReason, 'management-required')
    assert.equal(rows.find(row => row.entryId === 'include:unaddressable-theme').readOnlyReason, 'unaddressable')
    for (const id of ['plugin-manager', 'ui-theme', 'unaddressable-theme', 'nonofficial-row']) await assert.rejects(f.invoke('setPluginEnabled', { id: 'include:' + id, enabled: false }), denied)
    await assert.rejects(f.invoke('setBundleEnabled', { name: MISSING_BUNDLE, enabled: true }), denied)
    await assert.rejects(f.invoke('installBundle', { spec: MISSING_BUNDLE, options: undefined }), denied)
    assert.deepEqual(f.requests, [])
    for (const settings of [
      { ...emptyNativePolicy(), plugins: { 'plugin-manager': false } },
      { ...emptyNativePolicy(), plugins: { 'ui-theme': false } },
      { ...emptyNativePolicy(), plugins: { 'unaddressable-theme': true } },
      { ...emptyNativePolicy(), plugins: { 'not-current-inventory': true } },
      { ...emptyNativePolicy(), bundles: { [MISSING_BUNDLE]: true } },
    ]) {
      const response = await f.putPolicy({ expectedRevision: 4, settings }) // 不经过UI菜单，直接使用正式完整策略HTTP路径。
      assert.notEqual(response.status, 200)
      assert.deepEqual(f.requests, [])
      assert.equal(f.policy().revision, 4)
    }
    assert.equal(remoteMethods(f.ctx.pluginManager).some(method => method.method === 'validatePolicy'), false) // Host闭包不能成为普通RPC方法。
  } finally { globalThis.fetch = previousFetch; await f.close() }
})

test('SDK reload失败保留真实failed/changed结果，不冒充applied或撤销已保存共享选择', async () => {
  const f = await fixture(true, { hmrFailure: true }) // 官方reconcile找不到根Include，真实保存后失败。
  try {
    const name = OPTIONAL_BUNDLES.find(name => name.endsWith('badge-skill-bundle')) // 无实际运行副作用的官方Bundle用于失败协议。
    const result = await f.invoke('setBundleEnabled', { name, enabled: true })
    assert.equal(result.application, 'failed')
    assert.equal(result.changed, true)
    assert.equal(result.error.code, 'operation-error')
    assert.equal(f.native.getStatus().appliedRevision, null) // 真实SDK失败保留确认政策，但撤销当前采用完成标记。
    assert.equal(f.native.getBootstrapSnapshot(), null) // 应用失败不能下发新的HTML已采用证明。
    assert.equal(f.policy().settings.bundles[name], true) // 共享保存成功与局部SDK应用失败是两条事实。
    assert.ok(JSON.parse(await readFile(f.manifestPath, 'utf8')).dsh.profile.bundles.includes(name))
    assert.doesNotMatch(JSON.stringify(result), /[A-Z]:\\|synthetic-private/u)
  } finally { await f.close() }
})

test('普通Runtime收到全局高权限true只保留记录，不装载管理员专属组合或授予Host能力', async () => {
  const terminal = '@deepseek-ai/dsh-experimental-terminal-bundle' // 官方已装高权限样本，不执行Shell。
  const inspector = '@deepseek-ai/dsh-experimental-inspector-profile' // 官方已装Host调试样本，不启CDP或页面。
  const f = await fixture(false, { capabilityOverride: { adminOnlyBundles: { [terminal]: '仅管理员高权限', [inspector]: '仅管理员调试' }, blockedBundleReasons: { [terminal]: '仅管理员高权限', [inspector]: '仅管理员调试' }, roleExcludedBundles: [terminal, inspector] } }) // 与生产composer相同完整shape，不能只测试缺少blockedReasons的稀疏数据。
  try {
    const before = await readFile(f.manifestPath, 'utf8') // 确认内部受权采用也不会向普通Profile写入高权限选择。
    assert.deepEqual(await f.guard.applyPlugins({}, { [terminal]: true, [inspector]: true }), [])
    assert.equal(await readFile(f.manifestPath, 'utf8'), before)
    assert.equal(f.guard.liveCapabilities.getSnapshot().isAdmin, false)
    assert.equal(f.guard.liveCapabilities.getSnapshot().selectedBundles.includes(terminal), false)
    assert.equal(f.guard.liveCapabilities.getSnapshot().selectedBundles.includes(inspector), false)
    const shared = { ...emptyNativePolicy(), bundles: { [terminal]: true, [inspector]: true }, namespaces: { 'ui-theme': { codeFontSize: 15 }, subagent: { maxActiveSubagents: 3 }, 'agent-loop': { maxParallelToolCalls: 3 } } } // 同一全局记录仍允许兼容字段全员立即采用。
    await f.acceptSharedPolicy(shared)
    assert.equal(f.native.getStatus().appliedRevision, f.policy().revision)
    assert.equal(f.native.getBootstrapSnapshot().settings.namespaces['ui-theme'].codeFontSize, 15)
    assert.equal(f.namespaceValues['ui-theme'].codeFontSize, 15)
    assert.equal(f.namespaceValues.subagent.maxActiveSubagents, 3)
    assert.equal(f.namespaceValues['agent-loop'].maxParallelToolCalls, 3)
    assert.equal(await readFile(f.manifestPath, 'utf8'), before) // 零高权限setter副作用：真实SDKManifest完全没有被写入。
    assert.deepEqual(f.policy().settings.bundles, shared.bundles)
    await assert.rejects(f.invoke('setBundleEnabled', { name: terminal, enabled: true }), denied)
    assert.deepEqual(f.requests, [])
  } finally { await f.close() }
})

test('缺少可信Gateway能力清单时关闭管理写入，不以官方包存在推断管理员权限范围', async () => {
  const f = await fixture(true, { capabilityOverride: null }) // 管理员身份有效但能力确认缺失，不自动给全部core写权限。
  try {
    const rows = await f.invoke('listPlugins') // 官方目录仍可读，所有目标明确只读。
    assert.ok(rows.every(row => row.readOnlyReason !== undefined))
    await assert.rejects(f.invoke('setPluginEnabled', { id: 'include:' + EXTRA_ROW, enabled: false }), denied)
    assert.deepEqual(f.requests, [])
  } finally { await f.close() }
})

test('历史alpha2政策读取保留原tag与全部值，下一次明确管理员保存才写alpha3', async () => {
  const old = { ...emptyNativePolicy(), harnessVersion: '0.2.1-alpha.2', clientPreferences: { collapseTiming: 'completion' } } // 已核验字段兼容的历史记录，不做迁移或补默认。
  const f = await fixture(true, { initialSettings: old })
  try {
    assert.equal(f.native.getPolicySnapshot().settings.harnessVersion, '0.2.1-alpha.2')
    assert.deepEqual(f.requests, [])
    await f.invoke('setPluginEnabled', { id: 'include:' + EXTRA_ROW, enabled: false })
    assert.equal(f.policy().settings.harnessVersion, '0.2.1-alpha.3')
    assert.equal(f.policy().settings.clientPreferences.collapseTiming, 'completion')
    assert.equal(f.policy().settings.plugins[EXTRA_ROW], false)
  } finally { await f.close() }
})

test('存活Auto会话阻止共享关闭，管理员明确切换后才可停用且不隐式改权限', async () => {
  const name = '@deepseek-ai/dsh-experimental-auto-review' // 真实已安装官方Bundle，停用不运行reviewer或模型。
  const f = await fixture(true, { liveAuto: true })
  try {
    const before = await readFile(f.manifestPath, 'utf8') // 拒绝必须先于共享CAS和原生文件writer。
    await assert.rejects(f.invoke('setBundleEnabled', { name, enabled: false }), error => denied(error) && /Auto权限/u.test(error.message))
    assert.deepEqual(f.requests, [])
    assert.equal(await readFile(f.manifestPath, 'utf8'), before)
    const response = await f.putPolicy({ expectedRevision: f.policy().revision, settings: { ...emptyNativePolicy(), bundles: { [name]: false } } }) // 完整Native HTTP不能绕过相同停用检查。
    assert.notEqual(response.status, 200)
    assert.deepEqual(f.requests, [])
    f.permissionState.current = 'workspace-write' // 模拟用户已通过官方权限选择器明确离开Auto，受管代码不代替用户决定。
    await f.invoke('setBundleEnabled', { name, enabled: false })
    assert.equal(f.policy().settings.bundles[name], false)
    assert.equal(f.permissionState.current, 'workspace-write')
    assert.equal(f.permissionState.writes, 0)
  } finally { await f.close() }
})

test('Terminal组合热启停即使官方HMR成功仍要求两原生Sidebar行冷物化，不能伪报全功能已应用', async () => {
  const name = '@deepseek-ai/dsh-experimental-terminal-bundle' // 实际已装optional模型终端；原生WebPTY入口另属基础Web组合。
  const f = await fixture(true, { hmrSuccess: true })
  try {
    for (const enabled of [true, false]) {
      const result = await f.invoke('setBundleEnabled', { name, enabled }) // 真实SDKManifest writer和ChangeResult，经共享CAS后返回。
      assert.equal(result.changed, true)
      assert.equal(result.application, 'restart-required')
      assert.equal(result.restartReason, 'host-module')
      assert.equal(f.native.getStatus().appliedRevision, null)
      assert.equal(f.guard.liveCapabilities.getSnapshot().selectedBundles.includes(name), false)
      assert.equal(f.policy().settings.bundles[name], enabled)
    }
  } finally { await f.close() }
})
