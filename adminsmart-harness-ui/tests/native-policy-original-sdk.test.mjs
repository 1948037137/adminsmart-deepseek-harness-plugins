import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const runtimeRoot = path.resolve(process.env.ADMINSMART_DSH_ROOT || fileURLToPath(new URL('../../../deepseek-harness-runtime/', import.meta.url))) // 与受管服务相同的共享固定版本，不加载私有测试副本。

/** 仅提供 SDK 初始化和样式安装所需的离线节点能力，不渲染页面或启动浏览器。 */
class ElementFixture extends EventTarget {
  /** @param {string} [tag='div'] 合成节点类型。 */
  constructor(tag = 'div') {
    super()
    this.tagName = tag.toUpperCase() // 只识别离线 style 和 link，不读取用户 DOM。
    this.style = { setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } } // Boot 状态初始化需要的最小样式接口。
    this.dataset = {} // 官方 Boot 容器的数据标记。
    this.children = [] // 用于确认自有样式已经安装。
    this.classList = { add() {}, remove() {}, toggle() {} } // SDK 初始化所需的纯表层操作。
    this.relList = { supports: () => true } // 阻止官方 modulepreload polyfill 发起网络请求。
    this.parentElement = null // 合成节点的父级关系。
  }
  /** @param {...object} nodes 合成子节点 @returns {void} */
  append(...nodes) {
    this.children.push(...nodes)
    for (const node of nodes) if (node && typeof node === 'object') node.parentElement = this
  }
  /** @param {object} node 合成子节点 @returns {object} */
  appendChild(node) { this.append(node); return node }
  /** @param {...object} nodes 替换后的合成子节点 @returns {void} */
  replaceChildren(...nodes) { this.children = []; this.append(...nodes) }
  remove() {}
  setAttribute() {}
  getAttribute() { return null }
  querySelector() { return null }
  querySelectorAll() { return [] }
}

/** @returns {object} 完全离线的 document，所有节点均由本测试创建。 */
function documentFixture() {
  const root = new ElementFixture() // 官方发布包初始化时需要的 root，不用于实际 UI 验收。
  return {
    compatMode: 'CSS1Compat',
    createElement: tag => new ElementFixture(tag),
    createElementNS: (_namespace, tag) => new ElementFixture(tag),
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: id => id === 'root' ? root : null,
    documentElement: new ElementFixture('html'),
    head: new ElementFixture('head'),
    body: new ElementFixture('body')
  }
}

/** @param {string} filename 官方或自有 Lazy-CJS 文件 @param {object} document 离线节点接口 @returns {Function} 原样执行注册契约得到的 factory。 */
function readFactory(filename, document, location = { hostname: 'localhost' }, globals = {}) {
  let declaration // ModuleLoader.load 原样收到的模块定义，不截取或改写第三方函数。
  vm.runInNewContext(readFileSync(filename, 'utf8'), { ...globals, document, window: { ...globals.window, location, __ModuleLoader__: { load: value => { declaration = value } } } }, { filename })
  assert.equal(typeof declaration?.factory, 'function')
  return declaration.factory
}

