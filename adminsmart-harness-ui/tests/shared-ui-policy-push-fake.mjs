/** General Host 推送回归：真实 SSE 字节/流接口配合 Fake 后端，不访问网络、Redis、用户数据或模型。 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { captureGeneralSettings, installSharedUiPolicy, parseUiPolicyEvent, watchUiPolicyEvents } from '../src/shared-ui-policy.mjs'

const POLICY = Object.freeze({
  locale: 'zh', // 合成显式语言偏好。
  theme: 'dark', // 合成初始外观。
  fontSize: 15, // 合成内容字号。
  transcriptView: 'standard', // 合成工作细节。
  performanceUsage: 'compact', // 合成统计显示模式。
  developerTools: false, // 显式关闭，不能被默认值补成开启。
  busyEnter: 'queue', // 合成忙碌输入行为。
  linkOpening: 'sidebar', // 合成外部链接位置。
})

/** @returns {object} 与签名 Runtime 装配形状一致的纯合成身份，不读取实际能力文件。 */
function options() {
  return {
    apiBase: 'http://ui-policy-push.invalid', // 仅允许完全 Fake 的固定后端根，不能打开真实套接字。
    readToken: async () => 'fixture-capability', // 不读取受保护令牌文件的合成能力来源。
    userId: '8', // 与签名 Runtime 绑定的合成普通账号。
    modeId: 'knowledge', // 服务端白名单业务模式 Fixture。
    presetId: 'adminsmart-knowledge', // 该模式对应的 Preset Fixture。
    isAdmin: false, // 普通用户只读，测试不能凭页面数据升级角色。
  }
}

/** @param {object} t Node 测试生命周期。 @returns {object} 完全内存的 SSE 与策略 GET 后端。 */
function backend(t) {
  const state = { remote: { revision: 1, settings: structuredClone(POLICY) }, streams: [], calls: [], aborts: 0 } // 独立真源、连接观测与卸载计数。
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    state.calls.push({ url, method: request.method, headers: request.headers })
    if (url.endsWith('/ui-policy/events')) {
      assert.equal(request.method, 'GET')
      assert.equal(request.redirect, 'error')
      let controller // Fake 流控制端，只发送本测试指定的有限协议帧。
      const body = new ReadableStream({ start(value) { controller = value } }) // 使用 Node 标准流，验证真正的跨块 UTF-8/SSE 接口。
      request.signal.addEventListener('abort', () => {
        state.aborts += 1
        try { controller.error(new Error('fixture stream cancelled')) } catch {}
      }, { once: true })
      state.streams.push({ emit: source => controller.enqueue(new TextEncoder().encode(source)), close: () => controller.close() })
      return { ok: true, body }
    }
    assert.equal(url, 'http://ui-policy-push.invalid/internal/agent-model/v1/ui-policy')
    assert.equal(request.method, 'GET', '普通用户永远不发布设置')
    return { ok: true, json: async () => structuredClone(state.remote) }
  })
  return state
}

/** @returns {Promise<void>} 排空实际网络 Fake/标准流微任务，不等待补偿轮询。 */
async function flush() { await new Promise(resolve => setImmediate(resolve)) }

/** @param {object} policy 完整 General Fixture。 @returns {object} 原生 SettingsForms 公开协议 Fake。 */
function nativeSettings(policy) {
  const values = new Map([
    ['locale', { preference: policy.locale }],
    ['ui-theme', { preference: policy.theme, fontSize: policy.fontSize }],
    ['ui-chat', { transcriptView: policy.transcriptView, performanceUsage: policy.performanceUsage, linkOpening: policy.linkOpening }],
    ['ui-settings', { enabled: policy.developerTools }],
    ['ui-conversation', { busyEnter: policy.busyEnter }],
  ]) // 固定官方命名空间，不模拟任意 Profile JSON。
  return {
    describe: () => [...values].map(([ns, value]) => ({ ns, value, revision: 1 })),
    async update(ns, fields) { values.set(ns, { ...values.get(ns), ...fields }) },
    async mutate(ns) { values.set(ns, {}) },
  }
}

test('有限事件解析拒绝任意载荷/类型，ready/resync只触发回读', () => {
  assert.deepEqual(parseUiPolicyEvent('event: ready\ndata: {}'), { kind: null, revision: null })
  assert.deepEqual(parseUiPolicyEvent('event: resync\ndata: {}'), { kind: null, revision: null })
  assert.equal(parseUiPolicyEvent(': keep-alive'), null)
  assert.deepEqual(parseUiPolicyEvent('event: policy-invalidated\ndata: {"kind":"shortcuts","revision":2}'), { kind: 'shortcuts', revision: 2 })
  for (const frame of ['event: arbitrary\ndata: {}', 'event: ready\ndata: {"settings":{}}', 'event: policy-invalidated\ndata: {"kind":"general","revision":true}', 'event: policy-invalidated\ndata: {"kind":"general","revision":2,"userId":7}']) {
    assert.throws(() => parseUiPolicyEvent(frame))
  }
})

