/** 真实固定 PluginManager/Cordis/Gateway 与隔离 Profile，验证业务保护不仿造原生文件保存。 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import test from 'node:test'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 明确固定发行包，不读取生产Home或用户配置。

/**
 * 创建只持有合成 Loader 元数据及本测试专属磁盘目录的真实SDK上下文。
 * @param {boolean} isAdmin 合成可信角色。
 * @returns {Promise<object>} 真实管理器、Gateway、Fixture控制与安全清理方法。
 */
async function fixture(isAdmin) {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 所有公开SDK来自同一固定安装。
  assert.equal(require('@deepseek-ai/dsh-plugin-manager/package.json').version, '0.2.1-alpha.3')
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href) // 真实服务归属及fiber生命周期。
  const { default: Registry } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-registry')).href) // 真实RPC类型注册器。
  const { default: Gateway } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-gateway')).href) // 真实RPC dispatch与结果Schema。
  const { remoteMethods, RemoteError } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-protocol')).href) // 原始继承Remote标记检查。
  const { withFileLock } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-atomic-write')).href) // 实际Profile锁用于制造内部写入期间外部RPC并发。
  const { installGuardedPluginManager } = await import('../src/guarded-plugin-manager.mjs')
  const temporary = await mkdtemp(join(tmpdir(), 'adminsmart-plugin-sdk-')) // 清理仅限本测试创建的独占根。
  const profileDir = join(temporary, 'profile') // 真实SDK只读写此合成Profile。
  const homeDir = join(temporary, 'home') // 空Home防止Profile读层探测用户私有文件。
  await mkdir(profileDir)
  await mkdir(homeDir)
  const manifestPath = join(profileDir, 'package.json') // 官方manifest锁与Bundle目录真源。
  const patchPath = join(profileDir, 'cordis.patch.yml') // 官方setPluginEnabled实际原子持久化目标。
  const modules = {
    'ui-skill': '@deepseek-ai/dsh-client-ui-skill', // 已批准展示行。
    'ui-message-feedback': '@deepseek-ai/dsh-client-ui-message-feedback', // 已批准反馈UI。
    'ui-trajectory': '@deepseek-ai/dsh-client-ui-trajectory', // 已批准轨迹UI。
    'ui-deliverables': '@deepseek-ai/dsh-client-ui-deliverables', // 历史三项之外可以独立切换的官方交付展示行。
    'fs-sandbox': '@deepseek-ai/dsh-fs-sandbox', // 不允许插件页改动的边界能力。
    'ui-theme': '@deepseek-ai/dsh-client-ui-theme', // 不允许停用根布局依赖。
  }
  await writeFile(manifestPath, JSON.stringify({ name: 'synthetic-plugin-profile', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }), 'utf8')
  await writeFile(patchPath, '- insert:\n' + Object.entries(modules).map(([id, name]) => `    - id: ${id}\n      name: '${name}'\n`).join(''), 'utf8')
  const ctx = new Context() // 真实SDK根；不会加载任何实际业务或模型。
  const entries = Object.entries(modules).map(([id, name]) => ({
    id: `include:${id}`, // 当前Runtime的真实形状Loader身份。
    options: { id, name }, // 与合成patch中的稳定行一致。
    disabled: false, // 起始全部启用，之后可模拟新Runtime采用已存状态。
    parent: { tree: { ctx: { fiber: { entry: { id: 'include' } } } } }, // 官方PluginManager可寻址所属Include。
    fiber: { state: 2 }, // 合成激活状态，无真实插件执行。
  }))
  ctx.provide('profileContext', { name: 'fixture', dir: profileDir, patchPath, home: homeDir, cwd: temporary, installAnchor: join(runtimeRoot, 'package.json'), startedBundles: [], overlays: [] })
  ctx.provide('loader', { entries: () => entries, await: async () => {} }) // SDK库存使用Fixture，原始持久化仍由官方实现。
  const registry = ctx.plugin(Registry) // 原生类型注册器必须先激活。
  await registry.await()
  const { TYPERT } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-plugin-manager/typert')).href) // 完整原生严格Remote Schema。
  ctx.typert.register(TYPERT)
  const { default: RemoteAccess } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-remote-access')).href) // 新官方Gateway依赖必须真实装配，不伪造权限回答。
  const access = ctx.plugin(RemoteAccess) // 默认owner规则与普通用户业务管理拒绝分别验证。
  await access.await()
  const gateway = ctx.plugin(Gateway)
  await gateway.await()
  const { Peer } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-connection')).href) // alpha.3官方连接scope，不能构造无生命周期的假owner。
  const peer = new Peer(ctx, { principal: { kind: 'owner' } }) // 每用户独占Hostowner与业务管理员角色分离，普通管理仍被guard拒绝。
  const commits = [] // 全局CAS提交调用，不记录真实身份或配置。
  const capabilities = {
    harnessVersion: '0.2.1-alpha.3', // 隔离能力清单只与当前固定SDK匹配。
    allowedPluginIds: Object.keys(modules), // 候选仍须和真实官方可寻址库存、保护列表共同求交集。
    activePluginIds: Object.keys(modules), // 本Fixture初始live行，不能用它阻止正式Bundle启用后出现的新行。
    protectedPluginIds: ['fs-sandbox', 'ui-theme'], // 必需执行边界与根主题不可借管理扩展关闭。
    selectedBundles: [], // 本用例未启动可选执行Bundle，不自动启用。
    availableBundles: [], // 该Fixture只测行管理，没有额外软件包管理准入。
    protectedBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], // 基础组合保持原生及业务双重保护。
    blockedPluginReasons: {}, // 此Fixture除保护项外没有隐藏的兼容拒绝。
    adminOnlyBundles: {}, // 该隔离用例明确模拟角色未排除的官方SDK目录，不代表生产全员权限。
    roleExcludedBundles: [], // 正式角色隔离由独立用例覆盖，不能按hostname推断。
    blockedBundleReasons: {}, // 本用例不模拟实际业务的高风险Bundle兼容放行。
  }
  let refuseCommit = false // 失败时禁止官方局部写入。
  let adoptOnCommit // 模拟真实Host保存后await采用全局策略，保持原始服务调用链。
  const guard = installGuardedPluginManager(ctx, { isAdmin, capabilities, commitPlugin: async (id, enabled) => {
    if (refuseCommit) throw new Error('synthetic-private-path-and-token')
    commits.push({ id, enabled })
    await adoptOnCommit?.(id, enabled)
  } })
  await guard.fiber.await()
  assert.equal(guard.fiber.state, 2)
  assert.ok(remoteMethods(ctx.pluginManager).some(method => method.method === 'setPluginEnabled'))
  assert.equal(remoteMethods(ctx.pluginManager).some(method => method.method === 'applyPlugins'), false)
  const invoke = (method, args = {}) => ctx.typertGateway.invoke({ namespace: 'pluginManager', method, args, peer }) // 不直接调用伪造Remote服务答案。
  return { ctx, guard, entries, commits, invoke, patchPath, manifestPath, withFileLock, RemoteError,
    refuse(value) { refuseCommit = value }, // 只控制合成CAS错误。
    adopt(callback) { adoptOnCommit = callback }, // 只由测试Host配置真实保存后的采用调用，不成为Remote参数。
    async close() {
      await guard.fiber.dispose()
      await gateway.dispose()
      await registry.dispose()
      await ctx.fiber.dispose()
      assert.equal(dirname(resolve(temporary)), resolve(tmpdir())) // 递归清理前确认目标仍是本测试临时目录根下唯一目录。
      await rm(temporary, { recursive: true, force: true })
    },
  }
}

