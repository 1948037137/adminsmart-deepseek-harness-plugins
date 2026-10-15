/** 有限 UI 策略 HTTP 桥的离线权限与传输回归，不启动 HTTP/Gateway 或访问真实后端。 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { UI_POLICY_CLIENT_REVISION_GLOBAL, UI_POLICY_CLIENT_ROUTE, UI_POLICY_ROUTE, installUiPolicyHttp, requestUiPolicy } from '../src/ui-policy-http.mjs'

const POLICY = Object.freeze({
  locale: 'zh', // 合成语言选择。
  theme: 'dark', // 与官方默认不同的外观选择。
  fontSize: 22, // 新版合法字号上界。
  transcriptView: 'verbose', // 新版完全展开，不误用旧 expanded。
  performanceUsage: 'compact', // 合成统计选择。
  busyEnter: 'steer', // 合成忙碌 Enter 选择。
  linkOpening: 'new-tab', // 合成链接选择。
  developerTools: false, // 显式关闭诊断界面。
})

/** @param {boolean} admin 可信服务端角色。 @returns {object} 不读凭据或环境的签名 options Fake。 */
function signedOptions(admin = true) {
  return {
    apiBase: 'http://backend.invalid', // fetch 完全替换，不打开套接字。
    readToken: async () => 'fixture-capability', // 合成标记，不读取 Runtime 的真实令牌。
    userId: '7', // 服务端固定签名身份。
    modeId: 'knowledge', // 服务端业务模式。
    presetId: 'adminsmart-knowledge', // 服务端 Preset。
    isAdmin: admin, // 唯一被 Host 使用的管理员标记。
  }
}

/** @param {object} t 测试上下文。 @param {boolean} admin 可信服务端角色。 @param {Buffer} clientModuleSource 固定代码字节 Fixture。 @returns {object} 直接调用路由的离线 HTTP 协议 Fake。 */
function routeFixture(t, admin = true, clientModuleSource = Buffer.from('export const fixture = true\n')) {
  const routes = new Map() // 捕获官方 webServer.register 的精确路由。
  const state = { remote: { revision: 3, settings: { ...POLICY } }, calls: [], bodyReads: 0, status: 200 } // 内存后端与请求观测，不建立数据库。
  const disposers = [] // effect 释放每个路由。
  const pageInjections = [] // 捕获官方初始化表，不读取浏览器或真实用户配置。
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    state.calls.push({ url, options })
    assert.equal(url, 'http://backend.invalid/internal/agent-model/v1/ui-policy')
    assert.equal(options.headers['X-AdminSmart-User-Id'], '7')
    assert.equal(options.headers['X-AdminSmart-Agent-Mode-Id'], 'knowledge')
    assert.equal(options.headers['X-AdminSmart-Agent-Preset-Id'], 'adminsmart-knowledge')
    assert.equal(options.headers.Authorization, 'Bearer fixture-capability')
    assert.equal(options.redirect, 'error')
    if (state.status !== 200) return { ok: false, status: state.status }
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body) // 只接收已经过 Host 白名单校验的 CAS 输入。
      if (body.expectedRevision !== state.remote.revision) return { ok: false, status: 409 }
      state.remote = { revision: state.remote.revision + 1, settings: body.settings }
    }
    return { ok: true, json: async () => structuredClone(state.remote), headers: { get: () => state.delivery ?? null } }
  })
  const ctx = {
    on(event, listener) { assert.equal(event, 'webserver/index-inject'); listener(pageInjections); return () => { pageInjections.length = 0 } }, // 初始化只注入可信代码版本，卸载同时释放。
    webServer: { register(route) { assert.equal(route.kind, 'exact'); routes.set(route.path, route); return () => routes.delete(route.path) } },
    effect(register) { disposers.push(register()) },
  } // 不创建官方 Web Server，也不启动 Gateway。
  installUiPolicyHttp(ctx, signedOptions(admin), {
    assertSameOrigin(request) { if (request.headers['sec-fetch-site'] !== 'same-origin') throw new Error('fixture rejected origin') },
    async readJsonBody(request, maximumBytes) {
      state.bodyReads += 1
      assert.equal(maximumBytes, 4_096)
      if (Buffer.byteLength(request.body ?? '', 'utf8') > maximumBytes) throw new Error('fixture oversized body')
      return JSON.parse(request.body)
    },
    clientModuleSource, // 固定自有代码快照 Fake，不读用户文件或第三方构建文件。
  })
  /** @param {string} path 精确注册路径。 @param {string} method HTTP 方法。 @param {object|undefined} body 输入 JSON。 @param {object} headers 浏览器 Header Fixture。 @returns {Promise<object>} 安全响应。 */
  async function invoke(path, method = 'GET', body, headers = {}) {
    const output = { status: null, headers: null, body: undefined } // Node ServerResponse 协议的最小观测值。
    await routes.get(new URL(path, 'http://fixture.invalid').pathname).handler({ method, url: path, headers: { 'sec-fetch-site': 'same-origin', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }, {
      writeHead(status, responseHeaders) { output.status = status; output.headers = responseHeaders },
      end(content) { output.body = content },
    })
    return output
  }
  const close = () => { for (const dispose of disposers) dispose() } // 当前测试只卸载自己的两个路由。
  t.after(close)
  return { routes, state, pageInjections, invoke, close }
}

