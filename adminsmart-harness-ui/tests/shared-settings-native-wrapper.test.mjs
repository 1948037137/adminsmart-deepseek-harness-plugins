/** 候选三模块外壳的真实 Cordis/ModuleSystem 装配测试；只使用合成传输、元数据和 DOM。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { GENERAL_SETTINGS_NAMESPACES } from '../src/ui-policy-client.mjs'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 只读明确选定的固定 npm SDK，不从上游构建副本。

/**
 * 提供原始 Settings 所需的公开 Observable。
 * @param {unknown} initial 当前合成快照。
 * @returns {object} 引用稳定的存取与订阅接口，无真实持久化副作用。
 */
function snapshotStore(initial) {
  let value = initial // 只在接受新数据时替换引用。
  const listeners = new Set() // 当前离线消费者拥有的回调。
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      value = next
      for (const listener of listeners) listener()
    },
    update(edit) {
      const next = structuredClone(value)
      edit(next)
      this.set(next)
    },
  }
}

/** @returns {object} 由测试独占的 Promise 和释放能力，不执行真实等待或外部调用。 */
function deferred() {
  let release // 放行当前合成阶段的唯一能力。
  const promise = new Promise((resolve) => {
    release = resolve
  }) // 保持 pending 直到测试明确释放。
  return { promise, release }
}

/** @returns {Promise<void>} 等待公开回调结算，不设置任意长睡眠。 */
async function settle() {
  for (let index = 0; index < 5; index += 1)
    await new Promise((resolve) => setImmediate(resolve))
}

/**
 * 使用原始 ModuleSystem 和 Settings factory 执行完整候选外壳。
 * @param {import('node:test').TestContext} t 当前测试拥有 fetch/global 的清理边界。
 * @param {object} options 控制合成响应的阶段与错误。
 * @param {boolean} [options.holdCode] 扣住两个 ESM 和原始经典 script，检查三个阶段并行。
 * @param {boolean} [options.holdPolicy] 扣住 General 与 Native GET，检查原始消费者依赖门。
 * @param {boolean} [options.holdSchema] 扣住两次官方 describe，不伪造描述已完成。
 * @param {number} [options.nativeStatus] 第一次 Native GET 状态码；404 表示发布窗口兼容。
 * @param {boolean} [options.expirePolicy] 使用合成绝对时钟证明最后阶段沿用剩余预算。
 * @param {boolean} [options.rejectNativeModule] 模拟第三个模块加载失败。
 * @param {unknown} [options.nativeRevision] Host 注入代码哈希；非法时必须使用固定 legacy URL。
 * @param {'valid'|'invalid-version'} [options.bootstrapMode] 当前 HTML 安全启动数据；缺失时验证原始网络路径。
 * @param {boolean} [options.administrator=false] 使用合成管理员及官方模型描述，验证重连后的Host局部CAS。
 * @returns {Promise<object>} 真实上下文、fiber、可控响应与非敏感观察数据。
 */
