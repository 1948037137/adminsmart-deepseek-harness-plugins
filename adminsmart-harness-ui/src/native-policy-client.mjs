/** 受管原生设置的纯浏览器桥；官方组件、Schema 与公开 Slot 保持原始所有者。 */
export const NATIVE_POLICY_VERSION = '0.2.1-alpha.3' // 仅接受当前受管固定版的非敏感策略。
export const NATIVE_POLICY_READ_VERSIONS = Object.freeze(['0.2.1-alpha.2', NATIVE_POLICY_VERSION]) // 仅已逐字段核验的历史版本可读，不静默改写历史版本标记。
export const NATIVE_POLICY_FIELDS = Object.freeze({
  'ui-theme': Object.freeze([
    'codeFontSize',
    'terminalFontSize',
    'textFontFamily',
    'codeFontFamily',
    'terminalFontFamily',
  ]), // 旧八字段之外的原生字体字段。
  subagent: Object.freeze(['maxDepth', 'maxActiveSubagents']), // 已批准的单层子代理与并发边界。
  'agent-loop': Object.freeze(['maxParallelToolCalls']), // 原始官方并行字段，模板2是继承默认而不是额外自造上限。
  'ui-settings-general': Object.freeze(['welcomeNoticeVersion']), // 官方欢迎确认版本，不保存账号或凭据入门状态。
})
export const NATIVE_POLICY_PLUGINS = Object.freeze([
  'ui-skill',
  'ui-message-feedback',
  'ui-trajectory',
]) // 历史三项的兼容导出；可管理范围由当前官方SDK库存及稳定身份校验决定，不再用它限制管理员。
export const NATIVE_PLUGIN_MAXIMUM_ITEMS = 256 // 全站插件行覆盖有界，防止异常正文形成无上限执行队列。
export const NATIVE_BUNDLE_MAXIMUM_ITEMS = 64 // 已安装官方组合的启停覆盖有界，不接受安装规格或依赖内容。

/** @param {unknown} value 官方稳定patchId候选。 @returns {boolean} 是否为有限部署行身份；Host仍须以当前官方库存复核模块与原生只读约束。 */
export function isNativePluginId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
}

/** @param {unknown} value 官方包名候选。 @returns {boolean} 是否为受管官方命名空间；不接受版本、URL、目录、非官方包或安装指令。 */
export function isOfficialBundleName(value) {
  return typeof value === 'string' && /^@deepseek-ai\/dsh-[a-z0-9][a-z0-9-]{0,119}$/u.test(value)
}

/**
 * 校验启停映射而不执行访问器，JSON键仅作为稳定身份，不是文件路径。
 * @param {unknown} value 未信任的覆盖映射。
 * @param {Function} validateKey 固定身份校验器。
 * @param {number} maximumItems 当前region条目预算。
 * @returns {boolean} 全部自有可枚举字段为布尔值；符号和getter均拒绝。
 */
export function isNativeEnablementMap(value, validateKey, maximumItems) {
  if (!record(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
  const descriptors = Object.getOwnPropertyDescriptors(value) // 只读取属性描述符，不能为校验触发页面或内部getter。
  const keys = Reflect.ownKeys(descriptors) // 符号字段也参与拒绝，不能在JSON序列化时偷偷丢弃。
  return keys.length <= maximumItems && keys.every(key => typeof key === 'string' && validateKey(key)
    && Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable === true && typeof descriptors[key].value === 'boolean')
}
const LEGACY_THEME_FIELDS = Object.freeze({
  fontSize: 'fontSize', // 原始正文大小继续使用旧 General 的独立 CAS 真源。
}) // 混合主题编辑交由后端同一事务保存两个 region。
const LEGACY_CHAT_FIELDS = Object.freeze({
  transcriptView: [null, 'compact', 'standard', 'detailed', 'verbose', 'normal', 'expanded'], // 工作步骤展示沿用旧General的全部兼容枚举。
  performanceUsage: ['compact', 'detailed'], // 用量显示仅接受官方已批准的两种粒度。
  linkOpening: ['sidebar', 'new-tab'], // 链接目标仍属于旧General独立真源。
}) // collapseTiming只投影到官方ui-chat表单，持久化仍属于Native.clientPreferences。
const REQUEST_TIMEOUT_MS = 5_000 // 代码桥单次传输预算，不等待无限后台回答。
const INDEPENDENT_SETTINGS_NAMESPACES = new Set([
  'locale',
  'ui-chat',
  'ui-conversation',
  'ui-settings',
  'adminsmart-shared-settings',
  'llm-pi-ai',
  'adminsmart-managed-llm',
]) // 已有General/模型提供方自行维护这些namespace，不能让Native重复全目录回读。

/**
 * 在一个总预算内完成传输和正文解析，卸载取消即使下层Fake不响应signal也会及时结算。
 * @param {(signal: AbortSignal) => Promise<unknown>} operation 接收受管取消信号的完整请求。
 * @param {object} options 请求预算与生命周期。
 * @param {AbortSignal} [options.signal] 当前Controller卸载信号。
 * @param {number} [options.timeoutMs=5000] 生产不超过五秒；目标测试可缩短。
 * @returns {Promise<unknown>} 完整结果，超时或卸载不采用迟到值。
 * @throws {Error} 预算不合法、超时、卸载取消或完整请求操作失败。
 * @sideEffects 为当前请求创建计时器和 AbortSignal，结算后统一释放监听器。
 */
export async function withNativeRequest(
  operation,
  { signal, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > REQUEST_TIMEOUT_MS
  )
    throw new Error('原生设置请求预算无效')
  const controller = new AbortController() // 每个请求独立，不取消其它用户或通道。
  const cancel = () => controller.abort() // 只传取消事实，不传播下层敏感原因。
  const aborted = new Promise((_, reject) =>
    controller.signal.addEventListener(
      'abort',
      () => reject(new Error('原生设置请求超时或已停止')),
      {
        once: true,
      },
    ),
  ) // 与完整连接/正文共同竞争，不能只给fetch设置timeout。
  const timer = setTimeout(cancel, timeoutMs) // 请求开始即计时，不在JSON解析阶段重置预算。
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('原生设置请求已停止')
        return operation(controller.signal)
      }),
      aborted,
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}

/**
 * 检查 JSON 记录形状；精确字段准入由调用方白名单完成。
 * @param {unknown} value 外部 JSON 候选。
 * @returns {boolean} 是否为非 null、非数组对象，不执行对象内容。
 */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 为已批准的 JSON 创建键顺序无关的比较身份。
 * @param {unknown} value 受限非敏感策略，不接受可执行模板。
 * @returns {string} 稳定序列化身份；保持数组顺序语义，无外部副作用。
 */
function jsonIdentity(value) {
  const normalize = (input) =>
    Array.isArray(input)
      ? input.map(normalize)
      : record(input)
        ? Object.fromEntries(
            Object.keys(input)
              .sort()
              .map((key) => [key, normalize(input[key])]),
          )
        : input // 只有有限策略 JSON，不执行输入。
  return JSON.stringify(normalize(value))
}

