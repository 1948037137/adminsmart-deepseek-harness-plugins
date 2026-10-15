/** 固定alpha.3官方AutoReview停用副作用的离线回归；真实Cordis管理生命周期，不执行工具或审核模型。 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 调用方明确指定的固定SDK，不读取用户Home、模型配置或凭据。

/**
 * 只从当前固定安装导入公开官方插件，供各测试建立独立Cordis上下文。
 * @returns {Promise<object>} 真实Context、AutoReview、Session及权限服务模块。
 * @throws {AssertionError} 当前候选不为指定alpha.3时拒绝，不静默接受旧生命周期。
 */
async function sdk() {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 锚定同一已校验发行包，禁止解析参考源码。
  assert.equal(require('@deepseek-ai/dsh/package.json').version, '0.2.1-alpha.3')
  const official = name => import(pathToFileURL(require.resolve(name)).href) // 只采用已发布公开入口。
  const { Context } = await official('@deepseek-ai/cordis') // 真正的fiber/事件/清理调度。
  const AutoReview = await official('@deepseek-ai/dsh-experimental-auto-review') // 不抽取或复制apply内部函数。
  const { default: Sessions } = await official('@deepseek-ai/dsh-session') // 第二项使用真正的不可变Session事件日志。
  const { default: Projections } = await official('@deepseek-ai/dsh-session-projection') // 权限折叠由官方Projection执行。
  const { default: PermissionPresets } = await official('@deepseek-ai/dsh-permission-presets') // 真实preset及sandbox/approval持久事件写入。
  return { Context, AutoReview, Sessions, Projections, PermissionPresets }
}