async function fixture(
  t,
  {
    holdCode = false,
    holdPolicy = false,
    holdSchema = false,
    nativeStatus = 200,
    expirePolicy = false,
    rejectNativeModule = false,
    nativeRevision,
    bootstrapMode,
    administrator = false,
  } = {},
) {
  const require = createRequire(
    pathToFileURL(resolve(runtimeRoot, 'package.json')),
  ) // 固定版本公共包解析。
  const cordis = await import(
    pathToFileURL(require.resolve('@deepseek-ai/cordis')).href
  ) // 真实生命周期与服务所有权。
  const originals = new Map() // 完整原始官方工厂，不截取内部函数或改写源码。
  for (const name of [
    '@deepseek-ai/dsh-client-modules',
    '@deepseek-ai/dsh-client-ui-settings',
  ]) {
    assert.equal(require(name + '/package.json').version, '0.2.1-alpha.3')
    const file = require.resolve(name + '/client') // 当前固定版公开 Client 入口。
    let record // 原始 ModuleLoader 收到的登记合同。
    runInNewContext(
      await readFile(file, 'utf8'),
      {
        window: {
          __ModuleLoader__: {
            load(value) {
              record = value
            },
          },
        },
        structuredClone,
        console,
        queueMicrotask,
      },
      { filename: file },
    )
    originals.set(name, record)
  }
  const seed = {
    '@deepseek-ai/cordis': cordis, // 与测试 fiber 相同的官方平台单例。
    '@deepseek-ai/dsh-client-store': { createSnapshotStore: snapshotStore }, // 原始公开 Store 形状的离线实现。
  }
  const exports = originals
    .get('@deepseek-ai/dsh-client-modules')
    .factory(() => {
      throw new Error('禁止外部依赖')
    }) // 原始 ModuleSystem 导出。
  const target = { mode: 'queue', pendingQueue: [], load() {} } // 官方经典脚本登记入口。
  const modules = exports.createClientModuleSystem(
    target,
    {
      id: '@deepseek-ai/dsh-client-modules', // 原始基础设施身份。
      exports, // 原始工厂完整导出。
    },
    {
      boot: { rev: 'synthetic-native-wrapper', entries: [], batches: [] }, // 没有重复官方 Settings plugin entry。
      staticModules: seed, // 只允许离线种子，不进行未知真实资源载入。
      loadBundle: async () => {
        throw new Error('禁止网络模块载入')
      }, // 任何意外真实网络都会让测试失败。
    },
  )
  const codeGate = deferred() // 三份独立资源同时开始后才由测试放行。
  const policyGate = deferred() // General 与 Native 的首次响应共用测试放行，不改变并行起始事实。
  const schemaGate = deferred() // 两个官方描述读的合成门。
  const specifiers = [] // 只保存非敏感固定模块 URL 和版本哈希。
  const reads = { general: 0, native: 0, schemas: 0, puts: 0 } // 验证并行与零写入，不记录任何用户数据。
  let status = nativeStatus // 发布窗口结束时可以把 404 变为正常 API。
  let scripts = 0 // 原始官方 Client 只能登记一次。
  let removed = 0 // 卸载/超时必须释放经典 script。
  let imports = 0 // 必须在原始 script 登记以后调用官方 import。
  let registered = false // 未登记前不允许产品发起未知 import。
  let activated = 0 // 实际 Cordis consumer 的首次激活次数。
  let firstTheme // 实际服务激活时取得的首份组合表单值。
  let now = 1_000 // 仅总预算测试使用的合成绝对时钟。
  const timeouts = [] // 完整外壳实际分配的剩余预算。
  const policy = {
    revision: 4, // 与 Native CAS 独立的 General 修订。
    settings: {
      locale: null, // 保留官方浏览器语言继承。
      theme: 'light', // 用于首份快照门禁的管理员共享主题。
      fontSize: 17, // 旧 General 原生字段不能被 Native 桥丢失。
      transcriptView: 'verbose', // 官方轨迹呈现模式。
      performanceUsage: 'detailed', // 官方用量呈现模式。
      developerTools: false, // 不向普通用户开放工作区代码视图。
      busyEnter: 'queue', // 官方忙时输入行为。
      linkOpening: 'sidebar', // 官方链接预览行为。
    },
    writable: administrator, // 仅合成身份；全部测试传输仍禁止PUT。
  }
  const nativePolicy = {
    revision: 7, // Native 独立修订，不能与 General 数字混用。
    settings: {
      harnessVersion: '0.2.1-alpha.3', // 固定 SDK 契约版本。
      namespaces: {
        'ui-theme': { codeFontSize: 12 },
        'agent-loop': { maxParallelToolCalls: 3 },
      }, // 合法原生覆盖，2 只是模板默认。
      plugins: {}, // 不调整本测试插件开关。
      clientPreferences: {}, // 不制造未经管理员选择的折叠偏好。
    },
    writable: administrator, // 后端角色事实与官方metadata保持一致。
  }
  const described = {
    ok: true, // 与原始 Remote 完全相同的公开回答形状，不伪造官方服务。
    value: {
      writable: administrator, // 普通角色保持只读，管理员只用于模型元数据回归。
      hasDocument: false, // 安全启动包不提供本地配置文档能力。
      namespaces: [...new Set([...GENERAL_SETTINGS_NAMESPACES, 'subagent', 'agent-loop', 'ui-settings-general'])].map(ns => ({
        ns: ns === 'ui-settings' ? 'adminsmart-shared-settings' : ns, // 相同 owned alias 合同由正式 Adapter 统一处理。
        schema: { type: 'object', dict: {} }, // 专用原始 SDK 测试另验实际 Schema；本组只验证装配时序。
        value: ns === 'ui-theme' ? { codeFontSize: 10 } : {}, // 原生覆盖从独立 Native region采用，不能拿旧值放行。
        base: {}, // 不以本用户当前值猜测受管继承。
        revision: 1, // 官方 raw namespace修订，与两个policyCAS都不同。
        applies: 'live', // 保留公开实时采用声明。
        secrets: [], // 此Fixture不包含模型、凭据或任何秘密描述。
      })),
    },
  } // 安全初始数据和后续真实Remote读取共用相同合成契约。
  if (administrator) described.value.namespaces.push({ ns: 'llm-pi-ai', schema: { type: 'object', dict: {} }, value: { providers: { fixture: {} } }, user: {}, base: {}, revision: 8, applies: 'live', secrets: [] }) // 合成模型namespace不含Key、地址或真实业务配置；不用于安全HTML包。
  const remote = {
    $host: { isLoopback: false }, // 与 production 公开 Remote 条件一致的合成事实。
    $on: () => () => {}, // 不连接真实事件网络。
    settings: {
      async describe() {
        reads.schemas += 1
        await schemaGate.promise
        return structuredClone(described)
      },
    },
  }
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(request.method, 'GET')
    if (request.method === 'PUT') reads.puts += 1
    if (url === './adminsmart/ui-policy') {
      reads.general += 1
      await policyGate.promise // 即使 Fake 忽略 signal，卸载门禁也必须及时结束。
      return {
        ok: true,
        status: 200,
        json: async () => structuredClone(policy),
      }
    }
    assert.equal(url, './adminsmart/native-policy')
    reads.native += 1
    await policyGate.promise
    return {
      ok: status === 200,
      status,
      json: async () => structuredClone(nativePolicy),
    }
  })
  const previousWindow = globalThis.window // 恢复 Node 的合成全局，不留下跨测试状态。
  globalThis.window = {
    __ADMINSMART_NATIVE_POLICY_BASELINE__: {
      subagent: { maxDepth: 1, maxActiveSubagents: 2 }, // 模板实际继承，不是配置硬 cap。
      'agent-loop': { maxParallelToolCalls: 2 }, // 清除后必须恢复业务模板 2。
    },
  }
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  })
  const ctx = new cordis.Context() // 每个测试独占服务、fiber 和事件生命周期。
  ctx.provide('modules', {
    loadCache: modules.loadCache, // 真实 ModuleSystem 拥有登记目录。
    import(specifier, parent, attributes) {
      assert.equal(registered, true)
      imports += 1
      return modules.import(specifier, parent, attributes)
    },
  })
  ctx.provide('remote', remote)
  ctx.provide('remote.settings', remote.settings)
  ctx.provide('slots', {
    inject: (_name, register) => register(), // 原始 status Slot 使用公开注入机制。
    register: () => () => {}, // 不渲染 UI，不覆盖官方组件。
    subscribe: () => () => {}, // collapse Slot 不在当前测试装载。
    entries: () => [], // 不伪造可用 transcript-view。
  })
  const document = {
    createElement() {
      const listeners = new Map() // 当前 script 拥有的 load/error 回调。
      return {
        src: '',
        async: true,
        addEventListener(name, callback) {
          listeners.set(name, callback)
        },
        removeEventListener(name) {
          listeners.delete(name)
        },
        remove() {
          removed += 1
        },
        listeners,
      }
    },
    head: {
      append(script) {
        scripts += 1
        assert.match(
          script.src,
          /^http:\/\/fixture\.example\/runtime\/adminsmart\/shared-settings\/official-client\.js\?rev=[a-f0-9]{64}$/u,
        )
        void codeGate.promise.then(() => {
          if (expirePolicy) now = 5_500
          target.load(originals.get('@deepseek-ai/dsh-client-ui-settings')) // 原样执行固定 npm 工厂登记，保留公开身份。
          registered = true
          script.listeners.get('load')?.()
        })
      },
    },
  }
  const hashes = {
    official: createHash('sha256')
      .update(
        await readFile(
          require.resolve('@deepseek-ai/dsh-client-ui-settings/client'),
        ),
      )
      .digest('hex'), // Host 固定源码哈希。
    general: createHash('sha256')
      .update(
        await readFile(new URL('../src/ui-policy-client.mjs', import.meta.url)),
      )
      .digest('hex'), // 旧纯模块字节身份。
    native: createHash('sha256')
      .update(
        await readFile(new URL('../src/native-policy-client.mjs', import.meta.url)),
      )
      .digest('hex'), // 新纯模块字节身份。
  }
  let record // 候选完整 Lazy-CJS 登记合同。
  const file = new URL('../shared-settings/client.js', import.meta.url) // 不抽取或替换内部产品函数。
  runInNewContext(
    await readFile(file, 'utf8'),
    {
      window: {
        location: {
          href: 'http://fixture.example/runtime/?rev=untrusted-query',
        }, // 页面参数不能决定静态模块版本。
        __ADMINSMART_SHARED_SETTINGS_CLIENT_REVISION__: hashes.official, // 与原始官方字节一致的可信哈希。
        __ADMINSMART_UI_POLICY_CLIENT_REVISION__: hashes.general, // General 代码身份，不是数据 CAS。
        __ADMINSMART_NATIVE_POLICY_CLIENT_REVISION__:
          nativeRevision === undefined ? hashes.native : nativeRevision, // 用例可验证非法 metadata。
        ...(bootstrapMode ? {
          __ADMINSMART_SETTINGS_BOOTSTRAP__: {
            version: bootstrapMode === 'invalid-version' ? 2 : 1, // 无效版本必须走真正的首GET门禁。
            harnessVersion: '0.2.1-alpha.3', // 同固定原始SDK版本，禁止跨版本复用旧schema。
            general: policy, // 独立八字段已确认信封。
            native: nativePolicy, // 独立Native已确认信封。
            described, // 当前角色只有安全General/Native行，不含供应商或凭据。
          },
        } : {}), // 缺少HTML包时保持已有行为。
        __ModuleLoader__: {
          load(value) {
            record = value
          },
        }, // 官方 ModuleLoader 登记入口。
      },
      document,
      URL,
      AbortController,
      Date: expirePolicy ? { now: () => now } : Date, // 只在总预算目标中替换绝对时钟。
      setTimeout(callback, delay) {
        timeouts.push(delay)
        return setTimeout(
          callback,
          expirePolicy && timeouts.length === 5 ? 10 : delay,
        )
      },
      clearTimeout,
      setInterval,
      clearInterval,
    },
    {
      filename: file.pathname,
      importModuleDynamically: async (specifier) => {
        specifiers.push(specifier)
        await codeGate.promise
        const pathname = new URL(specifier).pathname // 只映射已观察固定 URL 的模块，不让输入决定本地路径。
        if (pathname.endsWith('/native-policy-client.mjs')) {
          if (rejectNativeModule) throw new Error('synthetic-native-load-error')
          return import('../src/native-policy-client.mjs')
        }
        assert.equal(pathname, '/runtime/adminsmart/ui-policy-client.mjs')
        return import('../src/ui-policy-client.mjs')
      },
    },
  )
  assert.equal(record.id, '@adminsmart/dsh-shared-settings')
  const wrapper = record.factory((name) => {
    assert.equal(name, 'react/jsx-runtime')
    return require(name)
  }) // 官方 React 平台单例。
  const consumer = ctx.plugin({
    inject: ['configForms'], // 服务在真实提供方 ready 前不能供给消费者。
    apply(owner) {
      activated += 1
      firstTheme = owner.configForms.get('ui-theme').getSnapshot().value
    },
  })
  const fiber = ctx.plugin(wrapper) // 官方 Context 真正执行完整 wrapper 生命周期。
  if (!holdCode) codeGate.release()
  if (!holdPolicy) policyGate.release()
  if (!holdSchema) schemaGate.release()
  return {
    ctx,
    fiber,
    consumer,
    modules,
    reads,
    hashes,
    specifiers,
    timeouts,
    releaseCode: codeGate.release,
    releasePolicy: policyGate.release,
    releaseSchema: schemaGate.release,
    setNativeStatus(value) {
      status = value
    },
    /** @param {number} revision 新Host的合成局部修订。 @returns {void} 只替换Fake下一次describe，不触发事件或写入。 */
    setModelRevision(revision) {
      const row = described.value.namespaces.find(item => item.ns === 'llm-pi-ai') // 仅管理员fixture提供这一合成namespace。
      row.revision = revision
    },
    get activated() {
      return activated
    },
    get firstTheme() {
      return firstTheme
    },
    get scripts() {
      return scripts
    },
    get imports() {
      return imports
    },
    get removed() {
      return removed
    },
    async dispose() {
      await consumer.dispose()
      await fiber.dispose()
    },
  }
}