/**
 * 检查客户端策略边界，服务端仍以可信角色和官方固定 Schema 最终准入。
 * @param {string} namespace 已批准命名空间。
 * @param {string} field 该命名空间的精确字段。
 * @param {unknown} value 未信任的字段值。
 * @returns {boolean} 是否为当前公开协议允许的非敏感值。
 */
export function isNativePolicyField(namespace, field, value) {
  if (
    !Object.hasOwn(NATIVE_POLICY_FIELDS, namespace) ||
    !NATIVE_POLICY_FIELDS[namespace].includes(field)
  )
    return false
  if (namespace === 'ui-theme') {
    if (field === 'codeFontSize')
      return Number.isInteger(value) && value >= 10 && value <= 16
    if (field === 'terminalFontSize')
      return Number.isInteger(value) && value >= 10 && value <= 20
    return (
      typeof value === 'string' &&
      value.length <= 512 &&
      !/[\u0000-\u001f\u007f<>\\]/u.test(value)
    )
  }
  if (namespace === 'subagent')
    return (
      Number.isSafeInteger(value) &&
      (field === 'maxDepth' ? value >= 0 && value <= 1 : value >= 1)
    )
  if (namespace === 'agent-loop')
    return Number.isSafeInteger(value) && value >= 1
  return typeof value === 'string' && value.length <= 64
}

/**
 * 检查完整原生策略，不对缺失字段补入当前用户值。
 * @param {unknown} value 未信任的完整策略。
 * @returns {boolean} 是否精确匹配固定版本、批准命名空间、插件和偏好。
 */
export function isNativePolicy(value) {
  if (
    !record(value) ||
    !NATIVE_POLICY_READ_VERSIONS.includes(value.harnessVersion) ||
    Object.keys(value).some(
      (key) =>
        ![
          'harnessVersion',
          'namespaces',
          'plugins',
          'bundles',
          'clientPreferences',
        ].includes(key),
    )
  )
    return false
  if (
    !record(value.namespaces) ||
    !isNativeEnablementMap(value.plugins, isNativePluginId, NATIVE_PLUGIN_MAXIMUM_ITEMS) ||
    (value.bundles !== undefined && !isNativeEnablementMap(value.bundles, isOfficialBundleName, NATIVE_BUNDLE_MAXIMUM_ITEMS)) ||
    (value.clientPreferences !== undefined && !record(value.clientPreferences))
  )
    return false
  if (
    Object.entries(value.namespaces).some(
      ([ns, patch]) =>
        !Object.hasOwn(NATIVE_POLICY_FIELDS, ns) ||
        !record(patch) ||
        Object.entries(patch).some(
          ([field, input]) => !isNativePolicyField(ns, field, input),
        ),
    )
  )
    return false
  return Object.entries(value.clientPreferences ?? {}).every(
    ([field, input]) =>
      field === 'collapseTiming' &&
      ['completion', 'next-input'].includes(input),
  )
}

/**
 * 创建尚未持久化的策略编辑副本。
 * @returns {object} 无显式覆盖的继承策略，不播种当前 Runtime 私人值或默认值。
 */
export function emptyNativePolicy() {
  return {
    harnessVersion: NATIVE_POLICY_VERSION, // 明确属于当前受管版本，避免跨版套用字段。
    namespaces: {}, // 空 region 表示从可信模板或官方配置继承。
    plugins: {}, // 未明确保存时不改变已装插件的原始启用状态。
    bundles: {}, // 未明确保存时继承已批准Profile选择，不自动启用实验组合或安装新软件包。
    clientPreferences: {}, // 不从本页面内存偏好播种全站政策。
  }
}

/**
 * 用标准 ConfigForms 接口持久化批准的原生字段，不渲染或覆盖官方 UI。
 * @param {object} options 当前受管页面的公共服务。
 * @param {object} options.general 既有八字段 Controller，提供 configForms/getPolicySnapshot/acceptPolicySnapshot/subscribe。
 * @param {object} options.remote 官方 Remote，describe 始终由 Host 脱敏。
 * @param {object} [options.ctx] 公开 Slot/Cordis Context，用于官方 collapseTiming 接线。
 * @param {Function} [options.fetchImpl] 隔离 Fake 或固定同源 fetch。
 * @param {object} [options.nativeBaseline] Host 注入的冻结模板继承值，不能读取 tenant 私有覆盖。
 * @param {Function|null} [options.eventSourceFactory] 当前 Runtime 同源失效流；测试可以省略网络流。
 * @param {number} [options.requestTimeoutMs=5000] 单次连接和正文共同预算，目标测试可缩短。
 * @returns {object} 稳定 ConfigForms、独立策略快照、刷新和清理能力。
 * @throws {Error} 公开 General/Remote 能力或受管继承基线无效。
 * @sideEffects 初始 GET、官方 describe 与变化回读；管理员 PUT 使用后端 CAS，普通用户从不保存。
 */
