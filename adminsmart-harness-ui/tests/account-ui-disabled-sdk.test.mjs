/** 账号UI关闭后的官方General/Models/模型选择装配；真实Cordis和SlotRegistry，所有外部服务均为离线合成数据。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 当前固定发行版由调用者明确指定，不读取生产Profile或用户凭据。

/**
 * 原样执行整个官方浏览器注册包，渲染测试与原组件共同使用同一真实React实例。
 * @param {object} platform 官方Web种子及同React服务端renderer。
 * @param {string} name 受测的公开官方包名；不导入已停用的账号UI。
 * @returns {object} 原包完整公开导出，不抽取私有组件或改写第三方字节。
 */
function loadOfficial(platform, name) {
  const path = platform.require.resolve(name + '/client') // 当前三个包的公开浏览器入口，均非Node专用入口。
  let registration // 原ModuleLoader实际收到的完整factory声明。
  const document = {
    querySelector: () => null, // 只承载原包安装样式，不读取实际页面。
    createElement: () => ({ dataset: {}, remove() {} }), // 合成style节点没有网络或用户DOM访问。
    head: { appendChild() {} }, // 原始CSS字节不重写，测试无需挂载视觉树。
  }
  runInNewContext(readFileSync(path, 'utf8'), {
    document, // 官方静态样式初始化的隔离文档。
    window: { __ModuleLoader__: { load(value) { registration = value } } }, // 只接收原注册，不运行浏览器loader或真实网络。
    structuredClone, console, queueMicrotask, setTimeout, clearTimeout,
  }, { filename: path })
  assert.equal(registration.id, name)
  return registration.factory(key => {
    if (key === 'react') return platform.react // 与下方renderToStaticMarkup的hooks dispatcher保持同一实例。
    if (key === 'react/jsx-runtime') return platform.require(key) // JSX元素与同一React renderer匹配。
    if (key === 'react-dom') return platform.require(key) // 不调用portal或挂载DOM，仅保持完整官方依赖。
    assert.ok(Object.hasOwn(platform.seeds, key), '缺少官方平台种子：' + key)
    return platform.seeds[key]
  })
}

/**
 * 为角色装配真实官方公开插件；不装账号模块，不模拟General/Models的注册算法。
 * @param {boolean} isAdmin 合成可信角色；普通用户根声明不提供管理席位。
 * @returns {Promise<object>} 真实Context、原模块、原Slot条目和可释放生命周期。
 */