test('正式wrapper连接重置允许管理员模型CAS从8回0，不继续沿用旧Host版本', { skip: !runtimeRoot, timeout: 3_000 }, async t => {
  const state = await fixture(t, { administrator: true }) // 真实官方Mirror、Cordis与自有两层桥，只有传输和数据为Fake。
  t.after(() => state.dispose())
  await state.fiber.await()
  await settle()
  const model = () => state.ctx.configForms.describe().getSnapshot().view.namespaces.find(row => row.ns === 'llm-pi-ai') // 与官方Models创建卡相同的最终复合目录。
  assert.equal(model().revision, 8)
  state.setModelRevision(0)
  state.ctx.emit('connection/reset') // 唯一官方重连事件必须同时撤销两层旧Host读写代际。
  await settle()
  await state.ctx.configForms.describe().ensure()
  assert.equal(model().revision, 0)
  assert.equal(state.reads.puts, 0)
})

test('有效 Host 启动包无需首次 HTTP，首份 Theme 已采用独立双策略且 reset 仍真正回读', { skip: !runtimeRoot, timeout: 3_000 }, async (t) => {
  const state = await fixture(t, { bootstrapMode: 'valid', holdPolicy: true, holdSchema: true }) // 扣住真实网络，若启动仍等待它本测试不会激活。
  t.after(() => state.dispose())
  await state.fiber.await()
  await settle()
  assert.equal(state.activated, 1)
  assert.deepEqual(state.reads, { general: 0, native: 0, schemas: 1, puts: 0 })
  assert.equal(state.firstTheme.preference, 'light')
  assert.equal(state.firstTheme.fontSize, 17)
  assert.equal(state.firstTheme.codeFontSize, 12)
  state.ctx.emit('connection/reset') // 保留真实首次代际失效，不能重放已消费HTML包。
  await settle()
  assert.equal(state.reads.general, 1)
  assert.equal(state.reads.native, 1)
  assert.equal(state.reads.schemas, 3)
  state.releasePolicy()
  state.releaseSchema()
  await settle()
  assert.equal(state.reads.puts, 0)
})

