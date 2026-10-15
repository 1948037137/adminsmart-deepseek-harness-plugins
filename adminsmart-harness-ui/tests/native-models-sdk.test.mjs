/** 固定官方 Models 原始 Client 与真实 Cordis 装配；网络、Settings 与 Credentials 全部为合成 Remote。 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { GENERAL_SETTINGS_NAMESPACES, installUiPolicyClient } from '../src/ui-policy-client.mjs'
import { originalClientPlatform } from './official-client-boot-fixture.mjs'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 调用方明确选定的固定官方安装，不读取生产配置。

test('管理员公网保留原生Models供应商目录与CAS/发现操作，普通用户不获得原生配置', { skip: !runtimeRoot }, async () => {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 原始官方包入口只来自当前固定安装。
  const cordis = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href) // 服务提供方归属与生命周期使用实际SDK。
  const officialStore = (await originalClientPlatform()).seeds['@deepseek-ai/dsh-client-store'] // 使用当前真实Web平台set/update/subscribe协议，避免导入Node非运行依赖或旧Fake缺set。
  const schema = (await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-pi-ai')).href)).Config.toJSON() // 原生供应商编辑器的真实公开Schema，不手写其字段规则。
  const modelsHost = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-ui-settings-models')).href) // 官方公开 Host 负责验证并注入浏览器自动引导选项。
  const hostConfig = modelsHost.Config({ credentialOnboarding: false }) // 只传经官方 Schema 确认的非敏感页面配置。
  let injectPage // 官方 Host 登记的公开页面初始化监听器。
  modelsHost.apply({ on(event, listener) { assert.equal(event, 'webserver/index-inject'); injectPage = listener } }, hostConfig)
  const pageInjections = [] // 合成页面初始化表，不读取真实页面或账号配置。
  injectPage(pageInjections)
  assert.equal(pageInjections.length, 1)
  assert.equal(pageInjections[0].name, '__DSH_MODELS_ONBOARDING__')
  assert.equal(pageInjections[0].value.credentialOnboarding, false)
  const onboardingEffects = [] // 仅收集原始官方引导组件的 React effect，避免挂载真实 DOM。
  /** @param {string} name 当前已知官方包名。 @returns {Promise<object>} 原始ModuleLoader导出，不修改上游字节。 */
  const load = async name => {
    let registration // 完整原始 Client 包公开load登记。
    const file = require.resolve(`${name}/client`) // npm公开subpath，不读私有源码文件。
    runInNewContext(await readFile(file, 'utf8'), { window: { __ModuleLoader__: { load(value) { registration = value } } }, [pageInjections[0].name]: pageInjections[0].value, structuredClone, queueMicrotask }, { filename: file })
    return registration.factory(id => {
      if (id === '@deepseek-ai/cordis') return cordis
      if (id === '@deepseek-ai/dsh-client-store') return officialStore
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return new Proxy({}, { get: () => () => null })
      if (id === 'react' && name === '@deepseek-ai/dsh-client-ui-settings-models') return { ...require(id), useState: initial => [initial, () => {}], useEffect: effect => onboardingEffects.push(effect) }
      if (id === 'react' || id === 'react/jsx-runtime') return require(id)
      throw new Error('Fixture 未声明官方模块依赖')
    })
  }
  const settings = await load('@deepseek-ai/dsh-client-ui-settings') // 官方Schema和原生ConfigForms真正apply，不仿造内部类。
  const models = await load('@deepseek-ai/dsh-client-ui-settings-models') // 原生供应商页面和操作实现全部来自官方原字节。
  for (const isAdmin of [false, true]) {
    const ctx = new cordis.Context() // 每个角色独立真实Context，无共享状态或网络。
    const registrations = new Map() // 当前公开Settings席位，供读取原生Controller与operations。
    const writes = [] // 官方CAS写入参数，只操作合成状态。
    let modelReads = 0 // 官方 Models 的目录与凭据读取次数，用于验证关闭自动引导后首屏不追加 RPC。
    let revision = 4 // 当前合成官方配置修订，不等于共享General修订。
    let profile = { providers: { fixture: { api: 'openai-responses', models: [{ id: 'fixture-model', contextWindow: 128000 }] } } } // 原生模型页可编辑的非敏感合成Store；每次写入独立替换，不与官方快照共享可变对象。
    const remote = {
      $host: { isLoopback: false }, // 真实公网事实；alpha.3描述仍必须保留官方首次eager读取，不能伪造内存分支。
      $on: () => () => {},
      settings: {
        describe: async () => ({ ok: true, value: { writable: isAdmin, hasDocument: false, namespaces: [...GENERAL_SETTINGS_NAMESPACES.map(ns => ({ ns, value: {}, schema: { type: 'object', dict: {} }, revision: 1, applies: 'live', secrets: [] })), { ns: 'llm-pi-ai', schema, value: structuredClone(profile), base: {}, user: structuredClone(profile), revision, applies: 'live', secrets: [] }] } }),
        mutate: async (ns, operations, expected) => {
          if (!isAdmin) return { ok: false, error: { code: 'denied', message: '权限不足' } }
          writes.push({ ns, operations, expected })
          if (expected !== undefined && expected !== revision) return { ok: false, error: { code: 'settings/conflict', message: '合成官方CAS冲突' } } // 真并发仍由官方Models操作映射为conflict，不自动重试或借新revision提交。
          profile = structuredClone(profile) // 官方镜像可能冻结回执；Fixture持久层不复用消费者的快照引用。
          for (const operation of operations) {
            const parent = operation.path.slice(0, -1).reduce((value, key) => value[key], profile) // 合成Store仅处理本用例明确存在的Provider路径。
            const field = operation.path.at(-1) // 当前原生set/unset精确寻址字段。
            if (operation.op === 'unset') delete parent[field]
            else parent[field] = structuredClone(operation.value)
          }
          revision += 1
          return { ok: true, value: { ns, schema, value: structuredClone(profile), base: {}, user: structuredClone(profile), revision } } // 官方回执是提交时独立描述，不能被下一次Fixture写入追改。
        },
      },
      credentials: {
        describe: async () => { modelReads += 1; return { ok: true, value: {} } }, // 只返回配置状态，不返回凭据明文。
        set: async () => ({ ok: isAdmin }),
        unset: async () => ({ ok: isAdmin }),
      },
      llm: {
        listProviders: async () => { modelReads += 1; return { ok: true, value: [{ id: 'fixture', name: 'Fixture' }] } },
        listConfigurableProviders: async () => { modelReads += 1; return { ok: true, value: [{ provider: 'fixture', displayName: 'Fixture', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'fixture'] }] } },
        discoverModels: async () => ({ ok: true, value: [{ id: 'fixture-discovered', name: 'Fixture Discovered' }] }),
      },
    }
    ctx.provide('remote', remote)
    ctx.provide('remote.settings', remote.settings)
    ctx.provide('remote.credentials', remote.credentials)
    ctx.provide('remote.llm', remote.llm)
    ctx.provide('slots', { inject: (_name, register) => register(), register(options, component) { registrations.set(`${options.name}:${options.id}`, { options, component }); return () => {} } })
    ctx.provide('locale', { register: () => () => {}, bind: () => key => key })
    let bridge // 正式自有façade拥有General与受限管理员原生描述。
    let officialForms // 原始SDK镜像仍由官方拥有，用公开acceptView模拟自己的写入完成回执。
    const fiber = ctx.plugin({ inject: settings.inject, async apply(owner) {
      settings.apply(owner)
      officialForms = owner.get('configForms', false)
      bridge = installUiPolicyClient({ configForms: officialForms, remote, recoveryIntervalMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ revision: 2, writable: isAdmin, settings: { locale: null, theme: 'light', fontSize: 14, transcriptView: 'standard', performanceUsage: 'compact', linkOpening: 'sidebar', busyEnter: 'queue', developerTools: false } }) }) })
      await bridge.ready
      owner.set('configForms', bridge.configForms)
    } })
    try {
      await fiber.await()
      assert.equal(ctx.remote.$host.isLoopback, false)
      assert.equal(bridge.configForms.describe().getSnapshot().view.namespaces.some(row => row.ns === 'llm-pi-ai'), isAdmin)
      if (!isAdmin) continue // Profile只对管理员激活官方Models；普通用户没有其Remote/Credentials入口。
      models.apply(ctx)
      const native = registrations.get('settings.section:models').options.inject() // 官方Models提供的真实原始Controller与operations。
      const onboarding = registrations.get('settings.onboarding:deepseek-official') // 原始官方引导组件经公开席位提供，未复制其内部状态机。
      const onboardingProps = onboarding.options.inject() // 官方 Host 页面选项实际进入 Client 席位参数。
      let completed = 0 // 关闭自动引导时原始组件通知 Settings Shell 完成的次数。
      assert.equal(onboardingProps.automatic, false)
      assert.equal(native.hooks.snapshot.getSnapshot().status, 'idle')
      assert.equal(onboarding.component({ ...onboardingProps, useModels: selector => selector(onboardingProps.hooks.models.getSnapshot()), complete: () => { completed += 1 }, renderSlot: () => null }), null)
      for (const effect of onboardingEffects.splice(0)) effect()
      assert.equal(completed, 1)
      assert.equal(modelReads, 0)
      assert.equal(native.hooks.snapshot.getSnapshot().status, 'idle')
      await native.controller.load()
      assert.ok(modelReads > 0)
      assert.equal(native.hooks.snapshot.getSnapshot().status, 'ready')
      assert.equal(native.hooks.snapshot.getSnapshot().rows[0].configured, true)
      assert.equal(native.hooks.snapshot.getSnapshot().writable, true)
      assert.deepEqual((await native.operations.discoverModels('llm-pi-ai', { provider: 'fixture' })).models.map(model => model.id), ['fixture-discovered'])
      const answer = await native.operations.writeSettings('llm-pi-ai', [{ op: 'set', path: ['providers', 'fixture', 'displayName'], value: 'Fixture Renamed' }], 4)
      assert.equal(answer.kind, 'written')
      bridge.configForms.describe().acceptView(answer.view)
      await bridge.refresh()
      assert.equal(bridge.configForms.describe().getSnapshot().view.namespaces.find(row => row.ns === 'llm-pi-ai').revision, 5)
      assert.equal(writes.length, 1)
      assert.equal(writes[0].expected, 4)
      assert.equal(Object.hasOwn(bridge.configForms.describe().getSnapshot().view.namespaces.find(row => row.ns === 'llm-pi-ai').value.providers.fixture, 'apiKey'), false)

      const removed = await native.operations.writeSettings('llm-pi-ai', [{ op: 'unset', path: ['providers', 'fixture'] }], undefined) // 官方删除本来不带卡片CAS，完成后必须更新下一张创建卡的基线。
      assert.equal(removed.kind, 'written')
      officialForms.describe().acceptView(removed.view) // 使用官方原始镜像公开回执，不调用自有refresh掩盖滞后问题。
      await native.controller.load()
      const afterDeletion = native.hooks.snapshot.getSnapshot().namespaces.get('llm-pi-ai') // 官方Models创建卡从其真实Controller读取namespace修订。
      assert.equal(afterDeletion.revision, 6)
      assert.deepEqual(Object.keys(afterDeletion.value.providers), [])
      const added = await native.operations.writeSettings('llm-pi-ai', [{ op: 'set', path: ['providers', 'fixture'], value: { api: 'openai-responses', models: [{ id: 'fixture-model', contextWindow: 128000 }] } }], afterDeletion.revision) // 删除完成立即新增，不能继续携带旧5。
      assert.equal(added.kind, 'written')
      officialForms.describe().acceptView(added.view)
      await native.controller.load()
      assert.equal(native.hooks.snapshot.getSnapshot().namespaces.get('llm-pi-ai').revision, 7)
      assert.equal(native.hooks.snapshot.getSnapshot().rows[0].configured, true)

      const openedAt = added.view.revision // 合成创建卡打开后，另一管理员已先完成下一笔修改。
      const otherWrite = await native.operations.writeSettings('llm-pi-ai', [{ op: 'set', path: ['providers', 'fixture', 'displayName'], value: 'Concurrent Winner' }], openedAt)
      assert.equal(otherWrite.kind, 'written')
      officialForms.describe().acceptView(otherWrite.view)
      const callsBeforeConflict = writes.length // 被拒绝的旧卡写不能被共享适配自动重放。
      const conflict = await native.operations.writeSettings('llm-pi-ai', [{ op: 'set', path: ['providers', 'fixture', 'displayName'], value: 'Stale Draft' }], openedAt)
      assert.equal(conflict.kind, 'conflict')
      assert.equal(writes.length, callsBeforeConflict + 1)
      assert.equal(profile.providers.fixture.displayName, 'Concurrent Winner')
    } finally { bridge?.dispose(); await fiber.dispose(); await ctx.fiber.dispose() }
  }
})