async function fixture(isAdmin) {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 所有官方依赖来自同一固定安装。
  assert.equal(require('@deepseek-ai/dsh/package.json').version, '0.2.1-alpha.3')
  const { originalClientPlatform } = await import('./official-client-boot-fixture.mjs') // 现有真实Web种子捕获，不新增平台私有解析器。
  const original = await originalClientPlatform() // 真实Cordis、SlotRegistry和store身份。
  const platform = { ...original, require, react: require('react'), render: require('react-dom/server').renderToStaticMarkup } // 原组件工厂与SSR共用这一个真实React，不Fake hooks。
  const general = loadOfficial(platform, '@deepseek-ai/dsh-client-ui-settings-general') // 原General整体只通过真实依赖及Slot声明生效。
  const models = loadOfficial(platform, '@deepseek-ai/dsh-client-ui-settings-models') // API-key编辑和onboarding原模块，不依赖账号UI。
  const picker = loadOfficial(platform, '@deepseek-ai/dsh-client-ui-model-selection') // 会话模型选择独立原模块。
  const ctx = new platform.seeds['@deepseek-ai/cordis'].Context() // 两角色分别拥有独立真实fiber树。
  new platform.SlotRegistry(ctx) // 重复/依赖/卸载规则全部使用当前官方实现。
  const makeStore = platform.seeds['@deepseek-ai/dsh-client-store'].createSnapshotStore // 原observable，不仿造状态发布算法。
  const forms = new Map() // 仅合成namespace数据，不执行任何持久化。
  const commands = new Set() // 官方settings.open与/model注册生命周期证据。
  const dictionaries = new Map() // 原包自己注册的完整词典，不复制文案。
  const catalog = { groups: [{ id: 'synthetic-api', name: 'Synthetic API', models: [{ id: 'synthetic-model', name: 'Synthetic Model' }] }], failures: [], default: { provider: 'synthetic-api', model: 'synthetic-model' }, routableProviders: ['synthetic-api'] } // 不访问模型或真实Provider。
  let catalogReads = 0 // 原Picker确实调用合成目录，不能只以Slot名存在代替服务就绪。
  let writes = 0 // 本测试纯装配与打开设置不得写入Host配置。
  const describe = {
    getSnapshot: () => ({ status: 'ready', view: { writable: isAdmin, hasDocument: false, namespaces: [] } }), // 原Models尚未显示，目录可以未请求。
    subscribe: () => () => {}, // 没有真实Host事件或后台轮询。
    ensure: async () => {}, // 目标不加载Models内容，不访问真实配置。
  }
  const remote = {
    $host: { isLoopback: false }, // 公网分支不提供打开本机文档入口。
    $on: () => () => {}, // 固定外部事件注册，实际fiber清理由Cordis持有。
    settings: {}, // 没有可执行Settings写方法。
    credentials: {}, // 不提供密钥读取或写入。
    llm: {}, // 不提供真实模型或供应商目录网络调用。
    session: { async modelCatalog() { catalogReads += 1; return { ok: true, value: catalog } } }, // 原Picker的公开目录请求仅返回合成模型。
  }
  ctx.provide('locale', {
    register(ns, values) { dictionaries.set(ns, values); return () => dictionaries.delete(ns) }, // 保留原词典归属与释放。
    bind: ns => key => dictionaries.get(ns)?.zh?.[key] ?? key, // 原始中文标签，不重写设置按钮。
    getSnapshot: () => ({ revision: 1, active: 'zh' }), // 不读取用户语言偏好。
    subscribe: () => () => {}, // 固定合成语言不产生外部事件。
  })
  ctx.provide('remote', remote)
  for (const name of ['settings', 'credentials', 'llm', 'session']) ctx.provide('remote.' + name, remote[name]) // 只声明各公开命名空间，不把账号服务补回。
  ctx.provide('configForms', {
    get(ns) {
      if (!forms.has(ns)) forms.set(ns, { getSnapshot: () => ({ status: 'ready', value: { welcomeNoticeVersion: '' }, writable: isAdmin, revision: 1 }), subscribe: () => () => {}, async set() { writes += 1; assert.fail('装配不能写Host设置') } }) // Fixture只供原Welcome控制器订阅。
      return forms.get(ns)
    },
    describe: () => describe, // 只读公开面供完整原General和Models接线。
    developerTools: { enabled: makeStore(false), async setEnabled() { writes += 1; assert.fail('装配不能更改Coding Tools') } }, // 固定展示值，不擅自升级权限。
  })
  ctx.provide('settingsSchema', {}) // 原Models仅绑定公开Schema回调；本用例不打开Provider编辑器或伪造校验结果。
  ctx.provide('connection', { state: makeStore('connected'), reconnect() { assert.fail('禁止真实连接') } }) // 原设置壳观察固定已连接状态。
  ctx.provide('shortcuts', { catalog: makeStore([]), register(command) { commands.add(command); return () => commands.delete(command) } }) // 真模块主动注册快捷键，卸载应释放。
  ctx.provide('commandUi', { register(command) { commands.add(command); return () => commands.delete(command) } }) // 原/model入口与管理入口独立。
  ctx.provide('sessions', { subagentAddress: () => undefined }) // Picker装配及命令登记不创建会话或访问真实历史。
  const root = ctx.plugin({ apply(owner) {
    owner.slots.register({ name: 'root', children: {
      'conversation.input.model': { kind: 'single', scope: 'root' }, // 两角色都保留官方会话模型选择席位。
      ...(isAdmin ? { 'sidebar.settings': { kind: 'single', scope: 'root' } } : {}), // 普通根从结构上不提供管理席位，账号关闭不能改变角色边界。
    } }, () => null)
  } })
  await root.await()
  const fibers = [] // 当前Fixture拥有的官方插件，按逆序释放。
  for (const module of [general, models, picker]) {
    const fiber = ctx.plugin(module) // 完整官方apply和注入等待，不直接调用私有类。
    fibers.push(fiber)
    await fiber.await()
    assert.equal(fiber.state, 2)
  }
  for (let index = 0; index < 4; index += 1) await new Promise(done => setImmediate(done)) // 推进真实子fiber和合成模型目录结算。
  return { ctx, platform, general, models, commands, writes: () => writes, catalogReads: () => catalogReads,
    async close() { for (const fiber of fibers.reverse()) await fiber.dispose(); await root.dispose(); await ctx.fiber.dispose() }, // 真实Cordis清理，不手工删除Slot冒充释放。
  }
}

