/** 完整原始ClientModules与Loader复现停用Controller Host行后的BootManifest缺失，不调用真实网络或模型。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const sdkRoot = process.env.ADMINSMART_DSH_ROOT // 只读固定官方安装，不能从浏览器输入选择代码。
assert.ok(sdkRoot)
const sdkRequire = createRequire(pathToFileURL(join(sdkRoot, 'package.json'))) // Host和Client统一解析alpha.2公开入口。
const load = name => import(pathToFileURL(sdkRequire.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { Loader } = await load('@deepseek-ai/cordis-plugin-loader')
const { ClientModuleRegistry } = await load('@deepseek-ai/dsh-client-modules')
const workspaceId = '@deepseek-ai/dsh-api-workspace-controller' // 原始Workspace Client模块身份。
const sessionId = '@deepseek-ai/dsh-api-session-controller' // 原始Session Client模块身份。

/**
 * 原样读取官方公开Client注册工厂，不截取或替换上游内部类。
 * @returns {Promise<object>} 官方ClientModuleSystem完整导出。
 */
async function originalClientModuleSystem() {
  const file = sdkRequire.resolve('@deepseek-ai/dsh-client-modules/client') // SDK公开浏览器入口。
  let registration // 经典script按官方load协议提交的完整注册。
  runInNewContext(await readFile(file, 'utf8'), {
    window: { __ModuleLoader__: { load(value) { registration = value } } },
    console,
    structuredClone,
    queueMicrotask,
    setTimeout,
    clearTimeout,
  }, { filename: file })
  assert.equal(registration.id, '@deepseek-ai/dsh-client-modules')
  return registration.factory(() => { throw new Error('模块系统本体不应请求外部种子') })
}

for (const role of ['managed-user', 'admin'])
  test('真实BootManifest回归复现：停用原Host行后Client缺失，角色=' + role, async () => {
    const ctx = new Context() // 实际Cordis负责Loader生命周期，没有伪造Entry/fiber对象。
    const loader = ctx.plugin(Loader, { baseUrl: pathToFileURL(join(sdkRoot, 'package.json')).href }) // 原始Loader公开EntryGroup路径。
    await loader.await()
    const rows = [
      { id: 'workspace-controller', name: pathToFileURL(sdkRequire.resolve(workspaceId)).href, disabled: true }, // 当前候选关闭原Host Controller。
      { id: 'session-controller', name: pathToFileURL(sdkRequire.resolve(sessionId)).href, disabled: true }, // 两种身份都执行同一装配契约。
      { id: 'ui-workspace', name: pathToFileURL(sdkRequire.resolve('@deepseek-ai/dsh-client-ui-workspace')).href }, // 真实Host空apply包含声明的Client依赖边。
      { id: 'ui-model-selection', name: pathToFileURL(sdkRequire.resolve('@deepseek-ai/dsh-client-ui-model-selection')).href }, // 真实模型UI声明Session Client依赖，不能靠Fake扩图。
    ] // 最小复现只删除Controller行的实际代码贡献，其余UI入口保持原官方实现。
    let registry // 若实际构造失败，finally仍释放Loader与Context。
    try {
      await ctx.loader.root.update(rows)
      await ctx.loader.await()
      assert.equal(ctx.loader.resolve('ui-workspace').fiber.state, 2)
      assert.equal(ctx.loader.resolve('ui-model-selection').fiber.state, 2)
      registry = ctx.plugin(ClientModuleRegistry)
      await registry.await()
      assert.equal(registry.state, 2)
      const graph = ctx.clientModules.graph() // 实际扫描器产生的公开boot wire，不手工拼行。
      assert.equal(graph.entries.some(row => row.id === workspaceId), false)
      assert.equal(graph.entries.some(row => row.id === sessionId), false)
      assert.equal(graph.entries.find(row => row.id === '@deepseek-ai/dsh-client-ui-workspace').inject.includes(workspaceId), true)
      const table = [] // 原始webserver/index-inject给HTML的当前启动清单。
      ctx.emit('webserver/index-inject', table)
      assert.equal(table.find(row => row.kind === 'global' && row.name === '__DSH_BOOT__').value, graph)
      const original = await originalClientModuleSystem() // 公开ClientModuleSystem解析真实Host清单。
      const target = { mode: 'queue', pendingQueue: [], load() {} } // 合成经典script登记外壳，不改官方注册算法。
      const modules = original.createClientModuleSystem(target, { id: '@deepseek-ai/dsh-client-modules', exports: original }, {
        boot: graph, // 输入实际Registry扫描结果，不能用测试手工BootManifest替代。
        staticModules: {}, // 本目标只触发缺行错误，根本不会读取UI平台种子。
        loadBundle: async () => { throw new Error('缺行不能回退真实网络') }, // 若错误触发资源下载，本目标立即失败。
      })
      assert.equal(modules.manifest.plugins.some(row => row.id === workspaceId), false)
      assert.equal(modules.manifest.plugins.some(row => row.id === sessionId), false)
      await assert.rejects(modules.import(workspaceId + '/client', '', {}), /not a row in the boot graph/u)
      await assert.rejects(modules.import(sessionId + '/client', '', {}), /not a row in the boot graph/u)
    } finally {
      await registry?.dispose()
      await loader.dispose()
      await ctx.fiber.dispose()
    }
  })
