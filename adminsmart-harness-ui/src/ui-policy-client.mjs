/** 使用官方 ConfigForms 公共协议同步共享 General 设置，不抓取 DOM、不模拟点击。 */

export const GENERAL_SETTINGS_NAMESPACES = Object.freeze([
  'locale',
  'ui-theme',
  'ui-chat',
  'ui-conversation',
  'ui-settings',
]) // 仅接管五个官方展示命名空间。
const OWNED_SETTINGS_NAMESPACE = 'adminsmart-shared-settings' // 公开insert产生的唯一自有Host entry ID；Client消费者仍使用官方ui-settings契约。
const ADMINISTRATOR_NATIVE_NAMESPACES = new Set(['llm-pi-ai', 'llm-deepseek', 'ui-settings-models']) // 原生模型页实际需要的配置属主；不扩展任意插件、沙箱或隐藏配置。

/**
 * 提取官方模型页公开描述；直接Remote与官方镜像遵守同一字段及namespace边界。
 * @param {object[]} rows 已由官方Settings脱敏的描述目录，不接受凭据或未知扩展字段。
 * @returns {object[]} 管理员模型页所需原生元数据，保持官方namespace修订和配置值。
 * @sideEffects 无；只投影公开数据，不读取模型能力、凭据或持久化配置。
 */
function administratorNativeMetadata(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(row => row && typeof row.ns === 'string' && ADMINISTRATOR_NATIVE_NAMESPACES.has(row.ns))
    .map(row => ({
      ns: row.ns, // 官方原生命名空间，不能由业务别名扩展管理范围。
      schema: row.schema, // 原始公开Schema，模型能力仍由官方定义。
      value: row.value, // 官方已脱敏的有效值，不解析或解引用凭据。
      base: row.base, // 原生Models区分继承配置与可删配置所需公开层。
      user: row.user, // 官方持久化覆盖层，不从界面草稿重建。
      revision: row.revision, // 官方namespace的独立CAS，不与共享General修订混用。
      autoGenerate: row.autoGenerate, // 原生配置界面能力保持官方声明。
      applies: row.applies, // 原生字段生效边界，不能伪造实时支持。
      secrets: row.secrets, // 敏感字段描述标记，真实敏感值由Host脱敏。
    }))
}

const FIELD_MAPPING = Object.freeze({
  locale: {
    // 官方语言命名空间与共享偏好映射。
    preference: 'locale', // 原生未指定语言省略字段，API 以 null 表达跟随浏览器。
  },
  'ui-theme': {
    // 官方主题及内容字体命名空间。
    fontSize: 'fontSize', // 会话内容的整数像素字号。
  },
  'ui-chat': {
    // 官方聊天展示命名空间。
    transcriptView: 'transcriptView', // 工作步骤与工具轨迹的展示详细程度。
    performanceUsage: 'performanceUsage', // 性能和Token用量明细程度。
    linkOpening: 'linkOpening', // 外部链接的打开位置。
  },
  'ui-conversation': {
    // 官方会话交互命名空间。
    busyEnter: 'busyEnter', // Agent运行期间Enter的排队或插话发送方式。
  },
  'ui-settings': {
    // 官方代码工作视图命名空间。
    enabled: 'developerTools', // 代码差异、轨迹和相关原生视图的共同开关。
  },
})
const POLICY_FIELDS = Object.freeze([...Object.values(FIELD_MAPPING).flatMap((mapping) => Object.values(mapping)), 'theme']) // 保留历史theme字段的八字段传输兼容；个人选择不映射或写入该字段。
const THEME_READ_ONLY_FIELDS = Object.freeze([
  'codeFontSize',
  'terminalFontSize',
  'textFontFamily',
  'codeFontFamily',
  'terminalFontFamily',
]) // 官方 Theme 新增的展示输入，仅补全消费者快照，不进入共享策略及写入映射。
const POLICY_URL = './adminsmart/ui-policy' // 当前签名 Runtime 的固定同源策略入口。
const PERSONAL_THEME_URL = './adminsmart/personal-theme' // 只读写当前用户的官方主题字段，不访问全站策略或任意 namespace。
const REQUEST_TIMEOUT_MS = 5_000 // 单次读取或保存的有界等待。
const RECOVERY_INTERVAL_MS = 30_000 // 原生事件断线期间的补偿回读；正常变化立即触发官方事件。
const BOOTSTRAP_MAXIMUM_BYTES = 131_072 // 初始 HTML 白名单设置包的总预算，不允许把完整 Profile 当作启动数据。
const BOOTSTRAP_NAMESPACES = new Set([...GENERAL_SETTINGS_NAMESPACES, OWNED_SETTINGS_NAMESPACE, 'subagent', 'agent-loop', 'ui-settings-general']) // 只允许主题/交互与既定 Native 描述；模型和凭据永不随 HTML 内联。

/**
 * 校验并为两个自有读取者提供仅一次的已确认 Host 启动回答。
 * @param {unknown} candidate 当前 HTML 由受管 Host 注入的有限 JSON；无效时沿原网络路径。
 * @param {object} options 已加载的固定协议与当前公开 Remote。
 * @param {Function} options.isNativePolicy 固定 Native 模块的完整白名单校验器。
 * @param {object} options.remote 当前官方 Remote，不修改其服务或全局传输。
 * @param {Function} [options.fetchImpl] 原始同源 fetch；仅自有 Adapter 的第一次 GET 可消费启动包。
 * @returns {object|null} General/Native 各自独占的一次读取接线；缺失或非法时返回 null。
 * @sideEffects 不发请求、不发布状态、不缓存后续回答；reset、SSE、恢复及保存继续使用原传输。
 */
