/** 通过官方 SettingsForms 同步管理员共享 General 策略，不读取或写入任意 Profile JSON。 */

const GENERAL_NAMES = Object.freeze(['locale', 'ui-theme', 'ui-chat', 'ui-conversation', 'ui-settings']) // 五个官方展示命名空间，排除供应商、凭据与权限设置。
const OWNED_SETTINGS_NAMESPACE = 'adminsmart-shared-settings' // 官方 ui-settings 停用后，独立自有 wrapper entry 的唯一公开身份。
const POLICY_FIELDS = Object.freeze([
  'locale',
  'theme',
  'fontSize',
  'transcriptView',
  'performanceUsage',
  'developerTools',
  'busyEnter',
  'linkOpening',
]) // 既有 API 的八个稳定字段；响应不能扩大白名单。
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u // RC2 官方 Locale Config 允许的语言标签。
const TRANSCRIPT_VALUES = new Set(['compact', 'standard', 'detailed', 'verbose', 'normal', 'expanded', null]) // RC2 当前模式、兼容旧值与未指定状态；完全展开是 verbose。
const REFRESH_MS = 30_000 // 推送暂不可用时的低频完整回读，正常更新由内部失效事件立即驱动。
const REQUEST_TIMEOUT_MS = 5_000 // 业务 API 不可用时，单次同步不能长期阻塞启动或编辑。
const EVENT_RECONNECT_MS = 1_000 // 内部连接断开后有界重连，重新读取当前签名能力文件。
const EVENT_CONNECTION_TIMEOUT_MS = 70_000 // 服务器六十秒主动轮换连接，客户端超时补偿卡住的传输。
const EVENT_BUFFER_LIMIT = 16_384 // SSE 只承载类型和修订，拒绝无限正文占用 Host 内存。

/**
 * 解析内部 SSE 的有限失效消息，不接受设置正文、身份或任意事件类型。
 * @param {string} frame 一个已分离的标准 SSE 帧。
 * @returns {object|null} ready/resync 恢复信号或 general/shortcuts/native/models 的正整数修订；注释帧返回 null。
 * @throws {Error} 格式损坏、额外字段或任意未知载荷，不将其转交业务写入。
 */
export function parseUiPolicyEvent(frame) {
  const lines = frame.split('\n') // 标准 SSE 字段逐行解析，不解释任意脚本或配置。
  const name = lines
    .find((line) => line.startsWith('event:'))
    ?.slice(6)
    .trim() // 后端固定事件类型，不作为路径或设置命名空间。
  if (!name) return null
  if (name === 'unavailable') throw new Error('界面设置实时分发暂不可用')
  if (!['ready', 'resync', 'policy-invalidated'].includes(name)) throw new Error('界面设置实时分发消息无效')
  const payload = JSON.parse(
    lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n'),
  ) // 未校验载荷不能进入设置回读与修订基线。
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('界面设置实时分发消息无效')
  if (name !== 'policy-invalidated') {
    if (Object.keys(payload).length !== 0) throw new Error('界面设置实时分发消息无效')
    return { kind: null, revision: null } // 恢复信号只触发完整回读，不携带策略数据。
  }
  if (
    Object.keys(payload).length !== 2 ||
    !['general', 'shortcuts', 'native', 'models'].includes(payload.kind) ||
    !Number.isSafeInteger(payload.revision) ||
    payload.revision < 1
  )
    throw new Error('界面设置实时分发消息无效')
  return payload
}

/**
 * 订阅当前签名 Runtime 的内部 General 失效流；数据库 GET 仍是设置真源。
 * @param {object} options Gateway 提供的固定 apiBase/readToken/userId/modeId/presetId，与策略 GET 共用身份。
 * @param {(event: object) => Promise<void>|void} onEvent 合法恢复信号或新修订触发的受控回读。
 * @param {object} [subscription] 已批准的单类订阅与可隔离传输。
 * @param {string} [subscription.kind=general] 只消费该类独立修订，其他合法类别静默忽略。
 * @param {Function} [subscription.fetchImpl] 固定路径的传输替身，不接收用户指定URL。
 * @returns {() => void} 中止当前流与重连计时器，卸载后不会发起迟到请求。
 * @sideEffects 仅调用固定内部只读 SSE，每次连接重新读取令牌；没有浏览器凭据或公开 SSE。
 */