test('模块下载期间的早到 reset 撤销迟到 HTML 包并走真实首读', { skip: !runtimeRoot, timeout: 3_000 }, async (t) => {
  const state = await fixture(t, { bootstrapMode: 'valid', holdCode: true, holdPolicy: true, holdSchema: true }) // 第一代际先于模块解析，不能在之后重新创建有效旧票据。
  t.after(() => state.dispose())
  state.ctx.emit('connection/reset')
  state.releaseCode()
  await settle()
  assert.equal(state.activated, 0)
  assert.deepEqual(state.reads, { general: 1, native: 1, schemas: 3, puts: 0 })
  state.releasePolicy()
  state.releaseSchema()
  await state.fiber.await()
  assert.equal(state.activated, 1)
})

test('版本损坏的 Host 启动包沿原始 GET 和 Schema 门禁恢复', { skip: !runtimeRoot, timeout: 3_000 }, async (t) => {
  const state = await fixture(t, { bootstrapMode: 'invalid-version', holdPolicy: true, holdSchema: true }) // 不能把半合法启动包当就绪。
  t.after(() => state.dispose())
  await settle()
  assert.equal(state.activated, 0)
  assert.deepEqual(state.reads, { general: 1, native: 1, schemas: 3, puts: 0 })
  state.releasePolicy()
  state.releaseSchema()
  await state.fiber.await()
  assert.equal(state.activated, 1)
  assert.equal(state.firstTheme.codeFontSize, 12)
})