export function createPolicyBootstrapReads(candidate, { isNativePolicy, remote, fetchImpl = globalThis.fetch } = {}) {
  const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)) // 字段数与所有权共同限制，不能夹带 Provider 或认证对象。
  const envelope = (value, validate) => exact(value, ['revision', 'settings', 'writable'])
    && Number.isSafeInteger(value.revision) && value.revision >= 0 && typeof value.writable === 'boolean'
    && (value.settings === null ? value.revision === 0 : value.revision > 0 && validate(value.settings)) // 两个策略修订各自校验，不互相借用。
  try {
    if (!exact(candidate, ['version', 'harnessVersion', 'general', 'native', 'described'])
      || candidate.version !== 1 || candidate.harnessVersion !== '0.2.1-alpha.3'
      || typeof isNativePolicy !== 'function' || !remote?.settings?.describe
      || !envelope(candidate.general, isUiPolicy) || !envelope(candidate.native, isNativePolicy)
      || !exact(candidate.described, ['ok', 'value']) || candidate.described.ok !== true
      || !exact(candidate.described.value, ['namespaces', 'writable', 'hasDocument'])
      || !Array.isArray(candidate.described.value.namespaces)
      || typeof candidate.described.value.writable !== 'boolean' || candidate.described.value.hasDocument !== false
      || candidate.native.writable !== candidate.described.value.writable
      || candidate.general.writable && !candidate.described.value.writable)
      return null
    const rows = candidate.described.value.namespaces // 只处理此页当前角色已有的有限安全描述，不生成缺失 namespace。
    const seen = new Set() // 同一原始身份的重复描述不应形成含糊的启动 Schema。
    if (rows.some(row => !row || typeof row !== 'object' || !BOOTSTRAP_NAMESPACES.has(row.ns)
      || seen.has(row.ns) || !row.schema || !row.value || typeof row.value !== 'object'
      || !Number.isSafeInteger(row.revision) || row.revision < 0 || !Array.isArray(row.secrets) || row.secrets.length > 0
      || (seen.add(row.ns), false))) return null
    const general = generalMetadata(rows) // 复用运行时相同 alias 和安全字段投影，缺任何 General 描述都回退真实 GET。
    if (GENERAL_SETTINGS_NAMESPACES.some(ns => !general.some(row => row.ns === ns))) return null
    const serialized = JSON.stringify(candidate) // 先限制整包 UTF-8 大小，再复制，避免保留可被页面原地修改的引用。
    if (new TextEncoder().encode(serialized).byteLength > BOOTSTRAP_MAXIMUM_BYTES) return null
    const accepted = JSON.parse(serialized) // 只有通过当前版本完整校验的 JSON 副本可以被一次读取。
    let bootstrapValid = true // 首次真实连接代际到来后，未消费票据也立即失效，不能重放订阅前的HTML状态。
    const makeReader = (region, path) => {
      let policyConsumed = false // 每个 Adapter 的策略只消费一次，之后所有 GET/PUT 都走受权原入口。
      let descriptionConsumed = false // General 与 Native 独立消费同一有限描述，互不抢占首读。
      let completeDescription = false // 启动包没有 Provider 行，只有真正官方 HTTP 描述完成后才算管理员完整目录。
      let lastDescriptionWasLive = false // 成功传输还不等于完整描述已被Adapter校验采用，必须等待其确认回调。
      return {
        fetchImpl(url, request) {
          if (bootstrapValid && !policyConsumed && url === path && request?.method === 'GET') {
            policyConsumed = true
            return Promise.resolve({ ok: true, status: 200, json: async () => structuredClone(accepted[region]), headers: { get: () => null } })
          }
          return fetchImpl(url, request)
        },
        remote: {
          $on: (...args) => remote.$on?.(...args) ?? (() => {}), // 原官方事件订阅照常接线，不能把启动回答当成事件边界。
          settings: {
            async describe() {
              if (bootstrapValid && !descriptionConsumed) {
                descriptionConsumed = true
                lastDescriptionWasLive = false
                return structuredClone(accepted.described)
              }
              const described = await remote.settings.describe() // reset/失效/管理员目录均真正读取当前 Host。
              lastDescriptionWasLive = true
              return described
            },
          },
        },
        isDescriptionComplete: () => completeDescription || accepted.described.value.writable !== true, // 普通角色没有 Models 管理目录；管理员必须额外确认真实完整目录。
        onDescriptionAccepted: () => { if (lastDescriptionWasLive) completeDescription = true }, // 只有正式Adapter通过原本完整校验并采用后，才解除Models目录门禁。
      }
    }
    return {
      general: makeReader('general', POLICY_URL), // General独立票据，不能被Native抢占。
      native: makeReader('native', './adminsmart/native-policy'), // Native独立票据，后续真实请求保持原语义。
      expire: () => { bootstrapValid = false }, // 只撤销尚未消费票据，已接受数据仍由真实失效回读/CAS代际替换。
    }
  } catch {
    return null // 损坏或过大启动包不阻止原有有界网络恢复，也不采用部分内容。
  }
}