export function watchUiPolicyEvents(
  options,
  onEvent,
  { kind = 'general', fetchImpl = globalThis.fetch } = {},
) {
  if (!['general', 'shortcuts', 'native', 'models'].includes(kind)) throw new Error('界面设置订阅类别无效') // 固定受限类别，不能变成任意消息分发。
  let disposed = false // 官方 Host 卸载后不再重连或回调。
  let controller = null // 当前 SSE 的 AbortController，由卸载和有界超时共同释放。
  let reconnectTimer = null // 一次连接结束只计划一个后续连接。
  let confirmedRevision = 0 // 当前订阅已看到的 General 修订，重复或乱序消息不会制造重复回读。

  /** @returns {Promise<void>} 完成一条有界 SSE，失败时只计划恢复，不暴露内部异常。 */
  const connect = async () => {
    if (disposed) return
    controller = new AbortController()
    const active = controller // 迟到旧连接不能取消或清理新的连接。
    const timeout = setTimeout(() => active.abort(), EVENT_CONNECTION_TIMEOUT_MS) // 后端轮换异常时仍按客户端边界释放。
    timeout.unref?.()
    try {
      const token = await options.readToken() // 签名能力仅存在 Host 调用栈，每次重连读取当前受保护文件。
      if (disposed || active.signal.aborted) return
      const response = await fetchImpl(`${options.apiBase}/internal/agent-model/v1/ui-policy/events`, {
        method: 'GET', // 普通用户只读订阅，不能借此提交设置。
        redirect: 'error', // 认证能力不得重定向到其它服务。
        headers: {
          Authorization: `Bearer ${token}`, // 当前 Runtime 的签名能力，不进入 URL、日志或 Client。
          Accept: 'text/event-stream', // 只接有限失效流。
          'X-AdminSmart-User-Id': options.userId, // 服务端绑定用户，不能由浏览器指定。
          'X-AdminSmart-Agent-Mode-Id': options.modeId, // 服务端白名单业务模式。
          'X-AdminSmart-Agent-Preset-Id': options.presetId, // 当前受管 Preset。
        },
        signal: active.signal, // 卸载/超时直接释放流式连接。
      })
      if (!response.ok || !response.body) throw new Error('界面设置实时分发暂不可用')
      const decoder = new TextDecoder() // UTF-8 跨块字符必须完整解码，不能按单块 JSON 解析。
      let buffer = '' // 有界帧缓冲，最多接收有限协议消息。
      // chunk 是固定内部响应的 UTF-8 字节，不直接当作业务数据。
      for await (const chunk of response.body) {
        if (disposed || active.signal.aborted) return
        buffer = (buffer + decoder.decode(chunk, { stream: true })).replaceAll('\r\n', '\n')
        if (buffer.length > EVENT_BUFFER_LIMIT) throw new Error('界面设置实时分发消息无效')
        let separator = buffer.indexOf('\n\n') // 完整 SSE 帧的标准边界，允许多个帧同块到达。
        while (separator >= 0) {
          const event = parseUiPolicyEvent(buffer.slice(0, separator)) // 消息必须经过有限结构验证。
          buffer = buffer.slice(separator + 2)
          if (event?.kind === null) await onEvent(event)
          else if (event?.kind === kind && event.revision > confirmedRevision) {
            confirmedRevision = event.revision
            await onEvent(event)
          }
          separator = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // 连接错误只通过低频 GET 与重连补偿，凭据、底层正文和内部地址不进入日志。
    } finally {
      clearTimeout(timeout)
      if (controller === active) controller = null
      if (!disposed) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          void connect()
        }, EVENT_RECONNECT_MS)
        reconnectTimer.unref?.()
      }
    }
  }

  void connect()
  return () => {
    disposed = true
    controller?.abort()
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  }
}

/**
 * 校验完整、非敏感的 General 策略，不补入猜测默认值。
 * @param {unknown} policy 本地快照或后端返回的八项设置。
 * @returns {boolean} 字段、类型、官方枚举及字号范围是否全部合法。
 * @sideEffects 无；null transcript 保留官方客户端默认语义。
 */
