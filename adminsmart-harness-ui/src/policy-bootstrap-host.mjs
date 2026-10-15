/** 从已采用共享策略及公开脱敏Settings描述构造一次HTML初值，不缓存政策或改变官方事件恢复语义。 */
import { isUiPolicy } from './ui-policy-client.mjs'
import { isNativePolicy, isNativePolicyField, NATIVE_POLICY_FIELDS } from './native-policy-client.mjs'

export const SETTINGS_BOOTSTRAP_GLOBAL = '__ADMINSMART_SETTINGS_BOOTSTRAP__' // 官方IndexInjection携带的固定初值身份，不能从页面输入选择。
export const SETTINGS_BOOTSTRAP_MAXIMUM_BYTES = 128 * 1024 // 整体UTF-8 JSON硬上限，防止异常Schema或配置使HTML无限膨胀。
const HARNESS_VERSION = '0.2.1-alpha.3' // 仅与当前固定版Adapter/Schema合同配套，不暗中支持未知上游。
const OWNED_GENERAL_ALIAS = 'adminsmart-shared-settings' // 既有Adapter将此实际entry身份归一为ui-settings，此处保留原公开ns。
const GENERAL_FIELDS = Object.freeze({
  locale: Object.freeze(['preference']), // 未指定语言继续省略，不猜测浏览器语言。
  'ui-theme': Object.freeze(['preference', 'fontSize', ...NATIVE_POLICY_FIELDS['ui-theme']]), // 共享主题、内容字号及五个原生安全字体字段。
  'ui-chat': Object.freeze(['transcriptView', 'performanceUsage', 'linkOpening', 'collapseTiming']), // 原聊天展示及Native折叠偏好的精确投影，不承载工具、正文或系统提示词。
  'ui-conversation': Object.freeze(['busyEnter']), // 忙碌Enter行为，不含会话草稿或消息。
  'ui-settings': Object.freeze(['enabled']), // 仅代码工作视图展示开关。
})
const GENERAL_NAMES = Object.freeze(Object.keys(GENERAL_FIELDS)) // 引导General适配器必须具备的五个原命名空间。
const SCHEMA_META_FIELDS = Object.freeze(['required', 'volatile', 'loose', 'min', 'max', 'step', 'default', 'pattern']) // 仅保留安全字段实际校验所需元数据，不复制描述、角色外数据或未知默认对象。

/** @param {unknown} value 待检查的只读JSON记录。 @returns {boolean} 是否为普通或空原型数据对象。 */
function record(value) {
  return value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))
}

/** @param {string} namespace 原始公开entry身份。 @returns {string} 仅固定owned别名规范化，不做前缀或任意推断。 */
function canonicalNamespace(namespace) { return namespace === OWNED_GENERAL_ALIAS ? 'ui-settings' : namespace }

/** @param {string} namespace 安全namespace。 @returns {string[]|undefined} 精确允许字段；模型、凭据及其它配置永不进入HTML。 */
function fieldsFor(namespace) {
  const canonical = canonicalNamespace(namespace) // 仅固定别名允许归一，原型属性不能变成namespace。
  return Object.hasOwn(GENERAL_FIELDS, canonical) ? GENERAL_FIELDS[canonical] : Object.hasOwn(NATIVE_POLICY_FIELDS, namespace) ? NATIVE_POLICY_FIELDS[namespace] : undefined
}

/**
 * 校验单个展示值，不能通过白名单字段夹带对象、路径或大文本。
 * @param {string} namespace 当前安全namespace。
 * @param {string} field 原始字段名。
 * @param {unknown} value 官方描述中的值或安全Schema默认值。
 * @returns {boolean} 是否符合当前Adapter已经采用的展示合同。
 */
function validField(namespace, field, value) {
  const ns = canonicalNamespace(namespace) // 别名只影响字段判断，输出仍保留原ns。
  if (Object.hasOwn(NATIVE_POLICY_FIELDS, ns) && NATIVE_POLICY_FIELDS[ns].includes(field)) return isNativePolicyField(ns, field, value)
  if (ns === 'locale') return typeof value === 'string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(value)
  if (ns === 'ui-theme') return field === 'preference' ? ['light', 'dark', 'system'].includes(value) : Number.isInteger(value) && value >= 10 && value <= 22
  if (ns === 'ui-chat') return field === 'transcriptView' ? [null, 'compact', 'standard', 'detailed', 'verbose', 'normal', 'expanded'].includes(value) : field === 'performanceUsage' ? ['compact', 'detailed'].includes(value) : field === 'collapseTiming' ? ['completion', 'next-input'].includes(value) : field === 'linkOpening' && ['sidebar', 'new-tab'].includes(value)
  if (ns === 'ui-conversation') return ['queue', 'steer'].includes(value)
  return ns === 'ui-settings' && typeof value === 'boolean'
}

