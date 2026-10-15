/** 个人明暗的Host/ConfigForms闭环；所有用户、持久化和请求均为隔离Fake。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { installPersonalThemeHttp, PERSONAL_THEME_ROUTE } from '../src/personal-theme-http.mjs'
import { installUiPolicyClient, GENERAL_SETTINGS_NAMESPACES } from '../src/ui-policy-client.mjs'
import { applyGeneralSettings, captureGeneralSettings } from '../src/shared-ui-policy.mjs'

const POLICY = Object.freeze({ locale: 'zh', theme: 'dark', fontSize: 15, transcriptView: 'detailed', performanceUsage: 'compact', developerTools: false, busyEnter: 'queue', linkOpening: 'sidebar' }) // 已有全站历史记录，dark不能覆盖任一个人的明暗。

/**
 * 创建单个签名Runtime的官方SettingsForms与窄Host路由Fake。
 * @param {'light'|'dark'|'system'} preference 本人的原生持久化选择。
 * @returns {object} 独立用户值、Host调用入口及真实业务Client适配器创建方法。
 */
function runtime(preference = 'light') {
  const values = new Map([['locale', { preference: 'zh' }], ['ui-theme', { preference, fontSize: 15, codeFontSize: 11 }], ['ui-chat', { transcriptView: 'detailed', performanceUsage: 'compact', linkOpening: 'sidebar' }], ['ui-conversation', { busyEnter: 'queue' }], ['ui-settings', { enabled: false }]]) // 每个runtime拥有不同对象，不用cwd或浏览器origin替代账号隔离。
  let revision = 1 // 官方命名空间CAS的独立Fake计数，不使用General修订。
  let handler // 当前Runtime精确注册的Host入口。
  let failWrite = false // 可控持久化失败，仅影响本Runtime。
  const calls = [] // 观测是否错误调用全站PUT或写入其他字段。
  const settings = {
    describe: () => [...values].map(([ns, value]) => ({ ns, value: structuredClone(value), revision, schema: { type: 'object', dict: {} }, applies: 'live', autoGenerate: false, secrets: [] })),
    async update(ns, fields, expected) {
      assert.equal(expected, revision)
      if (failWrite) throw new Error('fixture-write-failed')
      values.set(ns, { ...values.get(ns), ...fields })
      revision += 1
    },
  } // 仅官方公开describe/update协议，没有原始文件访问。
  const context = { get: name => name === 'settings' ? settings : undefined, effect: register => register(), webServer: { register: route => { assert.equal(route.path, PERSONAL_THEME_ROUTE); handler = route.handler; return () => {} } } } // Gateway身份已通过选择Runtime固定，浏览器载荷不能覆盖。
  installPersonalThemeHttp(context, { assertSameOrigin: request => { if (request.headers['sec-fetch-site'] !== 'same-origin') throw new Error('fixture-origin') }, readJsonBody: async (request, maximumBytes) => { assert.equal(maximumBytes, 128); return JSON.parse(request.body) } })
  /** @param {string} method 请求方法。 @param {unknown} body 请求体。 @param {string} site FetchMetadata。 @returns {Promise<object>} 真实Host handler的安全回执。 */
  const invoke = async (method = 'GET', body, site = 'same-origin') => {
    const output = {} // Node响应替身只记录有限输出。
    await handler({ method, headers: { 'sec-fetch-site': site }, body: JSON.stringify(body) }, { writeHead: (status, headers) => Object.assign(output, { status, headers }), end: raw => { output.body = raw ? JSON.parse(raw) : undefined } })
    return output
  }
  const nativeDirectory = { getSnapshot: () => ({ status: 'ready', view: { namespaces: [], writable: false, hasDocument: false } }), subscribe: () => () => {}, ensure: async () => {} } // 普通角色完整原始Settings保持只读。
  const client = () => installUiPolicyClient({
    configForms: { get: () => ({}), describe: () => nativeDirectory }, // 未接管的设置仍没有写入口。
    remote: { settings: { describe: async () => ({ ok: true, value: { namespaces: settings.describe(), writable: false, hasDocument: false } }) }, $on: () => () => {} }, // 仅公开当前用户脱敏General描述。
    recoveryIntervalMs: 0, // 确定性测试不创建轮询或访问网络。
    fetchImpl: async (url, request) => {
      calls.push({ url, method: request.method })
      if (url === './adminsmart/ui-policy') { assert.equal(request.method, 'GET'); return { ok: true, json: async () => ({ revision: 4, settings: POLICY, writable: false }) } }
      assert.equal(url, './adminsmart/personal-theme')
      const reply = await invoke(request.method, JSON.parse(request.body)) // 直接调用本Runtime的真实路由，不开端口。
      return { ok: reply.status === 200, status: reply.status, json: async () => reply.body }
    },
  })
  return { values, settings, calls, invoke, client, fail: () => { failWrite = true } }
}