function isGeneralPolicy(policy) {
  return (
    policy !== null &&
    typeof policy === 'object' &&
    !Array.isArray(policy) &&
    Object.keys(policy).length === POLICY_FIELDS.length &&
    POLICY_FIELDS.every((field) => Object.hasOwn(policy, field)) &&
    (policy.locale === null || (typeof policy.locale === 'string' && LOCALE_PATTERN.test(policy.locale))) &&
    ['light', 'dark', 'system'].includes(policy.theme) &&
    Number.isInteger(policy.fontSize) &&
    policy.fontSize >= 10 &&
    policy.fontSize <= 22 &&
    TRANSCRIPT_VALUES.has(policy.transcriptView) &&
    ['compact', 'detailed'].includes(policy.performanceUsage) &&
    typeof policy.developerTools === 'boolean' &&
    ['queue', 'steer'].includes(policy.busyEnter) &&
    ['sidebar', 'new-tab'].includes(policy.linkOpening)
  )
}

/**
 * 按字段比较策略，不把 JSON 键顺序或后端序列化顺序视为管理员编辑。
 * @param {object|null} left 已校验策略或尚未配置状态。
 * @param {object|null} right 另一份已校验策略或尚未配置状态。
 * @returns {boolean} 八项持久化偏好是否一致；旧值与 null 不被改写。
 */
function samePolicy(left, right) {
  return (
    left === right ||
    (left !== null && right !== null && POLICY_FIELDS.every((field) => left[field] === right[field]))
  )
}

/**
 * 将固定自有 Settings entry 映射到稳定 General 协议命名空间。
 * @param {unknown} namespace 官方 SettingsForms 描述或公开文档事件中的实际 entry ID。
 * @returns {string} canonical General 身份；其它 namespace 原样返回，随后仍受五项白名单筛选。
 * @sideEffects 无；不改写官方 entry、公开 DTO 或任意插件配置。
 */
function canonicalGeneralNamespace(namespace) {
  const source = String(namespace) // 实际 Host entry ID，不来自浏览器正文或任意配置路径。
  return source === OWNED_SETTINGS_NAMESPACE ? 'ui-settings' : source
}

/**
 * 读取五个原生展示命名空间的官方实时描述。
 * @param {object} settings 官方 SettingsForms 服务。
 * @param {'light'|'dark'|'system'} [historicalTheme='light'] 已确认兼容记录的历史主题，不从当前用户偏好推断。
 * @returns {Map<string, object>} canonical 白名单命名空间到完整描述的映射，保留原生修订号及真实 sourceNamespace。
 * @sideEffects describe 可能发布官方 document-updated 事件；不访问原始 Profile 或凭据。
 */
function generalRows(settings) {
  return new Map(
    settings
      .describe({ redactSecrets: true })
      .filter((row) => GENERAL_NAMES.includes(canonicalGeneralNamespace(row.ns)))
      .map((row) => [
        canonicalGeneralNamespace(row.ns),
        {
          ...row, // 原样保留官方 Schema、有效值、继承层和修订，不访问任何私有状态。
          ns: canonicalGeneralNamespace(row.ns), // 捕获和既有八字段策略继续使用 canonical General 协议。
          sourceNamespace: String(row.ns), // 原生 update/mutate 必须写实际 entry ID，不能向已停用旧 entry 写入。
        },
      ]),
  )
}

/**
 * 从已生效的官方 General 描述捕获共享策略，保留用户明确选择。
 * @param {object} settings 官方 SettingsForms 服务。
 * @returns {object|null} 八项完整展示设置；命名空间未就绪或必需值损坏时返回 null，等待下一次同步。
 * @sideEffects 仅读取；语言与 transcript 未指定时用 null 表达，而不是写入默认语言或模式。
 */
export function captureGeneralSettings(settings, historicalTheme = 'light') {
  const rows = generalRows(settings) // 官方有效值已解析 Schema 与继承配置，不从 Profile 原文取值。
  if (GENERAL_NAMES.some((name) => !rows.has(name))) return null
  const locale = rows.get('locale').value // 未指定语言由官方客户端选择浏览器语言。
  const theme = rows.get('ui-theme').value // 外观偏好与整数像素字号的官方属主。
  const chat = rows.get('ui-chat').value // 工作细节、性能统计与链接目的地的官方属主。
  const conversation = rows.get('ui-conversation').value // 忙碌时 Enter 行为的官方属主。
  const general = rows.get('ui-settings').value // 诊断工具开关的官方属主。
  const policy = {
    locale: locale?.preference ?? null, // null 保留未指定语言，不使用已解析的显示语言。
    theme: historicalTheme, // 历史兼容字段仅保留已确认记录，个人明暗不能发布成全站策略。
    fontSize: theme?.fontSize, // 采用实际生效字号，不强制回到官方默认字号。
    transcriptView: chat?.transcriptView ?? null, // RC2 未指定时交给官方 Client；旧值保持原样。
    performanceUsage: chat?.performanceUsage, // 完整保留 compact/detailed。
    developerTools: general?.enabled, // False 是明确关闭，不能按真值判断补默认值。
    busyEnter: conversation?.busyEnter, // 完整保留 queue/steer。
    linkOpening: chat?.linkOpening, // 完整保留 sidebar/new-tab。
  }
  return isGeneralPolicy(policy) ? policy : null
}