/** @param {unknown} error RPC拒绝。 @returns {boolean} 稳定官方错误码且不泄漏合成私有错误正文。 */
function denied(error) {
  return error?.code === 'gateway/bad-request' && !/synthetic-private|[A-Z]:\\/u.test(error.message)
}

test('普通角色全部外部读写拒绝，内部原始SDK应用三项策略且不提交全局写', { skip: !runtimeRoot }, async () => {
  const state = await fixture(false) // 各角色独立SDK与文件目录。
  try {
    for (const method of ['listPlugins', 'listBundles', 'registries', 'listVersionExemptions']) await assert.rejects(state.invoke(method), denied)
    for (const [method, args] of [
      ['setPluginEnabled', { id: 'include:ui-skill', enabled: false }], // 普通用户不能改展示策略。
      ['inspect', { spec: 'https://registry.example.test/fixture.tgz', options: undefined }], // 不能触发外部查询。
      ['setBundleEnabled', { name: '@deepseek-ai/dsh-web-app', enabled: false }], // 不能停管理核心。
      ['installBundle', { spec: 'fixture-package', options: undefined }], // 不能安装代码或脚本。
      ['removeBundle', { name: 'fixture-package' }], // 不能删除部署依赖。
      ['setVersionExemption', { packageVersion: 'fixture@1.0.0', runtimeVersion: '0.2.1-alpha.3', enabled: true, acceptRisk: true }], // 不能豁免固定版本。
      ['waitForInstall', { requestId: 'fixture-id' }], // 不拥有部署任务。
      ['cancelInstall', { requestId: 'fixture-id' }], // 不拥有部署任务。
    ]) await assert.rejects(state.invoke(method, args), denied)
    assert.deepEqual(state.commits, [])
    const before = await readFile(state.patchPath, 'utf8') // 确认拒绝没有触碰Profile。
    const results = await state.guard.applyPlugins({ 'ui-skill': false }) // 内部闭包确实调用原始官方file writer。
    assert.equal(results.length, 1)
    assert.equal(results[0].application, 'restart-required') // 未装HMR的真实SDK语义，不能伪造applied。
    assert.equal(results[0].changed, true)
    assert.notEqual(await readFile(state.patchPath, 'utf8'), before)
    assert.match(await readFile(state.patchPath, 'utf8'), /disabled: true/u)
    assert.deepEqual(state.commits, [])
    state.entries.find(row => row.options.id === 'ui-skill').disabled = true // 模拟新Runtime已采用刚才保存的原始状态。
    assert.deepEqual(await state.guard.applyPlugins({ 'ui-skill': false }), []) // 已一致不重复调用原生写。
    await assert.rejects(state.invoke('applyPlugins', { pluginsMap: { 'ui-skill': true } }), error => /no active Remote method/u.test(error.message))
  } finally { await state.close() }
})