/**
 * 校验完整共享策略，不补入猜测默认值。
 * @param {unknown} settings 未信任的服务端或管理员策略。
 * @returns {boolean} 八字段、类型、范围与固定版枚举是否有效。
 */
export function isUiPolicy(settings) {
  return (
    settings !== null &&
    typeof settings === 'object' &&
    !Array.isArray(settings) &&
    Object.keys(settings).length === POLICY_FIELDS.length &&
    POLICY_FIELDS.every((field) => Object.hasOwn(settings, field)) &&
    (settings.locale === null ||
      (typeof settings.locale === 'string' &&
        /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(settings.locale))) &&
    ['light', 'dark', 'system'].includes(settings.theme) &&
    Number.isInteger(settings.fontSize) &&
    settings.fontSize >= 10 &&
    settings.fontSize <= 22 &&
    [null, 'compact', 'standard', 'detailed', 'verbose', 'normal', 'expanded'].includes(
      settings.transcriptView,
    ) &&
    ['compact', 'detailed'].includes(settings.performanceUsage) &&
    ['queue', 'steer'].includes(settings.busyEnter) &&
    ['sidebar', 'new-tab'].includes(settings.linkOpening) &&
    typeof settings.developerTools === 'boolean'
  )
}

/**
 * 读取官方 Theme Schema 的字体默认值与已解析安全值，补齐消费者必需的只读输入。
 * @param {object|undefined} metadata 当前官方 ui-theme 的脱敏描述，包含公开 schema 与已解析 value。
 * @returns {object} 固定五项字体字段的有效原生值；旧 Schema 未声明的字段不生成。
 * @throws {Error} 官方已声明字段缺少合法默认值；固定说明不包含原始元数据。
 * @sideEffects 无；不解码任意 Schema、不读取 Profile、不修改后端八字段契约或管理员写能力。
 */
function themeReadOnlyValues(metadata) {
  const schema = metadata?.schema // 官方 Config.toJSON() 的公开引用格式，来源与原生消费者使用的 Schema 相同。
  const fields = schema?.refs?.[schema.uid]?.dict // 只访问 ui-theme 根对象的字段声明，不递归或执行远端内容。
  const values = {} // 只容纳固定展示白名单，供应商或其它额外字段不会进入页面快照。
  for (const field of THEME_READ_ONLY_FIELDS) {
    const declaration = schema?.refs?.[fields?.[field]] // 当前字段公开 Schema 节点，用于类型、范围和官方默认值核对。
    if (!declaration) continue // 旧版或合成 Schema 不声明该字段时不猜测默认配置。
    const valid = (value) =>
      declaration.type === 'string'
        ? typeof value === 'string' && value.length <= 512 && !/[\u0000-\u001f\u007f<>\\]/u.test(value)
        : declaration.type === 'number' &&
          Number.isInteger(value) &&
          Number.isFinite(declaration.meta?.min) &&
          Number.isFinite(declaration.meta?.max) &&
          value >= declaration.meta.min &&
          value <= declaration.meta.max // 字体列表只接受有限安全文本，字号遵守当前官方字段范围。
    const fallback = declaration.meta?.default // 默认值来自本次固定发行版 Schema，禁止按旧版本猜测新默认值。
    if (!valid(fallback)) throw new Error('官方主题字体描述无效')
    const accepted = metadata?.value?.[field] // 官方已解析的安全字体值；不允许覆盖共享主题与内容字号。
    values[field] = valid(accepted) ? accepted : fallback
  }
  return values
}

/**
 * 把共享字段映射到官方表单；locale:null 不能进入原生 LocaleRuntime。
 * @param {string} namespace 固定 General 命名空间。
 * @param {object} settings 完整已校验策略。
 * @param {object|undefined} metadata 当前命名空间官方脱敏描述，只为主题补齐只读字体输入。
 * @returns {object} 当前命名空间的原生字段值。
 * @throws {Error} 官方已声明的只读字体字段默认值无效，不能以残缺快照激活 Theme。
 */
function nativeValues(namespace, settings, metadata) {
  const shared = Object.fromEntries(
    Object.entries(FIELD_MAPPING[namespace])
      .filter(([, field]) => field !== 'locale' || settings.locale !== null)
      .map(([nativeField, field]) => [nativeField, settings[field]]),
  ) // 八字段共享策略仍是既有偏好的唯一真源。
  return namespace === 'ui-theme' ? { ...themeReadOnlyValues(metadata), ...shared, preference: ['light', 'dark', 'system'].includes(metadata?.value?.preference) ? metadata.value.preference : 'light' } : shared // 主题取本人官方描述；缺省只使用明确批准的light。
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
  return (
    left === right || Boolean(left && right && POLICY_FIELDS.every((field) => left[field] === right[field]))
  )
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
    if (
      !Object.hasOwn(FIELD_MAPPING, namespace) ||
      (index.has(namespace) && row.ns !== OWNED_SETTINGS_NAMESPACE)
    )
      continue
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
  return GENERAL_SETTINGS_NAMESPACES.map((namespace) => index.get(namespace)).filter(Boolean)
}

