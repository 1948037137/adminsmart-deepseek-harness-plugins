/** iframe 集成仅同步官方模态几何；聊天正文、Composer 与弹窗内容均保留原始所有者。 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

test('聊天与Composer变化不触发适配，官方弹窗几何合批且内容保持原样', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8') // 完整正式 Bundle，不抽取私有函数。
  const queued = [] // 可控 microtask 批次，验证多次 mutation 只安排一次兼容处理。
  const observations = [] // 当前根与局部 Observer 的公开配置，不观察真实页面。
  const texts = Object.freeze(['探索未至之境', 'Into the Unknown', 'Preview', '预览版']) // 撞上旧品牌替换规则的正文 canary。
  const messages = [] // iframe 发给合成同源宿主的非敏感几何协议。
  const rectangle = Object.freeze({ left: 12, top: 24, width: 480, height: 600 }) // 官方弹窗自身产生的合成布局，业务只能读取。
  let documentScans = 0 // root仅允许通过明确语义选择器发现区域。
  let release // 正式 chrome effect 的完整卸载能力。
  let registration // 官方 Bundle 登记的原始工厂。
  const chat = { closest: selector => selector === '[data-conversation-region="chat"]' ? chat : null, querySelectorAll() { throw new Error('聊天正文禁止适配') } } // 即使正文伪造role=dialog也必须排除。
  const composer = { isConnected: true, closest: () => null, querySelectorAll() { throw new Error('Composer禁止兼容改写') } } // 普通输入状态不能成为模态观察器目标。
  const dialog = {
    isConnected: true, // 官方弹窗挂载后才发布其几何。
    closest: selector => selector === '[role="dialog"]' ? dialog : null, // 不属于隐藏、外部遮罩或聊天正文。
    getBoundingClientRect: () => rectangle, // 不访问屏幕或真实用户 DOM。
    querySelectorAll() { throw new Error('只能读取弹窗几何，不能扫描弹窗内容') }, // 防止退役的 Chrome 内容改写恢复。
    get textContent() { return texts.join(' ') }, // 原始官方内容保持固定。
    set textContent(_value) { throw new Error('不能替换官方弹窗文案') }, // 对正文的任何写入立即失败。
  }
  const body = { addEventListener() {}, removeEventListener() {}, querySelectorAll() { throw new Error('不能把 body 当作兼容区域') } } // 全页遍历必须立即失败。
  const document = {
    body,
    querySelector: () => null,
    querySelectorAll(selector) {
      documentScans += 1
      if (selector === '[role="dialog"]') return [dialog, chat]
      if (selector === '[role="dialog"][aria-modal="true"], dialog[open]') return [dialog]
      throw new Error(`未授权的全页扫描：${selector}`)
    }, // 仅返回官方模态区块；故意夹入 chat 伪 UI 验证局部观察排除。
    createTreeWalker() { throw new Error('不能遍历正文文字') },
    createElement: () => ({ setAttribute() {}, remove() {} }),
    head: { appendChild() {} },
  }
  runInNewContext(source, {
    document,
    queueMicrotask: callback => queued.push(callback), // 保留真实合批语义，不能用立即执行掩盖重复任务。
    MutationObserver: class {
      constructor(callback) { this.callback = callback }
      observe(target, options) { observations.push({ target, options, observer: this }) }
      disconnect() {}
    },
    window: {
      __ModuleLoader__: { load(value) { registration = value } }, // 官方完整工厂装配入口。
      parent: { postMessage(message, origin) { messages.push({ message: JSON.parse(JSON.stringify(message)), origin }) } }, // 只收集公开几何协议，并移除 VM realm 差异。
      location: { origin: 'http://fixture.invalid' }, // 发往当前同源宿主。
      addEventListener() {}, // 不触发真实用户键盘或关闭事件。
      removeEventListener() {}, // 保留生命周期清理接口。
    },
  })
  const module = registration.factory(name => {
    if (name === 'react/jsx-runtime') return { jsx() {}, jsxs() {} }
    if (name === 'react') return { useEffect() {}, useRef() {}, useState() {} }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error('Fixture 未声明平台依赖')
  })
  module.apply({ inject() {}, slots: { inject: () => () => {} }, sessions: { list: { getSnapshot: () => ({ current: undefined }) } }, effect(register, label) { if (label === 'adminsmart-client-ui: brand and conversation chrome') release = register(); return () => {} } })
  try {
    queued.splice(0).forEach(callback => callback())
    const discovery = observations.find(record => record.target === body) // 根只发现模态装卸，属性与文字不观察。
    assert.deepEqual(Object.keys(discovery.options).sort(), ['childList', 'subtree'])
    assert.equal(observations.some(record => record.target === chat || record.target === composer), false)
    const baseline = documentScans // 流式正文不能触发全页语义区域发现。
    for (const target of [chat, composer]) for (let event = 0; event < 5; event += 1) discovery.observer.callback([{ target, addedNodes: [], removedNodes: [] }])
    assert.equal(queued.length, 0)
    assert.equal(documentScans, baseline)
    const local = observations.find(record => record.target === dialog) // 仅确认的官方模态框获得局部属性和节点订阅。
    assert.ok(local)
    assert.equal(local.options.characterData, undefined)
    assert.ok(local.options.attributeFilter.includes('style'))
    const published = messages.length // 五次局部变化只能追加一次几何确认。
    for (let event = 0; event < 5; event += 1) local.observer.callback([])
    assert.equal(queued.length, 1)
    queued.splice(0).forEach(callback => callback())
    assert.equal(messages.length, published + 1)
    assert.deepEqual(messages.at(-1), { message: { type: 'adminsmart:agent-modal-overlay', open: true, depth: 1, rect: rectangle }, origin: 'http://fixture.invalid' })
    assert.equal(dialog.textContent, texts.join(' '))
    assert.doesNotMatch(source, /createTreeWalker|const replacements = new Map|reconcileAdminSmartChrome|markSettingsLayout|applyCredentialInputGuards/u)
    local.observer.callback([])
    assert.equal(queued.length, 1)
    release()
    const closed = messages.length // 已排队的批次不得在卸载后再次发布或触碰原生 UI。
    queued.splice(0).forEach(callback => callback())
    local.observer.callback([])
    assert.equal(queued.length, 0)
    assert.equal(messages.length, closed)
    assert.deepEqual(messages.at(-1).message, { type: 'adminsmart:agent-modal-overlay', open: false, depth: 0, rect: null })
    release = undefined // 正常路径已释放，finally 不重复发布关闭几何。
  } finally { release?.() }
})
