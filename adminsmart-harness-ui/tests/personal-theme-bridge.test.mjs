/** 真实自有Client Bundle的同源个人主题消息协议；不创建浏览器、网络或真实用户。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

/** @returns {object} 执行真实交付代码并提供可控官方主题、Host确认与父窗口。 */
function fixture() {
  const messages = [] // 只观察有限偏好状态，不使用Token或实际消息内容。
  const windowListeners = new Map() // 浏览器消息监听生命周期。
  const savedListeners = new Set() // Host实际持久化回执的公开Observable。
  const themeListeners = new Map() // 官方theme/change公开事件，覆盖system随系统变色的投影。
  const cleanups = [] // 测试结束释放当前Bundle创建的订阅和计时器。
  const selections = [] // 记录是否确实调用官方ThemeRuntime.setTheme。
  let state = { status: 'ready', preference: 'light', saving: false, error: null } // 本人已经确认的初始浅色。
  let active = 'light' // 官方渲染可以先乐观改变，父页面不能把它误报为保存成功。
  let factory // 原始ModuleLoader登记的自有工厂。
  const parent = { postMessage: (data, origin) => messages.push({ data: JSON.parse(JSON.stringify(data)), origin }) } // 来源不含业务身份，主应用自己持有账号。
  const window = { parent, location: { origin: 'https://fixture.invalid' }, addEventListener: (event, listener) => windowListeners.set(event, listener), removeEventListener: (event, listener) => { if (windowListeners.get(event) === listener) windowListeners.delete(event) }, __ModuleLoader__: { load: definition => { factory = definition.factory } } } // 只提供本目标所需公开浏览器协议。
  const theme = { getTheme: () => ({ active: { colorScheme: active } }), setTheme: mode => { selections.push(mode); active = mode; change({ saving: true, error: null }) } } // 模拟官方乐观选择，但不复制实际主题实现。
  const personal = { getSnapshot: () => state, subscribe: listener => { savedListeners.add(listener); return () => savedListeners.delete(listener) } } // 真实桥只消费非敏感本人状态。
  /** @param {object} fields Host确认或失败字段。 @returns {void} 通知真实Bundle的公开订阅。 */
  function change(fields) { state = { ...state, ...fields }; for (const listener of [...savedListeners]) listener() }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { window, setTimeout, clearTimeout, queueMicrotask })
  const client = factory(specifier => {
    if (specifier === 'react/jsx-runtime') return { jsx: () => null }
    if (specifier === 'react') return { useEffect() {}, useRef() {}, useState() {} }
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { Button() {} }
    throw new Error('fixture unexpected dependency')
  }) // 原样执行交付Bundle，不提取或复制消息函数。
  client.apply({ inject(dependencies, register) { assert.deepEqual(Array.from(dependencies), ['theme', 'adminsmartPersonalTheme']); register({ theme, adminsmartPersonalTheme: personal, on: (name, listener) => { themeListeners.set(name, listener); return () => themeListeners.delete(name) }, effect: create => cleanups.push(create()) }) }, slots: { inject() {} }, effect() {} }) // 品牌、退出和DOM遮罩不属于本测试，不装配其effect。
  const request = (data, origin = window.location.origin, source = parent) => windowListeners.get('message')?.({ data, origin, source }) // 独立验证来源与正文，绝不操作真实iframe。
  const close = () => { for (const cleanup of cleanups) cleanup() } // 当前测试只清理自己创建的效果。
  return { messages, selections, savedListeners, windowListeners, request, change, close, parent,
    /** @param {'light'|'dark'} mode 官方媒体查询解析后的有效色。 @returns {void} 仅发官方变色事件，不保存固定偏好。 */
    systemMode(mode) { active = mode; themeListeners.get('theme/change')?.() },
  }
}

