/** 受管问答必须目录的官方Workspace/Session入口保护及注册恢复，不接管UI或用户身份隔离。 */
import { createRequire } from 'node:module'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const runtimeRoot = String(process.env.ADMINSMART_DSH_ROOT ?? '').trim() // Gateway选择并锁定的官方安装，不能从RPC输入选择模块路径。
if (!runtimeRoot) throw new Error('受管Workspace官方运行依赖未配置')
const officialRequire = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 所有继承类与协议来自同一官方发行版。
const { WorkspaceController } = await import(pathToFileURL(officialRequire.resolve('@deepseek-ai/dsh-api-workspace-controller')).href)
const { SessionController } = await import(pathToFileURL(officialRequire.resolve('@deepseek-ai/dsh-api-session-controller')).href)
const { RemoteError } = await import(pathToFileURL(officialRequire.resolve('@deepseek-ai/dsh-typert-protocol')).href)
const { realpathNormalize } = await import(pathToFileURL(officialRequire.resolve('@deepseek-ai/dsh-workspace')).href)

/**
 * 将一个绝对路径转换为仅用于前置拒绝的本机比较键，不能据此跳过官方canonical校验。
 * @param {string} path 可信Runtime路径或RPC候选，候选必须先确认绝对。
 * @returns {string} Windows忽略大小写，其它系统保持大小写，不访问文件系统。
 */