/**
 * 精确提取安全层字段；不复制官方脱敏器未标记的任意headers、provider或其它附加属性。
 * @param {unknown} source 当前公开value/base/user对象。
 * @param {string} namespace 已批准namespace。
 * @param {string[]} fields 当前精确字段集合。
 * @returns {object} 分离的安全原始值；字段省略保持原语义。
 * @throws {Error} 已批准字段包含无效值或层结构异常，整份bootstrap回退HTTP。
 */
function projectLayer(source, namespace, fields) {
  if (!record(source)) throw new Error('引导设置层无效')
  const result = {} // 只容纳有限primitive字段，不转发未知数据。
  for (const field of fields) {
    if (!Object.hasOwn(source, field) || source[field] === undefined) continue
    if (!validField(namespace, field, source[field])) throw new Error('引导展示字段无效')
    result[field] = source[field]
  }
  return result
}

/**
 * 按安全字段重建公开Schemastery引用图，剔除agent-loop.agents等非展示分支。
 * @param {unknown} schema 当前公开Controller的序列化Schema。
 * @param {string} namespace 当前安全namespace。
 * @param {string[]} fields 精确安全字段。
 * @returns {object} 仍可由官方Schema构造器读取的有限安全引用图。
 * @throws {Error} 缺节点、循环、secret字段、非primitive字段图或损坏默认值，不猜测Schema。
 */
function projectSchema(schema, namespace, fields) {
  if (!record(schema) || !Number.isSafeInteger(schema.uid) || !record(schema.refs)) throw new Error('引导Schema无效')
  const root = schema.refs[schema.uid] // 只接受当前固定版公开root object引用格式。
  if (!record(root) || root.type !== 'object' || !record(root.dict) || root.meta?.role === 'secret') throw new Error('引导Schema根无效')
  const refs = {} // 仅保留安全字段可达节点，禁止克隆完整原Schema附加分支。
  const active = new Set() // union必须无环；不执行任何Schema函数或transform。
  /** @param {number} id 原引用身份。 @param {string} field 当前安全字段。 @param {number} depth 当前图深度。 @returns {void} 收集有限原始验证节点。 */
  const visit = (id, field, depth = 0) => {
    if (!Number.isSafeInteger(id) || active.has(id) || depth > 12 || Object.keys(refs).length > 128) throw new Error('引导Schema引用无效')
    if (Object.hasOwn(refs, id)) return
    const source = schema.refs[id] // 当前原始节点，不读取不相关ref。
    if (!record(source) || !record(source.meta ?? {}) || !['string', 'number', 'boolean', 'const', 'union'].includes(source.type) || source.meta?.role === 'secret') throw new Error('引导Schema字段无效')
    active.add(id)
    const meta = {} // 仅允许验证primitive的元数据，不能包含任意文本、对象或凭据引用。
    for (const key of SCHEMA_META_FIELDS) {
      if (!Object.hasOwn(source.meta ?? {}, key)) continue
      const value = source.meta[key] // 单个公开Schema验证选项。
      if (key === 'default') { if (!validField(namespace, field, value)) throw new Error('引导Schema默认值无效') }
      else if (key === 'pattern') {
        if (!record(value) || typeof value.source !== 'string' || value.source.length > 4096 || typeof value.flags !== 'string' || !/^[dgimsuvy]*$/u.test(value.flags)) throw new Error('引导Schema模式无效')
      } else if (['min', 'max', 'step'].includes(key) ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'boolean') throw new Error('引导Schema验证项无效')
      meta[key] = key === 'pattern' ? { source: value.source, flags: value.flags } : value
    }
    const node = { type: source.type, meta } // 不复制role、描述、任意额外属性或上游函数。
    if (source.type === 'const') {
      if (!validField(namespace, field, source.value)) throw new Error('引导Schema枚举无效')
      node.value = source.value
    }
    if (source.type === 'union') {
      if (!Array.isArray(source.list) || source.list.length < 1 || source.list.length > 32) throw new Error('引导Schema分支无效')
      node.list = [...source.list]
      for (const child of node.list) visit(child, field, depth + 1)
    }
    refs[id] = node
    active.delete(id)
  }
  const dict = {} // 原root只保留当前namespace白名单内真实存在的字段。
  for (const field of fields) {
    if (!Object.hasOwn(root.dict, field)) continue
    visit(root.dict[field], field)
    dict[field] = root.dict[field]
  }
  refs[schema.uid] = { type: 'object', meta: { default: {} }, dict } // 不保留root默认对象中潜在非展示配置。
  return { uid: schema.uid, refs }
}

