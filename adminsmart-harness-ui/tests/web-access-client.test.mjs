/** 浏览器开关请求的离线超时、取消、错误及初始显示测试，不启动浏览器。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8') // 实际发布的 Client 模块。
const marker = '    exports.inject = inject' // 唯一工厂导出位置，仅在测试内增加可见性，不改运行产物。
assert.equal(source.split(marker).length, 2)
const instrumented = source.replace(marker,
  '    exports.testRequest = requestSessionWebAccess\n    exports.testComponent = AdminSmartComposerTools\n' + marker)
const timers = new Map() // 手动触发超时，使测试不需要真实等待十秒。
let nextTimer = 0 // 每个隔离请求对应的唯一计时器身份。
let fetchImpl // 每项测试的网络替身，不允许真实 HTTP。
let registration // 捕获官方 ModuleLoader 注册的同一个工厂。
const sandbox = {
  window: { __ModuleLoader__: { load: entry => { registration = entry } } },
  AbortController,
  fetch: (...args) => fetchImpl(...args), // 所有模型或公网请求都被替身隔离。
  setTimeout: (callback, milliseconds) => {
    assert.equal(milliseconds, 10000)
    const id = ++nextTimer // 本次超时的有界注册项。
    timers.set(id, callback)
    return id
  },
  clearTimeout: id => timers.delete(id),
}
vm.runInNewContext(instrumented, sandbox, { filename: 'adminsmart-client-under-test.js' })
const client = registration.factory(name => {
  if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  if (name === 'react') return { useState: value => [value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }) }
  return {} // 本测试不调用应用初始化，不依赖其它 Harness UI 服务。
})
const initial = client.testComponent({ sessionId: 'fixture-session' }) // 公开 Slot inject 提供身份，不再伪造不存在的 session 属性。
const initialButton = initial.props.children[0] // 本组件唯一的地球开关。
assert.equal(initialButton.props['data-state'], 'unknown')
assert.equal(initialButton.props['aria-pressed'], false)
assert.equal(initialButton.props.disabled, true)

fetchImpl = async (_url, options) => {
  assert.equal(options.method, 'PUT')
  assert.equal(options.headers['X-AdminSmart-Session'], 'fixture-session')
  assert.equal(options.body, '{"enabled":false}')
  return { ok: true, json: async () => ({ enabled: false }) }
}
assert.equal(await client.testRequest('fixture-session', false), false)
assert.equal(timers.size, 0)

fetchImpl = async () => ({ ok: false, json: async () => ({ error: 'server diagnostic must not be shown' }) })
await assert.rejects(client.testRequest('fixture-session'), /联网设置暂时不可用/)
assert.equal(timers.size, 0)

let initialReads = 0 // 首次 Session 挂载竞态：前两次 Host 读取失败，随后返回权威默认值。
fetchImpl = async (_url, options) => {
  assert.equal(options.method, 'GET')
  initialReads += 1
  return initialReads < 3
    ? { ok: false, json: async () => ({ error: 'session is mounting' }) }
    : { ok: true, json: async () => ({ enabled: true }) }
}
assert.equal(await client.testRequest('fixture-session'), true)
assert.equal(initialReads, 3)

fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason), { once: true })
}) // 卡住的网络请求只有收到取消才结束。
const pending = client.testRequest('fixture-session') // 模拟之前一直锁住工具栏的请求。
for (const timeout of timers.values()) timeout()
await assert.rejects(pending, /超时/)
assert.equal(timers.size, 0)

const sessionAbort = new AbortController() // 模拟切换会话或卸载组件。
const leaving = client.testRequest('fixture-session', undefined, sessionAbort.signal)
sessionAbort.abort()
await assert.rejects(leaving, error => error.name === 'AbortError')
assert.equal(timers.size, 0)

const hookStates = [] // 保存真实组件的状态更新，覆盖从加载到点击保存的完整链路。
const hookRefs = [] // 防重与会话身份引用跨渲染保持一致。
let stateIndex = 0 // 当前渲染读取的状态槽位。
let refIndex = 0 // 当前渲染读取的引用槽位。
let effectDeps // 唯一会话生命周期 Effect 上一轮依赖。
let scheduledEffect // 本轮提交后需要启动的真实组件 Effect。
let cleanupEffect // 卸载时必须取消未完成的会话控制请求。
let serverEnabled = true // 隔离 Host 的权威开关，按钮必须实际请求它才能改变。
let serverFailure = false // 模拟一次读取失败后允许用户点击重试。
const componentRequests = [] // 捕获真实组件发出的请求，不调用用户 Runtime。
const interactiveClient = registration.factory(name => {
  if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  if (name === 'react') return {
    useState: initialValue => {
      const index = stateIndex++ // 同一个声明在每轮渲染对应同一状态槽位。
      if (!(index in hookStates)) hookStates[index] = initialValue
      return [hookStates[index], value => { hookStates[index] = value }]
    },
    useRef: initialValue => {
      const index = refIndex++ // 组件防重控制器不能在重渲染时丢失。
      return hookRefs[index] ??= { current: initialValue }
    },
    useEffect: (effect, deps) => {
      if (!effectDeps || deps.some((value, index) => value !== effectDeps[index])) {
        cleanupEffect?.()
        effectDeps = deps
        scheduledEffect = effect
      }
    },
  }
  return {}
})
fetchImpl = async (_url, options) => {
  componentRequests.push(options)
  assert.equal(options.headers['X-AdminSmart-Session'], 'fixture-interactive')
  if (serverFailure) return { ok: false, json: async () => ({ error: 'fixture rejected' }) }
  if (options.method === 'PUT') serverEnabled = JSON.parse(options.body).enabled
  return { ok: true, json: async () => ({ enabled: serverEnabled }) }
}
/** @returns {object} 使用真实 Slot 身份渲染输入区控件，再提交 Effect。 */
function renderInteractive() {
  stateIndex = 0
  refIndex = 0
  const tree = interactiveClient.testComponent({ sessionId: 'fixture-interactive' }) // 不传入任何 SessionSnapshot。
  if (scheduledEffect) {
    const effect = scheduledEffect // 提交后清空队列，防止重入时重复启动。
    scheduledEffect = undefined
    cleanupEffect = effect()
  }
  return tree
}
/** @returns {Promise<object>} 等待控制请求 Promise 链完整结束，不运行浏览器。 */
async function settleInteractive() {
  await new Promise(resolve => setImmediate(resolve))
  return renderInteractive()
}
assert.equal(renderInteractive().props.children[0].props.disabled, true)
let interactiveTree = await settleInteractive() // 初次 GET 成功后才能呈现蓝色开启状态。
assert.equal(interactiveTree.props.children[0].props['data-state'], 'on')
assert.equal(interactiveTree.props.children[0].props.disabled, false)
interactiveTree.props.children[0].props.onClick()
interactiveTree = await settleInteractive()
assert.equal(serverEnabled, false)
assert.equal(interactiveTree.props.children[0].props['data-state'], 'off')
interactiveTree.props.children[0].props.onClick()
interactiveTree = await settleInteractive()
assert.equal(serverEnabled, true)
assert.equal(interactiveTree.props.children[0].props['data-state'], 'on')
serverFailure = true
interactiveTree.props.children[0].props.onClick()
interactiveTree = await settleInteractive()
assert.equal(interactiveTree.props.children[0].props['aria-label'], '重试联网设置')
assert.equal(interactiveTree.props.children[0].props.disabled, false)
serverFailure = false
interactiveTree.props.children[0].props.onClick()
interactiveTree = await settleInteractive()
assert.equal(interactiveTree.props.children[0].props['data-state'], 'on')
assert.deepEqual(componentRequests.map(request => request.method), ['GET', 'PUT', 'PUT', 'PUT', 'GET'])
cleanupEffect?.()
assert.equal(timers.size, 0)
process.stdout.write('web_access_client_timeout_and_unknown_state=ok\n')