test(
  '三份代码并行、General/Native/Schema 并行，完整原始 ModuleSystem 只在全部门禁确认后激活消费者',
  { skip: !runtimeRoot, timeout: 3_000 },
  async (t) => {
    const state = await fixture(t, {
      holdCode: true,
      holdPolicy: true,
      holdSchema: true,
    }) // 各阶段由测试分别放行。
    try {
      await settle()
      assert.equal(state.scripts, 1)
      assert.equal(state.imports, 0)
      assert.deepEqual(
        [...state.specifiers].sort(),
        [
          `http://fixture.example/runtime/adminsmart/ui-policy-client.mjs?rev=${state.hashes.general}`,
          `http://fixture.example/runtime/adminsmart/native-policy-client.mjs?rev=${state.hashes.native}`,
        ].sort(),
      )
      assert.equal(state.activated, 0)
      state.releaseCode()
      await settle()
      assert.deepEqual(state.reads, {
        general: 1,
        native: 1,
        schemas: 3,
        puts: 0,
      })
      assert.equal(state.activated, 0)
      state.releasePolicy()
      await settle()
      assert.equal(state.activated, 0)
      assert.equal(state.ctx.get('configForms'), undefined)
      state.releaseSchema()
      await state.fiber.await()
      await state.consumer.await()
      assert.equal(state.activated, 1)
      assert.equal(state.firstTheme.preference, 'light')
      assert.equal(state.firstTheme.fontSize, 17)
      assert.equal(state.firstTheme.codeFontSize, 12)
      assert.equal(
        state.ctx.get('configForms').get('agent-loop').getSnapshot().value
          .maxParallelToolCalls,
        3,
      )
      assert.equal(state.modules.manifest.plugins.length, 0)
      assert.equal(state.removed, 1)
    } finally {
      state.releaseCode()
      state.releasePolicy()
      state.releaseSchema()
      await state.dispose()
    }
  },
)