/**
 * 使用官方带修订号的 SettingsForms API 采用共享策略。
 * @param {object} settings 当前隔离用户 Runtime 的官方 SettingsForms。
 * @param {object} policy 后端完整展示策略，额外字段或非法值不得进入原生写操作。
 * @returns {Promise<void>} 所有变化的白名单字段提交完成。
 * @throws {Error} 策略损坏、原生表单未就绪或原生 CAS 失败；调用方下次回读后重试采用。
 * @sideEffects 仅更新五个展示命名空间，保留其它字段；不调用任意 Profile 编辑接口。
 */
export async function applyGeneralSettings(settings, policy) {
  if (!isGeneralPolicy(policy)) throw new Error('全局智能体界面设置无效')
  const rows = generalRows(settings) // 读值与原生修订号必须来自同一次官方描述。
  if (GENERAL_NAMES.some((name) => !rows.has(name))) throw new Error('通用设置尚未就绪')
  const updates = [
    [
      'ui-theme',
      {
        fontSize: policy.fontSize, // 官方整数像素字号。
      },
    ],
    [
      'ui-chat',
      {
        transcriptView: policy.transcriptView, // 保留官方当前模式、兼容旧值与 null 未指定状态。
        performanceUsage: policy.performanceUsage, // 性能统计明细级别。
        linkOpening: policy.linkOpening, // 外部链接目的地。
      },
    ],
    ['ui-conversation', { busyEnter: policy.busyEnter }], // 官方忙碌 Enter 字段。
    ['ui-settings', { enabled: policy.developerTools }], // 官方诊断工具字段。
  ] // 固定命名空间与字段白名单，不按响应动态生成任意 Profile 写入口。
  const locale = rows.get('locale') // Locale 的官方 unset 会恢复未指定/继承语义。
  if (policy.locale === null) {
    if (locale.value?.preference !== undefined)
      await settings.mutate('locale', [{ op: 'unset', path: ['preference'] }], locale.revision)
  } else if (locale.value?.preference !== policy.locale) {
    await settings.update('locale', { preference: policy.locale }, locale.revision)
  }
  // name 是目标命名空间；fields 是该命名空间固定的展示字段白名单。
  for (const [name, fields] of updates) {
    const current = rows.get(name) // 官方描述可能包含未来其它字段，不能整段替换。
    if (
      Object.entries(fields).every(
        ([field, value]) =>
          (field === 'transcriptView' ? (current.value?.[field] ?? null) : current.value?.[field]) === value,
      )
    )
      continue
    await settings.update(current.sourceNamespace ?? name, fields, current.revision)
  }
}

/**
 * 安装有界回读和管理员发布循环，后端策略是重载与跨用户采用的真源。
 * @param {object} ctx 官方 Host Context，提供 SettingsForms、事件和 effect 生命周期。
 * @param {object} options Gateway 提供的可信配置，不能由浏览器指定身份或角色。
 * @param {string} options.apiBase 受控业务 API 根地址。
 * @param {() => Promise<string>} options.readToken 每次请求读取当前签名能力令牌，不缓存或记录。
 * @param {string} options.userId 签名租约绑定的用户身份。
 * @param {string} options.modeId 服务端白名单业务模式。
 * @param {string} options.presetId 服务端选定的 Agent Preset。
 * @param {boolean} options.isAdmin 签名租约中的管理员角色，只有严格 true 才允许发布。
 * @returns {object} effect 管理定时器与事件订阅；getBootstrapSnapshot仅返回当前完整采用的确认副本。
 * @sideEffects 普通用户仅 GET 与本地采用；管理员通过既有受权 PUT 发布，失败不记录响应正文。
 */