/** @returns {Promise<object>} 从实际固定版本 Web 发布包取得平台种子，再原样执行官方 Renderer factory。 */
async function loadOfficialRegistry() {
  const frontendRoot = path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-web-frontend/dist') // 只读官方发布产物，绝不创建补丁或重新生成第三方包。
  const rendererPath = path.join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js') // 当前服务使用的真实 SlotRegistry 实现。
  const html = readFileSync(path.join(frontendRoot, 'index.html'), 'utf8') // 当前固定发布包的入口，不硬编码构建哈希。
  const script = /<script\b[^>]*\bsrc="([^"]+)"/.exec(html)?.[1] // 固定静态 HTML 中唯一的 module script。
  assert.ok(script)
  const entryPath = path.resolve(frontendRoot, `.${new URL(script, 'http://fixture.test/').pathname}`) // 把公开入口路径限制在官方发布目录内。
  assert.ok(!path.relative(frontendRoot, entryPath).startsWith('..'))
  const document = documentFixture() // SDK 初始化只使用本测试合成节点。
  let resolveSeeds // 官方 Loader.create 到达平台种子准备阶段时释放等待。
  const captured = new Promise(resolve => { resolveSeeds = resolve }) // 不执行应用插件、网络装载或 React 挂载。
  const stop = new Error('offline SDK capture completed') // 在公开 Loader.create 边界中断应用启动，而非修改发布包。
  const fields = {
    window: globalThis, document, HTMLElement: ElementFixture, Element: ElementFixture, Node: ElementFixture, SVGElement: ElementFixture,
    location: { href: 'http://fixture.test/', origin: 'http://fixture.test' },
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    fetch: () => { throw new Error('network is forbidden in Slot contract tests') },
    __ModuleLoader__: { create(options) { resolveSeeds(options.staticModules); throw stop } }
  } // 所有外部交互均离线；官方注册语义和平台种子本身保持真实。
  const previous = new Map(Object.keys(fields).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])) // 测试结束恢复每个 Node 全局描述符。
  const originalError = console.error // 只隐藏预期停止信号，意外 SDK 错误仍输出。
  try {
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    console.error = error => { if (error !== stop) originalError(error) }
    await import(pathToFileURL(entryPath).href)
    const seeds = await captured // 实际发布包通过公开 Loader.create 提供的 React、Cordis 与 SlotCore。
    const renderer = readFactory(rendererPath, document)(key => seeds[key]) // 原样执行官方注册器，不用接受任意重复声明的 Fake 替代。
    return { seeds, SlotRegistry: renderer.SlotRegistry }
  } finally {
    console.error = originalError
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

const official = await loadOfficialRegistry() // 单次加载平台种子，各测试仍使用独立 Context 和真实注册器。
const runtimeRequire = createRequire(path.join(runtimeRoot, 'package.json')) // 离线渲染只使用固定发行版已有的 ReactDOM Server。



import { installNativePolicyClient, emptyNativePolicy } from '../src/native-policy-client.mjs'

/** 完整原始Bundle及真实平台种子，不截取或改造上游私类。 */
function loadOriginal(name) {
  return readFactory(runtimeRequire.resolve(name + '/client'), documentFixture(), { hostname: 'fixture.test' }, { structuredClone, console, queueMicrotask, setTimeout, clearTimeout })(key => {
    assert.ok(Object.hasOwn(official.seeds, key), '缺少真实平台种子：' + key)
    return official.seeds[key]
  })
}
const themeSdk = loadOriginal('@deepseek-ai/dsh-client-ui-theme') // 原始完整Bundle公开ThemeRuntime。
const agentLoopSdk = loadOriginal('@deepseek-ai/dsh-client-ui-settings-agent-loop') // 原始完整AgentLoop设置Bundle，控制器只从公开Slot取得。
const subagentSdk = loadOriginal('@deepseek-ai/dsh-client-ui-settings-subagent') // 原始完整表单控制器只能从公开Slot注入取出。
const chatSdk = loadOriginal('@deepseek-ai/dsh-client-ui-chat') // 原始内存collapseTiming，不伪造策略类。
const generalSdk = loadOriginal('@deepseek-ai/dsh-client-ui-settings-general') // 管理员原始General声明拥有者。

/** 等待真实官方setter和候选异步ACK完成，不运行后台或真实网络。 */
async function settled() { for (let index = 0; index < 4; index += 1) await new Promise(resolve => setImmediate(resolve)) }

/**
 * 真实Cordis/Slots/Store及合成旧八字段Controller/后端协议。
 * @param {boolean} isAdmin 合成可信角色。
 * @returns {Promise<object>} 原始SDK接线所需状态和清理方法。
 */
async function fixture(isAdmin) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window') // 本测试只创建合成页面role，不读取真实浏览器。
  Object.defineProperty(globalThis, 'window', { value: { __ADMINSMART_RUNTIME_ROLE__: isAdmin ? 'admin' : 'managed-user' }, configurable: true, writable: true })
  const ctx = new official.seeds['@deepseek-ai/cordis'].Context() // 真实固定SDK的服务容器。
  const slots = new official.SlotRegistry(ctx) // 真实声明、重复检测与公开StoredEntry。
  const makeStore = official.seeds['@deepseek-ai/dsh-client-store'].createSnapshotStore // 全部observable使用实际官方Store。
  const baseline = { 'ui-theme': { codeFontSize: 12, terminalFontSize: 14, textFontFamily: '', codeFontFamily: '', terminalFontFamily: '' }, subagent: { maxDepth: 1, maxActiveSubagents: 2 }, 'agent-loop': { maxParallelToolCalls: 2 }, 'ui-settings-general': { welcomeNoticeVersion: '' } } // 合成受管Host模板继承基线；两个并发值2仅为模板默认，不作为硬上限，也未保存进策略。
  let policy = { revision: 1, settings: emptyNativePolicy(), writable: isAdmin } // 后端已发布空覆盖，非Null未发布窗口。
  let legacy = { revision: 7, writable: isAdmin, settings: { locale: 'zh', theme: 'dark', fontSize: 18, transcriptView: 'verbose', performanceUsage: 'compact', linkOpening: 'sidebar', busyEnter: 'queue', developerTools: false } } // 合成既有八字段真源。
  const puts = [] // 精确捕获candidate native PUT，不记录任何凭据。
  const generalListeners = new Set() // 合成旧Controller公开订阅。
  const describeListeners = new Set() // 合成旧ConfigForms目录公开订阅。
  const forms = new Map() // 原来的五General与未知原生命名空间表单。
  const schemas = new Map() // 元数据来自实际官方公开Schema。
  for (const [ns, packageName] of [['ui-theme','@deepseek-ai/dsh-client-ui-theme'], ['ui-chat','@deepseek-ai/dsh-client-ui-chat'], ['ui-settings-general','@deepseek-ai/dsh-client-ui-settings-general']]) {
    schemas.set(ns,(await import(pathToFileURL(runtimeRequire.resolve(packageName)).href)).Config.toJSON())
  }
  schemas.set('agent-loop',(await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-agent-loop')).href)).default.Config.toJSON()) // 真实原始AgentLoop Schema，不手写默认值合同。
  schemas.set('subagent',(await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-subagent')).href)).default.Config.toJSON())
  const originalValues = ns => ns === 'ui-theme' ? { preference: legacy.settings.theme, fontSize: legacy.settings.fontSize, ...baseline['ui-theme'] } : ns === 'ui-chat' ? { transcriptView: legacy.settings.transcriptView, performanceUsage: legacy.settings.performanceUsage, linkOpening: legacy.settings.linkOpening } : ns === 'subagent-model-selection-settings' ? { enabled: false, allowedModels: [] } : baseline[ns] ?? {} // 实际原生域未载入的能力保持无编辑状态。
  const originalForm = ns => {
    if (!forms.has(ns)) {
      const listeners = new Set() // 每个合成旧scope独立订阅。
      forms.set(ns, { getSnapshot: () => ({ status:'ready', value:originalValues(ns), base:originalValues(ns), user:{}, writable:isAdmin, revision:legacy.revision, mode:'host' }), subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}, async set(){assert.fail('原生候选不得绕过native PUT写旧scope')}, async mutate(){assert.fail('原生候选不得绕过native PUT写旧scope')}, publish(){for(const listener of listeners)listener()} })
    }
    return forms.get(ns)
  }
  const generalRows = () => ['locale','ui-theme','ui-chat','ui-conversation','ui-settings'].map(ns=>({ns,schema:schemas.get(ns)??{type:'object',dict:{}},value:originalValues(ns),base:originalValues(ns),user:{},revision:legacy.revision,secrets:[],applies:'live'})) // 合成旧八字段目录，不造新的管理入口。
  const general = { configForms: { get:originalForm, developerTools:{enabled:makeStore(false),setEnabled:async()=>false}, describe:()=>({getSnapshot:()=>({status:'ready',view:{writable:isAdmin,hasDocument:false,namespaces:generalRows()}}),subscribe(fn){describeListeners.add(fn);return()=>describeListeners.delete(fn)},acceptView(){}}), whileServed(){return()=>{}} }, getPolicySnapshot:()=>structuredClone(legacy), acceptPolicySnapshot(next){legacy=structuredClone(next);for(const form of forms.values())form.publish();for(const listener of generalListeners)listener()}, subscribe(fn){generalListeners.add(fn);return()=>generalListeners.delete(fn)} } // 父代理允许使用的Fake旧8协议，所有官方消费者仍真实。
  const remote = { $host:{isLoopback:false}, $on:()=>()=>{}, settings:{describe:async()=>({ok:true,value:{writable:isAdmin,hasDocument:false,namespaces:[...generalRows().filter(row=>row.ns!=='ui-theme'),...Object.keys(baseline).map(ns=>({ns,schema:schemas.get(ns),value:originalValues(ns),base:originalValues(ns),user:{},revision:3,secrets:[],applies:'live'}))]}})},session:{},llm:{listProviders:async()=>({ok:true,value:[]}),listModels:async()=>({ok:true,value:[]})} } // 所有RPC均合成，没有模型请求或凭据。
  ctx.provide('locale',{register:()=>()=>{},bind:()=>key=>key,getSnapshot:()=>({revision:1}),subscribe:()=>()=>{}})
  ctx.provide('configForms',general.configForms)
  ctx.provide('remote',remote)
  ctx.provide('remote.session',remote.session)
  ctx.provide('remote.settings',remote.settings)
  ctx.provide('uiConversation',{events:{register:()=>()=>{},registerFallback:()=>()=>{}},views:{register:()=>()=>{}},groups:{register:()=>()=>{}}})
  ctx.provide('uiSession',{provide:()=>()=>{}})
  ctx.provide('sessions',{})
  ctx.provide('uiWorkspace',{})
  ctx.provide('sidebarRight',{})
  ctx.provide('connection',{state:makeStore({status:'ready'}),reconnect(){assert.fail('禁止真实连接')}})
  ctx.provide('shortcuts',{catalog:makeStore([]),register:()=>()=>{}})
  const root = ctx.plugin({apply(owner){owner.slots.register({name:'root',children:{'shell.overlay':{kind:'list',scope:'root'},...(isAdmin?{'sidebar.settings':{kind:'single',scope:'root'},'plugins.item':{kind:'list',scope:'root'}}:{})}},()=>null)}}) // 只声明Fixture既有root/overlay及管理员原生管理席位。
  await root.await()
  const streams = [] // 候选真实SSE处理器接到本地FakeSource。
  const bridge = installNativePolicyClient({general,remote,ctx,nativeBaseline:baseline,eventSourceFactory(url){assert.equal(url,'./adminsmart/native-policy/events');const handlers=new Map();const source={addEventListener(name,fn){handlers.set(name,fn)},removeEventListener(name){handlers.delete(name)},close(){},emit(revision){handlers.get('native-policy-changed')?.({data:JSON.stringify({revision})})}};streams.push(source);return source},fetchImpl:async(url,options)=>{
    assert.equal(url,'./adminsmart/native-policy')
    if(options.method==='PUT'){
      assert.equal(isAdmin,true)
      const body=JSON.parse(options.body) // 当前候选实际发出的完整CAS请求。
      puts.push(body)
      assert.equal(body.expectedRevision,policy.revision)
      policy={revision:policy.revision+1,settings:body.settings,writable:isAdmin}
      if(body.legacyGeneralUpdate){assert.equal(body.legacyGeneralUpdate.expectedRevision,legacy.revision);legacy={revision:legacy.revision+1,settings:body.legacyGeneralUpdate.settings,writable:isAdmin};return{ok:true,json:async()=>({...structuredClone(policy),general:structuredClone(legacy)}),headers:{get:()=>null}}}
    }
    return{ok:true,json:async()=>structuredClone(policy),headers:{get:()=>null}}
  }})
  await bridge.ready
  assert.equal(bridge.getSnapshot().status,'ready')
  ctx.set('configForms',bridge.configForms) // 提供者同rootfiber采用候选公开façade。
  const owners = [] // 当前测试实际激活的原始SDK贡献。
  return{ctx,slots,bridge,puts,baseline,owners,
    policy:()=>structuredClone(policy),
    async load(module){const fiber=ctx.plugin({inject:module.inject,apply:module.apply});owners.push(fiber);await fiber.await();assert.equal(fiber.state,2);await settled();return fiber},
    async update(edit){const settings=structuredClone(policy.settings);edit(settings);policy={...policy,revision:policy.revision+1,settings};streams[0].emit(policy.revision);await bridge.refresh();await settled()},
    async close(){bridge.dispose();for(const fiber of owners.reverse())await fiber.dispose();await root.dispose();await ctx.fiber.dispose();if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete globalThis.window},
  }
}

for(const isAdmin of [false,true])test('完整官方ThemeRuntime保存与回读，管理员='+isAdmin,async()=>{
  const state=await fixture(isAdmin)
  try{
    assert.equal(typeof themeSdk.ThemeRuntime,'function')
    const theme=new themeSdk.ThemeRuntime(state.ctx,state.bridge.configForms.get('ui-theme')) // 公开原始class消费候选表单，未仿造私类。
    assert.equal(theme.getTheme().preference,'dark')
    assert.equal(theme.getTheme().fontSizes.text,18)
    theme.setFontSize('code',16)
    theme.setFontSize('terminal',20)
    theme.setFontFamily('text','Inter')
    theme.setFontFamily('code','Fira Code')
    theme.setFontFamily('terminal','Consolas')
    await settled()
    assert.equal(state.puts.length,isAdmin?5:0)
    assert.equal(theme.getTheme().fontSizes.code,isAdmin?16:12)
    assert.equal(theme.getTheme().fontSizes.terminal,isAdmin?20:14)
    assert.equal(theme.getTheme().fontFamilies.text,isAdmin?'"Inter"':'')
    assert.equal(theme.getTheme().fontFamilies.code,isAdmin?'"Fira Code"':'')
    assert.equal(theme.getTheme().fontFamilies.terminal,isAdmin?'"Consolas"':'')
    assert.equal(theme.getTheme().preference,'dark')
    assert.equal(theme.getTheme().fontSizes.text,18)
    if(isAdmin)assert.deepEqual(state.policy().settings.namespaces['ui-theme'],{codeFontSize:16,terminalFontSize:20,textFontFamily:'"Inter"',codeFontFamily:'"Fira Code"',terminalFontFamily:'"Consolas"'})
    else assert.deepEqual(state.policy().settings.namespaces,{})
    const puts=state.puts.length // 外部策略采用不能反向写入。
    await state.update(settings=>{settings.namespaces['ui-theme']={codeFontSize:13,terminalFontSize:17,textFontFamily:'Arial',codeFontFamily:'monospace',terminalFontFamily:'Consolas'}})
    assert.equal(theme.getTheme().fontSizes.code,13)
    assert.equal(theme.getTheme().fontSizes.terminal,17)
    assert.equal(theme.getTheme().fontFamilies.text,'"Arial"')
    assert.equal(state.puts.length,puts)
  }finally{await state.close()}
})

test('原始Subagent公开控制器scope.mutate保存有限字段且不播种默认',async()=>{
  const state=await fixture(true)
  try{
    await state.load(subagentSdk)
    const row=state.slots.entries('plugins.item').find(entry=>entry.options.id==='subagent') // 真正原始Slot注册，不用Fake注册器捕获。
    assert.ok(row)
    const face=row.inject() // 原始控制器公开Staged表单动作。
    const before=face.hooks.subagentLimitsCard.getSnapshot()
    assert.equal(before.maxDepth.text,'1')
    assert.equal(before.maxActiveSubagents.text,'2')
    assert.equal(state.puts.length,0)
    face.editLimit('maxDepth','0')
    face.editLimit('maxActiveSubagents','1')
    face.save()
    await settled()
    assert.equal(state.puts.length,1)
    assert.deepEqual(state.policy().settings.namespaces,{subagent:{maxDepth:0,maxActiveSubagents:1}})
    const saved=face.hooks.subagentLimitsCard.getSnapshot()
    assert.equal(saved.maxDepth.text,'0')
    assert.equal(saved.maxActiveSubagents.text,'1')
    assert.equal(saved.dirty,false)
    assert.equal(saved.failed,false)
    assert.equal(saved.maxDepth.overridden,true)
  }finally{await state.close()}
})

for(const isAdmin of [false,true])test('原始UIChat collapse绑定，SSE采用不写回且管理员明确操作一次PUT，管理员='+isAdmin,async()=>{
  const state=await fixture(isAdmin)
  try{
    if(isAdmin)await state.load(generalSdk)
    await state.load(chatSdk)
    await settled()
    assert.equal(state.bridge.getSnapshot().collapseAvailable,true)
    const row=state.slots.entries('settings.general.item').find(entry=>entry.options.id==='transcript-view')
    const face=row.inject() // 完整UIChat的公开注入，原始Policy没有公共class出口。
    assert.equal(face.hooks.collapseTiming.getSnapshot(),'completion')
    assert.equal(state.puts.length,0)
    await state.update(settings=>{settings.clientPreferences={collapseTiming:'next-input'}})
    assert.equal(face.hooks.collapseTiming.getSnapshot(),'next-input')
    assert.equal(state.puts.length,0)
    face.setCollapseTiming('completion')
    await settled()
    assert.equal(state.puts.length,isAdmin?1:0)
    if(isAdmin)assert.deepEqual(state.policy().settings.clientPreferences,{collapseTiming:'completion'})
    else{assert.equal(face.hooks.collapseTiming.getSnapshot(),'next-input');assert.equal(state.slots.entries('sidebar.settings').length,0);assert.equal(state.slots.entries('settings.section').length,0)}
  }finally{await state.close()}
})


test('原始AgentLoop控制器保存并发1、清除回受管基线2而非官方10',async()=>{
  const state=await fixture(true) // 管理员沿用唯一真实plugins.item席位。
  try{
    await state.load(agentLoopSdk)
    const row=state.slots.entries('plugins.item').find(entry=>entry.options.id==='agent-loop') // 原始公开注册，不抽取控制器私类。
    assert.ok(row)
    const face=row.inject() // 完整原始SDK的编辑/保存/清除动作。
    assert.equal(face.hooks.agentLoopCard.getSnapshot().maxParallelToolCalls.text,'2')
    assert.equal(state.puts.length,0)
    face.edit('maxParallelToolCalls','1')
    assert.equal(face.hooks.agentLoopCard.getSnapshot().dirty,true)
    face.save()
    await settled()
    assert.equal(state.puts.length,1)
    assert.deepEqual(state.policy().settings.namespaces,{'agent-loop':{maxParallelToolCalls:1}})
    assert.equal(face.hooks.agentLoopCard.getSnapshot().maxParallelToolCalls.text,'1')
    assert.equal(face.hooks.agentLoopCard.getSnapshot().dirty,false)
    assert.equal(face.hooks.agentLoopCard.getSnapshot().maxParallelToolCalls.overridden,true)
    face.resetField('maxParallelToolCalls')
    face.save()
    await settled()
    assert.equal(state.puts.length,2)
    assert.deepEqual(state.policy().settings.namespaces,{}) // 清除不把继承值2播种成全局覆盖。
    assert.equal(face.hooks.agentLoopCard.getSnapshot().maxParallelToolCalls.text,'2')
    assert.equal(face.hooks.agentLoopCard.getSnapshot().maxParallelToolCalls.overridden,false)
    const original=(await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-agent-loop')).href)).default.Config({}) // 对照真实官方默认，避免Fake基线与猜值混淆。
    assert.equal(original.maxParallelToolCalls.get(),10)
  }finally{await state.close()}
})

test('普通AgentLoop采用共享1但不PUT，清除采用回受管2且无管理页',async()=>{
  const state=await fixture(false) // 普通角色不声明plugins.item，不新增管理入口。
  try{
    await state.load(agentLoopSdk)
    const scope=state.bridge.configForms.get('agent-loop') // 同一真实消费者使用的候选公开scope。
    assert.equal(scope.getSnapshot().value.maxParallelToolCalls,2)
    assert.equal(scope.getSnapshot().writable,false)
    await state.update(settings=>{settings.namespaces['agent-loop']={maxParallelToolCalls:1}})
    assert.equal(scope.getSnapshot().value.maxParallelToolCalls,1)
    assert.equal(await scope.mutate([{op:'set',path:['maxParallelToolCalls'],value:2}],scope.getSnapshot().revision),false)
    assert.equal(state.puts.length,0)
    assert.equal(state.slots.entries('plugins.item').length,0)
    await state.update(settings=>{delete settings.namespaces['agent-loop']})
    assert.equal(scope.getSnapshot().value.maxParallelToolCalls,2)
    assert.equal(state.puts.length,0)
  }finally{await state.close()}
})


test('原始Subagent控制器合法并发3往返，清除回模板2不播种默认',async()=>{
  const state=await fixture(true) // 管理员可编辑官方正整数并发，模板2不是准入上限。
  try{
    await state.load(subagentSdk)
    const row=state.slots.entries('plugins.item').find(entry=>entry.options.id==='subagent') // 完整原始SDK公开注册，未访问私类。
    const face=row.inject()
    face.editLimit('maxActiveSubagents','3')
    assert.equal(face.hooks.subagentLimitsCard.getSnapshot().dirty,true)
    assert.equal(face.hooks.subagentLimitsCard.getSnapshot().invalid,false)
    face.save()
    await settled()
    assert.equal(state.puts.length,1)
    assert.deepEqual(state.policy().settings.namespaces,{subagent:{maxActiveSubagents:3}})
    assert.equal(face.hooks.subagentLimitsCard.getSnapshot().maxActiveSubagents.text,'3')
    assert.equal(face.hooks.subagentLimitsCard.getSnapshot().dirty,false)
    assert.equal(face.hooks.subagentLimitsCard.getSnapshot().failed,false)
    assert.equal(face.hooks.subagentLimitsCard.getSnapshot().maxActiveSubagents.overridden,true)
    assert.equal(face.hooks.subagentLimitsCard.getSnapshot().maxDepth.text,'1') // 调整并发不扩大或更改深度边界。
    face.resetLimit('maxActiveSubagents')
    face.save()
    await settled()
    assert.equal(state.puts.length,2)
    assert.deepEqual(state.policy().settings.namespaces,{}) // 清除表示继承，不能向后端写入猜测默认。
    assert.equal(face.hooks.subagentLimitsCard.getSnapshot().maxActiveSubagents.text,'2')
    assert.equal(face.hooks.subagentLimitsCard.getSnapshot().maxActiveSubagents.overridden,false)
    const original=(await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-subagent')).href)).default.Config({}) // 原始SDK默认对照与受管模板基线分开。
    assert.equal(original.maxActiveSubagents.get(),8)
  }finally{await state.close()}
})

test('原始AgentLoop控制器合法Tool并发3往返，清除回模板2不施加硬cap',async()=>{
  const state=await fixture(true) // 当前两并发只是共享模板继承值，合法3由原始Controller保存。
  try{
    await state.load(agentLoopSdk)
    const row=state.slots.entries('plugins.item').find(entry=>entry.options.id==='agent-loop')
    const face=row.inject() // 原始SDK公开编辑与原生scope.mutate保存链。
    face.edit('maxParallelToolCalls','3')
    assert.equal(face.hooks.agentLoopCard.getSnapshot().dirty,true)
    assert.equal(face.hooks.agentLoopCard.getSnapshot().invalid,false)
    face.save()
    await settled()
    assert.equal(state.puts.length,1)
    assert.deepEqual(state.policy().settings.namespaces,{'agent-loop':{maxParallelToolCalls:3}})
    assert.equal(face.hooks.agentLoopCard.getSnapshot().maxParallelToolCalls.text,'3')
    assert.equal(face.hooks.agentLoopCard.getSnapshot().dirty,false)
    assert.equal(face.hooks.agentLoopCard.getSnapshot().failed,false)
    assert.equal(face.hooks.agentLoopCard.getSnapshot().maxParallelToolCalls.overridden,true)
    face.resetField('maxParallelToolCalls')
    face.save()
    await settled()
    assert.equal(state.puts.length,2)
    assert.deepEqual(state.policy().settings.namespaces,{})
    assert.equal(face.hooks.agentLoopCard.getSnapshot().maxParallelToolCalls.text,'2')
    assert.equal(face.hooks.agentLoopCard.getSnapshot().maxParallelToolCalls.overridden,false)
  }finally{await state.close()}
})
