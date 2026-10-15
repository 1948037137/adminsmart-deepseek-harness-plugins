/** 官方 PluginManager 的可信角色和全站启停持久化接线；安装、版本和原生管理保护保留SDK契约。 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isNativeEnablementMap, isNativePluginId, isOfficialBundleName, NATIVE_PLUGIN_MAXIMUM_ITEMS, NATIVE_BUNDLE_MAXIMUM_ITEMS } from './native-policy-client.mjs'

const runtimeRoot = String(process.env.ADMINSMART_DSH_ROOT || '').trim() // Gateway 明确选定的固定发行包，不回退其它上游或用户目录。
if (!runtimeRoot) throw new Error('AdminSmart PluginManager runtime root is missing')
const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 公开类与 Remote 协议必须来自同一固定安装。
const { PluginManager } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-plugin-manager')).href) // 继承公开 SDK，不复制或改写官方管理实现。
const { RemoteError } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-protocol')).href) // 使用已声明的稳定 Remote 错误码。
const runtimeVersion = require('@deepseek-ai/dsh/package.json').version // 已校验固定官方运行版；管理员启停不允许顺带切换代码版本。
const TERMINAL_BUNDLE = '@deepseek-ai/dsh-experimental-terminal-bundle' // 模型持久终端与原生Sidebar两行需要同一次可信角色冷物化。
const AUTO_REVIEW_BUNDLE = '@deepseek-ai/dsh-experimental-auto-review' // 官方卸载会将存活Auto会话转换为danger-full-access，必须在关闭前明确撤出Auto。

/**
 * 确认名称对应当前受管安装的官方发行包，不从用户Profile或网络解析新代码。
 * @param {unknown} name 原SDK库存中的模块或Bundle名称。
 * @param {boolean} [bundle=false] 为真时还要求包声明官方Bundle补丁。
 * @returns {boolean} 名称、固定版本和Bundle身份均吻合才可进入管理动作。
 */
function installedOfficial(name, bundle = false) {
  if (!isOfficialBundleName(name)) return false
  try {
    const manifest = require(name + '/package.json') // 只读固定SDK锚点的公开包清单，不接受URL、目录或安装规格。
    return manifest.name === name && manifest.version === runtimeVersion && (!bundle || Boolean(manifest.dsh?.bundle))
  } catch { return false }
}

/**
 * 创建不携带底层路径、权限上下文或凭据的业务拒绝。
 * @param {string} message 固定中文业务文案，不接收外部错误正文。
 * @returns {RemoteError} 官方 gateway/bad-request 拒绝，details 保持空对象。
 */
function rejected(message = '当前业务不允许此插件管理操作') {
  return new RemoteError('gateway/bad-request', message, {})
}

/**
 * 核对原始官方行的稳定身份与原生只读约束。
 * @param {object} row super.listPlugins 返回的当前官方库存行。
 * @returns {boolean} 固定安装内所有可寻址官方行；官方原始只读约束不解除。
 */
function allowed(row) {
  return row?.readOnlyReason === undefined && typeof row?.patchId === 'string'
    && isNativePluginId(row.patchId) && installedOfficial(row.moduleName)
}

/** @param {object} row 官方Bundle库存行。 @returns {boolean} 仅当前固定安装可读且官方允许管理的组合，不安装缺失包。 */
function allowedBundle(row) {
  return row?.readOnlyReason === undefined && row.official === true && row.availability !== 'missing'
    && row.error === undefined && installedOfficial(row.name, true) && row.version === runtimeVersion
}

/**
 * 读取Gateway按当前官方composer生成的能力快照，禁止Host自行维护平行核心名单。
 * @param {unknown} input 私有进程环境JSON或隔离测试显式注入的数据。
 * @returns {object|null} 有限稳定身份数组及业务冲突理由；缺失/损坏时关闭管理写能力。
 */
