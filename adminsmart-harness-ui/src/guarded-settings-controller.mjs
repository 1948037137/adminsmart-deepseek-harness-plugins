/** 官方 Settings/Credentials Remote 的窄业务删除保护；继承公开控制器，不复制其协议、校验或存储。 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const runtimeRoot = String(process.env.ADMINSMART_DSH_ROOT || '').trim() // Gateway 明确选定的固定官方安装，不能回退到其它源码树。
if (!runtimeRoot) throw new Error('AdminSmart Settings runtime root is missing')
const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 同一 Runtime 的公开类与Remote错误协议。
const { SettingsController, CredentialsController } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-api-settings-controller')).href) // 只继承已公开导出的构造类，未修改原型或上游字节。
const { RemoteError } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-protocol')).href) // 官方界面可以原样呈现稳定业务拒绝。

/**
 * 将后台固定机器分类转换为安全删除提示，不采用后台异常或供应商正文。
 * @param {unknown} code 资格检查或锁内删除回执中的稳定错误分类。
 * @returns {Error} 附带允许分类的安全错误，未知情况统一提示重新查看状态。
 * @sideEffects 不读取连接值，也不在错误中携带URL、Key、目录或内部堆栈。
 */
export function providerDeletionError(code) {
  const messages = { // 固定文案区分知识连接迁移失败与真实不存在，不再将任何故障归因于默认引用。
    fixed_knowledge_connection_missing: '独立知识连接尚未准备好，供应商暂未删除；请先完成知识连接初始化。',
    fixed_knowledge_provider_ambiguous: '旧知识连接来源不能唯一确认，供应商暂未删除；请先核对知识连接来源。',
    fixed_knowledge_connection_invalid: '独立知识连接校验失败，供应商暂未删除；请检查受保护的知识连接配置。',
    fixed_knowledge_connection_migration_failed: '独立知识连接保存失败，供应商暂未删除；请重试或检查服务状态。',
    fixed_knowledge_connection_immutable: '该操作试图修改独立知识连接，已被拒绝；聊天供应商可单独管理。',
    chat_provider_missing: '共享供应商已不存在，请刷新官方模型页面后核对当前状态。',
    knowledge_engine_config_invalid: '共享配置校验失败，供应商暂未删除；请检查服务配置状态。',
  }
  const acceptedCode = typeof code === 'string' && Object.hasOwn(messages, code) ? code : 'provider_deletion_unconfirmed' // 未知或恶意分类不能成为客户端文案或异常数据。
  const error = new Error(messages[acceptedCode] || '供应商删除状态尚未确认，原生操作已停止；请刷新后重试。') // 稳定提示不会回显下层错误。
  error.code = acceptedCode
  return error
}

/**
 * 取得当前管理员实际保存的官方模型配置。
 * @param {object} ctx 当前管理员 Host 的官方编辑器。
 * @returns {object} 已保存的 Provider 配置映射，未配置时返回空对象。
 * @sideEffects 仅读取公开 ConfigEditor 元数据，不读取任何 Key。
 */
function profiles(ctx) {
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'llm-pi-ai') // 当前管理员的原生模型配置属主。
  const value = entry?.options?.config?.providers // Key 引用只用于判断关联，永不解引用。
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * 根据原生公开更新参数识别可能删除的供应商路由，最终合法性仍由官方Schema负责。
 * @param {object} current 已保存的实际 Provider 映射。
 * @param {'mutate'|'update'|'replace'} mode 官方变更方式。
 * @param {unknown} input 原始 Remote 的路径操作或配置片段。
 * @returns {string[]} 唯一受影响的已有路由；普通模型属性编辑不会触发删除检查。
 */