export function installNativePolicyClient({
  general,
  remote,
  ctx,
  fetchImpl = globalThis.fetch,
  nativeBaseline = globalThis.window?.__ADMINSMART_NATIVE_POLICY_BASELINE__ ??
    {},
  eventSourceFactory = typeof globalThis.EventSource === 'function'
    ? (url) => new globalThis.EventSource(url)
    : null,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
}) {
  if (
    !general?.configForms ||
    !general.getPolicySnapshot ||
    !general.acceptPolicySnapshot ||
    !remote?.settings?.describe
  )
    throw new Error('原生共享设置能力未就绪')
  if (
    !record(nativeBaseline) ||
    Object.entries(nativeBaseline).some(
      ([ns, patch]) =>
        !record(patch) ||
        Object.entries(patch).some(
          ([field, value]) => !isNativePolicyField(ns, field, value),
        ),
    )
  )
    throw new Error('原生共享继承基线无效')
  let disposed = false // 卸载使迟到读写失去发布权。
  let accepted = null // 唯一后端确认的 native revision/settings/writable。
  let metadata = [] // 官方 describe 的受限 namespace 元数据，不保存完整管理员 Profile。
  let describedWritable = false // 与后端角色同时确认后才开放原生设置写入。
  let generation = 0 // 写入和卸载会使旧 GET 失效。
  let connectionEpoch = 0 // 官方连接代际；旧GET/PUT及Host局部namespace修订不能跨重连采用。
  let externalEpoch = 0 // 他人提交撤销旧排队草稿，自己的 ACK 不撤销后续编辑。
  let inFlightWrite = null // 识别 PUT 响应之前经 SSE 到达的自有 native/General 提交回声。
  let observedGeneral = general.getPolicySnapshot() // 旧 General 的独立修订，不能混用 native CAS。
  let writeTail = Promise.resolve() // 两个 CAS 真源的混合操作按当前页面顺序提交。
  let refreshPending = null // 官方事件合并回读，不制造并行读取风暴。
  let refreshAgain = false // 手动、重连、恢复或官方描述失效仍要求下一轮真正回读。
  let wantedRevision = null // SSE只合并最高尚未被当前响应覆盖的独立政策修订，不把相同启动回声排成第二轮。
  let followedRevision = null // 每个更高失效修订最多自动补读一次，异常旧响应不能造成无限紧循环。
  const wantedNamespaceRevisions = new Map() // 官方白名单四namespace各自待见的raw配置修订，绝不能与Native政策CAS混用。
  const followedNamespaceRevisions = new Map() // 每个namespace的同一更高修订只自动补读一次，缺失描述不形成无限重试。
  let state = Object.freeze({
    status: 'loading', // 独立 Native 确认状态，404 使用 unsupported 而非伪 revision0。
    saving: false, // 当前页面有顺序提交尚未结算，供官方状态反馈使用。
    error: null, // 可展示的稳定业务错误，不携带响应正文。
    notice: null, // 保存成功后尚未分发的友好提示，不重发已提交写入。
    collapseAvailable: false, // 真正取得原始官方消费者后才声明折叠偏好可以采用。
  }) // 只显示稳定业务状态，不携带凭据或响应正文。
  let retryTimer = null // API 先后发布时只保留一个短期补偿任务。
  let retryAttempt = 0 // 1/2/4 秒三次短补偿后转低频回读或连接重置。
  const listeners = new Set() // 策略反馈的公开订阅者。
  const forms = new Map() // 各 namespace 的稳定表单与本地复合 CAS 版本。
  const cleanups = [] // 当前页面拥有的订阅和公开 Slot 释放函数。
  const lifecycle = new AbortController() // 同一Controller卸载时释放所有在途GET/PUT与迟到正文。
  let directory = Object.freeze({
    status: 'loading', // 官方 namespace 消费者使用的目录确认状态。
    view: undefined, // 仅在确认后投影公开白名单元数据。
  }) // 原生目录的稳定快照。
  const directoryListeners = new Set() // 原始官方 whileServed 的消费者。
  let collapseFace = null // 仅确认原始transcript-view公开消费者存在；采用由其Host表单订阅负责。

  /**
   * 发布页面反馈而不暴露策略内部引用。
   * @param {object} patch 安全状态变化。
   * @returns {void} 仅实际变化时替换快照并通知公开消费者。
   */
  const feedback = (patch) => {
    const next = Object.freeze({ ...state, ...patch }) // 稳定状态值，订阅者不接触策略内部引用。
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const listener of listeners) listener()
  }
  /**
   * 取得已投影的精确命名空间。
   * @param {string} ns 白名单 namespace。
   * @returns {object|undefined} 官方元数据；未装载时不伪造配置页面。
   */
  const rowFor = (ns) => metadata.find((row) => row.ns === ns)
  /**
   * 按官方值、冻结基线和已确认覆盖组合当前表单值。
   * @param {string} ns 已批准 namespace。
   * @returns {object} 可供官方表单显示的值；Theme 保留旧 General 独立真源。
   */
  const valuesFor = (ns) => {
    const row = rowFor(ns) // 当前官方 Schema 负责原生继承值。
    const inherited = Object.fromEntries(
      NATIVE_POLICY_FIELDS[ns]
        .filter((field) => Object.hasOwn(row?.value ?? {}, field))
        .map((field) => [field, row.value[field]]),
    ) // 只展示官方实际值；省略后的继承由受管 Host 从可信 baseline 应用，不在页面猜测配置层。
    const native = {
      ...inherited,
      ...(nativeBaseline[ns] ?? {}),
      ...(accepted?.settings?.namespaces?.[ns] ?? {}),
    } // 业务共享继承基线明确来自Host，禁止冒称上游默认或以模型名称推断。
    return ns === 'ui-theme'
      ? {
          ...(general.configForms.get(ns).getSnapshot().value ?? {}),
          ...native,
        }
      : native
  }
  /**
   * 向真实 ConfigForms 消费者发布组合值和受限描述目录。
   * @param {boolean} [force=false] 拒绝或冲突后强制撤回官方乐观草稿。
   * @returns {void} 404 下保留 General 基线；确认后采用原生 region。
   * @sideEffects 更新本地表单修订并通知消费者；官方自行采用Host快照，绝不调用具有写入副作用的setter。
   */
  const publish = (force = false) => {
    const original = general.configForms.describe().getSnapshot() // 旧八字段和 Models 原生目录继续保留所有者。
    const available = accepted !== null && original.status === 'ready' // 策略和旧官方依赖都确认后才提供组合表单。
    const baseline = accepted === null && original.status === 'ready' // API 临时不支持时保持官方基线，不生成伪 native 政策。
    const writable =
      available &&
      accepted.writable === true &&
      describedWritable &&
      general.getPolicySnapshot()?.writable === true // 三个可信读能力不能只凭页面 role 放开。
    for (const [ns, form] of forms) {
      if (ns === 'ui-chat') {
        const originalChat = general.configForms.get(ns).getSnapshot() // 三个旧字段仍由原General表单提供已确认值。
        const explicitTiming = accepted?.settings?.clientPreferences?.collapseTiming // 仅存在明确覆盖时标记官方overridden状态。
        form.publish({
          ...originalChat,
          revision: undefined, // 统一使用当前复合表单本地整数修订，不能把两个后端CAS混用。
          value: originalChat.value === undefined ? undefined : {
            ...originalChat.value,
            collapseTiming: explicitTiming ?? 'completion', // 固定发行包的继承语义，删除覆盖回到completion。
          },
          base: { ...originalChat.base, collapseTiming: 'completion' }, // Native清除覆盖时使用已核验的官方默认。
          user: { ...originalChat.user, ...(explicitTiming === undefined ? {} : { collapseTiming: explicitTiming }) }, // 保留旧General用户覆盖且不把默认播种进Native。
          writable: Boolean(writable && originalChat.writable), // 管理写须同时取得General、Native及官方描述许可。
        }, force)
        continue
      }
      const row = rowFor(ns) // 官方已装且已描述的 namespace。
      const next =
        baseline && ns === 'ui-theme'
          ? {
              ...general.configForms.get(ns).getSnapshot(),
              revision: undefined,
            }
          : {
              status:
                available && row
                  ? 'ready'
                  : state.error
                    ? 'unavailable'
                    : 'loading', // 原生政策与官方 namespace 均确认才可用。
              value: available && row ? valuesFor(ns) : undefined, // 受限组合值，不复制未知配置或模型连接。
              base: { ...row?.base, ...(nativeBaseline[ns] ?? {}) }, // 清除覆盖时恢复可信模板继承。
              user: accepted?.settings?.namespaces?.[ns] ?? {}, // 仅管理员明确持久化的全局覆盖，供官方 overridden 状态使用。
              writable: Boolean(writable && row || ns === 'ui-theme' && row && general.configForms.get(ns).getSnapshot().writable), // 本人主题写例外不放开字体；实际mutate仍逐字段授权。
              mode: 'host', // 保留官方远端表单语义，不伪装浏览器本地配置。
            } // 临时旧 API 下 Theme 同一实例继续呈现原来的官方八字段基线。
      form.publish(next, force)
    }
    const rows = available
      ? metadata.map((row) => ({
          ...row,
          value: valuesFor(row.ns), // 相同 namespace 的公开目录和 form 显示相同组合值。
          user: accepted.settings?.namespaces?.[row.ns] ?? {}, // 原始 UI 用于判断当前是否存在明确覆盖。
          revision: facade.get(row.ns).getSnapshot().revision, // 页面复合修订，只防本地陈旧编辑，不发送为全站 CAS。
        }))
      : [] // 描述修订来自本地复合表单；不会作为全局 CAS 发送。
    const next = Object.freeze({
      status:
        available || baseline
          ? 'ready'
          : state.error
            ? 'unavailable'
            : 'loading', // 404 下旧目录仍可供给原始 General 消费者。
      view: available // 只替换受管 namespace，其它官方目录保留原始所有者。
        ? {
            ...original.view,
            namespaces: [
              // 白名单 Native 行替换同 ID 原生描述，其余公开行继续保留。
              ...(original.view?.namespaces ?? []).filter(
                (row) => !rows.some((native) => native.ns === row.ns),
              ),
              ...rows,
            ],
          }
        : baseline
          ? original.view
          : undefined,
      error: baseline ? null : state.error, // Native 不支持由独立 status 报告，不把旧 General 标成失败。
    }) // 不扩大未知 namespace 或管理入口；policy status 独立报告 unsupported。
    if (JSON.stringify(next) !== JSON.stringify(directory)) {
      directory = next
      for (const listener of directoryListeners) listener()
    }
    if (state.status !== 'unsupported')
      feedback({
        status: available ? 'ready' : state.error ? 'unavailable' : 'loading',
      })
  }

  /**
   * 请求当前 Runtime 已受权的同源原生策略入口。
   * @param {'GET'|'PUT'} method 固定请求方法。
   * @param {object} [body] 完整策略及可选双 CAS 输入，不接受任意路径。
   * @returns {Promise<object>} 经固定版本白名单校验的策略信封。
   * @throws {Error} 传输失败、响应损坏、权限不足或 CAS 冲突；不解析失败正文。
   */
  const request = async (method, body) => {
    return withNativeRequest(
      async (signal) => {
        let response // 单次固定同源传输，不解析失败正文。
        try {
          response = await fetchImpl('./adminsmart/native-policy', {
            method, // 只允许固定 GET/PUT，不能发起任意服务操作。
            credentials: 'same-origin', // 浏览器认证由当前 Runtime 入口处理，不读取凭据值。
            cache: 'no-store', // 用户策略不得进入公开或浏览器静态缓存。
            redirect: 'error', // 不把认证请求重定向到其它域或业务路径。
            headers: { 'Content-Type': 'application/json' }, // 仅受限 JSON 契约。
            ...(body ? { body: JSON.stringify(body) } : {}), // 读取无正文，写入传完整校验候选。
            signal, // 连接与正文解析共同继承五秒预算和卸载取消。
          })
        } catch {
          throw new Error('原生共享设置连接失败，请重试')
        }
        if (!response.ok) {
          const error = new Error(
            response.status === 409
              ? '设置已被其他管理员更新，请重新编辑'
              : response.status === 403
                ? '管理员权限不足'
                : '原生共享设置保存失败，请重试',
          ) // 拒绝不得公开底层正文。
          error.conflict = response.status === 409 // 只区分稳定并发错误。
          error.unsupported = response.status === 404 // 发布窗口中只是该 API 尚未安装，不永久停装配。
          throw error
        }
        const payload = await response.json().catch(() => null) // 无效 JSON 不能进入表单或 Slot setter。
        if (
          !record(payload) ||
          !Number.isSafeInteger(payload.revision) ||
          payload.revision < 0 ||
          typeof payload.writable !== 'boolean' ||
          (payload.settings === null
            ? payload.revision !== 0
            : payload.revision < 1 || !isNativePolicy(payload.settings))
        )
          throw new Error('原生共享设置响应无效')
        return {
          revision: payload.revision, // 后端 Native 独立修订，用于下一次 native CAS。
          // 明确接受后复制安全 region，不暴露原响应引用。
          settings:
            payload.settings === null
              ? null
              : {
                  ...structuredClone(payload.settings),
                  clientPreferences: structuredClone(
                    payload.settings.clientPreferences ?? {},
                  ), // 旧契约缺项仍表示没有偏好覆盖。
                },
          writable: payload.writable, // 后端可信管理员事实，不能从页面入口可见性推断。
          general: payload.general, // 混合写入的旧 General ACK，只交其严格解析器接受。
          delayed:
            response.headers?.get?.('X-AdminSmart-UI-Policy-Delivery') ===
            'delayed', // 已保存但运行实例采用稍后补偿，不再次提交。
        } // general 只交给既有严格八字段解析器，不能扩展其 Schema。
      },
      { signal: lifecycle.signal, timeoutMs: requestTimeoutMs },
    )
  }

  /**
   * 合并政策失效通知并并行读取后端策略与官方描述。
   * @param {boolean} [revisionOnly=false] SSE/首次启动只等待已有读取；其余调用强制保留回读，不省略重连或恢复。
   * @returns {Promise<void>} 当前合并回读结算；失败以稳定状态呈现，可继续恢复。
   * @sideEffects 只接受当前代际且不落后修订；404 有限重试，卸载取消不发布。
   */
  const refresh = (revisionOnly = false) => {
    if (disposed) return Promise.resolve()
    if (refreshPending) {
      if (!revisionOnly) refreshAgain = true
      return refreshPending
    }
    let completedWantedRevision = null // 本轮最后同步检查的事件修订；结算微任务间新到的更高事件仍需被补读。
    let completedNamespaceRevisions = new Map() // 本轮最后检查过的namespace事件，保障结算微任务间更高通知不丢失。
    refreshPending = (async () => {
      do {
        refreshAgain = false
        const ticket = ++generation // 当前回读的发布代际。
        const connection = connectionEpoch // finally处理失效通知时也必须属于本次连接，不能污染重连后清空的待见集合。
        let receivedRevision = null // 只记录成功校验GET的真实修订；失败不触发无界即时重试。
        try {
          const [policy, described] = await Promise.all([
            request('GET'),
            remote.settings.describe(),
          ]) // 相互独立的可信政策与官方公开描述并行获取。
          receivedRevision = policy.revision // 先到SSE可已被这次在途响应覆盖，不需要重复拉相同数据。
          if (
            disposed ||
            ticket !== generation ||
            (accepted && policy.revision < accepted.revision)
          )
            continue
          if (!described?.ok || !Array.isArray(described.value?.namespaces))
            throw new Error('官方原生设置描述暂不可用')
          const ownEcho =
            inFlightWrite &&
            policy.revision === inFlightWrite.revision + 1 &&
            jsonIdentity(policy.settings) ===
              jsonIdentity(inFlightWrite.settings) // 自己的先到事件不能撤销后续用户操作。
          if (accepted && policy.revision !== accepted.revision && !ownEcho)
            externalEpoch += 1 // 他人变更之前排队的编辑必须失效。
          metadata = described.value.namespaces
            .filter((row) => row && Object.hasOwn(NATIVE_POLICY_FIELDS, row.ns))
            .map((row) => ({
              ns: row.ns, // 精确已批准官方 namespace，不接受原型名称或前缀匹配。
              schema: row.schema, // 固定版官方 Host 脱敏 Schema，原始 UI 继续使用其校验。
              revision: row.revision, // 官方描述修订，仅用于显示和本地 form 投影。
              autoGenerate: row.autoGenerate, // 原始官方自动表单声明，不创建自有表单。
              applies: row.applies, // 官方 live 等应用能力声明。
              secrets: [], // Native 白名单只含非敏感字段，不转发其它 secret 元数据。
              base: Object.fromEntries(
                // 仅复制白名单继承字段，拒绝服务器路径与其它配置层。
                NATIVE_POLICY_FIELDS[row.ns]
                  .filter((field) => Object.hasOwn(row.base ?? {}, field))
                  .map((field) => [field, row.base[field]]),
              ),
              value: Object.fromEntries(
                // 原始现值同样只保留公开安全字段。
                NATIVE_POLICY_FIELDS[row.ns]
                  .filter((field) => Object.hasOwn(row.value ?? {}, field))
                  .map((field) => [field, row.value[field]]),
              ),
            })) // 不复制未知层或敏感路径。
          describedWritable = described.value.writable === true
          accepted = policy
          retryAttempt = 0
          if (retryTimer !== null) {
            clearTimeout(retryTimer)
            retryTimer = null
          }
          feedback({ status: 'loading', error: null })
          publish()
        } catch (error) {
          if (!disposed && ticket === generation) {
            feedback({
              status: error.unsupported ? 'unsupported' : 'unavailable', // 404 属于发布顺序兼容，不伪造后端空策略。
              error: error.unsupported ? null : error.message, // 可恢复发布窗口没有永久错误；其它失败给稳定业务提示。
            })
            publish(true)
            if (error.unsupported && retryTimer === null && retryAttempt < 3) {
              const delay = [1000, 2000, 4000][retryAttempt++] // 短期 API 发布补偿逐次放缓，最多三次。
              retryTimer = setTimeout(() => {
                retryTimer = null
                void refresh()
              }, delay)
              retryTimer.unref?.()
            }
          }
        } finally {
          if (connection !== connectionEpoch) continue // 旧代际响应不能消费新Host通知；reset已安排当前合并器下一轮真实读取。
          completedWantedRevision = wantedRevision // 跟踪此次结算真正检查过的最高失效通知。
          completedNamespaceRevisions = new Map(wantedNamespaceRevisions) // 先保留已检查通知，再消除描述已经覆盖的首见事件。
          if (
            !disposed &&
            wantedRevision !== null &&
            receivedRevision !== null
          ) {
            const coveredRevision = Math.max(
              receivedRevision,
              accepted?.revision ?? -1,
            ) // 迟到GET或自己的PUT ACK都不能让已确认修订倒退。
            if (wantedRevision <= coveredRevision) wantedRevision = null
            else if (wantedRevision > (followedRevision ?? -1)) {
              followedRevision = wantedRevision
              refreshAgain = true // 只有真实响应落后于更高SSE才自动续读，多个通知合并成这一轮。
            }
          }
          if (!disposed && receivedRevision !== null)
            for (const [namespace, revision] of wantedNamespaceRevisions) {
              const describedRevision = rowFor(namespace)?.revision // 已接受metadata中该namespace的raw修订，不是政策修订。
              if (
                Number.isSafeInteger(describedRevision) &&
                revision <= describedRevision
              )
                wantedNamespaceRevisions.delete(namespace)
              else if (
                revision > (followedNamespaceRevisions.get(namespace) ?? -1)
              ) {
                followedNamespaceRevisions.set(namespace, revision)
                refreshAgain = true // 描述确实落后该namespace事件时才跟进，首describe已包含的revision0不会多读。
              }
            }
        }
      } while (refreshAgain && !disposed)
    })().finally(() => {
      refreshPending = null
      if (
        !disposed &&
        wantedRevision !== null &&
        wantedRevision > (completedWantedRevision ?? -1) &&
        wantedRevision > (accepted?.revision ?? -1)
      )
        void refresh(true) // 结算微任务期间新到事件不能因pending刚结束而丢失；失败后的旧通知不会热循环。
      else if (
        !disposed &&
        [...wantedNamespaceRevisions].some(
          ([namespace, revision]) =>
            revision > (completedNamespaceRevisions.get(namespace) ?? -1),
        )
      )
        void refresh(true) // raw namespace更高事件独立补读，不借政策CAS判断。
    })
    return refreshPending
  }

  /**
   * 撤销旧连接的原生元数据、待见修订和读写草稿，再读取同一持久化政策。
   * @returns {Promise<void>} 新代际政策及官方描述结算，不重试任何旧PUT。
   * @sideEffects 暂停旧描述的编辑能力；不清除数据库设置、凭据或用户会话。
   */
  const reset = () => {
    if (disposed) return Promise.resolve()
    connectionEpoch += 1
    generation += 1
    externalEpoch += 1
    inFlightWrite = null
    metadata = [] // 官方namespace revision随Host生命周期归0，不能继续持有旧进程的比较基线。
    describedWritable = false
    wantedRevision = null
    followedRevision = null
    wantedNamespaceRevisions.clear()
    followedNamespaceRevisions.clear()
    feedback({ saving: false, error: null, notice: null })
    publish(true)
    return refresh()
  }

  /**
   * 顺序保存完整原生 region，混合主题编辑在服务端一次双 CAS 提交。
   * @param {Function} edit 在独立副本上编辑并返回可选 legacyGeneralUpdate。
   * @returns {Promise<boolean>} 已提交或稳定拒绝；不会重放陈旧草稿。
   */
  const commit = (edit) => {
    const epoch = externalEpoch // 草稿排队前捕获他人采用边界。
    const connection = connectionEpoch // 旧连接的已发送或排队草稿均不能在新Host继续采用。
    const operation = writeTail.then(async () => {
      if (
        disposed ||
        connection !== connectionEpoch ||
        accepted?.writable !== true ||
        !describedWritable ||
        general.getPolicySnapshot()?.writable !== true
      )
        return false
      if (epoch !== externalEpoch) {
        feedback({ error: '设置已被其他管理员更新，请重新编辑' })
        publish(true)
        return false
      }
      const settings = structuredClone(accepted.settings ?? emptyNativePolicy()) // 只编辑当前确认的 native 策略，不读取模型或 Key。
      settings.harnessVersion = NATIVE_POLICY_VERSION // 只有新的明确保存切换当前协议标记；历史读取继续保留旧tag与全部值。
      const legacy = edit(settings) // 未知路径或不合法值由编辑器拒绝。
      if (!isNativePolicy(settings)) return false
      const revision = accepted.revision // 发出请求后不可被事件修改的真实全局 CAS。
      inFlightWrite = { revision, settings, legacyGeneralUpdate: legacy } // 只保存非敏感受限草稿，响应结算后清除。
      generation += 1
      feedback({ saving: true, error: null, notice: null })
      try {
        const saved = await request('PUT', {
          expectedRevision: revision, // 后端 Native CAS，不能使用当前页面复合 form revision。
          settings, // 当前确认副本上的完整受限原生 region。
          ...(legacy ? { legacyGeneralUpdate: legacy } : {}),
        })
        if (disposed || connection !== connectionEpoch) return false // 已提交事实由新GET确认，旧ACK不能进入Native或General状态。
        if (saved.general)
          general.acceptPolicySnapshot({
            ...saved.general,
            writable: general.getPolicySnapshot().writable,
          }) // 双 CAS ACK 必须通过旧 Controller 自己的严格解析。
        if (!accepted || saved.revision >= accepted.revision) accepted = saved
        feedback({
          notice: saved.delayed ? '设置已保存，实时同步暂不可用' : null,
        })
        publish()
        return true
      } catch (error) {
        if (disposed || connection !== connectionEpoch) return false // 旧连接错误不能覆盖新代际反馈或撤销其草稿。
        if (!disposed) {
          externalEpoch += 1
          await refresh()
          feedback({ error: error.message })
          publish(true)
        }
        if (error.conflict) return false
        throw error
      } finally {
        if (connection === connectionEpoch) {
          inFlightWrite = null
          if (!disposed) feedback({ saving: false })
        }
      }
    })
    writeTail = operation.then(
      () => {},
      () => {},
    ) // 失败不永久锁住原生表单。
    return operation
  }

  /**
   * 接收原始官方表单的一级 set/unset，并交受限顺序提交器。
   * @param {string} ns 已批准原生表单身份。
   * @param {object[]} operations 公开一级字段操作，未知路径或无效字段拒绝。
   * @param {number} [expected] 当前表单本地复合修订，阻止陈旧草稿覆盖。
   * @returns {Promise<boolean>} 已保存为 true，权限/陈旧/无效输入为 false。
   * @throws {Error} 稳定传输或保存失败；旧通用设置不允许 unset。
   */
  const mutate = (ns, operations, expected) => {
    if (disposed) return Promise.resolve(false) // 卸载后的旧scope不得通过legacy分支继续写入。
    const ops = structuredClone(operations) // 调用后外部修改数组不能改变已排队输入。
    const form = facade.get(ns) // 同一个实例同时覆盖 native 和旧 theme 字段。
    const snapshot = form.getSnapshot() // 保存前捕获完整复合状态，不借后来响应覆盖陈旧编辑。
    if (
      !Array.isArray(ops) ||
      (expected !== undefined && expected !== snapshot.revision)
    )
      return Promise.resolve(false)
    if (ns === 'ui-theme' && ops.length === 1 && ops[0]?.op === 'set' && ops[0]?.path?.length === 1 && ops[0].path[0] === 'preference') return general.configForms.get(ns).mutate(ops) // 本人颜色独立提交；不能混合字体或全站字段绕过管理员准入。
    if (accepted === null)
      return ns === 'ui-theme' &&
        ops.every(
          (op) =>
            op?.path?.length === 1 &&
            Object.hasOwn(LEGACY_THEME_FIELDS, op.path[0]),
        )
        ? general.configForms
            .get(ns)
            .mutate(ops, general.configForms.get(ns).getSnapshot().revision)
        : Promise.resolve(false) // 旧 API 发布窗口只允许原有八字段操作，额外字段不写默认。
    if (
      ops.some(
        (op) =>
          !['set', 'unset'].includes(op?.op) ||
          !Array.isArray(op.path) ||
          op.path.length !== 1 ||
          (!NATIVE_POLICY_FIELDS[ns]?.includes(op.path[0]) &&
            !(
              ns === 'ui-theme' &&
              Object.hasOwn(LEGACY_THEME_FIELDS, op.path[0])
            )) ||
          (op.op === 'set' &&
            NATIVE_POLICY_FIELDS[ns]?.includes(op.path[0]) &&
            !isNativePolicyField(ns, op.path[0], op.value)),
      )
    )
      return Promise.resolve(false)
    return commit((settings) => {
      const legacy = general.getPolicySnapshot() // 在串行执行时使用当前自有 ACK 基线；外部采用已经由 epoch 拒绝。
      const patch = { ...(settings.namespaces[ns] ?? {}) } // 原生显式 patch 不包含未知字段或默认补齐。
      const legacySettings = structuredClone(legacy.settings) // 旧八字段只在混合操作时交给其独立 CAS。
      let mixed = false // 不对纯 native 操作发送旧 policy。
      for (const op of ops) {
        const field = op.path[0] // 原生一级字段身份。
        if (ns === 'ui-theme' && Object.hasOwn(LEGACY_THEME_FIELDS, field)) {
          if (op.op === 'unset') throw new Error('该通用设置不支持空值')
          legacySettings[LEGACY_THEME_FIELDS[field]] = op.value
          mixed = true
        } else if (op.op === 'unset') delete patch[field]
        else patch[field] = op.value
      }
      if (Object.keys(patch).length) settings.namespaces[ns] = patch
      else delete settings.namespaces[ns]
      return mixed
        ? { expectedRevision: legacy.revision, settings: legacySettings }
        : undefined
    })
  }

  /**
   * 将官方Chat表单的明确操作投影到原有两个CAS真源，采用事件不调用本函数。
   * @param {object[]} operations 官方一级set/unset操作；collapseTiming仅有两种公开枚举。
   * @param {number} [expected] 当前复合scope整数修订，用于拒绝陈旧草稿。
   * @returns {Promise<boolean>} 保存成功为true；普通用户、无效路径及陈旧修订拒绝并撤回乐观显示。
   * @sideEffects 混合旧Chat字段时使用既有双CAS事务，不创建新的持久化namespace。
   */
  const mutateChat = async (operations, expected) => {
    const scope = facade.get('ui-chat') // 原始TranscriptViewPolicy持有的同一个公开表单。
    const ops = structuredClone(operations) // 排队前复制输入，避免外部修改正在提交的草稿。
    if (disposed || !Array.isArray(ops) || (expected !== undefined && expected !== scope.getSnapshot().revision)
      || ops.some(op => !['set', 'unset'].includes(op?.op) || !Array.isArray(op.path) || op.path.length !== 1
        || (op.path[0] === 'collapseTiming' ? op.op === 'set' && !['completion', 'next-input'].includes(op.value)
          : !Object.hasOwn(LEGACY_CHAT_FIELDS, op.path[0]) || (op.op === 'unset' ? op.path[0] !== 'transcriptView' : !LEGACY_CHAT_FIELDS[op.path[0]].includes(op.value))))) {
      publish(true)
      return false
    }
    const collapse = ops.some(op => op.path[0] === 'collapseTiming') // 纯旧字段继续委托原General，避免无必要的Native修订。
    if (!collapse) return general.configForms.get('ui-chat').mutate(ops, general.configForms.get('ui-chat').getSnapshot().revision)
    const saved = await commit(settings => {
      const legacy = general.getPolicySnapshot() // 串行执行时采用最新自有ACK，外部更新由commit的epoch防护。
      const legacySettings = structuredClone(legacy.settings) // 混合操作必须保留其它七个General配置。
      let mixed = false // 只有确实包含旧字段才发送General CAS。
      for (const op of ops) {
        const field = op.path[0] // 已验证的一级官方Chat字段。
        if (field === 'collapseTiming') {
          if (op.op === 'unset') delete settings.clientPreferences.collapseTiming
          else settings.clientPreferences.collapseTiming = op.value
        } else {
          legacySettings[field] = op.op === 'unset' ? null : op.value
          mixed = true
        }
      }
      return mixed ? { expectedRevision: legacy.revision, settings: legacySettings } : undefined
    })
    if (!saved) publish(true) // 普通用户的官方setter会先乐观更新；拒绝后须由官方adopt撤回，不能仅隐藏入口。
    return saved
  }

  const describe = {
    getSnapshot: () => directory, // 官方目录 Observable 的稳定快照读取。
    /**
     * 订阅目录确认和变化。
     * @param {Function} listener 官方消费者回调。
     * @returns {Function} 仅释放本订阅的函数，无写入副作用。
     */
    subscribe(listener) {
      directoryListeners.add(listener)
      return () => directoryListeners.delete(listener)
    },
    /**
     * 等待下层完整原生目录；通用设置启动包就绪不代表管理员Models描述已经确认。
     * @returns {Promise<void>} 下层官方描述及当前复合目录均已结算；真实读取失败继续向调用方报告。
     * @sideEffects 仅按需读取公开描述，已完整就绪时不追加Native政策请求或写入。
     */
    async ensure() {
      await general.configForms.describe().ensure?.() // 管理员完整模型目录门禁由原General适配确认，不能因Native已ready而跳过。
      if (directory.status !== 'ready') await refresh()
      publish() // 保留Models原生namespace及其独立CAS，不把Native政策修订替换进去。
    },
    /**
     * 接受原始目录公开更新并重新确认受管 region。
     * @param {object} view 原始 ConfigForms 已验证的描述视图。
     * @returns {void} 旧目录保持原始所有者，Native 同步单独回读。
     */
    acceptView: (view) => {
      general.configForms.describe().acceptView(view)
      void refresh()
    },
  } // 官方目录公开协议，不覆盖 UI 席位。
  const facade = {
    ...general.configForms, // 保留旧 developerTools 及 Models 公开接口。
    /**
     * 提供稳定的原生 form 或转发未接管的官方 form。
     * @param {string} ns 精确 namespace。
     * @returns {object} 官方 ConfigFormScope 协议实例；未批准 namespace 仍由 General 适配器负责。
     */
    get(ns) {
      if (ns !== 'ui-chat' && !Object.hasOwn(NATIVE_POLICY_FIELDS, ns))
        return general.configForms.get(ns)
      if (!forms.has(ns)) {
        let snapshot = Object.freeze({
          status: 'loading', // 尚未确认政策与描述时不能当作已读取默认。
          value: undefined, // 不播种当前 Runtime 私人值或未发布默认。
          writable: false, // 首次可信权限事实到达前禁写。
          revision: 0, // 页面本地复合修订，独立于两个后端 CAS。
          mode: 'host', // 保持官方远端 scope 的行为。
        }) // 首次默认不会被写成全局真源。
        const subscribers = new Set() // 当前原生表单的公开消费者。
        forms.set(ns, {
          getSnapshot: () => snapshot, // 当前 namespace 引用稳定的公开快照。
          /**
           * 订阅当前表单变化。
           * @param {Function} listener 原始 form controller 回调。
           * @returns {Function} 仅解除当前消费者，不改变其它 form。
           */
          subscribe(listener) {
            subscribers.add(listener)
            return () => subscribers.delete(listener)
          },
          set: (field, value) =>
            ns === 'ui-chat' ? mutateChat([{ op: 'set', path: [field], value }]) : mutate(ns, [{ op: 'set', path: [field], value }]), // Chat只投影公开scope，不改变其持久化职责。
          unset: (field) => ns === 'ui-chat' ? mutateChat([{ op: 'unset', path: [field] }]) : mutate(ns, [{ op: 'unset', path: [field] }]), // 清除覆盖后恢复可信baseline。
          mutate: (ops, revision) => ns === 'ui-chat' ? mutateChat(ops, revision) : mutate(ns, ops, revision), // 混合scope仍保留本地整数修订防旧草稿。
          /**
           * 采用确认值并维持当前 form 的本地修订。
           * @param {object} next 受限组合快照，不含后端 CAS。
           * @param {boolean} force 冲突/拒绝时让原始 UI 撤回乐观编辑。
           * @returns {void} 实际变化替换引用；强制反馈只通知当前消费者。
           */
          publish(next, force) {
            if (
              JSON.stringify(next) !==
              JSON.stringify({ ...snapshot, revision: undefined })
            ) {
              snapshot = Object.freeze({
                ...next,
                revision: snapshot.revision + 1,
              })
              for (const listener of subscribers) listener()
            } else if (force) for (const listener of subscribers) listener()
          },
        })
        if (ns === 'ui-chat' || ns === 'ui-theme') cleanups.push(general.configForms.get(ns).subscribe(() => publish())) // 个人Theme及General独立确认后，原生组合表单必须同步采用。
        publish()
      }
      return forms.get(ns)
    },
    describe: () => describe, // 官方描述目录继续由一个稳定 Observable 提供。
    /**
     * 按真实目录生命周期装配原始设置页面。
     * @param {string[]} namespaces 原始插件可以消费的精确 namespace。
     * @param {Function} register 得到可用 namespace 集合后返回清理函数。
     * @returns {Function} 同时释放目录订阅和原始 page 注册。
     */
    whileServed(namespaces, register) {
      let release // 官方 namespace 出现时注册，消失时释放。
      const sync = () => {
        const served = new Set(
          directory.view?.namespaces.map((row) => row.ns) ?? [],
        ) // 只使用已投影公开目录，不猜当前装配或权限。
        if (namespaces.some((ns) => served.has(ns))) {
          if (!release) release = register(served)
        } else {
          release?.()
          release = undefined
        }
      }
      const unsubscribe = describe.subscribe(sync) // 只接线既有官方 page ownership。
      sync()
      return () => {
        unsubscribe()
        release?.()
      }
    },
  }
  cleanups.push(
    general.configForms.describe().subscribe(() => publish()), // 官方模型目录与CAS变化独立于General偏好；复合目录必须立即透传同一公开更新。
    general.subscribe(() => {
      const next = general.getPolicySnapshot() // 旧 Controller 自己已验证的独立真源。
      const ownEcho =
        inFlightWrite?.legacyGeneralUpdate &&
        next?.revision ===
          inFlightWrite.legacyGeneralUpdate.expectedRevision + 1 &&
        jsonIdentity(next.settings) ===
          jsonIdentity(inFlightWrite.legacyGeneralUpdate.settings) // 双 CAS 的先到 General ACK 仍属于本次提交。
      if (
        observedGeneral &&
        next &&
        next.revision !== observedGeneral.revision &&
        !ownEcho
      )
        externalEpoch += 1
      observedGeneral = next
      publish()
    }),
  ) // 旧 theme 真源变化也更新复合 form；不会把 CAS 数字互相冒用。
  if (remote.$on)
    cleanups.push(
      remote.$on('settings/document-updated', (namespace, revision) => {
        if (
          typeof namespace !== 'string' ||
          !Number.isSafeInteger(revision) ||
          revision < 0
        ) {
          void refresh() // 未知或不完整事件无法证明描述已覆盖，保守保留真实重读。
          return
        }
        if (!Object.hasOwn(NATIVE_POLICY_FIELDS, namespace)) {
          if (!INDEPENDENT_SETTINGS_NAMESPACES.has(namespace)) void refresh() // 只有明确归其它提供方的完整事件才不触发Native。
          return
        }
        const describedRevision = rowFor(namespace)?.revision // 精确namespace已采用的公开raw修订，和policy revision完全分开。
        if (
          Number.isSafeInteger(describedRevision) &&
          revision <= describedRevision
        )
          return
        if (revision <= (wantedNamespaceRevisions.get(namespace) ?? -1)) return
        wantedNamespaceRevisions.set(namespace, revision)
        void refresh(true) // 在途只记最高待见metadata修订，首描述返回后再决定是否还落后。
      }),
    )
  if (ctx?.slots) {
    if (globalThis.window?.__ADMINSMART_RUNTIME_ROLE__ === 'managed-user')
      cleanups.push(
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay', // 公开根 overlay 类型，只声明下级原始偏好消费，不显示内容。
              id: 'adminsmart-readonly-settings-binding', // 固定无可见内容的生命期声明，不展示管理入口。
              children: {
                'settings.general.item': { kind: 'list', scope: 'root' },
              }, // 使用官方父子 Slot 依赖使普通用户消费原始偏好。
            },
            () => null,
          ),
        ),
      ) // 无可见 UI 的公开声明让官方 Chat 设置消费者仍可接线。
    /**
     * 从原始公开StoredEntry确认折叠消费者，不订阅其乐观store或调用具有持久化副作用的setter。
     * @returns {void} Slot尚未出现时保持未就绪；实际采用由官方scope订阅完成。
     */
    const attach = () => {
      const row = ctx.slots
        .entries('settings.general.item')
        .find((entry) => entry.options.id === 'transcript-view') // 只使用当前固定版公开的官方席位。
      const face = row?.inject?.() // 固定 SDK 的公开 StoredEntry.inject 返回原始 TranscriptViewRowInjected。
      if (
        !face?.hooks?.collapseTiming?.subscribe ||
        typeof face.setCollapseTiming !== 'function'
      )
        return
      if (collapseFace?.hooks.collapseTiming === face.hooks.collapseTiming)
        return
      collapseFace = face
      feedback({ collapseAvailable: true })
    }
    cleanups.push(ctx.slots.subscribe('settings.general.item', attach))
    attach()
  }
  const recovery = setInterval(() => {
    void refresh()
  }, 30_000) // 短重试用尽后仍能恢复新接口；不永久 disable。
  recovery.unref?.()
  cleanups.push(() => {
    clearInterval(recovery)
    if (retryTimer !== null) clearTimeout(retryTimer)
  })
  if (ctx?.on)
    cleanups.push(
      ctx.on('connection/reset', () => {
        void reset()
      }),
    ) // 发布后的重连立即回读真实政策。
  if (eventSourceFactory) {
    const source = eventSourceFactory('./adminsmart/native-policy/events') // Gateway 已绑定当前 Runtime 的同源能力，只接收非敏感 revision。
    const changed = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 512) return
      let value // 不解析或记录任意错误正文。
      try {
        value = JSON.parse(event.data)
      } catch {
        return
      }
      if (
        !record(value) ||
        Object.keys(value).length !== 1 ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0
      )
        return
      if (accepted && value.revision <= accepted.revision) return // 相同或更旧的已采用修订不是失效。
      if (wantedRevision !== null && value.revision <= wantedRevision) return // 当前在途已记最高修订，重复通知不创建第二轮。
      wantedRevision = value.revision
      void refresh(true) // 初始SSE与已有GET合并，是否补读由真实响应修订决定。
    }
    source.addEventListener('native-policy-changed', changed)
    cleanups.push(() => {
      source.removeEventListener?.('native-policy-changed', changed)
      source.close()
    })
  }
  const ready = refresh(true) // 首次SSE若已启动相同读取就共享该Promise；失败仍明确显示，不制造假ready。
  return {
    configForms: facade, // 原始 ConfigForms 公共接口，UI 不需知道持久化 API。
    ready, // 首次读取结算能力，404/失败状态由 getSnapshot 明确区分。
    refresh, // 失效后有界合并回读，不执行重复写入。
    reset, // 官方connection/reset的代际边界，隔离旧在途响应并重新确认Host元数据。
    getSnapshot: () => state, // 非敏感保存和采用反馈 Observable。
    getPolicySnapshot: () => accepted && structuredClone(accepted), // 只返回已确认政策副本；首次404仍为null。
    /**
     * 订阅保存/恢复反馈。
     * @param {Function} listener 当前公开消费者回调。
     * @returns {Function} 仅解除本订阅。
     */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /**
     * 释放当前桥及其全部在途生命周期资源。
     * @returns {void} 撤销旧 scope 写权限、取消请求并解除 Slot/SSE，不修改已保存策略。
     */
    dispose() {
      disposed = true
      for (const form of forms.values())
        form.publish({ ...form.getSnapshot(), writable: false }, true)
      lifecycle.abort()
      generation += 1
      for (const cleanup of cleanups.reverse()) cleanup?.()
      listeners.clear()
      directoryListeners.clear()
    },
  }
}