function lexicalKey(path) {
  const normalized = resolve(path) // 相对片段只用于规范路径拼写，不决定目录授权。
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * 安装官方继承控制器，只保护当前受管业务必需目录；Workspace仍不是用户、租户或知识隔离键。
 * @param {import('@deepseek-ai/cordis').Context} ctx 当前Gateway.User/Home已隔离的官方Host Context。
 * @param {object} options 可信宿主装配参数，不能来自浏览器正文。
 * @param {string} options.runtimeCwd 当前Runtime进程真实业务工作目录，已经由Gateway创建。
 * @param {object} [options.workspaceConfig] 原官方WorkspaceController配置，未声明使用官方默认。
 * @param {object} [options.sessionConfig] 原官方SessionController配置，所有模型、发送和生命周期继续由super负责。
 * @param {number} [options.startupTimeoutMs] 宿主依赖与首轮恢复的有限等待毫秒数，超时卸载整个贡献；仅用于可信装配及隔离测试。
 * @returns {Promise<object>} 已完成启动恢复的fiber，以及repair/drain/dispose；删除与新Session事件自动恢复合法登记。
 * @throws {Error} 官方依赖、可信目录、初始化或真实持久元数据不可用；不把失败当作空历史。
 * @sideEffects 仅经官方registry.create/Workspace.attachSession恢复登记，保原标题与会话日志；不删目录、迁移Session或读凭据。
 */
export async function installManagedWorkspace(ctx, { runtimeCwd, workspaceConfig = {}, sessionConfig = {}, startupTimeoutMs = 5000 } = {}) {
  if (typeof runtimeCwd !== 'string' || !isAbsolute(runtimeCwd)) throw new Error('受管业务工作目录必须明确')
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1) throw new Error('受管工作区启动等待必须为有限正整数')
  const canonical = await realpathNormalize(runtimeCwd) // 唯一可信实际目录，符号链接、大小写和分隔符语义由官方处理。
  if (await realpathNormalize(process.cwd()) !== canonical) throw new Error('受管Runtime进程工作目录不匹配') // Session官方无cwd请求的默认不能指到其他服务器目录。
  const acceptedKeys = new Set([lexicalKey(runtimeCwd), lexicalKey(canonical)]) // 先按可信拼写拒绝任意其它目录，避免为外部RPC探测其realpath。
  let disposed = false // Host卸载后不启动新的恢复或元数据写入。
  let tail = Promise.resolve() // 启动、Session与删除恢复串行，官方注册幂等且不会重建重复Workspace。
  let protectedId // 最近官方必需目录的注册ID，仅用于删除事件识别，不决定用户或目录权限。
  let retainedTitle // 当前登记的真实用户标题，只为同次Runtime删除恢复保留，不生成业务覆盖名称。
  let owner // 子fiber拥有的官方Context，全部事件随其生命周期释放。
  let resolveReady // 仅apply实际完成全部控制器构造后确认服务贡献已注册，PENDING的fiber.await不能代替它。
  let rejectReady // apply失败或生命周期释放时让安装方收到稳定拒绝，不将失败误认作空工作区。
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject }) // 显式公开apply完成屏障，不读取Cordis内部状态或私有字段。
  const badLocation = () => new RemoteError('gateway/bad-request', '当前问答只能使用受管业务工作目录', {}) // 沿用原生错误信封，不回显服务器路径或用户输入。
  /** @param {string} path RPC提供的候选目录。 @returns {Promise<void>} 合法即完成。 @throws {RemoteError} 非当前目录或无法canonical匹配。 */
  const admitPath = async path => {
    if (typeof path !== 'string' || !isAbsolute(path) || !acceptedKeys.has(lexicalKey(path))) throw badLocation()
    if (await realpathNormalize(path).catch(() => undefined) !== canonical) throw badLocation() // 只有已通过可信拼写的当前目录才可执行官方realpath读取。
  }
  /**
   * 恢复必需登记并关联真正header.cwd匹配的当前用户会话，不读取会话正文。
   * @param {object} options 恢复来源，不从RPC传入。
   * @param {boolean} options.full 启动时明确修复全部合法历史；已存在登记的新会话不得重扫。
   * @param {object|undefined} options.sessionHeader 官方session/created提供的当前真实header。
   * @returns {Promise<import('@deepseek-ai/dsh-workspace').Workspace|undefined>} 官方登记对象，卸载后不继续写入。
   */
  const restore = async ({ full, sessionHeader }) => {
    if (disposed) return undefined
    const registry = owner.workspaceRegistry // 当前用户Home中的官方数据域，不自行读写其内部表。
    const existing = registry.list().find(workspace => workspace.path === canonical) // 正常新会话只查当前公开缓存，不全量读持久化历史。
    const workspace = existing ?? await registry.create(canonical, retainedTitle) // 既有登记保原标题，已移除时只重建同目录注册。
    if (disposed) return undefined // 在官方异步创建返回前卸载时，不再继续关联或发起新持久化操作。
    protectedId = String(workspace.id)
    retainedTitle = workspace.title
    const byId = new Map() // 真正持久快照header与live header合并，live为同一ID最新可见元数据。
    if (full || existing === undefined) {
      const snapshots = await owner.sessionPersistence.list() // 仅启动/登记缺失才全量读取{header,revision}，失败不能假设空历史。
      if (disposed) return undefined // 初始化超时后迟到的历史响应不能继续写入登记。
      for (const snapshot of snapshots) {
        const header = snapshot?.header // 只读公开header，不打开log、附件或真实文件内容。
        if (header && typeof header.id === 'string') byId.set(header.id, header)
      }
      for (const session of owner.sessions.list()) byId.set(session.id, session.header) // 全量修复时live覆盖同ID持久快照。
    }
    if (sessionHeader && typeof sessionHeader.id === 'string') byId.set(sessionHeader.id, sessionHeader) // 正常新会话只验证与关联该真实header。
    for (const header of byId.values()) {
      if (disposed) return undefined
      if (typeof header.cwd !== 'string' || !isAbsolute(header.cwd) || !acceptedKeys.has(lexicalKey(header.cwd))) continue // 其他历史目录不被读、迁移、修改或附加到当前业务目录。
      if (await realpathNormalize(header.cwd).catch(() => undefined) !== canonical) continue
      if (disposed) return undefined // canonical检查期间卸载后不得再启动新的会话关联。
      await workspace.attachSession(header.id) // 官方再次验证真实Header匹配及已有account幂等，不写Session日志。
    }
    return workspace
  }
  /** @param {object} [options] 可信启动或Session事件参数。 @returns {Promise<object|undefined>} 串行恢复结果；真实持久化失败由caller处理。 */
  const repair = ({ full = false, sessionHeader } = {}) => {
    const work = tail.then(() => restore({ full, sessionHeader })) // 同一生命周期的恢复不互相竞态覆盖ID或标题。
    tail = work.catch(() => undefined) // 队列不被一次失败永久阻断；调用方仍收到原始拒绝。
    return work
  }
  /** @param {object} [options] 当前真实Session事件header或缺失登记恢复。 @returns {void} 回调不能等待registry当前写事务，避免死锁。 */
  const scheduleRepair = options => { void repair(options).catch(() => owner?.logger?.warn?.('受管问答工作区登记恢复暂不可用')) } // 仅稳定说明，不打印路径、历史或底层异常。

  class ManagedWorkspaceController extends WorkspaceController {
    /** @param {object} request 原生Workspace创建请求，只有path为目录选择。 @returns {Promise<object>} 原生投影。 @throws {RemoteError} 外部路径拒绝。 */
    async create(request) { await admitPath(request?.path); return super.create(request) }
    /** @param {AbortSignal} signal 原生请求取消。 @returns {Promise<object>} 当前必需Workspace的原生create投影。 */
    async initializeDefault(signal) {
      signal.throwIfAborted()
      await repair() // 不走Documents发现/新目录流程；既有业务目录恢复不创造用户Session。
      const created = await super.create({ path: canonical }) // 使用官方投影，保持原始Remote字段与界面协议。
      return { workspace: created.workspace } // initializeDefault原生返回形状，不添加自有保护元数据。
    }
    /** @param {object} request 原生workspaceId请求。 @returns {Promise<object>} 其它登记仍原生删除。 @throws {RemoteError} 当前必需目录拒绝，不删文件或Session。 */
    async delete(request) {
      const workspace = this.ctx.workspaceRegistry.get(request?.workspaceId) // ID只定位当前Host登记，真正保护按可信canonical目录。
      if (workspace?.path === canonical) throw new RemoteError('gateway/bad-request', '当前问答必需的业务工作区不能删除', {})
      return super.delete(request)
    }
  }
  class ManagedSessionController extends SessionController {
    /**
     * 校验新会话目录admission，所有真正Session创建、模型及Preset流程由原生super决定。
     * @param {object} request 原生cwd或workspaceId（二选一），无目录时保留原生当前进程默认。
     * @returns {Promise<object>} 完整原生创建回执，不改用户模型或effort。
     * @throws {RemoteError} 非受管目录；两字段冲突和未知ID仍由原生实现报告。
     */
    async create(request) {
      if (request?.cwd !== undefined && request?.workspaceId !== undefined) return super.create(request) // 原生会在任何写入前拒绝二选一冲突。
      if (request?.cwd !== undefined) await admitPath(request.cwd)
      if (request?.workspaceId !== undefined) {
        const workspace = this.ctx.workspaceRegistry.get(request.workspaceId) // 只看实际官方登记，不信任客户端自行描述path。
        if (workspace && workspace.path !== canonical) throw badLocation()
      }
      await repair() // 恢复必需登记，保留原生无目录请求的process.cwd默认；这里不创造用户会话。
      return super.create(request)
    }
  }
  const dependencies = [...new Set([...WorkspaceController.inject, ...SessionController.inject, 'sessionPersistence'])] // 原完整公开服务依赖与Schema不被缩减，不依赖自有UI或Host循环。
  const fiber = ctx.plugin({
    name: 'adminsmart-managed-workspace', // 只负责目录集成admission与必需登记，不冒充新的Workspace/Session引擎。
    inject: dependencies, // 包含原Controller全部服务，后续方法仍按原协议执行。
    apply(child) {
      if (disposed) return // 超时后的依赖迟到不能重新贡献控制器、事件或恢复写操作。
      owner = child // 事件、service和恢复均属于当前子fiber生命周期。
      child.effect(() => () => { disposed = true; rejectReady(new Error('受管工作区启动已取消')) }, 'adminsmart: managed workspace lifetime') // 在构造前注册清理，构造异常也不能遗留可继续恢复的生命周期。
      try {
        new ManagedWorkspaceController(child, workspaceConfig) // serviceKey=workspaceController，namespace=workspace，继承完整Remote markers。
        new ManagedSessionController(child, sessionConfig) // serviceKey=sessionController，namespace=session，模型选择/发送/归档等保持原生。
        child.on('domain/changed', change => {
          if (change.domain !== 'workspace' || change.table !== 'workspaces') return
          if (change.operation === 'deleted' && String(change.key) === protectedId) scheduleRepair() // 只对当前必需登记删除恢复，不重建其它已删Workspace。
          else if (String(change.key) === protectedId && typeof change.value?.title === 'string') retainedTitle = change.value.title // 官方put事件先于entity刷新，公开事件的新值才是本次提交后的用户标题。
        }) // 官方Context自行拥有并释放此监听，不读私有hooks。
        child.on('session/created', session => scheduleRepair({ sessionHeader: session.header })) // 每个新会话只关联自身header，已有历史数量不扩大创建成本。
        resolveReady() // 只表示apply已实际执行，安装方仍须等fiber公开生命周期结算及首轮恢复。
      } catch (error) {
        rejectReady(error)
        throw error // 保留Cordis原生FAILED状态与启动错误报告，不吞掉装配故障。
      }
    },
  })
  let startupTimer // 有限就绪门禁的唯一计时器，成功或失败都释放，不增加后台轮询。
  const deadline = new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('受管工作区依赖或初始化未在限时内就绪')), startupTimeoutMs) }) // 长期缺依赖明确拒绝，不无限等待或提前restore。
  try {
    await Promise.race([
      (async () => {
        await ready // PENDING状态下没有apply；仅等待明确注册完成，不能以fiber.await立即返回作为成功。
        await fiber.await() // 官方公开API报告构造失败并等待本次apply真正结算。
        if (disposed || !owner || fiber.state !== 2) throw new Error('受管工作区控制器未处于可用状态') // 固定版公开FiberState.ACTIVE=2，禁止使用私有inertia/epoch推测就绪。
        await repair({ full: true }) // 冷启修复此前已删除登记，并关联snapshot.header的合法历史；不迁移或删除会话。
        if (disposed) throw new Error('受管工作区启动已取消')
      })(),
      deadline,
    ])
  } catch (error) {
    disposed = true // 先封闭所有恢复入口，再卸载pending/active fiber，迟到依赖或持久响应均不能继续写入。
    await fiber.dispose()
    throw error
  } finally {
    clearTimeout(startupTimer)
  }
  return {
    fiber, // root可随Host生命周期管理该贡献，不需要在Profile加载第三方源码。
    repair, // 必需业务目录恢复；只供可信Host调用，非新增客户端RPC。
    drain: () => tail, // 隔离目标等待此前事件恢复完成，不增加常驻轮询。
    async dispose() { disposed = true; await fiber.dispose() }, // 释放本模块事件与继承服务，不修改用户数据。
  }
}