function removedRoutes(current, mode, input) {
  const existing = Object.keys(current) // 仅当前管理员原生 Profile 中实际存在的路由。
  const removed = new Set() // 同一批根与子操作不会重复访问删除资格接口。
  const modelCounts = new Map(existing.map(route => [route, Array.isArray(current[route]?.models) ? current[route].models.length : 0])) // 路径操作连续移除数组元素时按官方索引删除语义判断最终是否清空。
  const reset = value => value === null || value === undefined || typeof value !== 'object' || Object.keys(value).length === 0 // 官方可把 null 解析为失去models/Key引用的空Provider，身份键残留也属于破坏性重置。
  const destructive = (route, value, replace) => {
    const previous = current[route] // 仅检查当前实际存在的连接引用和显式模型，未声明字段不推测为缺失。
    if (reset(value)) return true
    const losesKey = typeof previous?.apiKeyEnv === 'string' && Boolean(previous.apiKeyEnv.trim())
      && (replace && !Object.hasOwn(value, 'apiKeyEnv') || Object.hasOwn(value, 'apiKeyEnv') && (typeof value.apiKeyEnv !== 'string' || !value.apiKeyEnv.trim())) // 合法非空引用替换仍由官方与发布校验；删/清空引用属于破坏性重置。
    const losesModels = Array.isArray(previous?.models) && previous.models.length > 0
      && (replace && !Object.hasOwn(value, 'models') || Object.hasOwn(value, 'models') && (!Array.isArray(value.models) || value.models.length === 0)) // 非空模型调整保持原流程，不引入逐模型删除资格接口。
    return losesKey || losesModels
  }
  const replacement = value => {
    for (const route of existing) if (!value || typeof value !== 'object' || !Object.hasOwn(value, route) || destructive(route, value[route], true)) removed.add(route)
  } // 只从替换后的显式映射判断身份，不执行任意Schema或路径代码。
  if (mode === 'replace') replacement(input?.providers)
  else if (mode === 'update') {
    if (input && Object.hasOwn(input, 'providers')) {
      if (input.providers === null) replacement(null)
      else if (input.providers && typeof input.providers === 'object') for (const route of existing) {
        if (Object.hasOwn(input.providers, route) && (input.providers[route] === null || input.providers[route] && Object.keys(input.providers[route]).length > 0 && destructive(route, input.providers[route], false))) removed.add(route) // 官方update深合并保留未提供字段；显式清空模型/Key引用才查资格。
      }
    }
  }
  else for (const operation of Array.isArray(input) ? input : []) {
    if (!Array.isArray(operation?.path)) continue // 无效参数交给官方验证器转换稳定错误。
    const path = operation.path // 原生公开字段路径，不作为服务器文件路径使用。
    if (!path.length) replacement(operation.op === 'set' ? operation.value?.providers : null)
    else if (path[0] === 'providers' && path.length === 1) replacement(operation.op === 'set' ? operation.value : null)
    else if (path[0] === 'providers' && Object.hasOwn(current, path[1])) {
      const route = path[1] // 当前已有路由；未实际存在的新配置不按删除猜测。
      if (path.length === 2 && (operation.op === 'unset' || destructive(route, operation.value, true))) removed.add(route)
      else if (path.length === 3 && path[2] === 'apiKeyEnv' && typeof current[route]?.apiKeyEnv === 'string' && current[route].apiKeyEnv.trim()
        && (operation.op === 'unset' || typeof operation.value !== 'string' || !operation.value.trim())) removed.add(route)
      else if (path.length === 3 && path[2] === 'models') {
        const count = operation.op === 'set' && Array.isArray(operation.value) ? operation.value.length : 0 // 整个模型数组替换或unset的有效长度。
        if (modelCounts.get(route) > 0 && count === 0) removed.add(route)
        modelCounts.set(route, count)
      } else if (path.length === 4 && path[2] === 'models' && operation.op === 'unset' && /^(0|[1-9][0-9]*)$/u.test(String(path[3])) && Number(path[3]) < modelCounts.get(route)) {
        const count = modelCounts.get(route) - 1 // 官方数组unset删除元素，连续操作必须用剩余长度而非旧数组长度。
        modelCounts.set(route, count)
        if (count === 0) removed.add(route)
      }
    }
  }
  return [...removed]
}

/**
 * 注册继承原始官方 Remote 控制器的管理员删除保护。
 * @param {object} ctx 已由可信 Runtime 角色确认的管理员 Host Context。
 * @param {(routeId:string) => Promise<void>} checkDeletion 只读签名后端资格检查，任何拒绝或故障都失败关闭。
 * @param {(routes:string[], operation:Function) => Promise<unknown>} [withDeletion] 同Host串行撤销共享与执行原生操作的可信事务入口。
 * @returns {object} 官方 Cordis fiber；构造的 Remote 保持原生服务身份并由该 fiber 释放。
 * @sideEffects 只有删除相关参数会调用一次只读检查；通过后由super执行原有Schema/CAS/Credentials写入。
 */