test('管理员 GET/PUT 只传 General 与 CAS，身份由服务端绑定，响应没有凭据', async t => {
  const fixture = routeFixture(t) // 可信管理员 Runtime Fixture。
  const viewed = await fixture.invoke(UI_POLICY_ROUTE, 'GET', undefined, { 'x-adminsmart-user-id': '999', Cookie: 'fixture-browser-cookie' }) // 浏览器伪造身份不能覆盖 options。
  assert.equal(viewed.status, 200)
  assert.deepEqual(JSON.parse(viewed.body), { revision: 3, settings: POLICY, writable: true })
  assert.doesNotMatch(viewed.body, /fixture-capability|fixture-browser-cookie|999/u)
  const chosen = { ...POLICY, fontSize: 10, transcriptView: 'standard' } // 另一种合法 RC2 管理员选择。
  const saved = await fixture.invoke(UI_POLICY_ROUTE, 'PUT', { expectedRevision: 3, settings: chosen }) // 只有两个允许的外层字段。
  assert.deepEqual(JSON.parse(saved.body), { revision: 4, settings: chosen, writable: true })
  assert.deepEqual(JSON.parse((await fixture.invoke(UI_POLICY_ROUTE)).body).settings, chosen)
  assert.equal(saved.headers['cache-control'], 'no-store')
})

test('普通用户只读，伪造管理员请求在读正文和发后端请求前拒绝', async t => {
  const fixture = routeFixture(t, false) // 服务端普通用户角色不能被客户端选择改变。
  const viewed = await fixture.invoke(UI_POLICY_ROUTE) // 普通用户可以读取共享策略。
  assert.equal(JSON.parse(viewed.body).writable, false)
  fixture.state.calls.length = 0
  const denied = await fixture.invoke(UI_POLICY_ROUTE, 'PUT', { expectedRevision: 3, settings: POLICY, isAdmin: true }, { 'x-adminsmart-is-admin': '1' })
  assert.equal(denied.status, 403)
  assert.equal(fixture.state.bodyReads, 0)
  assert.equal(fixture.state.calls.length, 0)
})