test(
  '真正首次 Native 404 保留同一 Theme scope 的 General 基线，重连后恢复原生覆盖且无 PUT',
  { skip: !runtimeRoot, timeout: 3_000 },
  async (t) => {
    const state = await fixture(t, { nativeStatus: 404 }) // 未先接受任何 Native 策略。
    try {
      await state.fiber.await()
      await state.consumer.await()
      const form = state.ctx.get('configForms').get('ui-theme') // 404 前后必须保持同一个公开 form 实例。
      assert.equal(form.getSnapshot().value.preference, 'light')
      assert.equal(form.getSnapshot().value.fontSize, 17)
      assert.equal(
        Object.hasOwn(form.getSnapshot().value, 'codeFontSize'),
        false,
      )
      state.setNativeStatus(200)
      state.ctx.emit('connection/reset')
      await settle()
      assert.strictEqual(state.ctx.get('configForms').get('ui-theme'), form)
      assert.equal(form.getSnapshot().value.preference, 'light')
      assert.equal(form.getSnapshot().value.codeFontSize, 12)
      assert.equal(state.reads.puts, 0)
    } finally {
      await state.dispose()
    }
  },
)

test(
  '三模块加载 pending 时卸载及时结束，迟到原始脚本/ESM 不创建服务',
  { skip: !runtimeRoot, timeout: 3_000 },
  async (t) => {
    const state = await fixture(t, { holdCode: true }) // 三个资源确实开始后才卸载。
    try {
      await settle()
      const started = Date.now() // 检查卸载无需耗尽共同五秒预算。
      await state.fiber.dispose()
      assert.ok(Date.now() - started < 1_000)
      state.releaseCode()
      await settle()
      assert.equal(state.imports, 0)
      assert.equal(state.activated, 0)
      assert.deepEqual(state.reads, {
        general: 0,
        native: 0,
        schemas: 0,
        puts: 0,
      })
      assert.equal(state.ctx.get('configForms'), undefined)
      assert.equal(state.removed, 1)
    } finally {
      state.releaseCode()
      await state.dispose()
    }
  },
)