test('普通用户仅能持久保存本人的明暗，另一个用户及全站历史设置不变', async () => {
  const first = runtime() // 首次账号没有个人覆盖，明确使用浅色。
  const second = runtime('system') // 存量官方system偏好保留，不被默认或历史dark重置。
  const client = first.client() // 被测真实ConfigForms门禁，而非手写普通用户行为。
  try {
    await client.ready
    const form = client.configForms.get('ui-theme') // 官方ThemeRuntime实际消费的表单。
    assert.equal(form.getSnapshot().value.preference, 'light')
    assert.equal(client.configForms.describe().getSnapshot().view.writable, false)
    assert.equal(await form.set('preference', 'dark'), true)
    assert.equal(form.getSnapshot().value.preference, 'dark')
    assert.equal((await first.invoke()).body.preference, 'dark')
    assert.equal((await second.invoke()).body.preference, 'system')
    assert.equal(first.calls.filter(call => call.url === './adminsmart/ui-policy' && call.method === 'PUT').length, 0)
    for (const [field, value] of [['fontSize', 20], ['codeFontSize', 14], ['providers', {}]]) assert.equal(await form.set(field, value), false)
    assert.equal(await form.mutate([{ op: 'set', path: ['preference'], value: 'light' }, { op: 'set', path: ['fontSize'], value: 20 }]), false)
    assert.equal(await client.configForms.get('ui-settings').set('enabled', true), false)
    const reload = first.client() // 重新装配从同一本人官方存储读取，不能依赖浏览器内存。
    await reload.ready
    assert.equal(reload.configForms.get('ui-theme').getSnapshot().value.preference, 'dark')
    reload.dispose()
  } finally { client.dispose() }
})

test('窄Host拒绝跨站、伪造身份、字体和任意配置；失败不伪报保存或泄漏异常', async () => {
  const user = runtime() // 独立普通用户，Host路由无需授予Settings全局写权。
  assert.equal((await user.invoke('PUT', { mode: 'dark' }, 'cross-site')).status, 403)
  for (const body of [{ mode: 'dark', userId: 99 }, { mode: 'dark', fontSize: 20 }, { preference: 'dark' }, { mode: 'system' }, null]) assert.equal((await user.invoke('PUT', body)).status, 400)
  assert.equal((await user.invoke('DELETE')).status, 405)
  user.fail()
  const response = await user.invoke('PUT', { mode: 'dark' }) // 官方持久化失败不能返回乐观成功。
  assert.equal(response.status, 503)
  assert.doesNotMatch(JSON.stringify(response.body), /fixture-write-failed|userId|profile/u)
  assert.equal((await user.invoke()).body.preference, 'light')
  const client = user.client() // 同一失败通过正式Client变成真实错误及原颜色回退。
  await client.ready
  assert.equal(await client.configForms.get('ui-theme').set('preference', 'dark'), false)
  assert.equal(client.personalTheme.getSnapshot().status, 'error')
  assert.equal(client.configForms.get('ui-theme').getSnapshot().value.preference, 'light')
  client.dispose()
})

test('General仍同步字号和规则，历史theme不采用、不从个人选择反向捕获', async () => {
  const user = runtime('light') // 本人浅色与历史全站dark故意冲突。
  await applyGeneralSettings(user.settings, { ...POLICY, fontSize: 20 })
  assert.equal(user.values.get('ui-theme').preference, 'light')
  assert.equal(user.values.get('ui-theme').fontSize, 20)
  assert.deepEqual(captureGeneralSettings(user.settings, POLICY.theme), { ...POLICY, fontSize: 20 })
  user.values.get('ui-theme').preference = 'dark'
  assert.deepEqual(captureGeneralSettings(user.settings, 'system'), { ...POLICY, theme: 'system', fontSize: 20 })
  assert.equal(GENERAL_SETTINGS_NAMESPACES.includes('ui-theme'), true, '字体仍由原共享命名空间提供')
})
