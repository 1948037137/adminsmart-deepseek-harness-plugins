/** 真实官方Cordis/StorageDomain/Workspace/Session Controllers；仅介质、AgentFactory和外围依赖为离线Fake。 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 测试调用方指定固定发行版，不读取用户Home或真实凭据。

/**
 * 用真实Loader条目、Cordis与官方Controller复现依赖pending及安装清理，只将数据介质与执行能力替换为离线Fake。
 * @param {object} scenario 受测装配时序。
 * @param {boolean} scenario.delayed 依赖晚于Host.apply提供时仍应正常启动。
 * @param {boolean} [scenario.slowHistory] 历史响应晚于启动超时时不能继续写入。
 * @returns {Promise<void>} 核验真实fiber生命周期与公开服务贡献后清理独占临时目录。
 */
async function verifyLoaderLifecycle({ delayed, slowHistory = false }) {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 与生产相同的固定官方发行包入口。
  const official = name => import(pathToFileURL(require.resolve(name)).href) // 仅从已锁定安装读取公开模块。
  const { Context } = await official('@deepseek-ai/cordis')
  const { default: Loader } = await official('@deepseek-ai/cordis-plugin-loader')
  const { default: Registry } = await official('@deepseek-ai/dsh-typert-registry')
  const { default: RemoteAccess } = await official('@deepseek-ai/dsh-api-remote-access') // Workspace和Session控制器采用同一原生访问策略服务，不以全允许Fake补依赖。
  const { default: Sessions } = await official('@deepseek-ai/dsh-session')
  const { default: Projections } = await official('@deepseek-ai/dsh-session-projection')
  const { realpathNormalize } = await official('@deepseek-ai/dsh-workspace')
  const { installManagedWorkspace } = await import('../src/managed-workspace.mjs')
  const temporary = await mkdtemp(join(tmpdir(), 'adminsmart-managed-loader-')) // 只含本用例的合成目录，最终按绝对边界清理。
  const previousCwd = process.cwd() // 保留测试进程原工作目录，不触碰运行Gateway。
  const previousFetch = globalThis.fetch // 隔离测试禁止意外网络并在finally恢复。
  const ctx = new Context() // 真正框架上下文，不仿造fiber.await或服务依赖调度。
  let managed // 仅成功安装时返回的生命周期句柄。
  let installation // 真正installer调用结果，用于确认pending时不提前完成。
  let settled = false // 无依赖阶段的安装完成证据。
  let creates = 0 // 公共Registry创建次数，不读取或修改官方内部表。
  let attaches = 0 // 超时后迟到历史不得继续关联Session。
  let historyCalls = 0 // pending时不得提前访问持久历史。
  let signalEntered // Host.apply已实际启动的明确信号。
  const entered = new Promise(resolve => { signalEntered = resolve }) // 不靠固定睡眠推测Host已加载。
  let finishHistory // 慢历史Fixture的完成开关，不访问真实Session正文。
  const history = new Promise(resolve => { finishHistory = resolve }) // 模拟晚于超时的公开持久化响应。
  const tick = () => new Promise(resolve => setImmediate(resolve)) // 仅让真正Cordis调度推进，不读内部inertia字段。
  try {
    process.chdir(temporary)
    globalThis.fetch = async () => { throw new Error('offline loader test forbids network') }
    const canonical = await realpathNormalize(temporary) // 与原生Workspace比较同一真实合成目录。
    const records = new Map() // 公开WorkspaceRegistry接口的离线介质，业务逻辑仍实际Controller执行。
    const workspaceRegistry = {
      archivedSessionIds: [], // 原生WorkspaceFeed读取的合成归档集。
      pinnedSessionIds: [], // 原生WorkspaceFeed读取的合成置顶集。
      list: () => [...records.values()], // 原生控制器和repair共享合成公开缓存。
      get: id => records.get(id), // 不提供其它服务器目录或用户数据。
      async create(path, title) {
        creates += 1
        const record = { id: 'fixture-required', path, title: title ?? 'Fixture', sessionIds: [], async attachSession(id) { attaches += 1; this.sessionIds.push(id) } } // 合成登记只保存本测试目录，写证据用于失败清理断言。
        records.set(record.id, record)
        return record
      },
    }
    ctx.provide('sessionPersistence', {
      async list() { historyCalls += 1; return slowHistory ? history : [] }, // 仅公开snapshot协议，没有网络或真实历史。
      async open() { throw new Error('不得读取合成历史正文') },
      async stat() { throw new Error('不得读取合成历史正文') },
    })
    await ctx.plugin(Sessions).await()
    await ctx.plugin(Projections).await()
    await ctx.plugin(Registry).await()
    await ctx.plugin(RemoteAccess).await()
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture', model: 'fixture' }), saveSelection: async () => { throw new Error('装配不得写模型选择') } }) // 只读合成默认，不运行模型。
    ctx.provide('agents', { get: () => undefined, list: () => [] }) // 未提供Factory，任何错误创建Agent都不能调用真实模型。
    ctx.provide('attachments', { imageLimits: { maxImageBytes: 1, maxImagesPerMessage: 1, maxMessageImageBytes: 1 } }) // 仅满足原Ctor公开图片能力依赖。
    ctx.provide('fileUploads', { registerAgentResolver: () => () => {} }) // 原Ctor正常注册/释放，不打开真实附件。
    ctx.provide('fs', {}) // 没有任何文件操作或网络能力。
    ctx.provide('llm', {}) // 没有任何模型执行能力。
    ctx.provide('fileReferences', {}) // 原子服务依赖仅供装配，测试不访问内容。
    ctx.provide('workingDirectory', { cwd: canonical }) // 当前合成目录的原生SkillCatalog公开依赖。
    ctx.provide('sessionQuery', { listSessions: async () => [] }) // 不读取其它用户或持久正文。
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(join(runtimeRoot, 'package.json')).href }).await() // Loader必须由真实独立fiber拥有，直接new到root会令官方Context原型回接成环。
    const loader = ctx.loader // 使用真正公开Loader，包含entry归属与继承inject，而不是Fake entries。
    loader.builtins['fixture-managed'] = {
      name: 'fixture-managed-host', // 原Host先进入apply再等待子控制器，精确重现此前pending缺口。
      async apply(child) {
        installation = installManagedWorkspace(child, { runtimeCwd: temporary, startupTimeoutMs: delayed ? 2000 : 100 })
        installation.then(() => { settled = true }, () => { settled = true }) // 只记录结算，不吞掉Host原生启动拒绝。
        signalEntered()
        managed = await installation
      },
    }
    await loader.root.update([{ id: 'fixture-host', name: 'cordis:fixture-managed' }]) // 真正Entry.init/ModuleLoader装配同一候选模块。
    await entered
    await tick(); await tick()
    assert.equal(settled, false, 'PENDING不能被fiber.await立即返回误认为成功')
    assert.equal(creates, 0)
    assert.equal(historyCalls, 0)
    assert.equal(ctx.get('workspaceController'), undefined)
    const host = loader.resolve('fixture-host').fiber // 公开Loader entry拥有的真实Host fiber。
    if (delayed || slowHistory) ctx.provide('workspaceRegistry', workspaceRegistry) // 缺失的真实服务依赖随后公开提供，Cordis实际执行apply。
    if (delayed) {
      await installation
      await host.await()
      assert.equal(host.state, 2)
      assert.ok(ctx.get('workspaceController'))
      assert.ok(ctx.get('sessionController'))
      assert.equal(creates, 1)
      assert.equal(historyCalls, 1)
      await managed.dispose()
    } else {
      await assert.rejects(installation, /未在限时内就绪/u)
      await assert.rejects(host.await(), /未在限时内就绪/u)
      assert.equal(host.state, 3)
      if (!slowHistory) ctx.provide('workspaceRegistry', workspaceRegistry) // 已失败后迟到依赖不能复活已卸载子fiber。
      finishHistory([{ header: { id: 'fixture-late-history', cwd: canonical }, revision: 'fixture' }]) // 超时前已开始的公开读取迟到完成，不得关联Session。
      await tick(); await tick()
      ctx.emit('session/created', { header: { id: 'fixture-late-created', cwd: canonical } }) // 原生事件只能触发仍活跃的贡献，卸载后不得恢复。
      await tick(); await tick()
      assert.equal(creates, slowHistory ? 1 : 0)
      assert.equal(attaches, 0)
    }
    assert.equal(ctx.get('workspaceController'), undefined)
    assert.equal(ctx.get('sessionController'), undefined)
    await loader.await()
  } finally {
    await managed?.dispose()
    await ctx.fiber.dispose()
    process.chdir(previousCwd)
    globalThis.fetch = previousFetch
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) // 清理目标必须属于本次实际mkdtemp。
    await rm(temporary, { recursive: true, force: true })
  }
}