/**
 * 只从当前公开SettingsController结果投影安全描述，不直接访问未脱敏SettingsForms。
 * @param {unknown} described 公开controller.describe()的同步结果。
 * @param {boolean} isAdmin 当前Gateway可信角色。
 * @returns {object} 五General及当前存在Native描述，权限为官方实际能力与可信角色交集。
 * @throws {Error} 描述损坏、缺General、重复namespace或安全字段被标secret，整份初值放弃。
 */
function projectDescription(described, isAdmin) {
  if (!record(described) || typeof described.writable !== 'boolean' || typeof described.hasDocument !== 'boolean' || !Array.isArray(described.namespaces) || described.namespaces.length > 512) throw new Error('引导官方描述无效')
  const namespaces = [] // 绝不容纳任何模型namespace；其headers等字段不受官方secret标记充分保护。
  const names = new Set() // 实际ns不得重复；owned与canonical别名仍交给既有Adapter择源。
  for (const row of described.namespaces) {
    if (!record(row) || typeof row.ns !== 'string') throw new Error('引导namespace无效')
    const fields = fieldsFor(row.ns) // 未批准namespace在访问其值或Schema之前直接忽略。
    if (!fields) continue
    if (names.has(row.ns) || !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.autoGenerate !== 'boolean' || row.applies !== 'live' || !Array.isArray(row.secrets)) throw new Error('引导namespace元数据无效')
    if (row.secrets.some(secret => !record(secret) || !Array.isArray(secret.path) || secret.path.length === 0 || secret.path.length > 16 || secret.path.some(part => typeof part !== 'string') || typeof secret.set !== 'boolean' || fields.includes(secret.path[0]))) throw new Error('引导展示字段不可公开')
    names.add(row.ns)
    namespaces.push({
      ns: row.ns, // 保留公开entry身份，owned alias不伪造旧Host行。
      schema: projectSchema(row.schema, row.ns, fields), // 仅safe字段对应原始验证图。
      value: projectLayer(row.value, row.ns, fields), // 只有当前允许展示值。
      ...(row.base === undefined ? {} : { base: projectLayer(row.base, row.ns, fields) }), // 普通Controller未提供层时不补造。
      ...(row.user === undefined ? {} : { user: projectLayer(row.user, row.ns, fields) }), // 明确覆盖仅保留安全字段。
      revision: row.revision, // 官方raw namespace修订，不与两个政策CAS混用。
      autoGenerate: isAdmin && row.autoGenerate, // 普通用户不得借HTML恢复自动配置表单。
      applies: row.applies, // 原始live合同。
      secrets: [], // 安全白名单无secret字段，不转发其它secret路径元数据。
    })
  }
  if (GENERAL_NAMES.some(name => !namespaces.some(row => canonicalNamespace(row.ns) === name))) throw new Error('引导General描述不完整')
  return {
    namespaces, // 仅现有安全域；不存在Native行保持不存在。
    writable: isAdmin && described.writable, // 不能只信任可见入口或浏览器role。
    hasDocument: false, // HTML只有安全展示初值；原文档能力必须等首次真实HTTP完整描述后才恢复。
  }
}