test('已保存但实时发布失败时仅透传安全delayed Header，body不扩展也不误报保存失败', async t => {
  const fixture = routeFixture(t) // 合成管理员提交，后台数据库保存已经成功。
  fixture.state.delivery = 'delayed'
  const saved = await fixture.invoke(UI_POLICY_ROUTE, 'PUT', { expectedRevision: 3, settings: POLICY }) // CAS仍保持既有修订与白名单。
  assert.equal(saved.status, 200)
  assert.equal(saved.headers['x-adminsmart-ui-policy-delivery'], 'delayed')
  assert.deepEqual(JSON.parse(saved.body), { revision: 4, settings: POLICY, writable: true })
  fixture.state.delivery = 'fixture-arbitrary-private-header'
  const next = await fixture.invoke(UI_POLICY_ROUTE, 'PUT', { expectedRevision: 4, settings: POLICY }) // 任意Header不能穿过安全枚举。
  assert.equal(next.headers['x-adminsmart-ui-policy-delivery'], 'delivered')
})

test('拒绝跨站、任意 Profile 字段、非法枚举与无效请求方法', async t => {
  const fixture = routeFixture(t) // 所有非法输入都必须在后端调用前拒绝。
  assert.equal((await fixture.invoke(UI_POLICY_ROUTE, 'PUT', { expectedRevision: 3, settings: POLICY }, { 'sec-fetch-site': 'cross-site' })).status, 403)
  for (const settings of [{ ...POLICY, profile: { arbitrary: true } }, { ...POLICY, transcriptView: 'fully-expanded' }, { ...POLICY, fontSize: 23 }]) {
    assert.equal((await fixture.invoke(UI_POLICY_ROUTE, 'PUT', { expectedRevision: 3, settings })).status, 400)
  }
  assert.equal((await fixture.invoke(UI_POLICY_ROUTE, 'PUT', { expectedRevision: 3, settings: POLICY, userId: '999' })).status, 400)
  assert.equal((await fixture.invoke(UI_POLICY_ROUTE, 'DELETE')).status, 405)
  assert.equal(fixture.state.calls.length, 0)
})

test('后端 CAS 返回 409，临时失败保持原选择且不泄漏错误正文', async t => {
  const fixture = routeFixture(t) // 已有修订三，陈旧修订不能写入。
  const conflict = await fixture.invoke(UI_POLICY_ROUTE, 'PUT', { expectedRevision: 2, settings: { ...POLICY, theme: 'light' } })
  assert.equal(conflict.status, 409)
  assert.equal(JSON.parse(conflict.body).error.code, 'agent_ui_policy_conflict')
  assert.deepEqual(fixture.state.remote.settings, POLICY)
  fixture.state.status = 500
  const failed = await fixture.invoke(UI_POLICY_ROUTE)
  assert.equal(failed.status, 503)
  assert.deepEqual(JSON.parse(failed.body), { error: { code: 'agent_ui_policy_unavailable', message: '通用设置暂时不可用' } })
  fixture.state.status = 200
  assert.deepEqual(JSON.parse((await fixture.invoke(UI_POLICY_ROUTE)).body).settings, POLICY)
})

test('上游响应包含额外数据、非法修订或字段时失败，不向浏览器转发', async t => {
  const fixture = routeFixture(t) // 把上游响应完整视为未信任数据。
  for (const remote of [{ revision: 3, settings: POLICY, unexpected: 'fixture-private-marker' }, { revision: -1, settings: POLICY }, { revision: 3, settings: { ...POLICY, developerTools: 'yes' } }]) {
    fixture.state.remote = remote
    const response = await fixture.invoke(UI_POLICY_ROUTE)
    assert.equal(response.status, 502)
    assert.doesNotMatch(response.body, /fixture-private-marker|fixture-capability/u)
  }
})

