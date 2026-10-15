/** 完整业务 Client 只接授权品牌及手机退出，保留官方 Workspace、侧栏布局和浏览器视图偏好。 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

for (const role of ['admin', 'managed-user']) test(`授权品牌不改变官方Workspace与侧栏状态，不调用自有数据/存储/改名覆盖：${role}`, async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8') // 原始正式 Bundle，没有候选代码或私有函数提取。
  let registration // 官方 ModuleLoader 捕获完整工厂登记。
  const slots = [] // 只允许品牌内容和两个业务退出列表项，不接管原生布局。
  const effects = [] // 装配不再包含 Workspace 视图同步或自动导航。
  const view = Object.freeze({ groupBy: 'date', collapsed: Object.freeze(['fixture-workspace']) }) // 合成官方视图状态，不使用真实Session或其它账号数据。
  const document = { querySelector: () => null } // 本目标不挂载模态框或组件，不创建业务样式容器。
  runInNewContext(source, {
    document,
    window: { __ADMINSMART_RUNTIME_ROLE__: role, __ModuleLoader__: { load(value) { registration = value } } },
    localStorage: { getItem() { throw new Error('业务Client不得接管官方偏好') }, removeItem() { throw new Error('业务Client不得清空官方偏好') } },
    fetch() { throw new Error('侧栏退役后不得调用自有视图接口') },
  })
  const client = registration.factory(name => {
    if (name === 'react/jsx-runtime') return { jsx() {}, jsxs() {} }
    if (name === 'react') return { useEffect() {}, useRef() {}, useState() {} }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error('Fixture未声明平台模块')
  }) // 实际公开工厂，只替换未挂载的React和网络边界。
  client.apply({
    inject() {}, // 独立Workspace目标不装配个人主题服务。
    reflect: { get: () => ({ openBundle() {} }) }, // 当前官方插件导航已注册，不重复提供或打开管理入口。
    slots: { inject(name) { slots.push(name); return () => {} } }, // 仅捕获当前业务注册目标，原生所有者保持不变。
    effect(_register, label) { effects.push(label); return () => {} }, // 不挂载无关模态框，检验业务插件已无侧栏生命周期。
    get workspaces() { throw new Error('业务Client不得重命名或选择官方Workspace') },
    get uiWorkspace() { throw new Error('业务Client不得改写官方会话导航') },
  })
  assert.deepEqual(slots, ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark', 'conversation.session.header.utilities', 'sidebar.footer.action'])
  assert.ok(effects.every(label => !/Workspace|sidebar/u.test(label)))
  assert.deepEqual(Array.from(client.inject), ['slots'])
  assert.deepEqual(view, { groupBy: 'date', collapsed: ['fixture-workspace'] })
  assert.doesNotMatch(source, /installUserWorkspaceView|LEGACY_WORKSPACE_VIEW_KEY|sidebar\.workspaces|connectWorkspace|AdminSmartMark|data-adminsmart-mobile-sidebar|data-adminsmart-settings-part|markSettingsLayout|conversation\.chat\.node/u)
})