test('官方AutoReview真实fiber停用时，仅已有Auto会话会调用danger-full-access setter，且先于撤销Auto注册', { skip: !runtimeRoot }, async () => {
  const { Context, AutoReview } = await sdk() // 生命周期函数由原插件整体装配，不直接调用其apply或手动执行清理回调。
  const ctx = new Context() // 独立离线上下文，没有Runtime进程或持久用户数据。
  const auto = { id: 'synthetic-auto-session' } // 已选择Auto的合成会话。
  const ordinary = { id: 'synthetic-workspace-session' } // 已选择普通workspace-write的合成会话。
  const manual = { id: 'synthetic-manual-full-session' } // 用户显式选全访问的合成会话，停用不得重复改写。
  const selections = new Map([[auto, 'auto'], [ordinary, 'workspace-write'], [manual, 'danger-full-access']]) // 仅作为公开permissionPresets.current数据源。
  const writes = [] // 记录原AutoReview实际调用的setter及调用时注册状态。
  let autoRegistered = false // 公开registerAuto生命周期的合成状态，不代替官方AutoReview清理算法。
  let admission // 原插件交给registerAuto的真实closing检查。
  let modelCalls = 0 // 装配和停用不得启动reviewer。
  let listingCalls = 0 // 原生命周期应在停用时只枚举当前会话一次。
  ctx.provide('permissionPresets', {
    current: session => selections.get(session), // 只返回本项合成Session选择。
    registerAuto(admit) {
      assert.equal(autoRegistered, false)
      autoRegistered = true
      admission = admit
      return () => { autoRegistered = false } // disposer交回原AutoReview，由真实Cordis决定释放顺序。
    },
    set(session, preset) {
      writes.push({ session, preset, autoRegistered }) // 只记录合成身份及选择，不读真实历史。
      selections.set(session, preset)
    },
  })
  ctx.provide('sessions', { list() { listingCalls += 1; return [auto, ordinary, manual] } }) // 仅公开会话枚举，不访问存储。
  ctx.provide('approval', {}) // 没有工具调用，任何审批方法都不存在。
  ctx.provide('llm', { stream() { modelCalls += 1; throw new Error('lifecycle fixture forbids reviewer/model') } }) // 若装配意外触发模型则立即失败。
  ctx.provide('tools', {}) // 无工具体或真实执行能力。
  ctx.provide('workingDirectory', {}) // 无文件或目录读取，关闭生命周期不需要ensure。
  const fiber = ctx.plugin(AutoReview) // 唯一受测对象是官方完整插件的真实fiber。
  try {
    await fiber.await()
    assert.equal(fiber.state, 2)
    assert.equal(autoRegistered, true)
    assert.equal(listingCalls, 0)
    assert.deepEqual(writes, [])
    assert.doesNotThrow(() => admission())
    await fiber.dispose()
    assert.deepEqual(writes, [{ session: auto, preset: 'danger-full-access', autoRegistered: true }])
    assert.equal(listingCalls, 1)
    assert.equal(autoRegistered, false)
    assert.equal(selections.get(ordinary), 'workspace-write')
    assert.equal(selections.get(manual), 'danger-full-access')
    assert.throws(() => admission(), /integration is closing/u)
    await fiber.dispose() // 重复dispose不得重复执行官方副作用。
    assert.equal(writes.length, 1)
    assert.equal(modelCalls, 0)
  } finally {
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
})

test('真实PermissionPresetService与Session日志证明AutoReview停用会把Auto持久改成全访问及never，普通会话不变', { skip: !runtimeRoot }, async () => {
  const { Context, AutoReview, Sessions, Projections, PermissionPresets } = await sdk() // 所有业务状态折叠与setter保持官方实现。
  const ctx = new Context() // 仅内存合成Session，不挂持久存储、Gateway或真实模型。
  let modelCalls = 0 // 生命周期不能因注册或撤销而调用模型。
  ctx.provide('shell', { sandboxMode: 'workspace-write' }) // 只提供原权限服务所需公开默认值，不提供shell执行方法。
  ctx.provide('approval', { config: { policy: 'ask' } }) // 普通默认审批状态，事件由原权限setter写入。
  ctx.provide('llm', { stream() { modelCalls += 1; throw new Error('lifecycle fixture forbids reviewer/model') } }) // 不调用任何真实模型接口。
  ctx.provide('tools', {}) // 本项没有工具调用或可执行工具体。
  ctx.provide('workingDirectory', {}) // 不读取服务器目录。
  const sessions = ctx.plugin(Sessions) // 真实SessionStore，只创建本项明确命名的合成会话。
  let projections // 正常释放成功装配的官方projection提供方。
  let presets // 真正PermissionPresetService的所有权fiber。
  let review // 原AutoReview整体插件的生命周期fiber。
  try {
    await sessions.await()
    projections = ctx.plugin(Projections)
    await projections.await()
    presets = ctx.plugin(PermissionPresets)
    await presets.await()
    const auto = ctx.sessions.create('synthetic-real-auto') // 原权限初始化通过session/created写入workspace默认。
    const ordinary = ctx.sessions.create('synthetic-real-ordinary') // 停用副作用不得改写该普通会话。
    assert.equal(ctx.permissionPresets.current(auto), 'workspace-write')
    review = ctx.plugin(AutoReview)
    await review.await()
    assert.equal(review.state, 2)
    assert.ok(ctx.permissionPresets.names.includes('auto'))
    ctx.permissionPresets.set(auto, 'auto') // 使用原公开setter形成真实Auto状态，不能仅Fake current答案。
    assert.equal(ctx.permissionPresets.current(auto), 'auto')
    const autoBefore = auto.snapshotEvents().length // 后续必须出现官方permission和approval持久事件。
    const ordinaryBefore = ordinary.snapshotEvents().length // 普通会话完整事件数必须保持不变。
    await review.dispose() // 唯一触发动作是原Cordis卸载，测试不直接调用权限setter模拟关闭。
    assert.equal(ctx.permissionPresets.names.includes('auto'), false)
    assert.equal(ctx.permissionPresets.current(auto), 'danger-full-access')
    assert.equal(ctx.permissionPresets.current(ordinary), 'workspace-write')
    assert.deepEqual(auto.snapshotEvents().slice(autoBefore).map(event => ({ type: event.type, data: event.data })), [
      { type: 'permission/preset', data: { preset: 'danger-full-access' } }, // 原AutoReview清理触发真实preset选择写入。
      { type: 'approval/policy', data: { policy: 'never' } }, // Auto已有全访问沙箱，停用实际变成无需审批。
    ])
    assert.equal(ordinary.snapshotEvents().length, ordinaryBefore)
    assert.throws(() => ctx.permissionPresets.set(ordinary, 'auto'), /unknown preset/u)
    assert.equal(modelCalls, 0)
  } finally {
    await review?.dispose()
    await presets?.dispose()
    await projections?.dispose()
    await sessions.dispose()
    await ctx.fiber.dispose()
  }
})