test('跨块SSE真实推送即时触发，重复乱序修订不会重复GET，卸载直接释放连接', async t => {
  const state = backend(t) // 不建立真实 HTTP 连接。
  const events = [] // 只记录已验证的恢复信号与新 General 修订。
  const dispose = watchUiPolicyEvents(options(), event => { events.push(event) }) // 不启动五秒轮询。
  t.after(dispose)
  await flush()
  const stream = state.streams[0] // 当前唯一受控 SSE。
  stream.emit('event: ready\r')
  stream.emit('\ndata: {}\r\n\r\n')
  for (const revision of [3, 2, 3, 4]) stream.emit(`event: policy-invalidated\ndata: {"kind":"general","revision":${revision}}\n\n`)
  stream.emit('event: policy-invalidated\ndata: {"kind":"shortcuts","revision":99}\n\n')
  await flush()
  assert.deepEqual(events, [{ kind: null, revision: null }, { kind: 'general', revision: 3 }, { kind: 'general', revision: 4 }])
  dispose()
  await flush()
  assert.equal(state.aborts, 1)
  assert.equal(state.calls.length, 1)
})

test('普通用户已打开Runtime立即采用管理员新策略，不等待任何定时轮询或产生PUT', async t => {
  const state = backend(t) // 初始策略已保存，后续 revision二模拟管理员在另一个 Runtime 的提交。
  let release // 官方 effect 唯一拥有的卸载函数。
  const ctx = {
    settings: nativeSettings(POLICY), // 普通用户原生 Settings 与后端 Fixture没有共享对象引用。
    effect(register) { release = register() },
    on() { throw new Error('普通用户不能订阅出站编辑事件') },
    logger: { warn() {} },
  } // 不创建 Harness 进程或真实 Session。
  installSharedUiPolicy(ctx, options())
  t.after(() => release?.())
  await flush()
  state.streams[0].emit('event: ready\ndata: {}\n\n')
  await flush()
  const changed = { ...POLICY, theme: 'light', fontSize: 21 } // 另一个管理员实际保存的完整值。
  state.remote = { revision: 2, settings: changed }
  state.streams[0].emit('event: policy-invalidated\ndata: {"kind":"general","revision":2}\n\n')
  await flush()
  assert.deepEqual(captureGeneralSettings(ctx.settings), changed)
  assert.equal(state.calls.filter(call => call.method === 'PUT').length, 0)
  const reads = state.calls.filter(call => !call.url.endsWith('/events')).length // 已完成回读数，用于验证乱序/重复事件被合并。
  state.streams[0].emit('event: policy-invalidated\ndata: {"kind":"general","revision":2}\n\nevent: policy-invalidated\ndata: {"kind":"general","revision":1}\n\n')
  await flush()
  assert.equal(state.calls.filter(call => !call.url.endsWith('/events')).length, reads)
})

test('有界重连重新读取签名能力，ready必回读以恢复断线期间保存的策略', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const state = backend(t) // 全部请求由进程内 Fake处理。
  const seen = [] // 合法通知的观察序列。
  let tokenReads = 0 // 每次连接必须重新读取能力，不能沿用旧进程凭据。
  const runtime = { ...options(), readToken: async () => { tokenReads += 1; return `fixture-capability-${tokenReads}` } } // 合成轮换令牌，无真实认证值。
  const dispose = watchUiPolicyEvents(runtime, event => { seen.push(event) })
  t.after(dispose)
  await flush()
  state.streams[0].emit('event: ready\ndata: {}\n\n')
  await flush()
  state.streams[0].close()
  await flush()
  t.mock.timers.tick(1_000)
  await flush()
  assert.equal(tokenReads, 2)
  assert.notEqual(state.calls[0].headers.Authorization, state.calls[1].headers.Authorization)
  state.streams[1].emit('event: ready\ndata: {}\n\n')
  await flush()
  assert.deepEqual(seen, [{ kind: null, revision: null }, { kind: null, revision: null }])
  dispose()
  await flush()
  t.mock.timers.tick(70_000)
  await flush()
  assert.equal(state.calls.length, 2, '卸载后不能被旧连接或计时器重新拉起')
})