function capabilitySnapshot(input) {
  try {
    const value = typeof input === 'string' ? JSON.parse(input) : input // 不接收任何HTTP或浏览器全局字段。
    const fields = ['harnessVersion', 'allowedPluginIds', 'activePluginIds', 'protectedPluginIds', 'selectedBundles', 'availableBundles', 'protectedBundles', 'blockedPluginReasons', 'blockedBundleReasons', 'adminOnlyBundles', 'roleExcludedBundles'] // 角色排除是实际装载差异，不改共享记录或按hostname分支。
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.harnessVersion !== runtimeVersion
      || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) return null
    for (const field of ['allowedPluginIds', 'activePluginIds', 'protectedPluginIds', 'selectedBundles', 'availableBundles', 'protectedBundles', 'roleExcludedBundles']) {
      const values = value[field] // 当前固定composer确认的稳定身份，不是模块URI或代码。
      const validate = field.includes('Bundle') ? isOfficialBundleName : isNativePluginId // 两种身份语法不可混用。
      if (!Array.isArray(values) || values.length > 4096 || values.some(item => !validate(item)) || new Set(values).size !== values.length) return null
    }
    for (const field of ['blockedPluginReasons', 'blockedBundleReasons', 'adminOnlyBundles']) {
      const values = value[field] // 可信业务规则只携带有限中文原因，不转发路径、凭据或用户数据。
      const validate = field.includes('Bundle') ? isOfficialBundleName : isNativePluginId
      if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 4096
        || Object.entries(values).some(([key, reason]) => !validate(key) || typeof reason !== 'string' || reason.length < 1 || reason.length > 512)) return null
    }
    return structuredClone(value) // 分离调用方引用，不把能力快照暴露为Remote或浏览器数据。
  } catch { return null }
}

/**
 * 保留官方结果字段及错误分类，只净化可能包含服务器路径的失败诊断。
 * @param {object} result 原始 SDK ChangeResult 或 Bundle 元数据结果。
 * @returns {object} 正常结果保持对象身份；失败诊断替换为固定文案。
 */
function publicChange(result) {
  if (!result?.error?.diagnostic) return result
  return { ...result, error: { ...result.error, diagnostic: '插件状态应用失败，请稍后重试' } }
}

/**
 * 安装唯一官方 PluginManager 服务，并提供只存在于 Host 闭包的共享状态应用入口。
 * @param {object} ctx 当前受管 Runtime 的真实 Cordis Context。
 * @param {object} options 服务端解析的角色与持久化能力，禁止浏览器提供。
 * @param {boolean} options.isAdmin 固定签名角色；只接受布尔值，不进行字符串真值转换。
 * @param {(patchId:string, enabled:boolean) => Promise<unknown>} options.commitPlugin 管理员全局 CAS 持久化；失败不得执行局部 SDK 写入。
 * @param {(name:string, enabled:boolean) => Promise<unknown>} [options.commitBundle] 已安装官方组合的共享CAS保存，缺失时不开放组合变更。
 * @param {Function} [options.validateCapabilitySelection] 可信业务兼容性验证，任何拒绝须在保存前明确报告。
 * @returns {object} fiber、applyPlugins和validatePolicy为Host内部能力，不作为Remote方法开放。
 * @throws {RemoteError} 角色、回调、重复装配或策略不合法时稳定拒绝。
 * @sideEffects 创建官方服务；外部管理员写入先提交共享策略，再调用原生保存；内部应用只写当前隔离 Profile。
 */