test('固定 JS 资源只允许 GET/HEAD，卸载后路由清理，不包含身份或 Token', async t => {
  const fixture = routeFixture(t) // JS 资源不调用后端。
  const source = await fixture.invoke(UI_POLICY_CLIENT_ROUTE)
  assert.equal(source.status, 200)
  assert.equal(source.headers['content-type'], 'text/javascript; charset=utf-8')
  assert.equal(source.headers['x-content-type-options'], 'nosniff')
  assert.equal(source.headers['cache-control'], 'no-store')
  assert.equal((await fixture.invoke(UI_POLICY_CLIENT_ROUTE, 'HEAD')).body, undefined)
  assert.equal((await fixture.invoke(UI_POLICY_CLIENT_ROUTE, 'POST')).status, 405)
  assert.equal(fixture.state.calls.length, 0)
  fixture.close()
  assert.equal(fixture.routes.size, 0)
  assert.equal(fixture.pageInjections.length, 0)
})

for (const isAdmin of [true, false]) test(`纯静态模块可信SHA缓存与原字节/HEAD一致，角色=${isAdmin ? 'admin' : 'managed-user'}，策略仍不缓存`, async t => {
  const original = await readFile(new URL('../src/ui-policy-client.mjs', import.meta.url)) // 正式纯模块代码，不加载凭据、会话或后端状态。
  const mutable = Buffer.from(original) // 验证 Host 拷贝后外部 Buffer 修改不能改变哈希对应的响应。
  const fixture = routeFixture(t, isAdmin, mutable) // 两个角色使用相同静态代码与缓存协议。
  const revision = createHash('sha256').update(original).digest('hex') // 独立按正式响应字节计算预期哈希。
  assert.deepEqual(fixture.pageInjections, [{ kind: 'html', placement: 'head', html: '<link rel="modulepreload" crossorigin href=".' + UI_POLICY_CLIENT_ROUTE + '?rev=' + revision + '">' }, { kind: 'global', name: UI_POLICY_CLIENT_REVISION_GLOBAL, value: revision }]) // 两角色使用完全相同静态URL，预载不访问政策或扩大写权限。
  mutable.fill(0)
  const versioned = `${UI_POLICY_CLIENT_ROUTE}?rev=${revision}` // 只接受 Host 注入的当前版本，不用共享策略 revision。
  for (const method of ['GET', 'HEAD']) {
    const response = await fixture.invoke(versioned, method) // HEAD 必须与 GET 有相同实体元数据。
    assert.equal(response.status, 200)
    assert.equal(response.headers['cache-control'], 'private, max-age=31536000, immutable')
    assert.equal(response.headers['content-length'], String(original.byteLength))
    assert.equal(response.headers['set-cookie'], undefined)
    if (method === 'GET') assert.deepEqual(response.body, original)
    else assert.equal(response.body, undefined)
  }
  for (const suffix of ['?rev=', `?rev=${'a'.repeat(64)}`, '?rev=malformed', `?rev=${revision}&rev=${revision}`]) {
    const stale = await fixture.invoke(UI_POLICY_CLIENT_ROUTE + suffix) // 空、旧、非法或重复版本不得以当前字节冒充历史代码。
    assert.equal(stale.status, 410)
    assert.equal(stale.headers['cache-control'], 'no-store')
    assert.equal(stale.body, undefined)
  }
  assert.equal(fixture.state.calls.length, 0)
  const policy = await fixture.invoke(`${UI_POLICY_ROUTE}?rev=${revision}`) // 静态版本参数不能使动态策略获得缓存或跳过身份读取。
  assert.equal(policy.headers['cache-control'], 'no-store')
  assert.equal(fixture.state.calls.length, 1)
  assert.equal(JSON.parse(policy.body).writable, isAdmin)
})

test('服务端直接调用也不能越过角色或白名单，传输失败转换为安全错误', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('fixture internal transport detail') })
  await assert.rejects(requestUiPolicy(signedOptions(false), 'PUT', { expectedRevision: 3, settings: POLICY }), error => error.status === 403)
  await assert.rejects(requestUiPolicy(signedOptions(), 'PUT', { expectedRevision: 3, settings: { ...POLICY, fontSize: true } }), error => error.status === 400)
  await assert.rejects(requestUiPolicy(signedOptions(), 'GET'), error => error.status === 503 && error.message === '通用设置暂时不可用')
})