test('真实Loader依赖迟到：显式apply就绪后才初始化并成功贡献Controller', { skip: !runtimeRoot, timeout: 5000 }, () => verifyLoaderLifecycle({ delayed: true }))
test('真实Loader永久缺依赖：有界失败卸载，迟到依赖不能产生服务或写入', { skip: !runtimeRoot, timeout: 5000 }, () => verifyLoaderLifecycle({ delayed: false }))
test('真实Loader历史读取超时：释放Controller且迟到响应不再关联Session', { skip: !runtimeRoot, timeout: 5000 }, () => verifyLoaderLifecycle({ delayed: false, slowHistory: true }))

test('必需Workspace原生删除拒绝/目录准入/真实Session默认/有限事件恢复与卸载', { skip: !runtimeRoot, timeout: 15000 }, async () => {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 同一官方安装的公开入口。
  const official = name => import(pathToFileURL(require.resolve(name)).href) // 不导入参考仓库或私有模块。
  const { Context } = await official('@deepseek-ai/cordis')
  const { default: Storage } = await official('@deepseek-ai/dsh-storage')
  const { DomainFacility } = await official('@deepseek-ai/dsh-storage-domain')
  const { default: Workspaces, realpathNormalize } = await official('@deepseek-ai/dsh-workspace')
  const { default: Sessions, SESSION_FORMAT_VERSION } = await official('@deepseek-ai/dsh-session')
  const { default: Projections } = await official('@deepseek-ai/dsh-session-projection')
  const { default: Agents } = await official('@deepseek-ai/dsh-agent')
  const { default: Registry } = await official('@deepseek-ai/dsh-typert-registry')
  const { default: Gateway } = await official('@deepseek-ai/dsh-api-gateway')
  const { default: RemoteAccess } = await official('@deepseek-ai/dsh-api-remote-access') // 与实际Gateway相同的官方身份访问服务。
  const { Peer } = await official('@deepseek-ai/dsh-client-connection') // 进程内Remote调用也必须使用明确的公开Peer身份。
  const { remoteMethods } = await official('@deepseek-ai/dsh-typert-protocol')
  const { installManagedWorkspace } = await import('../src/managed-workspace.mjs')
  const temporary = await mkdtemp(join(tmpdir(), 'adminsmart-managed-workspace-')) // 本测试独占目录，只包含合成canary。
  const cwd = join(temporary, 'runtime-cwd') // 当前用户Runtime必须业务目录Fixture。
  const foreign = join(temporary, 'other-cwd') // 同样由测试创建的其它目录，用于准入拒绝，不涉及真实用户数据。
  await mkdir(cwd); await mkdir(foreign)
  await writeFile(join(cwd, 'canary.txt'), 'synthetic-retain', 'utf8') // 所有删除流程都必须保留合成原件。
  const previousCwd = process.cwd() // Node测试进程的原始目录，finally完整恢复。
  const previousFetch = globalThis.fetch // 任何意外网络必须失败，结束后恢复进程入口。
  process.chdir(cwd)
  globalThis.fetch = async () => { throw new Error('offline test forbids network') }
  const ctx = new Context() // 没有真实运行用户、数据库、模型或网关进程。
  const peer = new Peer(ctx, { principal: { kind: 'owner' } }) // 当前隔离HostOwner仍须经过受管Workspace业务目录和删除保护。
  let managed // 唯一被测受管模块的生命周期句柄。
  let listCalls = 0 // 正常新会话不得反复全量扫描历史。
  let agentCreates = 0 // 非当前cwd/foreignworkspace必须在原生Agent创建前拒绝。
  let defaultWrites = 0 // 当前目录修复不能改变用户模型或全局默认。
  try {
    const canonical = await realpathNormalize(cwd) // 与官方登记完全相同的canonical语义。
    const foreignCanonical = await realpathNormalize(foreign) // 仅测试自建目录，不查询其它服务器路径。
    const headers = [
      { version: SESSION_FORMAT_VERSION, id: 'fixture-cold-match', createdAt: 1, isSeeded: false, cwd: canonical }, // 可以重新关联的真实公开header形状。
      { version: SESSION_FORMAT_VERSION, id: 'fixture-cold-other', createdAt: 2, isSeeded: false, cwd: foreignCanonical }, // 不属于业务目录的历史记录必须原样保留。
    ]
    const media = new Map() // 只实现公开StorageBackend介质协议，不仿造Workspace或Session逻辑。
    await ctx.plugin(Storage)
    ctx.storage.backend.register('fixture-memory', {
      kv: {
        async open(descriptor) {
          let medium = media.get(descriptor.name) // 当前公开数据域的合成持久介质。
          if (!medium) { medium = { tables: new Map(), global: null }; media.set(descriptor.name, medium) }
          return {
            async loadAll() { return { tables: Object.fromEntries(descriptor.tables.map(name => [name, Object.fromEntries(medium.tables.get(name) ?? [])])), global: medium.global } }, // 公开KvUnit加载合同，实际Domain执行校验和change事件。
            async putRecord(table, key, value) { if (!medium.tables.has(table)) medium.tables.set(table, new Map()); medium.tables.get(table).set(key, structuredClone(value)) }, // 仅内存合成记录。
            async deleteRecord(table, key) { medium.tables.get(table)?.delete(key) }, // 只删除注册记录，不触碰真实文件或会话。
            async setGlobal(value) { medium.global = structuredClone(value) }, // 公开全局域slot，完全由实际Domain负责语义。
            async close() {}, // 内存介质没有资源，Domain仍实际调用关闭。
          }
        },
      },
    })
    const facility = new DomainFacility(ctx, { backend: 'fixture-memory', routes: {} }) // 真正官方DomainFacility。
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    ctx.provide('sessionPersistence', {
      async list() { listCalls += 1; return headers.map(header => ({ header, revision: `fixture-${header.id}` })) }, // alpha.2真实snapshot.header协议。
      async open() { throw new Error('本测试不得读取会话正文') },
      async stat() { throw new Error('本测试不读取单会话正文') },
    })
    await ctx.plugin(Sessions)
    await ctx.plugin(Projections)
    await ctx.plugin(Agents)
    ctx.agents.setFactory({
      async createAgent(owner, options) {
        agentCreates += 1
        const session = ctx.sessions.create(options.sessionId, { meta: options.meta }) // 真正官方SessionStore创建，受管模块不会自行写header或日志。
        const agent = { id: session.id, session, status: 'idle', ctx: owner, options: options.agentOptions } // Agent执行完全Fake，不能运行模型或工具。
        await ctx.agents.register(agent)
        await options.setup?.(owner, agent)
        return { agent, dispose: async () => {} } // 不建立背景进程或真实引擎。
      },
      async resume() { throw new Error('本测试不运行模型或恢复会话正文') },
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }), async saveSelection() { defaultWrites += 1 } }) // 原模型选择保留，不来自真实配置。
    ctx.provide('attachments', { imageLimits: { maxImageBytes: 1024, maxImagesPerMessage: 4, maxMessageImageBytes: 4096 } }) // 只提供Ctor需要的合成公开能力。
    ctx.provide('fileUploads', { registerAgentResolver: () => () => {} }) // 真正SessionController构造可注册，测试不上传或读取文件。
    ctx.provide('fs', {}) // 不提供任何服务器文件读写能力。
    ctx.provide('llm', {}) // 不提供模型stream，保证模型无法被调用。
    ctx.provide('fileReferences', {}) // 原完整Controller子服务资格，测试不请求文件内容。
    ctx.provide('workingDirectory', { cwd: canonical }) // SessionSkillCatalog公开依赖，目录仅合成。
    ctx.provide('sessionQuery', { async listSessions() { return [] }, async observeSession() { throw new Error('本测试不观察会话正文') } }) // create不带已有ID，不能触发冷resume。
    await ctx.plugin(Registry)
    for (const name of ['@deepseek-ai/dsh-api-workspace-controller/typert', '@deepseek-ai/dsh-api-session-controller/typert']) {
      const { TYPERT } = await official(name) // 两官方完整Schema，不能缩减原RPC字段或以Fake方法签名绕验证。
      ctx.typert.register(TYPERT)
    }
    await ctx.plugin(RemoteAccess).await()
    await ctx.plugin(Gateway).await()
    await ctx.plugin(Workspaces)
    const prior = await ctx.workspaceRegistry.resolveByPath(canonical) // 官方历史bootstrap会登记匹配目录。
    await ctx.workspaceRegistry.delete(prior.id) // 模拟用户此前删除，只动合成介质。
    managed = await installManagedWorkspace(ctx, { runtimeCwd: cwd }) // 必须await原完整service依赖和第一轮恢复。
    let base = await ctx.workspaceRegistry.resolveByPath(canonical) // 直接读取实际官方登记结果。
    assert.ok(base.sessionIds.includes('fixture-cold-match'))
    assert.ok(!base.sessionIds.includes('fixture-cold-other'))
    assert.ok(remoteMethods(ctx.workspaceController).some(row => row.method === 'delete'))
    assert.ok(remoteMethods(ctx.sessionController).some(row => row.method === 'selectModel')) // 模型选择等完整原Remote没有退役。
    const invoke = (namespace, method, request) => ctx.typertGateway.invoke({ namespace, method, args: { request }, peer }) // 原Gateway以显式Owner和严格Schema执行，不能跳过业务保护。
    await assert.rejects(invoke('workspace', 'delete', { workspaceId: base.id }), error => error.code === 'gateway/bad-request')
    await assert.rejects(invoke('workspace', 'create', { path: foreign }), error => error.code === 'gateway/bad-request')
    const other = await ctx.workspaceRegistry.resolveByPath(foreignCanonical) // 不改其他已有Workspace元数据。
    const writesBefore = agentCreates // 两类非法Session请求不应进入原生创建流程。
    await assert.rejects(invoke('session', 'create', { cwd: join(temporary, 'nonexistent-private') }), error => error.code === 'gateway/bad-request')
    await assert.rejects(invoke('session', 'create', { workspaceId: other.id }), error => error.code === 'gateway/bad-request')
    assert.equal(agentCreates, writesBefore)
    const callsBefore = listCalls // 正常无cwd创建和session/created事件不能全扫历史。
    const created = await invoke('session', 'create', {}) // 原SessionCommands选择当前进程默认，仍由真实SessionStore/AgentRegistry执行。
    await managed.drain()
    assert.equal(ctx.sessions.get(created.sessionId).header.cwd, cwd)
    assert.equal(listCalls, callsBefore)
    assert.ok(base.sessionIds.includes(created.sessionId))
    assert.equal(defaultWrites, 0)
    await invoke('workspace', 'rename', { workspaceId: base.id, title: '用户原生标题' }) // 普通重命名仍走原生实现。
    await invoke('workspace', 'archiveSession', { sessionId: created.sessionId }) // 会话归档仍原生，不能与必需Workspace删除保护混淆。
    assert.ok(ctx.workspaceRegistry.archivedSessionIds.includes(created.sessionId))
    const oldId = base.id // 模拟非UI内部metadata删除，恢复必须采用新官方登记而不修改Session header。
    const headerBefore = ctx.sessions.get(created.sessionId).header
    await ctx.workspaceRegistry.delete(oldId)
    await managed.drain()
    base = await ctx.workspaceRegistry.resolveByPath(canonical)
    assert.ok(base && base.id !== oldId)
    assert.equal(base.title, '用户原生标题')
    assert.ok(base.sessionIds.includes('fixture-cold-match'))
    assert.ok(base.sessionIds.includes(created.sessionId))
    assert.equal(ctx.sessions.get(created.sessionId).header, headerBefore)
    assert.equal(await readFile(join(cwd, 'canary.txt'), 'utf8'), 'synthetic-retain')
    assert.equal(headers.length, 2)
    await managed.dispose()
    await ctx.workspaceRegistry.delete(base.id)
    await managed.drain()
    assert.equal(await ctx.workspaceRegistry.resolveByPath(canonical), undefined, '卸载后事件不得重新生成登记')
  } finally {
    await managed?.dispose()
    await ctx.fiber.dispose()
    process.chdir(previousCwd)
    globalThis.fetch = previousFetch
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) // 递归清理仅限本测试实际mkdtemp目标。
    await rm(temporary, { recursive: true, force: true })
  }
})
