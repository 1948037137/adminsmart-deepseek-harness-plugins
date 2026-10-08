/** 使用官方 ConfigForms 公共协议同步共享 General 设置，不抓取 DOM、不模拟点击。 */

export const GENERAL_SETTINGS_NAMESPACES = Object.freeze(['locale', 'ui-theme', 'ui-chat', 'ui-conversation', 'ui-settings']) // 仅接管五个官方展示命名空间。
const OWNED_SETTINGS_NAMESPACE = 'adminsmart-shared-settings' // 公开insert产生的唯一自有Host entry ID；Client消费者仍使用官方ui-settings契约。
const FIELD_MAPPING = Object.freeze({
  locale: { // 官方语言命名空间与共享偏好映射。
    preference: 'locale', // 原生未指定语言省略字段，API 以 null 表达跟随浏览器。
  },
  'ui-theme': { // 官方主题及内容字体命名空间。
    preference: 'theme', // light/dark/system 外观选择。
    fontSize: 'fontSize', // 会话内容的整数像素字号。
  },
  'ui-chat': { // 官方聊天展示命名空间。
    transcriptView: 'transcriptView', // 工作步骤与工具轨迹的展示详细程度。
    performanceUsage: 'performanceUsage', // 性能和Token用量明细程度。
    linkOpening: 'linkOpening', // 外部链接的打开位置。
  },
  'ui-conversation': { // 官方会话交互命名空间。
    busyEnter: 'busyEnter', // Agent运行期间Enter的排队或插话发送方式。
  },
  'ui-settings': { // 官方代码工作视图命名空间。
    enabled: 'developerTools', // 代码差异、轨迹和相关原生视图的共同开关。
  },
})
const POLICY_FIELDS = Object.freeze(Object.values(FIELD_MAPPING).flatMap(mapping => Object.values(mapping))) // 八字段白名单，拒绝任意 Profile 修改。
const POLICY_URL = './adminsmart/ui-policy' // 当前签名 Runtime 的固定同源策略入口。
const REQUEST_TIMEOUT_MS = 5_000 // 单次读取或保存的有界等待。
const RECOVERY_INTERVAL_MS = 30_000 // 原生事件断线期间的补偿回读；正常变化立即触发官方事件。

/**
 * 校验完整共享策略，不补入猜测默认值。
 * @param {unknown} settings 未信任的服务端或管理员策略。
 * @returns {boolean} 八字段、类型、范围与固定版枚举是否有效。
 */
