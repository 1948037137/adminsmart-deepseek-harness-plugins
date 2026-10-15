/** 候选完整Host真实Cordis/Remote/SettingsForms装配smoke；所有网络、身份与Profile均隔离Fake。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { verifyOfficialRemoteClientBoot } from './official-client-boot-fixture.mjs'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 只读固定SDK运行代码。
const require = createRequire(pathToFileURL(join(runtimeRoot, 'package.json'))) // 同一安装解析真实公开类与Schema。
const load = (name) => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { Loader } = await load('@deepseek-ai/cordis-plugin-loader')
const { Include } = await load('@deepseek-ai/cordis-plugin-include')
const { ClientModuleRegistry } = await load('@deepseek-ai/dsh-client-modules')
const { renderIndexInjections } = await load('@deepseek-ai/dsh-host-webserver')
const { default: Registry } = await load('@deepseek-ai/dsh-typert-registry')
const { default: Gateway } = await load('@deepseek-ai/dsh-api-gateway')
const { default: RemoteAccess } = await load('@deepseek-ai/dsh-api-remote-access') // 完整Host依赖真实官方访问服务，不以allallow替身绕过授权链。
const { Peer } = await load('@deepseek-ai/dsh-client-connection') // 当前独立HostOwner与全站管理员角色分别核验。
const { SettingsForms } = await load('@deepseek-ai/dsh-settings')
const { remoteMethods } = await load('@deepseek-ai/dsh-typert-protocol')
const { PluginManager } = await load('@deepseek-ai/dsh-plugin-manager')
const { WorkspaceController, DirectoryPickerController } = await load('@deepseek-ai/dsh-api-workspace-controller')
const { SessionController, SessionFileReferences, SessionSkillCatalog } = await load('@deepseek-ai/dsh-api-session-controller')
const { SessionStore } = await load('@deepseek-ai/dsh-session')
const { SessionProjectionRegistry } = await load('@deepseek-ai/dsh-session-projection')
const { Config: PiConfig } = await load('@deepseek-ai/dsh-llm-pi-ai')
const hostModule = await import('../src/index.mjs') // 当前镜像已经整合的真正完整index，不剪贴apply或替代模块。

/** 固定协议响应；所有JSON只包含合成字段，不发HTTP请求。 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
/** 等待已注册SDK微任务及Fixture通知，不依赖实际浏览器。 */
async function tick() {
  for (let index = 0; index < 4; index += 1)
    await new Promise((resolve) => setImmediate(resolve))
}
/** 有界SDK装配/管理调用，完成后立即释放本测试Timer。 */
async function within(operation, ms, message) {
  let timer
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

for (const isAdmin of [false, true])
  test('候选完整index真实SDK装配与清理，管理员=' + isAdmin, async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'adminsmart-index-sdk-')) // 本测试唯一拥有的状态和Profile根。
    const homeDir = join(temporary, 'home') // Home与Profile目录分开，避免官方组合器重复读同一个patch。
    await mkdir(homeDir)
    await symlink(join(runtimeRoot, 'node_modules'), join(temporary, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir') // 独占Fixture经只读SDK依赖链接解析官方裸包，清理仅移除链接而不访问上游目录。
    const previousCwd = process.cwd() // 最终恢复调用者目录，所有实际realpath校验只在本测试独占临时目录执行。
    const tokenPath = join(temporary, 'capability.token') // 仅写合成能力，不读取真实凭据。
    const patchPath = join(temporary, 'cordis.patch.yml') // 原始PluginManager需要的独占Profilepatch。
    await writeFile(tokenPath, 'fixture-capability', 'utf8')
    await writeFile(
      join(temporary, 'package.json'),
      JSON.stringify({
        name: 'fixture-index-sdk',
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: [] } },
      }),
      'utf8',
    )
    const modules = {
      'ui-skill': '@deepseek-ai/dsh-client-ui-skill',
      'ui-message-feedback': '@deepseek-ai/dsh-client-ui-message-feedback',
      'ui-trajectory': '@deepseek-ai/dsh-client-ui-trajectory',
    } // 唯一可管理的既有展示行。
    await writeFile(
      patchPath,
      '- insert:\n' +
        Object.entries(modules)
          .map(([id, name]) => `    - id: ${id}\n      name: '${name}'\n`)
          .join(''),
      'utf8',
    )
    const vars = {
      DSH_HOME: homeDir,
      ADMINSMART_DSH_ROOT: runtimeRoot,
      ADMINSMART_AGENT_API_BASE: 'http://127.0.0.1:9977',
      ADMINSMART_AGENT_TOKEN_FILE: tokenPath,
      ADMINSMART_AGENT_USER_ID: '7',
      ADMINSMART_AGENT_MODE_ID: 'knowledge',
      ADMINSMART_AGENT_PRESET_ID: 'adminsmart-knowledge',
      ADMINSMART_AGENT_IS_ADMIN: isAdmin ? '1' : '0',
      ADMINSMART_AGENT_PLUGIN_CAPABILITIES_JSON: JSON.stringify({
        harnessVersion: '0.2.1-alpha.3', // 能力只用于本测试指定的固定发行版。
        allowedPluginIds: Object.keys(modules), // 只给当前实际装配的合成展示行管理资格。
        activePluginIds: Object.keys(modules), // 初始Loader确实启用的三条原生展示插件。
        protectedPluginIds: [], // Fixture没有把基础设施误列为可管理展示行。
        selectedBundles: [], // 本Fixture不装配管理员高权限组合。
        availableBundles: [], // 不允许借真实安装中的其它组合扩大Fixture范围。
        protectedBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], // 基础引擎与Web组合仍保持保护。
        blockedPluginReasons: {}, // 当前三条展示行没有业务冲突。
        blockedBundleReasons: {}, // 未开放任何可选择组合。
        adminOnlyBundles: {}, // 角色授权仍由Host业务Guard验证，本Fixture不声明高权限组合。
        roleExcludedBundles: [], // 当前两个角色采用同一合成展示装配。
      }),
      ADMINSMART_AGENT_UI_POLICY_SUPPORTED: '1',
      ADMINSMART_AGENT_NATIVE_BASELINE_JSON: JSON.stringify({
        subagent: { maxDepth: 1, maxActiveSubagents: 2 },
        'agent-loop': { maxParallelToolCalls: 2 },
      }),
    } // 可信env只用于当前隔离装配。
    const oldEnv = new Map(
      Object.keys(vars).map((key) => [key, process.env[key]]),
    ) // 只在内存保存需恢复的配置，不读取令牌值。
    Object.assign(process.env, vars)
    const previousFetch = globalThis.fetch // 所有共享后台/模型入口必须被Fake接管。
    const streams = new Set() // 原始SSE helper实际打开的合成流，dispose应中止。
    const network = [] // 只记录固定路径和方法，不记录认证头或正文。
    let native = {
      revision: 1,
      settings: {
        harnessVersion: '0.2.1-alpha.3',
        namespaces: {},
        plugins: {},
        clientPreferences: {},
      },
    } // 未覆写任何Host默认的已发布共享区域。
    const general = {
      revision: 3,
      settings: {
        locale: null,
        theme: 'light',
        fontSize: 14,
        transcriptView: 'standard',
        performanceUsage: 'compact',
        linkOpening: 'sidebar',
        busyEnter: 'queue',
        developerTools: false,
      },
    } // 合成旧八字段真源。
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url) // SDK和自有模块只能访问Fake9977；不能碰真实9099。
      assert.equal(url.origin, 'http://127.0.0.1:9977')
      network.push({ path: url.pathname, method: options.method ?? 'GET' })
      if (url.pathname.endsWith('/ui-policy/events')) {
        let controller // 每个真实helper持有独立合成SSE，可随AbortSignal结束。
        const marker = {} // 用对象身份追踪当前流，而不显示能力或用户字段。
        const body = new ReadableStream({
          start(current) {
            controller = current
            streams.add(marker)
            current.enqueue(
              new TextEncoder().encode('event: ready\ndata: {}\n\n'),
            )
            options.signal?.addEventListener(
              'abort',
              () => {
                streams.delete(marker)
                try {
                  controller.close()
                } catch {}
              },
              { once: true },
            )
          },
          cancel() {
            streams.delete(marker)
          },
        })
        return new Response(body, {
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      if (url.pathname.endsWith('/native-policy')) {
        if (options.method === 'PUT') {
          const value = JSON.parse(options.body)
          assert.equal(isAdmin, true)
          assert.equal(value.expectedRevision, native.revision)
          native = { revision: native.revision + 1, settings: value.settings }
        }
        return json(native)
      }
      if (url.pathname.endsWith('/ui-policy')) return json(general)
      if (url.pathname.endsWith('/harness-profile'))
        return json({
          revision: 0,
          providers: {},
          defaultProvider: '',
          defaultModel: '',
        })
      return json(
        { error: { code: 'fixture-unavailable', message: '合成未配置端点' } },
        404,
      ) // 旧快捷键未配置时保持兼容，无外部服务回退。
    }
    const ctx = new Context() // 真SDK提供方归属和子fiber生命周期。
    const peer = new Peer(ctx, { principal: { kind: 'owner' } }) // 两种业务角色都是各自HostOwner；普通角色仍必须被业务管理Guard拒绝。
    const invoke = (request) => ctx.typertGateway.invoke({ ...request, peer }) // 所有Remote都显式经过官方Peer访问检查，不直接调用控制器方法。
    const routes = new Map() // 不启动HTTP，仅检查真实Host登记/卸载。
    const schemas = new Map()
    for (const [ns, name] of [
      ['locale', '@deepseek-ai/dsh-client-locale'],
      ['ui-theme', '@deepseek-ai/dsh-client-ui-theme'],
      ['ui-chat', '@deepseek-ai/dsh-client-ui-chat'],
      ['ui-conversation', '@deepseek-ai/dsh-client-ui-conversation'],
      ['adminsmart-shared-settings', '@deepseek-ai/dsh-client-ui-settings'],
      ['ui-settings-general', '@deepseek-ai/dsh-client-ui-settings-general'],
    ])
      schemas.set(ns, (await load(name)).Config)
    schemas.set(
      'subagent',
      (await load('@deepseek-ai/dsh-subagent')).default.Config,
    )
    schemas.set(
      'agent-loop',
      (await load('@deepseek-ai/dsh-agent-loop')).default.Config,
    )
    schemas.set(isAdmin ? 'llm-pi-ai' : 'adminsmart-managed-llm', PiConfig)
    const raw = {
      locale: {},
      'ui-theme': { preference: 'light', fontSize: 14 },
      'ui-chat': {
        transcriptView: 'standard',
        performanceUsage: 'compact',
        linkOpening: 'sidebar',
      },
      'ui-conversation': { busyEnter: 'queue' },
      'adminsmart-shared-settings': { enabled: false },
      'ui-settings-general': {},
      subagent: { maxDepth: 1, maxActiveSubagents: 2 },
      'agent-loop': { maxParallelToolCalls: 2 },
      [isAdmin ? 'llm-pi-ai' : 'adminsmart-managed-llm']: { providers: {} },
    } // 实际原生Schema解析Synthetic值，不抄完整用户Profile。
    const entries = Object.entries(raw).map(([id, value]) => ({
      id: 'include:' + id,
      options: { id, name: 'fixture:' + id, config: value },
      disabled: false,
      parent: { tree: { ctx: { fiber: { entry: { id: 'include' } } } } },
      fiber: {
        uid: 'fixture:' + id,
        state: 2,
        runtime: { Config: schemas.get(id) },
        ctx,
        config: schemas.get(id)(value),
      },
    })) // SettingsForms读取真实Schema，但业务/磁盘事务由FakeEditor控制。
    for (const [id, name] of Object.entries(modules))
      entries.push({
        id: 'include:' + id,
        options: { id, name },
        disabled: false,
        parent: { tree: { ctx: { fiber: { entry: { id: 'include' } } } } },
        fiber: { state: 2 },
      })
    const loader = ctx.plugin(Loader, { baseUrl: pathToFileURL(join(runtimeRoot, 'package.json')).href }) // 真实Loader必须实际导入主Host与wrapper，不能用假Entry绕过启动门禁。
    await loader.await()
    ctx.loader.builtins.include = Include // 官方公开Include承载真实子树，保留既有管理ID和包解析上下文。
    ctx.provide('profileContext', {
      name: 'fixture',
      dir: temporary,
      patchPath,
      home: homeDir,
      cwd: temporary,
      installAnchor: join(runtimeRoot, 'package.json'),
      startedBundles: [],
      overlays: [],
    })
    ctx.provide('configEditor', {
      documentPath: patchPath,
      entries: () => entries.filter((entry) => schemas.has(entry.options.id)),
      configuration: () =>
        entries
          .filter((entry) => schemas.has(entry.options.id))
          .map((entry) => ({
            entry,
            inherited: {},
            override: entry.options.config,
          })),
      async edit(entry, change) {
        const next = change(entry.options.config, {})
        entry.fiber.config = entry.fiber.runtime.Config(next)
        entry.options.config = next
      },
    }) // 官方SettingsForms负责路径/CAS/Schema，不自行仿造算法。
    ctx.provide('credentials', {
      resolve: async () => ({ value: 'fixture-key' }),
      describe: async () => ({ configured: false, writable: true }),
      set: async () => {},
      unset: async () => {},
    })
    const workspaces = new Map() // 合成官方Workspace记录；登记仅修改内存，不接触磁盘与生产存储。
    const workspaceOperations = [] // 公共Registry调用证据，用于核对受管控制器只采用中性Runtime目录。
    ctx.provide('workspaceRegistry', {
      archivedSessionIds: [], // Synthetic会话未归档，保留官方WorkspaceFeed与ArchivedSessionGate的读取契约。
      pinnedSessionIds: [], // Synthetic会话未固定，供官方WorkspaceFeed建立完整基线。
      list: () => [...workspaces.values()], // 同一合成Registry在初始化与Remote基线中保持一致。
      get: (id) => workspaces.get(id), // 官方Remote按稳定Workspace身份查找记录。
      resolveByPath: async (path) => [...workspaces.values()].find((item) => resolve(item.path) === resolve(path)), // 公共路径查询只比较Fixture对象。
      async create(path) {
        workspaceOperations.push({ kind: 'create', path })
        const existing = [...workspaces.values()].find((item) => resolve(item.path) === resolve(path)) // 原公开create具备路径幂等，repair不能产生新登记。
        if (existing) return existing
        const record = {
          id: 'fixture-workspace-' + (workspaces.size + 1), // 当前内存记录唯一身份，不作为用户/知识分区。
          path, // 公共create接收的目录，测试会核对为Runtime默认cwd。
          title: 'Fixture Workspace', // 只供原始Workspace视图Schema验证。
          sessionIds: [], // 原始SessionController通过attachSession登记成功创建的会话。
          createdAt: '2026-10-14T00:00:00.000Z', // 固定合成时间，避免依赖真实用户记录。
          updatedAt: '2026-10-14T00:00:00.000Z', // 公共Remote要求的可序列化更新时间。
          async attachSession(sessionId) {
            if (!this.sessionIds.includes(sessionId)) this.sessionIds.push(sessionId)
            workspaceOperations.push({ kind: 'attach', sessionId })
          },
        }
        workspaces.set(record.id, record)
        return record
      },
      initializeDefault: async () => { throw new Error('Fixture不能调用系统Documents目录初始化') }, // 受管初始化必须返回既有中性工作目录。
    })
    ctx.provide('sessionPersistence', {
      list: async () => [
        { header: { id: 'fixture-cold-session', cwd: temporary }, revision: 0 }, // 当前业务目录的合成持久元数据，验证通过header识别并关联。
        { header: { id: 'fixture-other-session', cwd: previousCwd }, revision: 0 }, // 其它合成目录必须跳过，不迁移或读取其正文。
      ],
    }) // 冷启动只读取合成header，不扫描真实用户数据。
    const rootSelection = Object.freeze({ provider: 'fixture-chat', model: 'fixture-chat-model', reasoningEffort: 'high' }) // 原聊天选择只读证据，不能被Workspace接线改写。
    let selectionWrites = 0 // 只记录对原选择的写调用，期望受管Workspace装配始终为零。
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ ...rootSelection }), // 官方SessionController读取原选择，但本Fixture不调用模型。
      saveSelection: async () => { selectionWrites += 1 }, // 合成持久化入口用于发现无关装配副作用。
    })
    ctx.provide('agents', { get: () => undefined, list: () => [] }) // 当前无活动Agent，控制器冷读不创建或恢复模型执行。
    ctx.provide('attachments', {
      imageLimits: {
        maxImageBytes: 4096, // 单张合成图片的字节上限。
        maxImagesPerMessage: 1, // 合成消息最多一张图，不涉及真实上传。
        maxMessageImageBytes: 4096, // 合成消息总字节上限。
        maxImagePixels: 4096, // 合成图片像素上限，供原始Projection Schema校验。
        maxImageDimension: 64, // 合成单边尺寸上限。
        mediaTypes: ['image/png'], // 原始客户端可接收的合成类型。
      },
    })
    const agentResolvers = new Set() // 原控制器注册的公开上传解析回调，卸载后必须全部释放。
    ctx.provide('fileUploads', {
      registerAgentResolver(resolver) {
        agentResolvers.add(resolver)
        return () => agentResolvers.delete(resolver)
      },
    })
    ctx.provide('fs', {}) // 只满足官方文件服务接线；本目标测试不调用文件读取或宿主打开。
    ctx.provide('fileReferences', { list: async () => [] }) // 原始SessionFileReferences公开服务依赖使用合成空数据。
    ctx.provide('workingDirectory', { defaultDirectory: temporary }) // 原始SessionSkillCatalog默认路径等于中性Runtime默认目录。
    ctx.provide('sessionQuery', {
      listSessions: async () => ctx.sessions.list().map((session) => ({ header: session.header, formatStatus: 'current' })), // 原始Session.list仅读取真实Store中的合成root Session，不恢复Agent。
    })
    const fileRoutes = new Map() // 原始SessionMediaReferences仅注册内存Fetch路由，无HTTP监听。
    ctx.provide('connection', {
      fetch: {
        register(route) {
          assert.equal(fileRoutes.has(route.path), false)
          fileRoutes.set(route.path, route)
          return () => fileRoutes.delete(route.path)
        },
      },
    })
    ctx.provide('webServer', {
      register(route) {
        assert.equal(routes.has(route.path), false, '路由重复:' + route.path)
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    })
    ctx.provide('messageFeedback', {
      list: async () => ({ ok: true, value: { items: [] } }),
    })
    ctx.provide('llm', {
      resolveModelInfo: async () => ({
        context: { contextWindow: 128000 },
        inputModalities: ['text'],
      }),
    })
    const registry = ctx.plugin(Registry)
    await registry.await()
    const sessions = ctx.plugin(SessionStore) // 真实官方SessionRoot存储生命周期由独立fiber拥有，Host退出不能替换它。
    await sessions.await()
    const projections = ctx.plugin(SessionProjectionRegistry) // 使用真实注册、折叠及监听清理，不能Fake控制器初始化算法。
    await projections.await()
    const rootSession = ctx.sessions.create('fixture-root-session', { meta: { cwd: temporary, createdAt: 1 } }) // Host外的真实Session，装配和卸载均必须保留同一实例。
    for (const name of [
      '@deepseek-ai/dsh-plugin-manager',
      '@deepseek-ai/dsh-api-settings-controller',
      '@deepseek-ai/dsh-api-workspace-controller',
      '@deepseek-ai/dsh-api-session-controller',
    ])
      ctx.typert.register((await load(name + '/typert')).TYPERT) // 实际严格Remote Schema覆盖继承服务。
    const access = ctx.plugin(RemoteAccess) // alpha.3 Gateway和完整Workspace/Session控制器的真实公开依赖。
    await access.await()
    const gateway = ctx.plugin(Gateway)
    await gateway.await()
    const settings = ctx.plugin(SettingsForms)
    await settings.await()
    const clientRegistry = ctx.plugin(ClientModuleRegistry) // 原始注册队列提供方先就绪，wrapper按公开依赖等待它，再注册parser-blocking源码脚本。
    await clientRegistry.await()
    process.chdir(temporary) // 官方SessionController读取真实进程cwd，装配期间仅使用本测试目录。
    await ctx.loader.root.update([{
      id: 'include', // 真实包含树保持PluginManager原生patch ID形状。
      name: 'cordis:include', // 官方公开Loader builtin，不伪造应用插件Entry。
      group: true, // 官方Include只负责装配，不贡献伪Client package。
      config: {
        path: pathToFileURL(join(temporary, 'fixture.runtime.json')).href, // 官方Include按URL解析；显式file URL兼容Windows盘符，不读取生产Profile。
        enableLogs: false, // 合成Fixture只保留明确失败输出。
        initial: [
        { id: 'adminsmart-ui', name: new URL('../src/index.mjs', import.meta.url).href }, // 真正主Host源码作为真实Loader行导入。
        { id: 'official-remotes', name: new URL('../official-remotes/index.mjs', import.meta.url).href }, // 已批准自有wrapper唯一Boot Graph身份。
        { id: 'workspace-controller', name: '@deepseek-ai/dsh-api-workspace-controller', disabled: true }, // 原Host保持禁用，不能借重启原类恢复Client图。
        { id: 'session-controller', name: '@deepseek-ai/dsh-api-session-controller', disabled: true }, // 原Session Host由已有受管继承贡献提供。
        { id: 'ui-workspace', name: '@deepseek-ai/dsh-client-ui-workspace' }, // 实际Graph保留原Workspace消费入口。
        { id: 'ui-model-selection', name: '@deepseek-ai/dsh-client-ui-model-selection' }, // 实际Graph保留原模型选择消费入口。
        ...Object.entries(modules).map(([id, name]) => ({ id, name })), // 三个已允许展示行继续真实加载原Host空apply。
        ],
      },
    }])
    await ctx.loader.await()
    const hostEntry = ctx.loader.resolve('include:adminsmart-ui') // 实际主Host的Entry，而非ctx.plugin临时贡献。
    const host = hostEntry.fiber // 后续装配、真实路由与退出都核对这同一实际fiber。
    try {
      assert.ok(host, '真实主Host没有创建fiber')
      await within(host.await(), 3000, '候选Host装配未结算')
      assert.equal(host.state, 2)
      assert.equal(hostEntry.fiber.state, 2)
      assert.equal(hostEntry.moduleNamespace, hostModule)
      assert.equal(ctx.loader.resolve('include:official-remotes').fiber.state, 2)
      assert.equal(ctx.loader.resolve('include:workspace-controller').disabled, true)
      assert.equal(ctx.loader.resolve('include:session-controller').disabled, true)
      await tick() // 真实扫描器处理Loader的incremental dirty name，再读取当前启动清单。
      assert.equal(clientRegistry.state, 2)
      const graph = ctx.clientModules.graph() // 不能手工构造原包Boot Graph行掩盖缺失。
      assert.equal(graph.entries.filter(row => row.id === '@adminsmart/dsh-official-remotes').length, 1)
      assert.equal(graph.entries.some(row => row.id === '@deepseek-ai/dsh-api-workspace-controller'), false)
      assert.equal(graph.entries.some(row => row.id === '@deepseek-ai/dsh-api-session-controller'), false)
      await tick()
      assert.ok(ctx.get('pluginManager') instanceof PluginManager)
      assert.ok(
        remoteMethods(ctx.pluginManager).some(
          (method) => method.method === 'setPluginEnabled',
        ),
      )
      assert.equal(
        remoteMethods(ctx.pluginManager).some(
          (method) => method.method === 'applyPlugins',
        ),
        false,
      )
      assert.ok(ctx.get('settingsController'))
      assert.ok(ctx.get('workspaceController') instanceof WorkspaceController)
      assert.ok(ctx.get('sessionController') instanceof SessionController)
      const sessionPrototype = Object.getPrototypeOf(ctx.get('sessionController')) // Cordis服务访问带scope代理，原型函数身份直接证明模型方法仍继承官方super。
      assert.equal(sessionPrototype.selectModel, SessionController.prototype.selectModel)
      assert.equal(sessionPrototype.modelCatalog, SessionController.prototype.modelCatalog)
      assert.equal(sessionPrototype.initializeDefaultModel, SessionController.prototype.initializeDefaultModel)
      assert.equal(Object.hasOwn(sessionPrototype, 'selectModel'), false)
      assert.equal(Object.hasOwn(sessionPrototype, 'modelCatalog'), false)
      assert.ok(ctx.get('directoryPickerController') instanceof DirectoryPickerController)
      assert.ok(ctx.get('sessionFileReferences') instanceof SessionFileReferences)
      assert.ok(ctx.get('sessionSkillCatalog') instanceof SessionSkillCatalog)
      const requiredWorkspace = [...workspaces.values()][0] // 当前官方受管冷启恢复的必需目录登记。
      assert.equal(workspaces.size, 1)
      assert.equal(resolve(requiredWorkspace.path), resolve(temporary))
      assert.equal(workspaceOperations.every((item) => item.kind !== 'create' || resolve(item.path) === resolve(temporary)), true)
      const initialized = await invoke({ namespace: 'workspace', method: 'initializeDefault', args: {} }) // 经真实Remote marker与严格TYPERT执行继承方法。
      assert.equal(initialized.workspace.workspaceId, requiredWorkspace.id)
      assert.equal(workspaces.size, 1)
      assert.equal(await invoke({ namespace: 'directoryPicker', method: 'pick', args: {} }), null)
      assert.equal(requiredWorkspace.sessionIds.includes('fixture-cold-session'), true)
      assert.equal(requiredWorkspace.sessionIds.includes(rootSession.id), true)
      assert.equal(requiredWorkspace.sessionIds.includes('fixture-other-session'), false)
      const listed = await invoke({ namespace: 'session', method: 'list', args: { _request: {} } }) // 真实SessionRoot投影完整通过原始Remote Schema。
      assert.equal(listed.items.length, 1)
      assert.equal(listed.items[0].sessionId, rootSession.id)
      assert.equal(listed.items[0].agentAvailable, false)
      assert.equal(listed.items[0].blank, true)
      await assert.rejects(invoke({ namespace: 'workspace', method: 'delete', args: { request: { workspaceId: requiredWorkspace.id } } }), (error) => error.code === 'gateway/bad-request')
      await assert.rejects(invoke({ namespace: 'session', method: 'create', args: { request: { cwd: previousCwd } } }), (error) => error.code === 'gateway/bad-request')
      await assert.rejects(invoke({ namespace: 'workspace', method: 'create', args: { request: { path: previousCwd } } }), (error) => error.code === 'gateway/bad-request')
      assert.equal(agentResolvers.size, 1)
      assert.ok(fileRoutes.has('/api/file'))
      assert.equal(ctx.get('sessions') instanceof SessionStore, true)
      assert.equal(ctx.sessions.get(rootSession.id), rootSession)
      assert.deepEqual(ctx.agentDefaultModel.currentSelection(), rootSelection)
      assert.equal(selectionWrites, 0)
      assert.ok(routes.has('/adminsmart/native-policy'))
      assert.ok(routes.has('/adminsmart/native-policy-client.mjs'))
      assert.ok(routes.has('/adminsmart/native-policy/events'))
      assert.ok(routes.has('/adminsmart/ui-policy-client.mjs'))
      assert.ok(routes.has('/adminsmart/assets/aurasearch-logo.webp'))
      if (!isAdmin) {
        await assert.rejects(
          invoke({
            namespace: 'pluginManager',
            method: 'listPlugins',
            args: {},
          }),
          (error) => error.code === 'gateway/bad-request',
        )
        assert.equal(ctx.get('credentialsController'), undefined)
        assert.ok(
          network.some((item) => item.path.endsWith('/harness-profile')),
        )
      } else {
        assert.ok(ctx.get('credentialsController'))
        assert.equal(
          network.some((item) => item.path.endsWith('/harness-profile')),
          false,
        )
        const rows = await invoke({
          namespace: 'pluginManager',
          method: 'listPlugins',
          args: {},
        })
        assert.equal(rows.filter((row) => row.patchId).length, 3)
        const result = await within(
          invoke({
            namespace: 'pluginManager',
            method: 'setPluginEnabled',
            args: { id: 'include:ui-skill', enabled: false },
          }),
          2000,
          '真实Native commit/adopt队列互等',
        ) // 实际整合链，不单独Fakecommit callback。
        assert.equal(result.application, 'restart-required')
        assert.equal(native.settings.plugins['ui-skill'], false)
        assert.ok(native.revision > 1)
      }
      const table = [] // 实际Index Injection只包含角色、代码哈希和受管基线，没有凭据。
      ctx.emit('webserver/index-inject', table)
      assert.equal(table.find(row => row.name === '__DSH_BOOT__').value, graph)
      for (const [path, globalName] of [
        ['/adminsmart/ui-policy-client.mjs', '__ADMINSMART_UI_POLICY_CLIENT_REVISION__'],
        ['/adminsmart/native-policy-client.mjs', '__ADMINSMART_NATIVE_POLICY_CLIENT_REVISION__'],
      ]) {
        const revision = table.find(row => row.name === globalName)?.value // 必须使用当前真实Host注入的代码SHA，不自行猜文件修订。
        assert.match(revision, /^[a-f0-9]{64}$/u)
        let status // 合成Node响应只记录路由实际状态，不监听HTTP或使用真实浏览器。
        let body // 路由返回的纯模块字节，用于核验和当前注入SHA一致。
        await routes.get(path).handler({ method: 'GET', url: path + '?rev=' + revision, headers: {} }, {
          writeHead(value) { status = value },
          end(value) { body = value },
        })
        assert.equal(status, 200, '真实主Host pure module路由不可用:' + path)
        assert.equal(createHash('sha256').update(body).digest('hex'), revision)
      }
      const html = renderIndexInjections('<html><head><script type="module" src="/shell.js"></script></head><body></body></html>', table) // 官方renderer负责parser-blocking经典script顺序。
      for (const [path, globalName, module] of [
        ['/adminsmart/ui-policy-client.mjs', '__ADMINSMART_UI_POLICY_CLIENT_REVISION__', true],
        ['/adminsmart/native-policy-client.mjs', '__ADMINSMART_NATIVE_POLICY_CLIENT_REVISION__', true],
        ['/adminsmart/shared-shortcuts-client.mjs', '__ADMINSMART_SHARED_SHORTCUTS_CLIENT_REVISION__', true],
      ]) {
        const revision = table.find(row => row.name === globalName)?.value // 原始可信代码SHA，不采用用户/角色/会话或策略修订生成URL。
        assert.match(revision, /^[a-f0-9]{64}$/u)
        const url = '.' + path + '?rev=' + revision // 与运行中的script/import消费路径完全一致，不能改fetch目标形成二次下载。
        const hints = table.filter(row => module ? row.kind === 'html' && row.html === '<link rel="modulepreload" crossorigin href="' + url + '">' : row.kind === 'script-preload' && row.src === url) // ESM与经典script使用各自标准预载模式。
        assert.equal(hints.length, 1, '每份桥代码只提示一次:' + path)
        assert.ok(html.indexOf(url) < html.indexOf('<script src='), '提示须先于官方阻塞script:' + path)
        assert.equal(table.some(row => row.kind === 'script-src' && row.src === url), false, '预载不能提前执行共享桥:' + path)
      }
      assert.equal(table.filter(row => row.kind === 'script-preload' && row.src.startsWith('plugins/')).length, graph.batches.filter(batch => batch.phase === 'application').length) // 官方合并包已自带预载，不再额外逐成员请求或复制Graph。
      for (const row of table.filter(row => row.kind === 'script-src' && row.src.includes('/official-remotes/'))) {
        assert.equal(row.placement, 'head')
        assert.ok(html.indexOf(row.src.replaceAll('&', '&amp;')) < html.indexOf('/shell.js'))
      }
      await verifyOfficialRemoteClientBoot({ graph, table, routes, fetchBundle: request => ctx.clientModules.fetchBundle(request), isAdmin }) // 真正ModuleSystem+Cordis Client验证原服务与原consumer生命周期。
      assert.equal(
        table.find((row) => row.name === '__ADMINSMART_RUNTIME_ROLE__').value,
        isAdmin ? 'admin' : 'managed-user',
      )
      assert.doesNotMatch(
        JSON.stringify(table),
        /fixture-capability|fixture-key/u,
      )
      await clientRegistry.dispose()
      await ctx.loader.resolve('include:official-remotes').fiber.dispose()
      await host.dispose()
      await tick()
      assert.equal(routes.size, 0)
      assert.equal(ctx.get('pluginManager'), undefined)
      assert.equal(ctx.get('settingsController'), undefined)
      assert.equal(ctx.get('workspaceController'), undefined)
      assert.equal(ctx.get('sessionController'), undefined)
      assert.equal(ctx.get('directoryPickerController'), undefined)
      assert.equal(ctx.get('sessionFileReferences'), undefined)
      assert.equal(ctx.get('sessionSkillCatalog'), undefined)
      assert.equal(agentResolvers.size, 0)
      assert.equal(fileRoutes.size, 0)
      assert.equal(ctx.get('sessions') instanceof SessionStore, true)
      assert.equal(ctx.sessions.get(rootSession.id), rootSession)
      assert.deepEqual(ctx.agentDefaultModel.currentSelection(), rootSelection)
      assert.equal(selectionWrites, 0)
      assert.equal(streams.size, 0)
    } finally {
      await clientRegistry?.dispose()
      await host?.dispose()
      await settings.dispose()
      await gateway.dispose()
      await projections.dispose()
      await sessions.dispose()
      await registry.dispose()
      await loader.dispose()
      await ctx.fiber.dispose()
      globalThis.fetch = previousFetch
      process.chdir(previousCwd)
      for (const [key, value] of oldEnv) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
      await rm(temporary, { recursive: true, force: true })
    }
  })