test('管理员开放官方可寻址与能力清单交集，保护基础行且CAS失败不局部写', { skip: !runtimeRoot }, async () => {
  const state = await fixture(true) // 管理员仍使用真实SDK目录投影。
  try {
    const rows = await state.invoke('listPlugins') // 实际Gateway返回受保护的原始库存行。
    assert.equal(rows.filter(row => row.patchId).length, 4)
    assert.ok(rows.some(row => row.patchId === 'ui-deliverables'))
    assert.ok(rows.filter(row => row.moduleName.includes('sandbox') || row.moduleName.includes('theme')).every(row => row.readOnlyReason === 'management-required' && !Object.hasOwn(row, 'patchId')))
    const bundles = await state.invoke('listBundles') // 当前Fixture未准入额外组合，仍保留其固定部署保护。
    assert.ok(bundles.filter(row => row.availability !== 'missing').every(row => row.readOnlyReason === 'management-required')) // 已安装但不在能力清单中的组合保持不可编辑。
    assert.ok(bundles.every(row => row.removable === false)) // 未安装的官方目录项可保留原展示信息，任何软件包删除仍拒绝。
    for (const row of bundles.filter(row => row.availability === 'missing')) await assert.rejects(state.invoke('setBundleEnabled', { name: row.name, enabled: true }), denied) // 离线目录可见不能授权安装或共享启用。
    await writeFile(join(dirname(state.patchPath), 'compatibility.json'), '{synthetic-private-invalid-record', 'utf8') // 合成坏版本记录用于验证官方读取警告净化。
    const versions = await state.invoke('listVersionExemptions') // 原始SDK读取与分类继续生效，但不把路径或私有正文发给Client。
    assert.ok(versions.warnings.length > 0)
    assert.doesNotMatch(JSON.stringify(versions), /synthetic-private|[A-Z]:\\/u)
    await assert.rejects(state.invoke('setPluginEnabled', { id: 'include:fs-sandbox', enabled: false }), denied)
    assert.deepEqual(state.commits, [])
    state.refuse(true)
    const before = await readFile(state.patchPath, 'utf8') // 失败后保留原生完整Profile。
    await assert.rejects(state.invoke('setPluginEnabled', { id: 'include:ui-skill', enabled: false }), denied)
    assert.equal(await readFile(state.patchPath, 'utf8'), before)
    state.refuse(false)
    const result = await state.invoke('setPluginEnabled', { id: 'include:ui-skill', enabled: false }) // CAS成功后执行原始SDK保存。
    assert.equal(result.changed, true)
    assert.equal(result.application, 'restart-required')
    assert.deepEqual(state.commits, [{ id: 'ui-skill', enabled: false }])
    const ordinarySafe = state.entries.find(row => row.options.id === 'ui-trajectory') // 原生不可寻址约束不可被业务白名单解除。
    ordinarySafe.parent.tree.ctx.fiber.entry.id = 'nested-preset'
    const protectedRow = (await state.invoke('listPlugins')).find(row => row.entryId === ordinarySafe.id)
    assert.equal(protectedRow.readOnlyReason, 'unaddressable')
    assert.equal(Object.hasOwn(protectedRow, 'patchId'), false)
    await assert.rejects(state.invoke('setPluginEnabled', { id: ordinarySafe.id, enabled: false }), denied)
    await assert.rejects(state.guard.applyPlugins({ 'ui-trajectory': false }), denied)
    assert.equal(state.commits.length, 1)
  } finally { await state.close() }
})