export function installGuardedPluginManager(ctx, { isAdmin, commitPlugin, commitBundle, validateCapabilitySelection = () => {}, capabilities = process.env.ADMINSMART_AGENT_PLUGIN_CAPABILITIES_JSON } = {}) {
  if (typeof isAdmin !== 'boolean' || typeof commitPlugin !== 'function') throw rejected('插件管理身份或持久化能力无效')
  if (ctx.get('pluginManager', false) !== undefined) throw rejected('插件管理服务已装配')
  const nativeScope = new AsyncLocalStorage() // 仅内部 super.set 的虚调用读取可进入；外部并发 RPC 不继承此调用上下文。
  const mutationScope = new AsyncLocalStorage() // 当前受控动作等待的Host采用可重入同一序列，独立RPC仍等待tail且不获得读取能力。
  const capability = capabilitySnapshot(capabilities) // 与Gateway冷物化同源；缺失时不凭本机SDK包名猜权限。
  const canManagePlugin = row => allowed(row) && capability?.allowedPluginIds.includes(row.patchId) && !capability.protectedPluginIds.includes(row.patchId) // 当前可寻址官方行与业务恢复依赖共同求交集。
  const canManageBundle = row => allowedBundle(row) && capability?.availableBundles.includes(row.name) && !capability.protectedBundles.includes(row.name) // 不开放基础启动组合或未安装依赖。
  const assertCompatible = (kind, id, enabled) => {
    if (!capability) throw rejected('插件管理能力尚未由当前Gateway确认，请重新连接')
    const reason = (kind === 'bundle' ? capability.blockedBundleReasons : capability.blockedPluginReasons)[id] // 原因只来自可信冷物化结果，不是客户端文案。
    if (enabled && reason) throw rejected(reason)
    if (!enabled && (kind === 'bundle' && id === AUTO_REVIEW_BUNDLE || kind === 'plugin' && id === 'auto-review')) {
      const presets = ctx.get('permissionPresets', false) // 官方公开权限服务反映当前会话实际模式，不能从页面选项推断。
      const sessions = ctx.get('sessions', false) // 仅检查本Runtime当前存活会话，不读取磁盘或其它用户历史。
      if (presets && sessions && Array.from(sessions.list()).some(session => presets.current(session) === 'auto'))
        throw rejected('仍有会话使用Auto权限，请先在官方权限选择器中明确切换这些会话，再停用自动审批插件')
    }
  } // 明确不兼容只拒绝真实开启，关闭及仍兼容原能力不被统一锁死。
  const roleExcludedBundle = name => !isAdmin && capability && Object.hasOwn(capability.adminOnlyBundles, name) // 内部采用保留共享管理员选择，普通Runtime不把它转为本地装载。
  let readNative // 由实例构造时绑定的 super.listPlugins，只供 Host 闭包使用。
  let writeNative // 由实例构造时绑定的 super.setPluginEnabled，不作为服务方法或 Remote 暴露。
  let readNativeBundles // 原始官方Bundle目录，仅Host闭包及管理员受权读可调用。
  let writeNativeBundle // 原始SDK组合选择和HMR流程，不能由外部Remote绕过共享保存。
  let tail = Promise.resolve() // 全局策略提交与当前 Runtime 投影按接收顺序串行，失败不阻断下一次动作。
  let liveSnapshot = Object.freeze({ isAdmin, selectedBundles: Object.freeze([...(capability?.selectedBundles ?? [])]) }) // 冷启动composer确认的role-effective选择，后续仅真实SDK应用更新。
  const capabilityListeners = new Set() // 仅Host/Agent内部订阅者，不进入Remote或HTML数据。
  const liveCapabilities = {
    getSnapshot: () => liveSnapshot, // 引用稳定的可信身份与实际组合选择。
    subscribe(listener) { capabilityListeners.add(listener); return () => capabilityListeners.delete(listener) }, // 订阅随Agent/Host正常生命周期释放。
  }

  /**
   * 原SDK结算后读取真实库存，选择和运行状态共同确认Agent可用能力。
   * @returns {Promise<void>} 更新role-effective内部快照；缺少active行或存在pending/failed时不伪授予工具。
   * @sideEffects 只读公开目录和原库存，不发网络、不改变全局策略。
   */
  const publishLiveCapabilities = async () => {
    if (!capability) return // 无可信Gateway能力确认时保持只读/无新权限，不以公开库存自行推断授权。
    const rows = await readNative() // 实际启用和fiberPhase来源，不能只按Manifest选中推断工具可用。
    const bundles = await readNativeBundles() // 当前SDK实际选择，尚需重启的Manifest不会单独授予能力。
    const selected = bundles.filter(bundle => bundle.enabled && bundle.error === undefined
      && (!Object.hasOwn(capability.adminOnlyBundles, bundle.name) || isAdmin)
      && (bundle.rows.length === 0 ? capability.selectedBundles.includes(bundle.name) : bundle.rows.some(part => rows.some(row => row.entryId === part.entryId && row.enabled && row.fiberPhase === 'active')))
      && !bundle.rows.some(part => rows.some(row => row.entryId === part.entryId && row.enabled && row.fiberPhase !== 'active'))).map(bundle => bundle.name) // OS条件关闭的行不要求激活；启用但未就绪的行禁止假就绪。
    if (JSON.stringify(selected) === JSON.stringify(liveSnapshot.selectedBundles)) return
    liveSnapshot = Object.freeze({ isAdmin, selectedBundles: Object.freeze(selected) })
    for (const listener of capabilityListeners) listener()
  }

  /**
   * 串行执行一个完整的策略提交或原生投影。
   * @param {() => Promise<unknown>} work 当前受控管理动作。
   * @returns {Promise<unknown>} 动作真实结果，失败不自动重放。
   */
  const serialize = work => {
    if (mutationScope.getStore()?.active === true) return Promise.resolve().then(work) // commit内部await采用同一已确认策略，不能排到自身之后互等。
    const run = () => {
      const operation = { active: true, results: new Map() } // 私有动作保留同序列采用回执，避免保存后再次执行同一SDK变更。
      return mutationScope.run(operation, async () => {
        try { return await work() } finally { operation.active = false }
      })
    } // 标记不放入SDK服务或Remote参数，已完成链创建的延迟任务重新参与正常队列。
    const result = tail.then(run, run) // 前一项失败不阻止后续明确重试。
    tail = result.then(() => undefined, () => undefined)
    return result
  }

  /** 继承全部官方 Config、Remote 标记和原始管理实现，业务保护只包住公开入口。 */
  class GuardedPluginManager extends PluginManager {
    /**
     * @param {object} owner 服务所属真实 Cordis fiber。
     * @param {object} config 由继承的官方 Config Schema 解析的管理配置。
     */
    constructor(owner, config) {
      super(owner, config)
      readNative = () => super.listPlugins()
      writeNative = (id, enabled) => {
        const permission = { active: true } // 原生setter期间的内部读取资格，完成后立即失效，包括已创建的异步后继。
        return nativeScope.run(permission, async () => {
          try { return publicChange(await super.setPluginEnabled(id, enabled)) } finally { permission.active = false }
        })
      }
      readNativeBundles = () => super.listBundles()
      writeNativeBundle = async (name, enabled) => {
        const result = publicChange(await super.setBundleEnabled(name, enabled)) // 官方失败与真实保存分类保持原样。
        return name === TERMINAL_BUNDLE && result.changed && ['applied', 'restart-required'].includes(result.application)
          ? { ...result, application: 'restart-required', restartReason: 'host-module' } // Sidebar Controller独立于optional模型Bundle；只有冷物化才能保证两者与签名角色一致。
          : result
      }
    }

    /**
     * 返回管理员可管理的当前固定官方库存；普通外部调用不读取任何库存。
     * @returns {Promise<object[]>} 官方原生只读规则保留，未安装或非官方代码仍由受管部署提供。
     * @throws {RemoteError} 普通用户或底层读取故障稳定拒绝。
     */
    async listPlugins() {
      if (nativeScope.getStore()?.active === true) return super.listPlugins() // 官方 setPluginEnabled 的当前内部虚调用不能被普通角色误拦截。
      if (!isAdmin) throw rejected('仅管理员可以查看插件管理')
      try {
        return (await super.listPlugins()).map(row => {
          if (canManagePlugin(row)) return row
          const { patchId: _patchId, ...protectedRow } = row // 不向原生 UI 提供受保护行的可编辑目标。
          return { ...protectedRow, readOnlyReason: row.readOnlyReason ?? 'management-required' }
        })
      } catch { throw rejected('插件目录暂不可用，请稍后重试') }
    }

    /**
     * 返回官方Bundle原始元数据，已安装固定官方组合保留其启停能力。
     * @returns {Promise<object[]>} 官方行及受保护的可编辑/可删除状态。
     * @throws {RemoteError} 普通用户或底层读取故障稳定拒绝。
     */
    async listBundles() {
      if (!isAdmin) throw rejected('仅管理员可以查看插件管理')
      try { return (await super.listBundles()).map(row => {
        const result = publicChange(row) // 官方目录中的错误类型保持，仅净化内部诊断。
        if (canManageBundle(row) || row.official && row.availability === 'missing') return { ...result, removable: false }
        return { ...result, readOnlyReason: row.readOnlyReason ?? 'management-required', removable: false }
      }) }
      catch { throw rejected('插件组合目录暂不可用，请稍后重试') }
    }

    /**
     * 读取管理员可见的原生注册表说明。
     * @returns {Promise<object>} 官方注册表信息，不改变注册表或依赖。
     * @throws {RemoteError} 普通角色或底层故障稳定拒绝，不透传异常正文。
     */
    async registries() {
      if (!isAdmin) throw rejected('仅管理员可以查看插件管理')
      try { return await super.registries() } catch { throw rejected('插件注册表信息暂不可用') }
    }

    /**
     * 读取管理员可见的原生版本豁免说明，不授权写入。
     * @returns {object} 官方当前Profile的豁免及读取警告。
     * @throws {RemoteError} 普通角色或底层故障稳定拒绝。
     */
    listVersionExemptions() {
      if (!isAdmin) throw rejected('仅管理员可以查看插件管理')
      try {
        const result = super.listVersionExemptions() // 官方仍负责版本记录校验；只净化读取警告中的宿主诊断。
        return result.warnings.length ? { ...result, warnings: result.warnings.map(() => '部分插件版本记录不可用，请联系管理员') } : result
      } catch { throw rejected('插件版本信息暂不可用') }
    }

    /**
     * 管理员提交当前固定官方库存中可寻址行，先共享CAS保存再原SDK采用。
     * @param {string} id 当前 Runtime 的真实 Loader entryId，不接受全局猜测身份。
     * @param {boolean} enabled 期望启用状态；保持目录、模型和角色装配不变。
     * @returns {Promise<object>} 官方 ChangeResult，不把持久化提交冒充已应用。
     * @throws {RemoteError} 不合法目标、角色、CAS 或底层异常稳定拒绝。
     */
    async setPluginEnabled(id, enabled) {
      if (!isAdmin) throw rejected('仅管理员可以修改插件状态')
      if (typeof id !== 'string' || typeof enabled !== 'boolean') throw rejected('插件状态参数无效')
      return serialize(async () => {
        let row // 当前原始官方库存中命中的真实行，不采用装饰后的 UI 行。
        try { row = (await readNative()).find(candidate => candidate.entryId === id) }
        catch { throw rejected('插件目录暂不可用，请稍后重试') }
        if (!canManagePlugin(row)) throw rejected('该插件当前受官方只读规则或业务恢复依赖保护，不能修改')
        assertCompatible('plugin', row.patchId, enabled)
        let saved // 已保存ACK与当前Runtime应用状态分开，delayed时不能自行重试SDK动作。
        try { saved = await commitPlugin(row.patchId, enabled) } catch { throw rejected('插件全局策略未保存，请稍后重试') }
        const applied = mutationScope.getStore()?.results.get('plugin:' + row.patchId) // 保存时Host同序列采用已经返回的真实SDK结果。
        if (applied) return applied
        if (saved?.delayed) throw rejected('全局插件状态已保存，当前运行实例尚未应用，请刷新查看或按官方提示重启')
        try {
          const result = await writeNative(id, enabled) // 没有同序列采用时只执行一次原SDK动作。
          if (result.application === 'applied') await publishLiveCapabilities()
          return result
        } catch { throw rejected('插件状态应用失败，请稍后重试') }
      })
    }

    /**
     * 阻止插件页启动外部网络或任意宿主路径诊断。
     * @param {string} spec 未授权安装规格，不读取其内容。
     * @param {object} options 未授权查询选项，不转发到SDK。
     * @param {AbortSignal} signal 未授权生命周期，不启动任务。
     * @throws {RemoteError} 当前业务仅通过受管部署提供软件包。
     */
    async inspect(spec, options, signal) { throw rejected() }
    /**
     * 管理当前已安装官方组合，不自动安装、不改变固定发行依赖。
     * @param {string} name Bundle身份，不解析或读取外部文件。
     * @param {boolean} enabled 启用期望，不执行原生操作。
     * @returns {Promise<object>} 原始SDK应用分类，保存成功不等于当前Runtime已应用。
     * @throws {RemoteError} 普通角色、缺失软件包、固定版本或原生管理保护不满足。
     */
    async setBundleEnabled(name, enabled) {
      if (!isAdmin) throw rejected('仅管理员可以修改插件组合')
      if (!isOfficialBundleName(name) || typeof enabled !== 'boolean' || typeof commitBundle !== 'function') throw rejected('插件组合状态参数无效')
      return serialize(async () => {
        const row = (await readNativeBundles()).find(candidate => candidate.name === name) // 提交前按当前真实SDK目录复核，不采用页面旧行。
        if (!canManageBundle(row)) throw rejected(row?.availability === 'missing' ? '该官方插件尚未安装，请先完成受管固定版本安装' : '该插件组合受官方保护或当前启动恢复依赖保护，不能修改')
        assertCompatible('bundle', name, enabled)
        let saved // 对实际采用失败只展示已保存延迟，不再自动重复关闭/开启服务。
        try { saved = await commitBundle(name, enabled) } catch { throw rejected('插件组合全局策略未保存，请稍后重试') }
        const applied = mutationScope.getStore()?.results.get('bundle:' + name) // 同一提交内的Host采用回执不重复运行HMR或卸载。
        if (applied) return applied
        if (saved?.delayed) throw rejected('全局插件组合状态已保存，当前运行实例尚未应用，请刷新查看或按官方提示重启')
        const result = await writeNativeBundle(name, enabled) // 同步或重启分类仍由官方返回。
        if (result.application === 'applied') await publishLiveCapabilities()
        return result
      })
    }
    /**
     * 阻止管理面安装、升级或授权软件包脚本。
     * @param {string} spec 安装规格，不访问网络或文件。
     * @param {object} options 安装及脚本选项，包含禁用安装也一并拒绝。
     * @throws {RemoteError} 软件包变更必须由受管发布流程完成。
     */
    async installBundle(spec, options) { throw rejected() }
    /**
     * 防止删除部署组合及共享依赖。
     * @param {string} name 删除目标，不查询安装器或磁盘。
     * @throws {RemoteError} 删除仅属于受管发布流程。
     */
    async removeBundle(name) { throw rejected() }
    /**
     * 拒绝读取本管理面不拥有的部署任务。
     * @param {string} requestId 未授权安装身份，不回显或查找任务。
     * @throws {RemoteError} 当前管理面不启动或拥有安装任务。
     */
    async waitForInstall(requestId) { throw rejected() }
    /**
     * 拒绝干预本管理面不拥有的部署任务。
     * @param {string} requestId 未授权安装身份，不查找或取消任务。
     * @throws {RemoteError} 当前管理面不启动或拥有安装任务。
     */
    async cancelInstall(requestId) { throw rejected() }
    /**
     * 保持受管固定版本准入，不以界面风险确认绕过部署边界。
     * @param {string} packageVersion 软件包版本，不作为安装输入。
     * @param {string} runtimeVersion Runtime版本，不修改兼容记录。
     * @param {boolean} enabled 豁免期望，授权与撤销均拒绝。
     * @param {boolean} acceptRisk 浏览器风险确认，不替代受管发布。
     * @throws {RemoteError} 禁止通过管理面改写固定版本准入。
     */
    async setVersionExemption(packageVersion, runtimeVersion, enabled, acceptRisk) { throw rejected() }
  }

  const fiber = ctx.plugin(GuardedPluginManager) // 继承官方 Config/服务名与 Remote 装配，所有角色使用同一个实现。

  /**
   * 保存前核对变化目标的原生库存和可信业务兼容性，原始HTTP PUT也必须使用此入口。
   * @param {object} pluginsMap 有限patchId布尔映射，不含安装代码或配置内容。
   * @param {object} [bundlesMap] 已安装官方组合布尔映射。
   * @param {object} [previous] 上次已确认政策；历史未变化值不重复授权。
   * @param {boolean} [adopting=false] 仅Host内部已确认政策采用可保留角色排除项；HTTP/外部管理校验不传此标志。
   * @returns {Promise<void>} 全部变化获准，失败时尚未保存或修改局部Profile。
   * @throws {RemoteError} 非法映射、目标缺失、原生只读、未安装或业务范围不兼容。
   */
  const validatePolicy = async (pluginsMap, bundlesMap = {}, previous = {}, adopting = false) => {
    if (!isNativeEnablementMap(pluginsMap, isNativePluginId, NATIVE_PLUGIN_MAXIMUM_ITEMS)
      || !isNativeEnablementMap(bundlesMap, isOfficialBundleName, NATIVE_BUNDLE_MAXIMUM_ITEMS)) throw rejected('插件共享策略无效')
    await fiber.await()
    if (fiber.state !== 2) throw rejected('插件管理服务暂不可用')
    const rows = await readNative() // 当前官方可管理行，不使用页面旧entry身份。
    const bundles = await readNativeBundles() // 当前目录包含原SDK安装、版本、管理保护判定。
    for (const [name, enabled] of Object.entries(bundlesMap)) {
      const row = bundles.find(candidate => candidate.name === name) // 包名只作为可信目录查找键，不解析安装规格。
      if (!canManageBundle(row)) throw rejected(row?.availability === 'missing' ? '该官方插件尚未安装，需受管固定版本安装后再启用' : '插件组合的官方安装、版本或管理保护条件尚未满足')
      if (adopting && roleExcludedBundle(name)) continue // 角色排除不是全局配置无效；仍先验证实际官方安装及核心保护，不放宽外部写入。
      assertCompatible('bundle', name, enabled)
    }
    for (const [id, enabled] of Object.entries(pluginsMap)) {
      if (!capability?.allowedPluginIds.includes(id) || capability.protectedPluginIds.includes(id)) throw rejected('该共享插件身份未知或属于业务恢复依赖，不能采用')
      const row = rows.find(candidate => candidate.patchId === id) // 官方唯一寻址目标，不用任意模块名替代。
      const owner = bundles.find(bundle => bundle.rows.some(candidate => candidate.rowId === id)) // 公开Bundle元数据确认所属关系，不能靠任意blocked reason猜高权限身份。
      if (adopting && owner && roleExcludedBundle(owner.name)) continue // 只保留已确认共享覆盖，不装载或调用普通角色的高权限SDK setter。
      const declaredEntryIds = bundles.flatMap(bundle => bundle.rows.filter(part => part.rowId === id).map(part => part.entryId).filter(Boolean)) // 原SDK仍报告的live身份即使没有patchId也不能当休眠。
      if (!row && rows.some(candidate => declaredEntryIds.includes(candidate.entryId))) throw rejected('该插件行仍在运行但官方标为不可寻址，不能绕过原生保护')
      const dormantOwner = !row && bundles.find(bundle => !bundle.enabled && bundle.rows.some(part => part.rowId === id)) // 只有真正关闭的已安装组合才构成dormant，活行unaddressable不能借历史绕过。
      if (dormantOwner && previous.plugins?.[id] === enabled) continue // HTTP不能新增未live目标，旧合法覆盖等待所属组合重开。
      if (!canManagePlugin(row)) throw rejected('该插件行受官方只读或业务恢复依赖保护')
      assertCompatible('plugin', id, enabled)
      if (previous.plugins?.[id] !== enabled && enabled && owner && (bundlesMap[owner.name] ?? owner.enabled) === false) throw rejected('请先启用该插件行所属的官方组合')
    }
    await validateCapabilitySelection({ plugins: pluginsMap, bundles: bundlesMap, previous }) // 可信业务兼容性失败不得以已保存/已启用掩盖。
  }

  /**
   * 应用已确认组合及行状态，依赖、Profile持久化和HMR均由官方setter负责。
   * @param {object} pluginsMap 已确认patchId映射。
   * @param {object} [bundlesMap] 已确认官方组合映射；旧政策缺省不改变选择。
   * @returns {Promise<object[]>} 真实SDK回执，非applied仍需明确恢复或重启。
   * @throws {RemoteError} 当前目标、映射或SDK失败；不重试已经持久化的全局动作。
   */
  const applyPlugins = async (pluginsMap, bundlesMap = {}) => {
    if (!isNativeEnablementMap(pluginsMap, isNativePluginId, NATIVE_PLUGIN_MAXIMUM_ITEMS)
      || !isNativeEnablementMap(bundlesMap, isOfficialBundleName, NATIVE_BUNDLE_MAXIMUM_ITEMS)) throw rejected('插件共享策略无效')
    await fiber.await()
    if (fiber.state !== 2) throw rejected('插件管理服务暂不可用')
    return serialize(async () => {
      await validatePolicy(pluginsMap, bundlesMap, { plugins: pluginsMap, bundles: bundlesMap }, true) // 普通角色保留已确认管理员选择而不装载；未知、未安装和核心保护仍先拒绝。
      const results = [] // 只记录实际SDK结果，不把磁盘更新冒充当前能力已经运行。
      for (const [name, enabled] of Object.entries(bundlesMap)) {
        if (roleExcludedBundle(name)) continue // 共享选择保持原值，但普通Runtime绝不装载管理员Host求值/终端等高权限服务。
        const row = (await readNativeBundles()).find(candidate => candidate.name === name) // 每项之前重新确认安装与原生保护。
        if (!canManageBundle(row)) throw rejected('共享插件组合当前不可应用')
        if (row.enabled === enabled) continue
        const result = await writeNativeBundle(name, enabled) // 不嵌套官方HMR锁，不调用私有reload。
        results.push(result)
        mutationScope.getStore()?.results.set('bundle:' + name, result)
      }
      for (const [id, enabled] of Object.entries(pluginsMap)) {
        const ownerBundle = (await readNativeBundles()).find(bundle => bundle.rows.some(part => part.rowId === id)) // 每次以SDK公开成员关系核对角色边界，不能按来自浏览器的ID前缀推断。
        if (ownerBundle && roleExcludedBundle(ownerBundle.name)) continue // 共享插件行覆盖可保留但普通Runtime不调用任何高权限行setter。
        const rows = await readNative() // 组合变更后再读新entryId，不能用已卸载的旧行。
        const row = rows.find(candidate => candidate.patchId === id)
        if (!row) {
          const owner = (await readNativeBundles()).find(bundle => !bundle.enabled && bundle.rows.some(part => part.rowId === id)) // 不能把仍活着但官方不可寻址的行误归休眠。
          if (owner && capability?.allowedPluginIds.includes(id) && !capability.protectedPluginIds.includes(id)) continue
          throw rejected('共享插件行当前不存在，不能声明已应用')
        }
        if (!canManagePlugin(row)) throw rejected('共享插件目标当前不可编辑')
        if (row.enabled === enabled) continue
        const result = await writeNative(row.entryId, enabled) // 原始Schema和写入错误分类保留。
        results.push(result)
        mutationScope.getStore()?.results.set('plugin:' + id, result)
      }
      if (results.every(result => result.application === 'applied')) await publishLiveCapabilities() // failed/restart-required仍沿旧已运行能力，不能按刚写的Manifest伪授予。
      return results
    })
  }
  return { fiber, applyPlugins, validatePolicy, liveCapabilities } // 内部能力face与采用器均不注册Remote方法或浏览器全局。
}