export function isUiPolicy(settings) {
  return settings !== null && typeof settings === 'object' && !Array.isArray(settings)
    && Object.keys(settings).length === POLICY_FIELDS.length
    && POLICY_FIELDS.every(field => Object.hasOwn(settings, field))
    && (settings.locale === null || typeof settings.locale === 'string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(settings.locale))
    && ['light', 'dark', 'system'].includes(settings.theme)
    && Number.isInteger(settings.fontSize) && settings.fontSize >= 10 && settings.fontSize <= 22
    && [null, 'compact', 'standard', 'detailed', 'verbose', 'normal', 'expanded'].includes(settings.transcriptView)
    && ['compact', 'detailed'].includes(settings.performanceUsage)
    && ['queue', 'steer'].includes(settings.busyEnter)
    && ['sidebar', 'new-tab'].includes(settings.linkOpening)
    && typeof settings.developerTools === 'boolean'
}

/**
 * 把共享字段映射到官方表单；locale:null 不能进入原生 LocaleRuntime。
 * @param {string} namespace 固定 General 命名空间。
 * @param {object} settings 完整已校验策略。
 * @returns {object} 当前命名空间的原生字段值。
 */
function nativeValues(namespace, settings) {
  return Object.fromEntries(Object.entries(FIELD_MAPPING[namespace])
    .filter(([, field]) => field !== 'locale' || settings.locale !== null)
    .map(([nativeField, field]) => [nativeField, settings[field]]))
}

/** @param {unknown} left 当前快照。 @param {unknown} right 待发布状态。 @returns {boolean} 非敏感 JSON 状态是否相同。 */
function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * 按稳定字段比较策略，后端JSON键顺序不构成外部管理员编辑。
 * @param {object|null} left 当前接受策略。
 * @param {object|null} right 待比较完整策略。
 * @returns {boolean} 八项展示偏好是否相同。
 */
function samePolicy(left, right) {
  return left === right || Boolean(left && right && POLICY_FIELDS.every(field => left[field] === right[field]))
}

/**
 * 仅在自有描述桥归一化固定owned alias，不改变官方Host注册或Schema。
 * @param {Array<object>} rows 官方脱敏Remote描述，可能包含历史canonical行。
 * @returns {Array<object>} 每个General canonical身份最多一行，owned行优先，且不转发未知额外元数据。
 */
function generalMetadata(rows) {
  const index = new Map() // 按官方Client消费身份索引真实Host Schema。
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.ns !== 'string') continue
    const namespace = row.ns === OWNED_SETTINGS_NAMESPACE ? 'ui-settings' : row.ns // 固定白名单alias，不允许响应动态指定别名。
    if (!Object.hasOwn(FIELD_MAPPING, namespace) || index.has(namespace) && row.ns !== OWNED_SETTINGS_NAMESPACE) continue
    index.set(namespace, {
      ns: namespace, // 只调整bridge展示/索引身份，原生Host仍归owned entry所有。
      schema: row.schema, // 完整保留固定SDK官方公开Schema，不复制或改写字段定义。
      value: row.value, // 官方有效值仅用于确认元数据就绪，公开展示另由共享白名单投影。
      base: row.base, // 原生继承配置层的公开元数据。
      user: row.user, // 原生显式配置层的公开元数据。
      autoGenerate: row.autoGenerate, // 官方是否允许按Schema生成配置表单。
      applies: row.applies, // 官方实时或重启后生效标记。
      secrets: row.secrets, // 官方脱敏字段说明，不扩大数据读取范围。
      revision: row.revision, // 原生描述修订，最终General表单使用共享CAS修订。
    })
  }
  return GENERAL_SETTINGS_NAMESPACES.map(namespace => index.get(namespace)).filter(Boolean)
}

/**
 * 安装受限 General façade；所有环境和角色使用同一接线。
 * @param {object} options 官方服务和可隔离的固定同源传输。
 * @param {object} options.configForms 同提供方 fiber 创建的原生 ConfigForms。
 * @param {object} options.remote 官方 Remote，读取脱敏 Schema 并订阅文档变化。
 * @param {Function} [options.fetchImpl] 固定同源 fetch；测试使用 Fake。
 * @param {number} [options.recoveryIntervalMs] 补偿回读间隔，测试以零禁用计时器。
 * @returns {object} ConfigForms、状态订阅、ready、refresh 与 dispose。
 * @sideEffects 仅读共享策略与官方脱敏描述；仅服务端确认的管理员能提交白名单 CAS。
 */