export function installGuardedSettingsControllers(ctx, checkDeletion, withDeletion = (_routes, operation) => operation()) {
  /**
   * 对受影响的当前私有路由逐项确认后台删除资格。
   * @param {string[]} routes 已确认属于当前官方 Profile 的路由。
   * @param {'settings'|'credentials'} kind 原生错误域。
   * @returns {Promise<void>} 全部获准后完成，任何拒绝立即停止后续原生动作。
   * @throws {RemoteError} 独立知识连接候选或资格读取失败，使用固定安全分类。
   */
  const check = async (routes, kind) => {
    for (const route of routes) {
      try { await checkDeletion(route) }
      catch (error) {
        const safe = providerDeletionError(error?.code) // 资格失败只按固定分类解释，不把任意异常message回显浏览器。
        throw new RemoteError(kind === 'settings' ? 'settings/rejected' : 'credential/rejected', safe.message, { reason: safe.code })
      }
    }
  }
  /**
   * 在资格确认及共享撤销后执行原始官方变更，普通字段直接保留官方路径。
   * @param {string[]} routes 当前原生受影响路由。
   * @param {'settings'|'credentials'} kind 官方错误域。
   * @param {Function} operation 原始 super 动作，不重试凭据删除。
   * @returns {Promise<unknown>} 原始官方回执，不伪造成功。
   * @throws {RemoteError} 原生 Schema/CAS/凭据拒绝原样保留，共享撤销失败转为固定安全错误。
   */
  const guarded = async (routes, kind, operation) => {
    if (!routes.length) return operation() // 普通属性与无Provider关联的凭据操作保持官方原有路径，不额外进入共享发布队列。
    await check(routes, kind)
    try { return await withDeletion(routes, operation) }
    catch (error) {
      if (error instanceof RemoteError) throw error // 原生Schema/CAS/凭据拒绝仍保持官方错误语义。
      const safe = providerDeletionError(error?.code) // 锁内迁移或撤销失败保持相同安全分类，不猜测默认用途。
      throw new RemoteError(kind === 'settings' ? 'settings/rejected' : 'credential/rejected', safe.message, { reason: safe.code })
    }
  }
  /** 保留官方Settings的describe/Schema/CAS，仅在实际供应商身份删除之前检查业务用途。 */
  class GuardedSettingsController extends SettingsController {
    /**
     * 在破坏性路径变更之前校验当前供应商用途，保留原始路径与 CAS 协议。
     * @param {string} ns 原生命名空间。
     * @param {object[]} ops 公开路径操作。
     * @param {number|undefined} expectedRevision 原生 CAS 基线。
     * @returns {Promise<object>} 原始官方写入回执。
     * @throws {RemoteError} 连接候选无效、资格故障或原始官方 Schema/CAS 错误。
     */
    async mutate(ns, ops, expectedRevision) {
      const routes = ns === 'llm-pi-ai' ? removedRoutes(profiles(this.ctx), 'mutate', ops) : [] // 不触发其它命名空间的业务删除检查。
      return guarded(routes, 'settings', () => super.mutate(ns, ops, expectedRevision))
    }
    /**
     * 对官方深合并保留普通编辑，仅保护明确清空连接或模型的供应商重置。
     * @param {string} ns 原生命名空间。
     * @param {object} patch 公开合并片段。
     * @param {number|undefined} expectedRevision 原生 CAS 基线。
     * @returns {Promise<object>} 原始官方回执。
     * @throws {RemoteError} 用途拒绝、资格故障或原始官方 Schema/CAS 错误。
     */
    async update(ns, patch, expectedRevision) {
      const routes = ns === 'llm-pi-ai' ? removedRoutes(profiles(this.ctx), 'update', patch) : [] // 官方deepmerge语义与窄重置保护共享。
      return guarded(routes, 'settings', () => super.update(ns, patch, expectedRevision))
    }
    /**
     * 在原生整段替换之前保护会被删除或重置的已有供应商。
     * @param {string} ns 原生命名空间。
     * @param {object} section 公开整段替换。
     * @param {number|undefined} expectedRevision 原生 CAS 基线。
     * @returns {Promise<object>} 原始官方回执。
     * @throws {RemoteError} 用途拒绝、资格故障或原始官方 Schema/CAS 错误。
     */
    async replace(ns, section, expectedRevision) {
      const routes = ns === 'llm-pi-ai' ? removedRoutes(profiles(this.ctx), 'replace', section) : [] // 整段替换仅检查真实被删除或重置的路由。
      return guarded(routes, 'settings', () => super.replace(ns, section, expectedRevision))
    }
  }
  /** 保留官方Credentials全部读取/设置行为；删除关联Key前核对所有受影响的当前私有路由。 */
  class GuardedCredentialsController extends CredentialsController {
    /**
     * 删除原生 Key 引用之前保护所有实际关联的当前供应商。
     * @param {string} ref 原生 Credential 引用身份，绝非 Key 明文。
     * @returns {Promise<void>} 后台共享撤销与原始官方删除完成。
     * @throws {RemoteError} 独立连接迁移拒绝、资格故障或原始 Credentials 拒绝。
     */
    async unset(ref) {
      const routes = Object.entries(profiles(this.ctx)).filter(([, profile]) => profile?.apiKeyEnv === ref).map(([route]) => route) // 同一引用可能由多个Provider共用，必须全部获准才删除。
      return guarded(routes, 'credentials', () => super.unset(ref))
    }
  }
  return ctx.plugin({
    name: 'adminsmart-settings-delete-policy', // 自有装配属主，不篡改原Controller的上下文所有权。
    inject: ['configEditor', 'settings', 'credentials'], // 构造前确认原生能力齐备，缺失则不开放半套管理接口。
    /**
     * 在本插件的实际提供方上下文创建继承官方协议的两个 Remote。
     * @param {object} owner 官方 Cordis 为本插件创建的 Context。
     * @returns {void} 注册由该 fiber 生命周期释放的服务。
     */
    apply(owner) {
      new GuardedSettingsController(owner) // serviceKey=settingsController，继承原始Remote及CAS行为。
      new GuardedCredentialsController(owner) // serviceKey=credentialsController，普通用户不会装载。
    },
  })
}