test('只接受同源父页面窄载荷，真实官方选择保存确认后才返回ready', async () => {
  const current = fixture() // 当前合成用户，初始就绪必须主动通知宿主。
  try {
    assert.deepEqual(current.messages[0].data, { type: 'adminsmart:theme-state', status: 'ready', mode: 'light', preference: 'light' })
    for (const [data, origin, source] of [
      [{ type: 'adminsmart:theme-request', requestId: 'other', mode: 'dark' }, 'https://other.invalid', current.parent],
      [{ type: 'adminsmart:theme-request', requestId: 'other', mode: 'dark' }, 'https://fixture.invalid', {}],
      [{ type: 'adminsmart:theme-request', requestId: 'other', mode: 'dark', userId: 9 }, 'https://fixture.invalid', current.parent],
      [{ type: 'adminsmart:theme-request', requestId: 'x'.repeat(129), mode: 'dark' }, 'https://fixture.invalid', current.parent],
    ]) current.request(data, origin, source)
    assert.equal(current.selections.length, 0)
    current.request({ type: 'adminsmart:theme-request', requestId: 'read_1' })
    assert.equal(current.messages.at(-1).data.requestId, 'read_1')
    current.request({ type: 'adminsmart:theme-request', requestId: 'set_1', mode: 'dark' })
    await Promise.resolve()
    assert.deepEqual(current.selections, ['dark'])
    assert.equal(current.messages.some(message => message.data.requestId === 'set_1' && message.data.status === 'ready'), false, '乐观setTheme不是已保存回执')
    current.change({ preference: 'dark', status: 'ready', saving: false }) // 只有Host官方持久化成功才确认。
    assert.deepEqual(current.messages.at(-1).data, { type: 'adminsmart:theme-state', requestId: 'set_1', status: 'ready', mode: 'dark', preference: 'dark' })
  } finally { current.close() }
  assert.equal(current.windowListeners.size, 0)
  assert.equal(current.savedListeners.size, 0)
})

test('保存失败回固定错误和原确认颜色，卸载不发送迟到状态', () => {
  const current = fixture() // 不触及其他用户或全站设置。
  current.request({ type: 'adminsmart:theme-request', requestId: 'fail_1', mode: 'dark' })
  current.change({ status: 'error', saving: false, error: 'fixture-private-error' })
  const receipt = current.messages.at(-1).data // 真实桥必须丢弃底层异常内容。
  assert.equal(receipt.requestId, 'fail_1')
  assert.equal(receipt.status, 'error')
  assert.equal(receipt.mode, 'light')
  assert.equal(receipt.preference, 'light')
  assert.equal(receipt.error, '个人主题保存失败，请重试')
  current.close()
  const count = current.messages.length // 卸载后的Host迟到回执不能影响新账号或页面。
  current.change({ status: 'ready', preference: 'dark' })
  assert.equal(current.messages.length, count)
})

test('存量system保留Host偏好语义，官方系统色变化只投影有效色且不执行保存', () => {
  const current = fixture() // 同一已登录账号原生存量system，不从主页面缓存猜测偏好。
  try {
    current.change({ preference: 'system' })
    assert.deepEqual(current.messages.at(-1).data, { type: 'adminsmart:theme-state', status: 'ready', mode: 'light', preference: 'system' })
    current.systemMode('dark') // 模拟官方MQL解析结果，并直接执行交付代码订阅的公开事件。
    assert.deepEqual(current.messages.at(-1).data, { type: 'adminsmart:theme-state', status: 'ready', mode: 'dark', preference: 'system' })
    current.request({ type: 'adminsmart:theme-request', requestId: 'system_read' })
    assert.deepEqual(current.messages.at(-1).data, { type: 'adminsmart:theme-state', requestId: 'system_read', status: 'ready', mode: 'dark', preference: 'system' })
    current.systemMode('light')
    assert.equal(current.messages.at(-1).data.preference, 'system')
    assert.equal(current.messages.at(-1).data.mode, 'light')
    assert.equal(current.selections.length, 0, '系统变化或读取都不能把system转换为固定主题保存')
  } finally { current.close() }
})