export function installUiPolicyClient({ configForms, remote, fetchImpl = globalThis.fetch, recoveryIntervalMs = RECOVERY_INTERVAL_MS } = {}) {
  if (!configForms?.get || !remote?.settings?.describe) throw new Error('共享设置官方能力未就绪')
  let disposed = false // 卸载后迟到响应不能重新发布或启动下一次请求。
  let policy = null // 最近确认的完整共享策略、修订和服务端写能力。
  let metadata = [] // 官方 describe 返回的五个 General Schema，不从 DOM 推断。
  let generation = 0 // 写入与新回读推进世代，丢弃较早 GET 响应。
  let externalEpoch = 0 // 采用其它修订或保存失败时撤销已排队草稿，自己的成功ACK不推进此边界。
  let inFlightWrite = null // 当前PUT的修订与完整草稿，用于识别HTTP回答之前到达的自有文档事件回声。
  let writeTail = Promise.resolve() // 所有 General 表单共用串行队列，避免跨命名空间丢更新。
  let refreshPending = null // 并发原生事件合并为同一读取。
  let refreshAgain = false // 当前读取期间到达的事件安排后续回读，保证不丢通知。
  let state = Object.freeze({ // 保存错误与已持久化但推送延迟的反馈分别表示。
    status: 'loading', // 初次策略及Schema尚未完整采用。
    saving: false, // 当前串行队列是否正在提交请求。
    error: null, // 未保存、权限拒绝或并发冲突的稳定提示。
    notice: null, // 已提交但实时推送延迟或已被后续管理员覆盖的提示。
    revision: undefined, // 当前真正接受的共享CAS修订。
  })
  let directory = Object.freeze({ // 兼容SettingsDescribeFace的稳定目录快照。
    status: 'loading', // 五个General Schema与策略的完整就绪状态。
    view: undefined, // 官方元数据和共享值组成的受限目录。
    error: null, // 无后端正文或路径的目录读取错误。
  })
  const stateListeners = new Set() // 保存状态与错误的公开订阅者。
  const directoryListeners = new Set() // 官方 namespace 目录的公开订阅者。
  const forms = new Map() // 同一 General namespace 只创建一个共享表单。
  const cleanups = [] // 原生事件、目录订阅与计时器的卸载动作。

  /** @param {object} fields 保存状态变化。 @returns {void} 状态未变时保持引用稳定。 */
  const publishState = fields => {
    const next = Object.freeze({ ...state, ...fields }) // 每次真正变化才替换公开快照。
    if (sameValue(state, next)) return
    state = next
    for (const listener of stateListeners) listener()
  }

  /**
   * 同时发布权威策略和真实 Schema，memory native 目录为空时也有完整 General served 信息。
   * @param {boolean} [force] 保存失败后触发官方消费者撤回乐观状态，即使接受值未变。
   * @returns {void} 未变化的快照引用保持稳定。
   */
  const publish = (force = false) => {
    const ready = Boolean(policy?.settings) && GENERAL_SETTINGS_NAMESPACES.every(namespace => metadata.some(row => row.ns === namespace)) // 策略和五项 Schema 都完整才开放表单。
    for (const [namespace, form] of forms) {
      const row = metadata.find(candidate => candidate.ns === namespace) // 官方公开 namespace 元数据。
      const value = ready ? nativeValues(namespace, policy.settings) : undefined // 原生语言未指定时省略 preference。
      form.publish({
        status: ready ? 'ready' : state.error ? 'unavailable' : 'loading', // 策略与真实Schema的共同就绪状态。
        value, // 唯一共享策略已转换的原生字段。
        base: row?.base, // 官方返回的继承层，只读取而不猜测。
        user: value, // 共享策略构成当前接受的显式展示偏好。
        revision: policy?.revision, // 所有展示Namespace共用的CAS修订。
        writable: ready && policy.writable === true, // 必须服务端确认管理员且策略已就绪。
        mode: 'host', // 值由受控Host持久化，不采用浏览器本地memory分支。
      }, force)
    }
    const native = configForms.describe().getSnapshot() // 未接管的 namespace 和文档能力仍由官方拥有。
    const rows = ready ? metadata.map(row => ({
      ...row, // 原生Schema、applies、秘密字段标记及其它公开元数据保持官方定义。
      value: nativeValues(row.ns, policy.settings), // 当前namespace实际采用的共享值。
      user: nativeValues(row.ns, policy.settings), // 当前共享策略对应的显式展示字段。
      revision: policy.revision, // 下次编辑必须携带的共同修订。
    })) : [] // Schema保留官方，值与修订采用共享真源。
    const view = ready ? {
      ...native.view, // 非General目录的其它官方公开能力原样保留。
      namespaces: [...(native.view?.namespaces ?? []).filter(row => row.ns !== OWNED_SETTINGS_NAMESPACE && !Object.hasOwn(FIELD_MAPPING, row.ns)), ...rows], // owned来源不作为重复namespace泄露；只发布五项canonical General。
      writable: policy.writable === true, // 共享编辑能力由受控Host确认。
      hasDocument: native.view?.hasDocument === true, // 打开原生文档能力仍由官方服务决定。
    } : undefined
    const next = Object.freeze({
      status: ready ? 'ready' : state.error ? 'unavailable' : 'loading', // 完整目录的可用状态。
      view, // 公共官方元数据与共享值的统一目录。
      error: state.error, // 稳定安全提示，不包含后端正文。
    })
    if (!sameValue(directory, next)) {
      directory = next
      for (const listener of directoryListeners) listener()
    }
    publishState({ status: ready ? 'ready' : state.error ? 'unavailable' : 'loading', revision: policy?.revision })
  }

  /**
   * 调用固定共享策略端点，完整校验响应后才采用。
   * @param {'GET'|'PUT'} method 固定受控操作。
   * @param {object} [body] 管理员 expectedRevision/settings CAS。
   * @returns {Promise<object>} 完整已验证的非敏感信封。
   * @throws {Error} 连接、权限、冲突或响应损坏，错误不携带内部数据。
   */
  const request = async (method, body) => {
    let response // 固定同源传输结果，不解析失败响应正文。
    try {
      response = await fetchImpl(POLICY_URL, { method, credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch { throw new Error('共享设置连接失败，请重试') }
    if (!response.ok) {
      const error = new Error(response.status === 409 ? '设置已被其他管理员更新，请重新编辑' : response.status === 403 ? '管理员权限不足' : '共享设置保存失败，请重试') // 不复述响应、身份或认证字段。
      error.conflict = response.status === 409 // 冲突后回读胜出值，不重发旧编辑。
      throw error
    }
    let accepted // JSON 解析失败只返回稳定提示，不复述响应正文。
    try { accepted = await response.json() } catch { throw new Error('共享设置响应无效') }
    if (!accepted || typeof accepted !== 'object' || !Number.isSafeInteger(accepted.revision) || accepted.revision < 0 || typeof accepted.writable !== 'boolean'
      || (accepted.settings === null ? accepted.revision !== 0 : accepted.revision < 1 || !isUiPolicy(accepted.settings))) throw new Error('共享设置响应无效')
    return {
      revision: accepted.revision, // 后端已提交或读取的唯一共享修订。
      settings: accepted.settings === null ? null : structuredClone(accepted.settings), // 完整白名单策略副本，不能由响应引用原地修改。
      writable: accepted.writable, // 服务端根据可信Runtime身份确认的管理员写能力。
      deliveryDelayed: method === 'PUT' && response.headers?.get?.('X-AdminSmart-UI-Policy-Delivery') === 'delayed', // commit已成功但跨Runtime通知暂未送达。
    }
  }

  /**
   * 合并文档变化回读；写入或卸载使较早响应失效。
   * @returns {Promise<void>} 当前与合并的最后一次读取完成。
   */
  const refresh = () => {
    if (disposed) return Promise.resolve()
    if (refreshPending) { refreshAgain = true; return refreshPending }
    refreshPending = (async () => {
      do {
        refreshAgain = false
        const ticket = ++generation // 本轮策略和 Schema 采用的唯一时序。
        try {
          const [accepted, described] = await Promise.all([request('GET'), Promise.resolve().then(() => remote.settings.describe()).catch(() => { throw new Error('官方设置描述暂不可用') })]) // 只公开安全错误，不暴露官方底层异常。
          if (disposed || ticket !== generation) continue
          const rows = described?.ok ? described.value?.namespaces : undefined // 官方 Remote 的 ok/value 回答，错误信封不能采用。
          if (!Array.isArray(rows)) throw new Error('官方设置描述暂不可用')
          const general = generalMetadata(rows) // 固定owned来源归canonical索引，历史行兼容且禁止重复或额外描述字段。
          if (GENERAL_SETTINGS_NAMESPACES.some(namespace => !general.some(row => row.ns === namespace && row.schema && row.value && typeof row.value === 'object'))) throw new Error('官方通用设置尚未就绪')
          if (policy && accepted.revision < policy.revision) continue // 旧GET不能撤回已确认PUT或更高修订的外部采用。
          const ownEcho = inFlightWrite && accepted.revision === inFlightWrite.revision + 1 && samePolicy(accepted.settings, inFlightWrite.settings) // Host可能在PUT回答前发送当前提交的原生事件，不能误撤销自有后续编辑。
          if (policy && !ownEcho && (accepted.revision !== policy.revision || !samePolicy(accepted.settings, policy.settings))) externalEpoch += 1 // 外部采用撤销旧草稿，JSON键顺序变化不算编辑。
          metadata = general
          policy = accepted
          publishState({ error: null })
          publish()
        } catch (error) {
          if (disposed || ticket !== generation) continue
          publishState({ error: error?.message ?? '共享设置暂不可用' })
          publish()
        }
      } while (refreshAgain && !disposed)
    })().finally(() => { refreshPending = null })
    return refreshPending
  }

  /**
   * 串行提交一次 namespace 原子操作，字段映射和 CAS 在执行时计算。
   * @param {string} namespace 五个固定 General 之一。
   * @param {Array<object>} operations 官方 set/unset 单字段路径。
   * @param {number} [expectedRevision] 调用方明确捕获的旧修订。
   * @returns {Promise<boolean>} 接受为 true，拒绝或冲突恢复为 false；连接错误拒绝 Promise。
   */
  const mutate = (namespace, operations, expectedRevision) => {
    const copied = structuredClone(operations) // 排队后外部修改操作不能改变将要提交的草稿。
    const queuedEpoch = externalEpoch // 草稿入队时的外部采用边界；允许自己的ACK链推进修订，禁止跨外部采用重放。
    const operation = writeTail.then(async () => {
      if (disposed || policy?.writable !== true || !policy?.settings) return false
      if (queuedEpoch !== externalEpoch) { publishState({ error: '设置已被其他管理员更新，请重新编辑' }); publish(true); return false }
      if (expectedRevision !== undefined && expectedRevision !== policy.revision) { await refresh(); publish(true); return false }
      const settings = { ...policy.settings } // 保留上次成功 PUT 确认的其它命名空间字段。
      for (const op of copied) {
        const field = op.path?.length === 1 ? FIELD_MAPPING[namespace][op.path[0]] : undefined // 白名单之外或嵌套路径不能越过受限策略。
        if (!field || !['set', 'unset'].includes(op.op)) return false
        if (op.op === 'unset' || field === 'locale' && op.value === undefined) {
          if (!['locale', 'transcriptView'].includes(field)) return false // 其它必需值无空值协议，不能猜测继承默认值。
          settings[field] = null
        } else settings[field] = op.value
      }
      if (!isUiPolicy(settings)) return false
      if (samePolicy(settings, policy.settings)) return true
      generation += 1
      publishState({ saving: true, error: null, notice: null })
      inFlightWrite = {
        revision: policy.revision, // 当前请求真正提交的CAS基线。
        settings, // 完整白名单草稿，只有相同值且下一修订可作为自有事件回声。
      }
      try {
        const accepted = await request('PUT', {
          expectedRevision: inFlightWrite.revision, // 保存时捕获的同一基线，事件采用不能改变已发送CAS。
          settings, // 当前完整受限策略。
        })
        if (disposed) return false
        if (queuedEpoch !== externalEpoch || accepted.revision < policy.revision) {
          publishState({ notice: '设置已保存，当前设置已被其他管理员更新' }) // 成功ACK已经提交，后续胜出值必须保留，不能误报未提交或回退修订。
          publish(true)
          return true
        }
        policy = accepted
        publishState({ notice: accepted.deliveryDelayed ? '设置已保存，实时同步暂不可用' : null }) // 已提交不能误报未保存或重发旧CAS。
        publish()
        return true
      } catch (error) {
        externalEpoch += 1 // 冲突或结果不明时撤销此前排队草稿，不能重放到回读后的新CAS上。
        if (!disposed) {
          await refresh()
          publishState({ error: error.message })
          publish(true)
        }
        if (error.conflict) return false
        throw error
      } finally {
        inFlightWrite = null // 后续GET不能再借用已经结算的提交身份。
        if (!disposed) publishState({ saving: false })
      }
    })
    writeTail = operation.then(() => {}, () => {}) // 保存失败不能永久阻塞后续编辑。
    return operation
  }

  const describe = {
    getSnapshot: () => directory, // 官方目录订阅需要稳定快照。
    subscribe(listener) { directoryListeners.add(listener); return () => directoryListeners.delete(listener) },
    ensure: () => directory.status === 'loading' || directory.status === 'unavailable' ? refresh() : Promise.resolve(),
    acceptView(view) { if (!Object.hasOwn(FIELD_MAPPING, view.ns)) configForms.describe().acceptView(view); else void refresh() }, // General 始终回读共享真源，原生回答不能覆盖策略。
  }
  const facade = {
    /**
     * 获取同一共享表单；未知namespace完整委托原生服务。
     * @param {string} namespace 官方命名空间身份。
     * @returns {object} 稳定表单实例、快照、订阅及原子操作。
     */
    get(namespace) {
      if (!Object.hasOwn(FIELD_MAPPING, namespace)) return configForms.get(namespace)
      if (!forms.has(namespace)) {
        let snapshot = Object.freeze({
          status: 'loading', // 初次读取或未取得真实Schema时不能声明已采用。
          value: undefined, // 尚无经验证的原生字段值。
          base: undefined, // 尚未取得官方继承层。
          user: undefined, // 尚无共享显式偏好。
          revision: undefined, // 首次读取后才具有可靠CAS基线。
          writable: false, // 未取得服务端角色确认前不得写入。
          mode: 'host', // 所有环境统一由受控Host真源同步。
        })
        const listeners = new Set() // 当前命名空间的全部官方消费者。
        forms.set(namespace, {
          getSnapshot: () => snapshot,
          subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
          set: (field, value) => mutate(namespace, [{ op: 'set', path: [field], value }]),
          unset: field => mutate(namespace, [{ op: 'unset', path: [field] }]),
          mutate: (ops, revision) => mutate(namespace, ops, revision),
          publish(next, force) { const changed = !sameValue(snapshot, next); if (changed) snapshot = Object.freeze(next); if (changed || force) for (const listener of listeners) listener() },
        })
        publish()
      }
      return forms.get(namespace)
    },
    describe: () => describe,
    /**
     * 依照官方公开目录维持依赖Namespace的UI席位。
     * @param {Array<string>} namespaces 需要至少存在一项的官方命名空间。
     * @param {Function} register 接收实际served集合，返回席位卸载函数。
     * @returns {Function} 终止目录订阅并清理已注册席位。
     */
    whileServed(namespaces, register) {
      let release // 满足公开 served 条件时保留的注册生命周期。
      const sync = () => {
        const served = new Set(directory.view?.namespaces.map(row => row.ns) ?? []) // General 和未知官方命名空间共享一个可观察目录。
        if (namespaces.some(namespace => served.has(namespace))) { if (!release) release = register(served) }
        else if (release) { release(); release = undefined }
      }
      const off = describe.subscribe(sync) // 采用或丢失 namespace 时更新注册生命周期。
      void describe.ensure()
      sync()
      return () => { off(); release?.(); release = undefined }
    },
    developerTools: {
      enabled: {
        getSnapshot: () => facade.get('ui-settings').getSnapshot().value?.enabled ?? false, // 初始未知时关闭代码视图。
        subscribe(listener) {
          let previous = facade.developerTools.enabled.getSnapshot() // boolean 订阅只在接受值实际变化时发布。
          return facade.get('ui-settings').subscribe(() => { const next = facade.developerTools.enabled.getSnapshot(); if (next !== previous) { previous = next; listener() } })
        },
      },
      async setEnabled(enabled) { if (!await facade.get('ui-settings').set('enabled', enabled)) throw new Error('代码工作视图设置未保存') },
    },
  }
  cleanups.push(configForms.describe().subscribe(() => publish())) // 未接管 namespace 的官方目录变化继续投影。
  if (remote.$on) cleanups.push(remote.$on('settings/document-updated', () => { void refresh() })) // Host 采用共享策略后立即通过原生事件更新。
  if (recoveryIntervalMs > 0) {
    const timer = setInterval(() => { void refresh() }, recoveryIntervalMs) // 重连事件缺失时的有界补偿，不依赖设置弹窗。
    timer.unref?.()
    cleanups.push(() => clearInterval(timer))
  }
  const ready = refresh() // 初次读取失败以明确 unavailable 结束，不形成启动死锁。
  return {
    configForms: facade,
    ready,
    refresh,
    getSnapshot: () => state,
    subscribe(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener) },
    getError: () => state.error,
    dispose() { disposed = true; generation += 1; for (const cleanup of cleanups.reverse()) cleanup?.(); for (const form of forms.values()) form.publish({ ...form.getSnapshot(), writable: false }, true); stateListeners.clear(); directoryListeners.clear() },
  }
}