/**
 * 安装每次HTML渲染时即时构建的一次性安全初值，失败保持原HTTP初始化路径。
 * @param {object} ctx 官方Host Context，通过公开settingsController.describe及IndexInjection读取/输出。
 * @param {object} options 可信Host闭包，不接受页面正文、URL或Cookie值。
 * @param {boolean} options.isAdmin Gateway已经确认的角色。
 * @param {Function} options.getGeneralSnapshot 现有General同步器的已完整采用getter。
 * @param {Function} options.getNativeSnapshot 现有Native同步器的已完整采用getter。
 * @param {number} [options.maximumBytes=131072] 只能降低硬上限的受信预算，隔离测试可缩小。
 * @returns {void} 监听随当前fiber卸载；无异步请求、新政策缓存或持久化。
 * @sideEffects 仅读取公开脱敏描述与确认getter；使用官方global注入行，由官方renderer转义script敏感字符。
 */
export function installPolicyBootstrapHost(ctx, { isAdmin, getGeneralSnapshot, getNativeSnapshot, maximumBytes = SETTINGS_BOOTSTRAP_MAXIMUM_BYTES }) {
  if (typeof isAdmin !== 'boolean' || typeof getGeneralSnapshot !== 'function' || typeof getNativeSnapshot !== 'function' || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > SETTINGS_BOOTSTRAP_MAXIMUM_BYTES) throw new Error('设置引导装配无效')
  ctx.effect(() => ctx.on('webserver/index-inject', table => {
    try {
      if (!Array.isArray(table) || table.some(row => row?.kind === 'global' && row.name === SETTINGS_BOOTSTRAP_GLOBAL)) return
      const general = getGeneralSnapshot() // 不发请求，只从同Host已采用真源取当前确认。
      const native = getNativeSnapshot() // 未确认、部分采用或失败时必须为null。
      if (!record(general) || !record(native) || Object.keys(general).sort().join() !== 'revision,settings,writable' || Object.keys(native).sort().join() !== 'revision,settings,writable' || !Number.isSafeInteger(general.revision) || general.revision < 1 || !Number.isSafeInteger(native.revision) || native.revision < 1 || !isUiPolicy(general.settings) || !isNativePolicy(native.settings) || typeof general.writable !== 'boolean' || typeof native.writable !== 'boolean') return
      const controller = ctx.get('settingsController') // 当前实际角色的公开控制器，禁止绕过其脱敏及namespace权限。
      if (typeof controller?.describe !== 'function') return
      const described = projectDescription(controller.describe(), isAdmin) // 同步公开调用；Promise或异常不被当作成功描述。
      const chat = described.namespaces.find(row => canonicalNamespace(row.ns) === 'ui-chat') // 只覆盖现有官方公开Chat行，不自造namespace或表单Schema。
      const timing = native.settings.clientPreferences?.collapseTiming // 唯一持久化真源来自已完整采用的Native记录，不采用旧raw Host残值。
      chat.value = { ...chat.value, collapseTiming: timing ?? 'completion' }
      if (chat.base !== undefined) chat.base = { ...chat.base, collapseTiming: 'completion' }
      if (chat.user !== undefined) {
        chat.user = { ...chat.user }
        delete chat.user.collapseTiming
        if (timing !== undefined) chat.user.collapseTiming = timing
      }
      if (JSON.stringify(general) !== JSON.stringify(getGeneralSnapshot()) || JSON.stringify(native) !== JSON.stringify(getNativeSnapshot())) return // 描述事件导致确认/现值变化时，不能拼成不同代际的引导。
      const payload = {
        version: 1, // 自有一次性引导合同版本，不替代官方Remote/政策版本。
        harnessVersion: HARNESS_VERSION, // 严格绑定当前固定SDK。
        general: { revision: general.revision, settings: structuredClone(general.settings), writable: isAdmin && general.writable && described.writable }, // 完整已采用General与权限交集。
        native: { revision: native.revision, settings: structuredClone(native.settings), writable: isAdmin && native.writable && described.writable }, // 完整已采用Native，无供应商、凭据或其它策略区域。
        described: { ok: true, value: described }, // 与原Client接受的公开Remote成功信封相同，仅含安全行。
      }
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > maximumBytes) return
      table.push({ kind: 'global', name: SETTINGS_BOOTSTRAP_GLOBAL, value: payload }) // 禁止手拼script，由官方IndexInjection统一序列化和转义。
    } catch { /* 任何确认、描述、shape或预算异常均放弃HTML初值，沿用现有受权HTTP与官方reset恢复。 */ }
  }), 'adminsmart: confirmed settings bootstrap')
}