test('内部原生写入的async上下文不向并发普通RPC泄漏，非法策略整批先拒绝', { skip: !runtimeRoot }, async () => {
  const state = await fixture(false) // 验证原始super.set内部虚调用与外部RPC角色隔离。
  let release // 本测试持有真实Profile文件锁的受控释放门。
  try {
    const before = await readFile(state.patchPath, 'utf8')
    for (const policy of [null, [], { 'mcp-resources': true }, { 'ui-skill': 'true' }, { 'ui-skill': false, 'credentials': true }, Object.create({ 'ui-skill': false }), { get 'ui-skill'() { assert.fail('内部策略不能执行getter') } }, { [Symbol('fixture')]: true }]) {
      await assert.rejects(state.guard.applyPlugins(policy), denied)
    }
    assert.equal(await readFile(state.patchPath, 'utf8'), before)
    let acquired // Profile原生锁已取得的确认门。
    const locked = new Promise(resolve => { acquired = resolve })
    const wait = new Promise(resolve => { release = resolve })
    const lock = state.withFileLock(state.manifestPath, async () => { acquired(); await wait }) // 只锁测试专属文件，真实原生写会暂等。
    await locked
    const applying = state.guard.applyPlugins({ 'ui-skill': false })
    await new Promise(resolve => setImmediate(resolve))
    await assert.rejects(state.invoke('listPlugins'), denied) // 内部super.set活动时，外部RPC仍不带内部上下文。
    await assert.rejects(state.invoke('listBundles'), denied)
    release()
    await lock
    assert.equal((await applying)[0].application, 'restart-required')
    assert.deepEqual(state.commits, [])
  } finally { release?.(); await state.close() }
})

test('管理员部署与网络mutation均拒绝，错误角色不装服务且不读取任意配置', { skip: !runtimeRoot }, async () => {
  const state = await fixture(true) // 权限高也不能通过插件页改变受管版本或部署组合。
  const previousFetch = globalThis.fetch // 测试网络必须完全禁止。
  try {
    globalThis.fetch = async () => { assert.fail('插件保护回归不得访问真实网络') }
    for (const [method, args] of [
      ['inspect', { spec: 'https://registry.example.test/fixture.tgz', options: undefined }],
      ['setBundleEnabled', { name: '@deepseek-ai/dsh-base', enabled: false }],
      ['installBundle', { spec: 'fixture-package', options: { enabled: false, approvedBuilds: ['fixture'] } }],
      ['removeBundle', { name: 'fixture-package' }],
      ['setVersionExemption', { packageVersion: 'fixture@1.0.0', runtimeVersion: '0.2.1-alpha.3', enabled: false, acceptRisk: true }],
      ['waitForInstall', { requestId: 'fixture-id' }],
      ['cancelInstall', { requestId: 'fixture-id' }],
    ]) await assert.rejects(state.invoke(method, args), denied)
    const { installGuardedPluginManager } = await import('../src/guarded-plugin-manager.mjs')
    assert.throws(() => installGuardedPluginManager(state.ctx, { isAdmin: '1', commitPlugin() {} }), denied)
    assert.throws(() => installGuardedPluginManager(state.ctx, { isAdmin: true }), denied)
    assert.throws(() => installGuardedPluginManager(state.ctx, { isAdmin: true, commitPlugin() {} }), denied)
    assert.deepEqual(state.commits, [])
  } finally { globalThis.fetch = previousFetch; await state.close() }
})