for (const isAdmin of [true, false]) test('关闭账号UI后完整官方General/Models及独立模型选择保留角色边界，管理员=' + isAdmin, { skip: !runtimeRoot }, async () => {
  const state = await fixture(isAdmin) // 两角色没有账号模块，管理root声明保持现有区别。
  try {
    assert.deepEqual(state.ctx.slots.entries('settings.launcher'), [])
    const management = state.ctx.slots.entries('sidebar.settings') // 原General注册的SettingsRoot，只能存在于有管理父席位的角色。
    assert.equal(management.length, isAdmin ? 1 : 0)
    assert.deepEqual(state.ctx.slots.entries('settings.section').map(row => row.options.id).sort(), isAdmin ? ['general', 'models'] : [])
    assert.deepEqual(state.ctx.slots.entries('settings.models.sign-in'), [])
    assert.equal(state.ctx.slots.entries('conversation.input.model').length, 1)
    assert.ok(state.ctx.get('modelDirectories'))
    assert.equal(state.catalogReads(), 1)
    assert.ok([...state.commands].some(row => row.name === 'model'))
    assert.equal([...state.commands].some(row => row.id === 'settings.open'), isAdmin)
    if (isAdmin) {
      assert.equal(management[0].component.name, 'SettingsRoot') // 原完整General工厂发布的真实组件，无业务替代。
      assert.deepEqual(state.ctx.slots.entries('settings.general.item').map(row => row.options.id).sort(), ['current-version', 'developer-tools'])
      assert.deepEqual(state.ctx.slots.entries('settings.onboarding').map(row => row.options.id).sort(), ['deepseek-official', 'welcome-notice'])
    }
    assert.equal(state.writes(), 0)
  } finally { await state.close() }
})

test('官方SettingsRoot在账号launcher为空时生成原生可访问Settings后备按钮并打开同一原生store', { skip: !runtimeRoot }, async () => {
  const state = await fixture(true) // 管理员管理父席位存在，但账号UI没有装配。
  try {
    const entry = state.ctx.slots.entries('sidebar.settings')[0] // 只能从真实公开Slot取原组件，不能从源码提取私有函数。
    const store = entry.store.create() // 原General创建的唯一设置视图store，与原快捷键共享；公开StoredEntry将store独立于options保存。
    let launcher // 原SettingsRoot实际传给公开renderSlot的后备React树。
    const props = {
      wide: true, // 固定展开的合成侧栏几何。
      useStore: select => select(store.getSnapshot()), // 原设置store的公开状态，不复制打开/关闭算法。
      actions: store.actions, // 原General所有者动作，按钮必须调用同一实例。
      useShortcuts: select => select([]), // 本项不伪造组合键。
      useSections: select => select([]), // Settings未打开，无需渲染页面导航。
      useOnboardingSteps: select => select([]), // 本项只核验设置后备按钮，不启动引导。
      useSessions: select => select({ phase: 'ready', byId: {} }), // 没有任何用户或合成活跃会话。
      useDesktopUpdate: select => select({ presentation: null }), // 不提供Desktop更新能力。
      useConnectionState: select => select('connected'), // 已连接表层，不触发重连。
      t: key => key, // 固定词典键仅供ARIA断言，不改组件逻辑。
      reconnect() { assert.fail('禁止连接') }, // fallback按钮只能打开设置。
      openDesktopUpdate() { assert.fail('禁止更新') }, // fallback不能触发Desktop操作。
      renderSlot(name, _owner, options) { if (name === 'settings.launcher') launcher = options.fallback; return null }, // 捕获原组件真实生成的fallback，不渲染官方子控件或替换其实现。
    }
    function Capture() {
      entry.component(props) // 真实React renderer下执行原Slot组件，原hooks与renderer共用同React，避免Fake dispatcher。
      return null
    }
    assert.equal(state.platform.render(state.platform.react.createElement(Capture)), '')
    const button = launcher.props.children // 官方Tooltip里的实际原生button，不提取或重写组件源码。
    assert.equal(button.type, 'button')
    assert.equal(button.props.type, 'button')
    assert.equal(button.props['aria-label'], 'trigger')
    assert.equal(button.props['aria-haspopup'], 'dialog')
    assert.equal(button.props['aria-expanded'], false)
    assert.equal(store.getSnapshot().open, false)
    button.props.onClick() // 实际调用官方后备按钮动作。
    assert.equal(store.getSnapshot().open, true)
    assert.equal(state.writes(), 0)
  } finally { await state.close() }
})
