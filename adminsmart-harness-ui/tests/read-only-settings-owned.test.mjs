/** 普通用户 owned Settings Remote 的真实SDK目标回归；外部数据均为合成Fixture，无网络、磁盘用户数据或模型调用。 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 测试调用方明确指定的固定SDK，不持久化本机安装路径。

test('真实Cordis/TypertGateway普通Remote提供owned General Schema与false，不暴露模型凭据或写方法', { skip: !runtimeRoot }, async () => {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 所有公开SDK能力从同一固定安装解析。
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href) // 实际fiber依赖及生命周期，不用Fake替代。
  const { default: TypertRegistry } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-registry')).href) // 实际SRC协议注册表。
  const { default: TypertGateway } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-gateway')).href) // 真正公开Remote dispatch，不直接冒充RPC返回。
  const { default: RemoteAccess } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-remote-access')).href) // 原始Gateway真实访问策略依赖，不使用全允许Fake。
  const { Peer } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-connection')).href) // 独立Runtime内普通业务用户仍是HostOwner，不能据此获得全站写能力。
  const { remoteMethods } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-protocol')).href) // 实际标准装饰器元数据接口。
  const { AdminSmartReadOnlySettings } = await import('../src/read-only-settings.mjs') // 当前产品正式只读Remote。
  const namespaces = ['locale', 'ui-theme', 'ui-chat', 'ui-conversation', 'ui-settings'] // 五种General Schema与兼容canonical身份。
  const descriptors = [] // 只有真实SDK解析的展示数据，Fixture中另加被禁止的诱饵描述。
  for (const namespace of namespaces) {
    const module = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-' + namespace)).href) // 各显示字段由官方Config真实解析。
    const config = module.Config(namespace === 'ui-settings' ? { enabled: false } : {}) // 显式false必须保留，不能按真值补默认开启。
    descriptors.push({
      ns: namespace === 'ui-settings' ? 'adminsmart-shared-settings' : namespace, // 普通Runtime的新Profile只有owned entry。
      schema: module.Config.toJSON(), // 原封不动的官方序列化Schema。
      value: Object.fromEntries(Object.entries(config).map(([field, value]) => [field, value.get()])), // 从官方z引用读取实际默认值和false。
      applies: 'live', // 五种General字段都由官方支持实时采用。
      revision: 3, // 合成官方namespace CAS，仅供只读描述验证。
      secrets: [], // 展示字段不携带秘密引用。
    })
  }
  descriptors.push(
    { ns: 'llm-pi-ai', value: { apiKey: 'fixture-credential-marker' }, schema: {}, revision: 4 }, // 只验证白名单排除，不是真实凭据。
    { ns: 'credentials', value: { marker: 'fixture-private-marker' }, schema: {}, revision: 4 }, // 独立凭据服务不得伪装成General。
    { ns: 'adminsmart-shared-settings-extra', value: { marker: 'fixture-unapproved-marker' }, schema: {}, revision: 4 }, // 前缀相似的未知entry同样禁止。
  )
  const ctx = new Context() // 实际Cordis树，完全没有HTTP/数据库或用户Runtime。
  const peer = new Peer(ctx, { principal: { kind: 'owner' } }) // 明确公开Peer身份，真实只读Remote仍负责业务方法边界。
  ctx.provide('settings', { describe(options) {
    assert.deepEqual(options, { redactSecrets: true })
    return structuredClone(descriptors)
  } }) // Fake仅提供安全Schema数据源，实际Remote/Gateway执行正式协议。
  const registry = ctx.plugin(TypertRegistry) // 公开SDK注册表按真实生命周期激活。
  await registry.await()
  const access = ctx.plugin(RemoteAccess) // 与生产相同官方访问服务，在Gateway之前就绪。
  await access.await()
  const gateway = ctx.plugin(TypertGateway) // 未挂Connection/WebServer，不产生任何网络监听。
  await gateway.await()
  const controller = ctx.plugin(AdminSmartReadOnlySettings) // 普通Remote作为真正的独立Service fiber挂载。
  await controller.await()
  try {
    assert.equal(controller.state, 2)
    assert.deepEqual(remoteMethods(ctx.get('settingsController')).map(method => method.method), ['describe'])
    const result = await ctx.get('typertGateway').invoke({
      namespace: 'settings', // 与正式Client remote.settings一致的公开RPC命名空间。
      method: 'describe', // 普通用户唯一允许的方法。
      args: {}, // 无用户、环境、路径或任意配置输入。
      peer, // 显式经过原Gateway的身份访问检查，不绕过权限链。
    })
    assert.deepEqual(result.namespaces.map(row => row.ns), ['locale', 'ui-theme', 'ui-chat', 'ui-conversation', 'adminsmart-shared-settings'])
    assert.equal(result.namespaces.find(row => row.ns === 'adminsmart-shared-settings').value.enabled, false)
    assert.equal(result.writable, false)
    assert.equal(result.hasDocument, false)
    assert.ok(result.namespaces.every(row => row.autoGenerate === false && row.secrets.length === 0))
    assert.doesNotMatch(JSON.stringify(result), /fixture-credential-marker|fixture-private-marker|fixture-unapproved-marker|llm-pi-ai|credentials/u)
    for (const method of ['mutate', 'update', 'prepareDocument', 'openSettingsDocument']) {
      await assert.rejects(ctx.get('typertGateway').invoke({ namespace: 'settings', method, args: {}, peer }), error => error.code === 'gateway/invocation-unavailable')
    }
    assert.equal(ctx.get('credentialsController'), undefined)
  } finally {
    await controller.dispose()
    await gateway.dispose()
    await access.dispose()
    await registry.dispose()
    await ctx.fiber.dispose()
  }
})