test(
  '双策略首次读取忽略 signal 仍能卸载，迟到正文不能重新供给 configForms',
  { skip: !runtimeRoot, timeout: 3_000 },
  async (t) => {
    const state = await fixture(t, { holdPolicy: true }) // Fake 故意不响应 AbortSignal。
    try {
      await settle()
      assert.equal(state.reads.native, 1)
      assert.equal(state.reads.general, 1)
      const started = Date.now() // 真实 Cordis dispose 不等待传输回答。
      await state.fiber.dispose()
      assert.ok(Date.now() - started < 1_000)
      state.releasePolicy()
      await settle()
      assert.equal(state.activated, 0)
      assert.equal(state.ctx.get('configForms'), undefined)
    } finally {
      state.releasePolicy()
      await state.dispose()
    }
  },
)

test(
  '第三模块加载失败不创建官方服务，稳定错误不泄漏底层细节',
  { skip: !runtimeRoot, timeout: 3_000 },
  async (t) => {
    const state = await fixture(t, { rejectNativeModule: true }) // 一个 ESM 独立失败。
    try {
      await assert.rejects(
        () => state.fiber.await(),
        /原生设置适配模块加载失败或超时/u,
      )
      assert.equal(state.activated, 0)
      assert.equal(state.ctx.get('configForms'), undefined)
      assert.deepEqual(state.reads, {
        general: 0,
        native: 0,
        schemas: 0,
        puts: 0,
      })
    } finally {
      await state.dispose()
    }
  },
)

test(
  '三代码与双读取共用五秒总预算，最后 500ms 超时后迟到结果失去发布权',
  { skip: !runtimeRoot, timeout: 3_000 },
  async (t) => {
    const state = await fixture(t, { holdPolicy: true, expirePolicy: true }) // 原始脚本完成时已经消耗 4.5 秒。
    try {
      await assert.rejects(
        () => state.fiber.await(),
        /共享设置首次读取失败或超时/u,
      )
      assert.deepEqual(state.timeouts, [5_000, 5_000, 5_000, 500, 500])
      assert.equal(state.activated, 0)
      state.releasePolicy()
      await settle()
      assert.equal(state.activated, 0)
      assert.equal(state.ctx.get('configForms'), undefined)
    } finally {
      state.releasePolicy()
      await state.dispose()
    }
  },
)

test(
  'Native 非法 Host metadata 只使用固定 legacy URL，页面 query 不被采纳',
  { skip: !runtimeRoot, timeout: 3_000 },
  async (t) => {
    const state = await fixture(t, {
      holdCode: true,
      nativeRevision: '../other.mjs?rev=malformed',
    }) // metadata 只代表代码身份。
    try {
      await settle()
      assert.ok(
        state.specifiers.includes(
          'http://fixture.example/runtime/adminsmart/native-policy-client.mjs',
        ),
      )
      assert.equal(
        state.specifiers.some(
          (value) =>
            value.includes('malformed') || value.includes('untrusted-query'),
        ),
        false,
      )
    } finally {
      await state.fiber.dispose()
      state.releaseCode()
      await state.dispose()
    }
  },
)