/**
 * 安装受限 General façade；所有环境和角色使用同一接线。
 * @param {object} options 官方服务和可隔离的固定同源传输。
 * @param {object} options.configForms 同提供方 fiber 创建的原生 ConfigForms。
 * @param {object} options.remote 官方 Remote，读取脱敏 Schema 并订阅文档变化。
 * @param {Function} [options.fetchImpl] 固定同源 fetch；测试使用 Fake。
 * @param {number} [options.recoveryIntervalMs] 补偿回读间隔，测试以零禁用计时器。
 * @param {Function} [options.isDescriptionComplete] 管理员启动包不含模型目录，只有原始 describe 完成后才允许 Models 消费完整目录。
 * @param {Function} [options.onDescriptionAccepted] 完整描述经当前代际校验采用后回调，损坏或旧响应不得解除 Models 门禁。
 * @returns {object} ConfigForms、状态订阅、ready、refresh 与 dispose。
 * @sideEffects 仅读共享策略与官方脱敏描述；仅服务端确认的管理员能提交白名单 CAS。
 */
export function installUiPolicyClient({
  configForms,
  remote,
  fetchImpl = globalThis.fetch,
  recoveryIntervalMs = RECOVERY_INTERVAL_MS,
  isDescriptionComplete = () => true,
  onDescriptionAccepted = () => {},
} = {}) {
  if (!configForms?.get || !remote?.settings?.describe) throw new Error('共享设置官方能力未就绪')
  let disposed = false // 卸载后迟到响应不能重新发布或启动下一次请求。
  let policy = null // 最近确认的完整共享策略、修订和服务端写能力。
  let metadata = [] // 官方 describe 返回的五个 General Schema，不从 DOM 推断。
  let administratorMetadata = [] // 双方管理员能力确认后的官方Models描述；更高官方镜像修订可更新，旧回读不得降级。
  let connectionEpoch = 0 // 官方connection/reset边界；Host namespace修订不能跨进程比较。
  let descriptionConfirmed = false // 当前连接至少完成一次可信完整读取后才能编辑或复用模型描述。
  let previousConnectionMirror = null // reset时仍展示旧Host的镜像对象，换成新公开快照前禁止借它抬高新Host修订。
  let generation = 0 // 写入与新回读推进世代，丢弃较早 GET 响应。
  let externalEpoch = 0 // 采用其它修订或保存失败时撤销已排队草稿，自己的成功ACK不推进此边界。
  let inFlightWrite = null // 当前PUT的修订与完整草稿，用于识别HTTP回答之前到达的自有文档事件回声。
  let writeTail = Promise.resolve() // 所有 General 表单共用串行队列，避免跨命名空间丢更新。
  let refreshPending = null // 并发原生事件合并为同一读取。
  let refreshAgain = false // 当前读取期间到达的事件安排后续回读，保证不丢通知。
  let state = Object.freeze({
    // 保存错误与已持久化但推送延迟的反馈分别表示。
    status: 'loading', // 初次策略及Schema尚未完整采用。
    saving: false, // 当前串行队列是否正在提交请求。
    error: null, // 未保存、权限拒绝或并发冲突的稳定提示。
    notice: null, // 已提交但实时推送延迟或已被后续管理员覆盖的提示。
    revision: undefined, // 当前真正接受的共享CAS修订。
  })
  let directory = Object.freeze({
    // 兼容SettingsDescribeFace的稳定目录快照。
    status: 'loading', // 五个General Schema与策略的完整就绪状态。
    view: undefined, // 官方元数据和共享值组成的受限目录。
    error: null, // 无后端正文或路径的目录读取错误。
  })
  const stateListeners = new Set() // 保存状态与错误的公开订阅者。
  const directoryListeners = new Set() // 官方 namespace 目录的公开订阅者。
  const forms = new Map() // 同一 General namespace 只创建一个共享表单。
  const cleanups = [] // 原生事件、目录订阅与计时器的卸载动作。
  let personalState = Object.freeze({ status: 'loading', preference: 'light', revision: undefined, saving: false, error: null }) // 本人主题的独立确认状态，不借用全站CAS或管理员写权。
  let personalTail = Promise.resolve() // 本页快速切换按顺序保存，不重试已经失效的旧连接请求。
  const personalListeners = new Set() // 官方Theme和父应用仅消费这一非敏感本人偏好快照。

  /** @param {object} fields 本人主题确认、保存或错误字段。 @returns {void} 引用稳定且仅在真实状态变化时通知。 */
  const publishPersonal = fields => {
    const next = Object.freeze({ ...personalState, ...fields }) // 每次快照只含偏好、修订及固定状态，不包含身份或配置。
    if (sameValue(next, personalState)) return
    personalState = next
    for (const listener of personalListeners) listener()
  }

  /** @param {object} fields 保存状态变化。 @returns {void} 状态未变时保持引用稳定。 */
  const publishState = (fields) => {
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
    const ready =
      Boolean(policy?.settings) &&
      GENERAL_SETTINGS_NAMESPACES.every((namespace) => metadata.some((row) => row.ns === namespace)) // 策略和五项 Schema 都完整才开放表单。
    for (const [namespace, form] of forms) {
      const row = metadata.find((candidate) => candidate.ns === namespace) // 官方公开 namespace 元数据。
      const value = ready ? nativeValues(namespace, policy.settings, row) : undefined // 原生语言未指定时省略 preference，主题只读输入来自当前官方描述。
      form.publish(
        {
          status: ready ? 'ready' : state.error ? 'unavailable' : 'loading', // 策略与真实Schema的共同就绪状态。
          value, // 唯一共享策略已转换的原生字段。
          base: row?.base, // 官方返回的继承层，只读取而不猜测。
          user: value, // 共享策略构成当前接受的显式展示偏好。
          revision: policy?.revision, // 所有展示Namespace共用的CAS修订。
          writable: ready && descriptionConfirmed && (namespace === 'ui-theme' || policy.writable === true), // 普通用户只在主题scope具写入口，逐字段校验仍只允许本人preference。
          mode: 'host', // 值由受控Host持久化，不采用浏览器本地memory分支。
        },
        force,
      )
    }
    const native = configForms.describe().getSnapshot() // 未接管的 namespace 和文档能力仍由官方拥有。
    if (descriptionConfirmed && native !== previousConnectionMirror && policy?.writable === true && native.status === 'ready' && native.view?.writable === true) {
      const mirrored = administratorNativeMetadata(native.view.namespaces) // 官方公开镜像已确认的模型配置，仍执行相同脱敏投影。
      administratorMetadata = administratorMetadata.map(row => {
        const newer = mirrored.find(candidate => candidate.ns === row.ns) // 只跟随完整Remote已确认存在的namespace，旧镜像不能复活已移除目录。
        return newer && Number.isSafeInteger(newer.revision) && newer.revision > row.revision ? newer : row // 删除Provider等真实模型变更立即透传；相等或更旧修订不能覆盖最新直接描述。
      })
    }
    const rows = ready
      ? metadata.map((row) => ({
          ...row, // 原生Schema、applies、秘密字段标记及其它公开元数据保持官方定义。
          value: nativeValues(row.ns, policy.settings, row), // 当前 namespace 的共享偏好及官方 Theme 必需只读输入。
          user: nativeValues(row.ns, policy.settings, row), // 展示快照完整供官方消费者读取；写操作仍严格受 FIELD_MAPPING 限制。
          revision: policy.revision, // 下次编辑必须携带的共同修订。
        }))
      : [] // Schema保留官方，值与修订采用共享真源。
    const view = ready
      ? {
          ...native.view, // 非General目录的其它官方公开能力原样保留。
          namespaces: [...administratorMetadata, ...rows], // 普通用户只有 General；管理员原生供应商目录从真实官方 describe 保留，不伪造 loopback 能力。
          writable: descriptionConfirmed && policy.writable === true, // 共享编辑能力须由当前连接重新确认，旧Host状态只保留显示。
          hasDocument: native.view?.hasDocument === true, // 打开原生文档能力仍由官方服务决定。
        }
      : undefined
    const next = Object.freeze({
      status: ready ? 'ready' : state.error ? 'unavailable' : 'loading', // 完整目录的可用状态。
      view, // 公共官方元数据与共享值的统一目录。
      error: state.error, // 稳定安全提示，不包含后端正文。
    })
    if (!sameValue(directory, next)) {
      directory = next
      for (const listener of directoryListeners) listener()
    }
    publishState({
      status: ready ? 'ready' : state.error ? 'unavailable' : 'loading',
      revision: policy?.revision,
    })
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
      response = await fetchImpl(POLICY_URL, {
        method,
        credentials: 'same-origin',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      throw new Error('共享设置连接失败，请重试')
    }
    if (!response.ok) {
      const error = new Error(
        response.status === 409
          ? '设置已被其他管理员更新，请重新编辑'
          : response.status === 403
            ? '管理员权限不足'
            : '共享设置保存失败，请重试',
      ) // 不复述响应、身份或认证字段。
      error.conflict = response.status === 409 // 冲突后回读胜出值，不重发旧编辑。
      throw error
    }
    let accepted // JSON 解析失败只返回稳定提示，不复述响应正文。
    try {
      accepted = await response.json()
    } catch {
      throw new Error('共享设置响应无效')
    }
    if (
      !accepted ||
      typeof accepted !== 'object' ||
      !Number.isSafeInteger(accepted.revision) ||
      accepted.revision < 0 ||
      typeof accepted.writable !== 'boolean' ||
      (accepted.settings === null
        ? accepted.revision !== 0
        : accepted.revision < 1 || !isUiPolicy(accepted.settings))
    )
      throw new Error('共享设置响应无效')
    return {
      revision: accepted.revision, // 后端已提交或读取的唯一共享修订。
      settings: accepted.settings === null ? null : structuredClone(accepted.settings), // 完整白名单策略副本，不能由响应引用原地修改。
      writable: accepted.writable, // 服务端根据可信Runtime身份确认的管理员写能力。
      deliveryDelayed:
        method === 'PUT' && response.headers?.get?.('X-AdminSmart-UI-Policy-Delivery') === 'delayed', // commit已成功但跨Runtime通知暂未送达。
    }
  }

  /**
   * 合并文档变化回读；写入或卸载使较早响应失效。
   * @returns {Promise<void>} 当前与合并的最后一次读取完成。
   */
  const refresh = () => {
    if (disposed) return Promise.resolve()
    if (refreshPending) {
      refreshAgain = true
      return refreshPending
    }
    refreshPending = (async () => {
      do {
        refreshAgain = false
        const ticket = ++generation // 本轮策略和 Schema 采用的唯一时序。
        try {
          const [accepted, described] = await Promise.all([
            request('GET'),
            Promise.resolve()
              .then(() => remote.settings.describe())
              .catch(() => {
                throw new Error('官方设置描述暂不可用')
              }),
          ]) // 只公开安全错误，不暴露官方底层异常。
          if (disposed || ticket !== generation) continue
          const rows = described?.ok ? described.value?.namespaces : undefined // 官方 Remote 的 ok/value 回答，错误信封不能采用。
          if (!Array.isArray(rows)) throw new Error('官方设置描述暂不可用')
          const general = generalMetadata(rows) // 固定owned来源归canonical索引，历史行兼容且禁止重复或额外描述字段。
          if (
            GENERAL_SETTINGS_NAMESPACES.some(
              (namespace) =>
                !general.some(
                  (row) => row.ns === namespace && row.schema && row.value && typeof row.value === 'object',
                ),
            )
          )
            throw new Error('官方通用设置尚未就绪')
          if (policy && accepted.revision < policy.revision) continue // 旧GET不能撤回已确认PUT或更高修订的外部采用。
          const ownEcho =
            inFlightWrite &&
            accepted.revision === inFlightWrite.revision + 1 &&
            samePolicy(accepted.settings, inFlightWrite.settings) // Host可能在PUT回答前发送当前提交的原生事件，不能误撤销自有后续编辑。
          if (
            policy &&
            !ownEcho &&
            (accepted.revision !== policy.revision || !samePolicy(accepted.settings, policy.settings))
          )
            externalEpoch += 1 // 外部采用撤销旧草稿，JSON键顺序变化不算编辑。
          const theme = general.find(row => row.ns === 'ui-theme') // 当前用户官方主题描述，绝不从General.theme读取颜色。
          const previousTheme = metadata.find(row => row.ns === 'ui-theme') // 在途旧描述不能回退已确认个人保存；Host重连时旧修订先撤销。
          if (theme && previousTheme && personalState.revision !== undefined && (personalState.saving || personalState.revision > theme.revision)) {
            theme.value = { ...theme.value, preference: previousTheme.value.preference }
            theme.revision = Math.max(theme.revision, personalState.revision)
          }
          metadata = general
          if (theme && !personalState.saving) publishPersonal({ status: 'ready', preference: nativeValues('ui-theme', accepted.settings ?? {}, theme).preference, revision: theme.revision, error: null })
          administratorMetadata =
            accepted.writable === true && described.value.writable === true
              ? administratorNativeMetadata(rows).map(row => {
                  const newer = administratorMetadata.find(candidate => candidate.ns === row.ns) // 直接GET在途期间，官方镜像可能已接受更高模型修订。
                  return newer && Number.isSafeInteger(newer.revision) && newer.revision > row.revision ? newer : row // 仅同namespace按官方修订防降级；完整Remote缺失的namespace仍撤回。
                })
              : [] // 任一能力缺失或普通用户都不能得到供应商描述。
          policy = accepted
          descriptionConfirmed = true // 当前连接的描述通过权限与Schema校验后才能再次采用镜像和开放写入。
          onDescriptionAccepted() // 在Schema/角色/代际校验成功且完整目录采用后才声明管理员Models可消费。
          publishState({ error: null })
          publish()
        } catch (error) {
          if (disposed || ticket !== generation) continue
          publishState({ error: error?.message ?? '共享设置暂不可用' })
          publish()
        }
      } while (refreshAgain && !disposed)
    })().finally(() => {
      refreshPending = null
    })
    return refreshPending
  }

  /**
   * 接受官方连接代际切换，撤销旧Host的namespace CAS及在途草稿后重新读取。
   * @returns {Promise<void>} 新代际读取完成；旧请求可结算，但不能发布到当前连接。
   * @sideEffects 只撤销页面内旧读写授权并读取当前Host；不重试PUT、不清除持久化设置。
   */
  const reset = () => {
    if (disposed) return Promise.resolve()
    connectionEpoch += 1
    generation += 1
    externalEpoch += 1
    descriptionConfirmed = false
    previousConnectionMirror = configForms.describe().getSnapshot() // 官方mirror可能稍后才处理同一reset，不能把旧8与新Host的0比较。
    administratorMetadata = [] // Host-local修订随连接失效；持久化General策略及显示值继续保留。
    inFlightWrite = null // 旧连接ACK不再被新GET当作自己的提交回声。
    publishPersonal({ status: 'loading', revision: undefined, saving: false, error: null }) // 本人偏好与Host修订同样按真实连接重新确认。
    publishState({ saving: false, error: null, notice: null })
    publish(true)
    return refresh()
  }

  /**
   * 串行提交一次 namespace 原子操作，字段映射和 CAS 在执行时计算。
   * @param {string} namespace 五个固定 General 之一。
   * @param {Array<object>} operations 官方 set/unset 单字段路径。
   * @param {number} [expectedRevision] 调用方明确捕获的旧修订。
   * @returns {Promise<boolean>} 接受为 true，拒绝或冲突恢复为 false；连接错误拒绝 Promise。
   */
  const mutate = (namespace, operations, expectedRevision) => {
    if (namespace === 'ui-theme' && Array.isArray(operations) && operations.length === 1 && operations[0]?.op === 'set' && operations[0]?.path?.length === 1 && operations[0].path[0] === 'preference') return mutatePersonal(operations[0].value) // 唯一普通用户写例外，混合字段不能借此放行。
    const copied = structuredClone(operations) // 排队后外部修改操作不能改变将要提交的草稿。
    const queuedEpoch = externalEpoch // 草稿入队时的外部采用边界；允许自己的ACK链推进修订，禁止跨外部采用重放。
    const queuedConnection = connectionEpoch // 连接切换前排队或发送的草稿，不能在新Host状态上继续执行。
    const operation = writeTail.then(async () => {
      if (disposed || queuedConnection !== connectionEpoch || !descriptionConfirmed || policy?.writable !== true || !policy?.settings) return false
      if (queuedEpoch !== externalEpoch) {
        publishState({ error: '设置已被其他管理员更新，请重新编辑' })
        publish(true)
        return false
      }
      if (expectedRevision !== undefined && expectedRevision !== policy.revision) {
        await refresh()
        publish(true)
        return false
      }
      const settings = { ...policy.settings } // 保留上次成功 PUT 确认的其它命名空间字段。
      for (const op of copied) {
        const field = op.path?.length === 1 ? FIELD_MAPPING[namespace][op.path[0]] : undefined // 白名单之外或嵌套路径不能越过受限策略。
        if (!field || !['set', 'unset'].includes(op.op)) return false
        if (op.op === 'unset' || (field === 'locale' && op.value === undefined)) {
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
        if (disposed || queuedConnection !== connectionEpoch) return false // 旧连接可能已经落库，是否生效只由新GET确认；迟到ACK不能修改新页面状态。
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
        if (disposed || queuedConnection !== connectionEpoch) return false // 旧连接错误不撤销新代际草稿或覆盖其反馈。
        externalEpoch += 1 // 冲突或结果不明时撤销此前排队草稿，不能重放到回读后的新CAS上。
        if (!disposed) {
          await refresh()
          publishState({ error: error.message })
          publish(true)
        }
        if (error.conflict) return false
        throw error
      } finally {
        if (queuedConnection === connectionEpoch) {
          inFlightWrite = null // 后续GET不能再借用已经结算的同连接提交身份。
          if (!disposed) publishState({ saving: false })
        }
      }
    })
    writeTail = operation.then(
      () => {},
      () => {},
    ) // 保存失败不能永久阻塞后续编辑。
    return operation
  }

  /**
   * 串行保存当前账号的官方明暗字段，失败保留已确认状态并撤回官方乐观颜色。
   * @param {unknown} mode 请求的内置light/dark；system仅保留存量读取，不从宿主新建。
   * @returns {Promise<boolean>} 服务端确实保存为true，无权/旧连接为false；传输失败返回固定错误。
   * @sideEffects 只访问个人HTTP入口，绝不提交General或Native共享策略。
   */
  const mutatePersonal = mode => {
    if (disposed || !descriptionConfirmed || !['light', 'dark'].includes(mode)) return Promise.resolve(false)
    const epoch = connectionEpoch // 快速切换可以排队，同一保存不能跨Host重连重放。
    publishPersonal({ saving: true, error: null })
    const operation = personalTail.then(async () => {
      if (disposed || epoch !== connectionEpoch || !descriptionConfirmed) return false
      try {
        const response = await fetchImpl(PERSONAL_THEME_URL, { method: 'PUT', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }) // 只有枚举，没有用户ID、字体、模型或全站修订。
        if (!response.ok) throw new Error('个人主题保存失败，请重试')
        const accepted = await response.json() // 只采用本人官方持久化回执，不读取错误正文。
        if (!accepted || Object.keys(accepted).sort().join() !== 'preference,revision' || accepted.preference !== mode || !Number.isSafeInteger(accepted.revision) || accepted.revision < 0) throw new Error('个人主题保存失败，请重试')
        if (disposed || epoch !== connectionEpoch) return false
        const row = metadata.find(candidate => candidate.ns === 'ui-theme') // 与官方ConfigForms共用本人描述，不生成平行主题或改DOM。
        if (!row) throw new Error('个人主题保存失败，请重试')
        row.value = { ...row.value, preference: accepted.preference }
        row.revision = accepted.revision
        publishPersonal({ status: 'ready', preference: accepted.preference, revision: accepted.revision, error: null })
        publish()
        return true
      } catch {
        if (!disposed && epoch === connectionEpoch) {
          publishPersonal({ status: 'error', error: '个人主题保存失败，请重试' })
          publish(true)
        }
        return false
      } finally {
        if (!disposed && epoch === connectionEpoch) publishPersonal({ saving: false })
      }
    })
    personalTail = operation.then(() => {}, () => {}) // 单笔失败不永久阻塞后续本人选择。
    return operation
  }

  const describe = {
    getSnapshot: () => directory, // 官方目录订阅需要稳定快照。
    subscribe(listener) {
      directoryListeners.add(listener)
      return () => directoryListeners.delete(listener)
    },
    async ensure() {
      if (directory.status === 'loading' || directory.status === 'unavailable' || !descriptionConfirmed || !isDescriptionComplete()) await refresh()
      if (!descriptionConfirmed) throw new Error('官方设置连接尚未确认') // 新Host读取失败不能复用旧连接的模型CAS。
      if (!isDescriptionComplete()) throw new Error('官方模型设置描述尚未确认') // 失败时不能把只含 General 的启动包冒充完整空供应商目录。
      await configForms.describe().ensure?.() // Models首次打开或官方镜像失效时等待原生读取，保留官方并发与错误语义。
      publish() // 下层读取结算后再投影最新原生模型修订，不自动重试任何CAS写入。
    },
    acceptView(view) {
      if (!Object.hasOwn(FIELD_MAPPING, view.ns)) configForms.describe().acceptView(view)
      void refresh()
    }, // 原生供应商写后也回读官方 describe；公网 memory mirror 不能成为模型页持久化真源。
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
          subscribe(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
          set: (field, value) => mutate(namespace, [{ op: 'set', path: [field], value }]),
          unset: (field) => mutate(namespace, [{ op: 'unset', path: [field] }]),
          mutate: (ops, revision) => mutate(namespace, ops, revision),
          publish(next, force) {
            const changed = !sameValue(snapshot, next)
            if (changed) snapshot = Object.freeze(next)
            if (changed || force) for (const listener of listeners) listener()
          },
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
        const served = new Set(directory.view?.namespaces.map((row) => row.ns) ?? []) // General 和未知官方命名空间共享一个可观察目录。
        if (namespaces.some((namespace) => served.has(namespace))) {
          if (!release) release = register(served)
        } else if (release) {
          release()
          release = undefined
        }
      }
      const off = describe.subscribe(sync) // 采用或丢失 namespace 时更新注册生命周期。
      void describe.ensure()
      sync()
      return () => {
        off()
        release?.()
        release = undefined
      }
    },
    developerTools: {
      enabled: {
        getSnapshot: () => facade.get('ui-settings').getSnapshot().value?.enabled ?? false, // 初始未知时关闭代码视图。
        subscribe(listener) {
          let previous = facade.developerTools.enabled.getSnapshot() // boolean 订阅只在接受值实际变化时发布。
          return facade.get('ui-settings').subscribe(() => {
            const next = facade.developerTools.enabled.getSnapshot()
            if (next !== previous) {
              previous = next
              listener()
            }
          })
        },
      },
      async setEnabled(enabled) {
        if (!(await facade.get('ui-settings').set('enabled', enabled)))
          throw new Error('代码工作视图设置未保存')
      },
    },
  }
  cleanups.push(configForms.describe().subscribe(() => publish())) // 未接管 namespace 的官方目录变化继续投影。
  if (remote.$on)
    cleanups.push(
      remote.$on('settings/document-updated', () => {
        void refresh()
      }),
    ) // Host 采用共享策略后立即通过原生事件更新。
  if (recoveryIntervalMs > 0) {
    const timer = setInterval(() => {
      void refresh()
    }, recoveryIntervalMs) // 重连事件缺失时的有界补偿，不依赖设置弹窗。
    timer.unref?.()
    cleanups.push(() => clearInterval(timer))
  }
  const ready = refresh() // 初次读取失败以明确 unavailable 结束，不形成启动死锁。
  return {
    configForms: facade,
    /** @returns {object|null} 当前已验证的八字段共享快照，供双CAS事务使用；不公开其它Profile。 */
    getPolicySnapshot: () =>
      policy && {
        revision: policy.revision,
        settings: policy.settings === null ? null : structuredClone(policy.settings),
        writable: policy.writable,
      },
    /**
     * 采用独立native接口同一数据库事务的General回执，仍执行原八字段验证。
     * @param {object} accepted 已提交revision/settings及原可信写能力。
     * @returns {boolean} 是否采用；较旧回执不能覆盖已胜出的值。
     */
    acceptPolicySnapshot(accepted) {
      if (
        !accepted ||
        !Number.isSafeInteger(accepted.revision) ||
        accepted.revision < 1 ||
        typeof accepted.writable !== 'boolean' ||
        !isUiPolicy(accepted.settings)
      )
        throw new Error('共享设置响应无效')
      if (policy && accepted.revision < policy.revision) return false
      generation += 1
      policy = {
        revision: accepted.revision,
        settings: structuredClone(accepted.settings),
        writable: accepted.writable,
      }
      publishState({ error: null })
      publish()
      return true
    },
    ready,
    refresh,
    reset, // 仅由官方connection/reset接线调用，普通失效继续使用同代际refresh。
    getSnapshot: () => state,
    subscribe(listener) {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
    getError: () => state.error,
    personalTheme: {
      getSnapshot: () => personalState, // 父页面只消费本人状态，不拿到General写能力。
      subscribe(listener) { personalListeners.add(listener); return () => personalListeners.delete(listener) }, // 随当前Runtime生命周期释放。
    },
    dispose() {
      disposed = true
      generation += 1
      for (const cleanup of cleanups.reverse()) cleanup?.()
      for (const form of forms.values()) form.publish({ ...form.getSnapshot(), writable: false }, true)
      stateListeners.clear()
      directoryListeners.clear()
      personalListeners.clear()
    },
  }
}