test('管理员commit等待原生采用可同序列重入且有界完成，独立普通RPC仍拒绝', { skip: !runtimeRoot }, async () => {
  const administrator = await fixture(true) // 当前管理员真实SDK、文件锁与队列。
  const ordinary = await fixture(false) // 不同可信角色的独立SDK不能继承管理员私有序列标记。
  const adopted = [] // 真实Host采用产生的原生ChangeResult，不仿造写入结果。
  let timeout // 仅为捕获队列互等设置的有界测试门。
  try {
    administrator.adopt(async (id, enabled) => {
      await assert.rejects(ordinary.invoke('listPlugins'), denied)
      await assert.rejects(ordinary.invoke('setPluginEnabled', { id: 'include:ui-skill', enabled: true }), denied)
      adopted.push(...await administrator.guard.applyPlugins({ [id]: enabled })) // 本行对应真实nativeHost.commit里await采用，必须重入而非排到自己之后。
      administrator.entries.find(row => row.options.id === id).disabled = !enabled // 合成Loader在下一代Runtime采用已保存状态，物理文件仍由SDK写入。
    })
    const result = await Promise.race([
      administrator.invoke('setPluginEnabled', { id: 'include:ui-skill', enabled: false }), // 实际Gateway→原生子类→commit→内部super应用。
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('同序列采用未在一秒内完成')), 1000) }), // 旧serialize会确定互等，不把挂起当通过。
    ])
    assert.equal(adopted.length, 1)
    assert.equal(adopted[0].changed, true)
    assert.equal(adopted[0].application, 'restart-required')
    assert.equal(result.application, 'restart-required')
    assert.equal(result.changed, true) // 返回同序列采用的原SDK真实回执；不再次调用Setter制造无变化结果。
    assert.match(await readFile(administrator.patchPath, 'utf8'), /disabled: true/u)
    assert.equal(administrator.entries.find(row => row.options.id === 'ui-skill').disabled, true)
    assert.deepEqual(administrator.commits, [{ id: 'ui-skill', enabled: false }])
    assert.deepEqual(ordinary.commits, [])
    await assert.rejects(ordinary.invoke('listPlugins'), denied) // 已结束的操作也不泄漏私有上下文或临时读权。
  } finally {
    clearTimeout(timeout)
    await ordinary.close()
    await administrator.close()
  }
})

test('原生事件创建的延迟任务不能在操作结束后保留内部读取资格', { skip: !runtimeRoot }, async () => {
  const state = await fixture(false) // 同一普通Runtime内检查异步上下文的生命周期，而非只比较不同实例。
  let release // 内部SDK事件产生后才允许后继RPC执行。
  let lateRead // 原生事件内部注册的Promise后继，Node会传播其创建时的async上下文。
  const gate = new Promise(resolve => { release = resolve })
  const off = state.ctx.on('plugin-manager/changed', () => {
    lateRead = gate.then(() => state.invoke('listPlugins')) // 在原始super.change内部创建，但读取发生在原生操作完成之后。
  })
  try {
    await state.guard.applyPlugins({ 'ui-skill': false })
    assert.ok(lateRead)
    release()
    await assert.rejects(lateRead, denied) // 已结束操作的私有权限失效，不能作为永久旁路。
  } finally {
    release?.()
    off()
    await state.close()
  }
})