export function installSharedUiPolicy(ctx, options) {
  const admin = options.isAdmin === true // 只信任 Gateway 角色，不使用浏览器状态。
  let disposed = false // 卸载后不再计划请求或采用迟到响应。
  let initialized = false // 首次回读完成前不能把启动默认值当作管理员编辑。
  let applying = false // 远端采用触发的官方事件不应发起反向发布。
  let mustAdopt = false // CAS 冲突或部分采用失败后，必须完整采用远端，不能发布混合本地状态。
  let lastConfirmed = null // Runtime 实际确认或完整采用的策略与修订，CAS 不能借用刚读到的新修订。
  let running = false // 同一 Runtime 不并行执行两次同步。
  let rerun = false // 当前请求期间到达的触发合并为一次后续同步。
  let wakeTimer = null // 官方 General 事件的短去抖计时器。

  /**
   * 读取或提交现有受权策略 API，并校验完整响应。
   * @param {'GET'|'PUT'} method 策略读取或管理员完整替换。
   * @param {object|undefined} body expectedRevision 与八项 settings 的 CAS 请求体。
   * @returns {Promise<object>} 合法 revision/settings 信封，不含任意 Profile 字段。
   * @throws {Error} 传输、响应校验或 CAS 失败，错误只携带安全信息。
   */
  const request = async (method, body) => {
    const token = await options.readToken() // 能力令牌仅存在单次 Host 请求栈，不进入日志或客户端。
    if (disposed) throw new Error('界面设置同步已停止')
    // response 是唯一受控策略端点的结果，不解析失败响应中的内部数据。
    const response = await fetch(`${options.apiBase}/internal/agent-model/v1/ui-policy`, {
      method, // 角色与路径固定，不能扩展为任意配置代理。
      redirect: 'error', // 签名能力令牌不能跟随重定向到其它服务。
      headers: {
        Authorization: `Bearer ${token}`, // 后端再次校验的签名 Runtime 能力。
        'Content-Type': 'application/json', // 仅提交受限 JSON Schema。
        'X-AdminSmart-User-Id': options.userId, // 与能力交叉校验的可信身份。
        'X-AdminSmart-Agent-Mode-Id': options.modeId, // 服务端绑定业务模式。
        'X-AdminSmart-Agent-Preset-Id': options.presetId, // 服务端绑定业务能力组合。
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), // 单次请求有界超时。
    })
    if (!response.ok) {
      const error = new Error('全局智能体界面设置同步失败') // 不包含响应正文、地址或凭据。
      error.policyConflict = response.status === 409 // 过期管理员必须采用已提交的新策略。
      throw error
    }
    const payload = await response.json() // 未校验数据不能进入原生写操作或同步基线。
    if (
      !payload ||
      !Number.isSafeInteger(payload.revision) ||
      payload.revision < 0 ||
      (payload.settings === null
        ? payload.revision !== 0
        : payload.revision < 1 || !isGeneralPolicy(payload.settings))
    ) {
      throw new Error('全局智能体界面设置响应无效')
    }
    return payload
  }

  /**
   * 完整采用后端策略，成功之前禁止反向发布部分修改。
   * @param {object} remote 已校验的 revision/settings 信封。
   * @returns {Promise<void>} 全部原生字段已采用，确认基线同步推进。
   * @throws {Error} 原生写入失败或有效值与目标不一致，保留下次完整采用标记。
   */
  const adopt = async (remote) => {
    mustAdopt = true
    applying = true
    try {
      await applyGeneralSettings(ctx.settings, remote.settings)
      if (disposed) return
      const adopted = captureGeneralSettings(ctx.settings, remote.settings.theme) // 历史主题不参与个人采用；其它共享字段必须完整验证。
      if (!samePolicy(adopted, remote.settings)) throw new Error('通用设置尚未完整采用')
      lastConfirmed = remote
      mustAdopt = false
    } finally {
      applying = false
    }
  }

  /**
   * 回读并采用策略，或提交基于已确认修订的管理员编辑。
   * @returns {Promise<void>} 本轮结束；缺表单、网络失败和冲突由后续有界轮询重试。
   * @sideEffects 用白名单快照发现遗漏事件，不发布启动值或采用中间状态。
   */
  const reconcile = async () => {
    if (disposed) return
    if (running) {
      rerun = true
      return
    }
    running = true
    try {
      const remote = await request('GET') // 后端持久化状态决定跨用户及 Runtime 重启后的展示策略。
      if (disposed) return
      const local = captureGeneralSettings(ctx.settings, remote.settings?.theme ?? lastConfirmed?.settings?.theme ?? 'light') // 仅把已确认历史主题带回兼容契约，不读取个人颜色形成全站修改。
      if (local === null) return // 等待下次定时回读，不用默认值填补，也不形成微任务忙循环。
      if (!initialized) {
        if (remote.settings !== null) {
          await adopt(remote)
        } else if (admin) {
          lastConfirmed = await request('PUT', { expectedRevision: 0, settings: local }) // 无策略时只由管理员播种已生效的原生选择。
        } else {
          lastConfirmed = remote // 普通用户即使尚无策略也不能发布本地值。
        }
        if (disposed) return
        initialized = true
        return
      }
      const localChanged =
        lastConfirmed !== null &&
        lastConfirmed.settings !== null &&
        !samePolicy(local, lastConfirmed.settings) // 官方事件遗漏时，定时比较仍能识别真实编辑。
      if (admin && !mustAdopt && localChanged && !samePolicy(local, remote.settings)) {
        if (remote.revision !== lastConfirmed.revision) {
          if (remote.settings !== null) await adopt(remote) // GET 已发现另一管理员更新，旧编辑不能冒用新修订覆盖它。
          return
        }
        const saved = await request('PUT', { expectedRevision: lastConfirmed.revision, settings: local }) // GET 后再次发生竞态仍由后端 CAS 拒绝。
        if (disposed) return
        lastConfirmed = saved // 只确认服务器快照，请求期间的新本地编辑留待下一轮继续提交。
        return
      }
      if (remote.settings !== null && (mustAdopt || !samePolicy(local, remote.settings))) {
        await adopt(remote)
      } else if (remote.settings !== null) {
        lastConfirmed = remote // 原生值相同时也采用当前修订，不产生反向 PUT。
      }
    } catch (error) {
      if (error?.policyConflict) mustAdopt = true // 下一轮只能采用胜出策略，不能重发失败的旧编辑。
      if (!disposed) ctx.logger?.warn?.('AdminSmart 全局界面设置同步暂不可用') // 不记录策略正文、内部异常或能力令牌。
    } finally {
      running = false
      if (rerun && !disposed) {
        rerun = false
        queueMicrotask(() => {
          void reconcile()
        })
      }
    }
  }

  ctx.effect(() => {
    const unsubscribe = admin
      ? ctx.on('settings/document-updated', (ns) => {
          if (!initialized || applying || !GENERAL_NAMES.includes(canonicalGeneralNamespace(ns))) return
          if (wakeTimer !== null) clearTimeout(wakeTimer)
          wakeTimer = setTimeout(() => {
            wakeTimer = null
            void reconcile()
          }, 200)
        })
      : () => {} // ns 是官方变化命名空间，普通 Runtime 不订阅出站发布事件。
    const interval = setInterval(() => {
      void reconcile()
    }, REFRESH_MS) // 活跃 Session 周期采用共享策略，不随渲染频繁请求。
    interval.unref?.()
    const releaseEvents = watchUiPolicyEvents(options, () => reconcile()) // commit 后 Redis 失效消息立即触发 GET/官方采用，不等待低频补偿时钟。
    void reconcile()
    return () => {
      disposed = true
      unsubscribe?.()
      releaseEvents()
      clearInterval(interval)
      if (wakeTimer !== null) clearTimeout(wakeTimer)
    }
  }, 'adminsmart-client-ui: shared General settings')
  return {
    /**
     * 读取可用于当前HTML首次装配的已采用策略，不启动网络、不缓存额外副本。
     * @returns {object|null} 已确认的revision/settings/writable；未初始化、部分采用、冲突、卸载或现值偏离时返回null。
     * @sideEffects 只通过公开SettingsForms捕获当前安全General值；其首次describe可能发布官方描述事件。
     */
    getBootstrapSnapshot() {
      if (disposed || !initialized || applying || mustAdopt || !lastConfirmed?.settings) return null
      try {
        if (!isGeneralPolicy(lastConfirmed.settings) || !samePolicy(captureGeneralSettings(ctx.settings, lastConfirmed.settings.theme), lastConfirmed.settings)) return null
        return {
          revision: lastConfirmed.revision, // 已实际采用或持久化确认的General独立CAS修订。
          settings: structuredClone(lastConfirmed.settings), // 分离副本避免HTML构建修改当前确认真源。
          writable: admin, // 角色只来自Gateway可信装配，bootstrap稍后仍与官方控制器能力求交集。
        }
      } catch { return null } // 官方描述不可用时回退既有HTTP确认，不把错误或部分设置注入页面。
    },
  }
}
