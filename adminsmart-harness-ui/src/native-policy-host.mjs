/** 当前 Runtime 的原生配置共享 Adapter；只调用官方 Settings/公开插件回调，不渲染配置页面。 */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  NATIVE_POLICY_FIELDS,
  NATIVE_POLICY_VERSION,
  isNativePluginId,
  isOfficialBundleName,
  emptyNativePolicy,
  isNativePolicy,
  isNativePolicyField,
  withNativeRequest,
} from './native-policy-client.mjs'
import { watchUiPolicyEvents } from './shared-ui-policy.mjs'

const API_PATH = '/internal/agent-model/v1/native-policy' // 唯一受权后端路径，不能由浏览器输入选择。
const BROWSER_PATH = '/adminsmart/native-policy' // 当前已签名 Runtime 的非敏感同源入口。
const MODULE_PATH = '/adminsmart/native-policy-client.mjs' // 固定纯模块入口，不提供任意文件映射。
const REVISION_GLOBAL = '__ADMINSMART_NATIVE_POLICY_CLIENT_REVISION__' // 页面启动元数据仅含固定代码哈希。
const BASELINE_GLOBAL = '__ADMINSMART_NATIVE_POLICY_BASELINE__' // 共享策略的非敏感业务继承值，来源是冻结模板而不是当前租户 Profile。
const EVENTS_PATH = '/adminsmart/native-policy/events' // 只发送当前已验证政策修订，不复制设置或伪造官方事件。
const MAXIMUM_NATIVE_POLICY_BODY_BYTES = 65_536 // 插件256项及组合64项仍在统一64KiB预算内，避免合法全站管理被旧16KiB正文限制误拒。
const TIMEOUT_MS = 5_000 // 单次受权请求的有界等待。
const REFRESH_MS = 30_000 // SSE 断线和 API 先后发布的低频补偿，不阻塞问答。

/**
 * 校验受权后端信封，不以 Runtime 现值补齐缺失政策。
 * @param {unknown} payload 后端 native JSON 候选。
 * @returns {boolean} 是否为合法持久化修订与固定版本策略；null 只允许配 revision0。
 */
function envelope(payload) {
  return (
    payload &&
    Number.isSafeInteger(payload.revision) &&
    payload.revision >= 0 &&
    (payload.settings === null
      ? payload.revision === 0
      : payload.revision >= 1 && isNativePolicy(payload.settings))
  )
}

/**
 * 将明确的非敏感 namespace patch 应用到当前用户的官方 Settings。
 * @param {object} settings 官方公开 SettingsForms。
 * @param {object} policy 已由严格白名单校验的完整原生策略。
 * @param {object} [baseline] 冻结模板的非敏感继承值，缺业务并发基线时拒绝恢复。
 * @returns {Promise<void>} 所有存在的原生 namespace 按官方局部 CAS 采用完成。
 * @throws {Error} 官方 Schema、权限或写入拒绝；上层只能报告保存成功后的分发延迟。
 */
export async function applyNativeNamespaces(settings, policy, baseline = {}) {
  for (const [ns, fields] of Object.entries(NATIVE_POLICY_FIELDS)) {
    const row = settings
      .describe({ redactSecrets: true })
      .find((item) => item.ns === ns) // 每个 namespace 使用该 Runtime 最新的官方修订。
    if (!row) continue // 普通角色未装管理页时，不伪造其 namespace 或扩大装配。
    const patch = policy.namespaces[ns] ?? {} // 省略字段恢复可信模板/官方继承，不把默认值写入全站策略。
    const operations = [] // 只编辑允许字段；不触碰旧 General、其它 Config 或凭据。
    for (const field of fields) {
      if (Object.hasOwn(patch, field)) {
        if (JSON.stringify(row.value?.[field]) !== JSON.stringify(patch[field]))
          operations.push({ op: 'set', path: [field], value: patch[field] })
        continue
      }
      if (Object.hasOwn(baseline[ns] ?? {}, field)) {
        if (
          JSON.stringify(row.value?.[field]) !==
          JSON.stringify(baseline[ns][field])
        )
          operations.push({
            op: 'set',
            path: [field],
            value: baseline[ns][field],
          })
        continue
      }
      if (ns === 'subagent' || ns === 'agent-loop')
        throw new Error('业务运行共享继承基线未确认') // 不得 unset 到上游8/10，缺可信基线保持现值并报告应用延迟。
      if (Object.hasOwn(row.user ?? {}, field))
        operations.push({ op: 'unset', path: [field] }) // 字体与欢迎确认交由官方继承，未声明值不凭名称猜默认。
    }
    if (operations.length) await settings.mutate(ns, operations, row.revision)
  }
}

/**
 * 装配 signed HTTP、静态纯模块及持续确认循环；同一实现覆盖开发、生产及全部角色。
 * @param {object} ctx 官方 Context，含 settings/webServer/effect/on。
 * @param {object} options Gateway 已验证的 Runtime 请求上下文。
 * @param {string} options.apiBase 固定后端 API 根地址，不能由浏览器选择。
 * @param {Function} options.readToken 取得当前请求受保护凭据，不返回浏览器或日志。
 * @param {string} options.userId 已签名可信用户身份，用于后端权限和归属校验。
 * @param {string} options.modeId 当前可信白名单业务模式。
 * @param {string} options.presetId 当前可信白名单 Agent Preset。
 * @param {boolean} options.isAdmin 可信角色事实；普通 PUT 读 body 前拒绝。
 * @param {object} helpers 受限入口及可隔离依赖。
 * @param {Function} helpers.assertSameOrigin 同源请求检查，不读取 Cookie 明文。
 * @param {Function} helpers.readJsonBody 最大64KiB的正文解析，与后端/cold读取预算一致。
 * @param {Function} [helpers.applyPlugins] 采用已确认官方组合和可寻址行，返回真实SDK应用分类。
 * @param {Function} [helpers.validatePolicy] 保存前验证当前SDK库存、安装与业务兼容性，HTTP PUT与原界面同样经过此准入。
 * @param {Function} [helpers.watchEvents] 复用受权 native 失效通道，事件不包含策略正文。
 * @param {Function} [helpers.fetchImpl] 请求隔离 Fake；默认真实 fetch。
 * @param {Buffer} [helpers.clientModuleSource] 固定模块字节 Fixture，生产从当前冻结 package 只读加载。
 * @param {object} [helpers.nativeBaseline] 根从本修订冻结模板提取的受限继承值。
 * @param {number} [helpers.requestTimeoutMs=5000] 请求连接、Token 读取和正文共同预算，目标测试可缩短。
 * @returns {object} commitPlugin、setPluginApplier、refresh、快照与清理能力。
 * @throws {Error} 固定模块读取失败或冻结继承基线无效。
 * @remarks 后端保存与各 Runtime 应用不是分布式原子事务；应用失败不撤销已经提交的策略。
 */
export async function installNativePolicy(ctx, options, helpers) {
  const moduleSource = Buffer.from(
    helpers.clientModuleSource ??
      (await readFile(new URL('./native-policy-client.mjs', import.meta.url))),
  ) // 版本与 HTTP 实体必须来自同一个不可变源码快照。
  const revision = createHash('sha256').update(moduleSource).digest('hex') // 仅公开静态代码版本，不混入用户或政策修订。
  const fetchImpl = helpers.fetchImpl ?? globalThis.fetch // 固定受权传输，只允许测试通过 Fake 隔离网络。
  const nativeBaseline = structuredClone(helpers.nativeBaseline ?? {}) // 根根据冻结模板提供，不能从浏览器或已覆盖租户值捕获。
  if (
    Object.entries(nativeBaseline).some(
      ([ns, fields]) =>
        !Object.hasOwn(NATIVE_POLICY_FIELDS, ns) ||
        !fields ||
        typeof fields !== 'object' ||
        Array.isArray(fields) ||
        Object.entries(fields).some(
          ([field, value]) => !isNativePolicyField(ns, field, value),
        ),
    )
  )
    throw new Error('原生共享继承基线无效')
  let disposed = false // 生命周期终止后不采用迟到策略。
  let confirmed = null // 唯一后端确认的 native 修订，不能以当前官方 Profile 值播种。
  let appliedRevision = null // 已完整应用到当前 Runtime 的修订，不冒充全员事务。
  let bootstrapAdoptionConfirmed = false // 最近一次确认与采用完整成功才允许HTML初值；不保存新的策略或权限缓存。
  let pluginApplier = helpers.applyPlugins ?? null // 注入安装顺序不形成循环，根在官方服务激活后设置。
  let pluginValidator = helpers.validatePolicy ?? null // 当前SDK库存和业务兼容性准入；HTTP直接PUT也不能跳过管理目标校验。
  let pending = null // 当前全策略 GET/apply 循环防并发。
  let rerun = false // 应用期间收到失效事件则再确认一次。
  let writes = Promise.resolve() // 管理员相同 Runtime 的写入按顺序使用真实 CAS。
  let unsupported = false // 新 Gateway 先于新 API 时只保留官方基线，不永久停装配。
  const cleanups = [] // 当前 Runtime 的路由、监听器和计时器。
  const connections = new Set() // 当前已认证 Runtime 浏览器的 SSE 连接，不包含用户标识或配置正文。
  const lifecycle = new AbortController() // 生命周期结束及时结算所有在途政策请求，不等待迟到正文。

  /**
   * 核对实际原生展示字段仍等于已采用策略及其可信继承，不读取任何模型或秘密值。
   * @returns {boolean} 当前每个存在的原生namespace均与确认策略一致，缺失域不补造。
   * @sideEffects 公开脱敏describe可发原生失效事件；调用者仍须复核采用确认未被撤销。
   */
  const bootstrapValuesMatch = () => {
    const rows = ctx.settings.describe({ redactSecrets: true }) // 当前官方实际生效值及base，不能用旧appliedRevision代替核对。
    if (!Array.isArray(rows)) return false
    for (const [ns, fields] of Object.entries(NATIVE_POLICY_FIELDS)) {
      const row = rows.find(item => item.ns === ns) // 普通角色没有的原生域保持缺行。
      if (!row) continue
      const patch = confirmed.settings.namespaces[ns] ?? {} // 明确共享值优先，其余字段遵循与采用器完全一致的继承规则。
      for (const field of fields) {
        const expected = Object.hasOwn(patch, field) ? patch[field]
          : Object.hasOwn(nativeBaseline[ns] ?? {}, field) ? nativeBaseline[ns][field]
            : row.base?.[field] // 官方base已完成当前版本默认解析，不按名称猜测字体或欢迎版本。
        if (!Object.hasOwn(patch, field) && !Object.hasOwn(nativeBaseline[ns] ?? {}, field)
          && (ns === 'subagent' || ns === 'agent-loop' || Object.hasOwn(row.user ?? {}, field))) return false
        if (JSON.stringify(row.value?.[field]) !== JSON.stringify(expected)) return false
      }
    }
    return true
  }

  ctx.effect(() => ctx.on('settings/document-updated', ns => {
    if (Object.hasOwn(NATIVE_POLICY_FIELDS, ns)) bootstrapAdoptionConfirmed = false // 原生raw文档改变即撤销旧采用证明；下一轮受权采用成功后才恢复。
  }), 'adminsmart-native-policy: invalidate bootstrap adoption')

  /**
   * 通知当前已认证 Runtime 的页面政策失效。
   * @param {object} saved 已验证后的后端确认信封。
   * @returns {void} 仅发送独立 revision，客户端必须重新受权 GET。
   * @sideEffects 单页面断开仅解除该 SSE，不把已提交政策报告成失败。
   */
  const notifyBrowsers = (saved) => {
    const message = `event: native-policy-changed\ndata: ${JSON.stringify({ revision: saved.revision })}\n\n` // 仅已确认政策修订，不含namespace、actor或凭据。
    for (const response of connections) {
      try {
        response.write(message)
      } catch {
        connections.delete(response)
        try {
          response.end()
        } catch {
          /* 单个断开页面不能使已提交策略报成保存失败。 */
        }
      }
    }
  }

  /**
   * 在有界生命周期内请求固定受权后端入口。
   * @param {'GET'|'PUT'} method 固定读取或提交操作。
   * @param {object} [body] 已校验策略和可选双 CAS，读取时省略。
   * @returns {Promise<object>} 经白名单确认的策略与旧 General ACK。
   * @throws {Error} 凭据取得失败、超时、权限/CAS 拒绝或非法响应；不解析失败正文。
   */
  const request = async (method, body) => {
    return withNativeRequest(
      async (signal) => {
        const token = await options.readToken() // 凭据只在本次 Host 请求栈，绝不返回浏览器。
        if (signal.aborted) throw new Error('原生设置请求已停止')
        const response = await fetchImpl(
          options.apiBase.replace(/\/$/u, '') + API_PATH,
          {
            method, // 只允许当前固定 API 的 GET/PUT 操作。
            redirect: 'error', // 不转发受保护凭据到重定向地址。
            headers: {
              // 签名凭据和可信上下文只发送给既定后端，不输出到日志。
              Authorization: `Bearer ${token}`, // 本次内部签名 Token，不持久化或返回浏览器。
              'Content-Type': 'application/json', // 受限 JSON 协议，不接受可执行模板。
              'X-AdminSmart-User-Id': options.userId, // 后端以可信登录身份执行业务权限校验。
              'X-AdminSmart-Agent-Mode-Id': options.modeId, // 防止跨业务模式借用能力。
              'X-AdminSmart-Agent-Preset-Id': options.presetId, // 与租约白名单 Agent Preset 一致。
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal, // Token、连接与正文共同继承总预算和卸载取消。
          },
        )
        if (!response.ok) {
          const error = new Error('原生共享设置暂不可用') // 不解析上游错误或认证正文。
          error.status = [403, 409, 404].includes(response.status)
            ? response.status
            : 503 // 404 只表示本轮尚未部署 API。
          throw error
        }
        const payload = await response.json().catch(() => null) // 损坏或未知策略不可进入官方变更调用。
        if (!envelope(payload)) throw new Error('原生共享设置响应无效')
        return {
          revision: payload.revision, // 后端 Native CAS 修订，不与任何官方局部修订混用。
          settings:
            payload.settings === null
              ? null
              : structuredClone(payload.settings), // 已确认的完整受限策略副本。
          general: payload.general, // 混合写入独立 General ACK，最终经原接口严格解析。
          delayed:
            response.headers?.get?.('X-AdminSmart-UI-Policy-Delivery') ===
            'delayed', // 后端已提交、全员采用仍等待补偿的真实状态。
        } // 旧 General 双 CAS ACK 原样经原接口最终校验。
      },
      {
        signal: lifecycle.signal,
        timeoutMs: helpers.requestTimeoutMs ?? TIMEOUT_MS,
      },
    )
  }
  /**
   * 将后端确认政策应用到当前 Runtime 原始服务。
   * @param {object} saved 已校验的完整确认信封。
   * @returns {Promise<void>} namespace及明确官方启停采用已结算；非applied结果不声明完成修订。
   * @throws {Error} 官方采用失败，提交器保留已保存政策并报告 delayed。
   * @sideEffects 经原SDK更新当前Runtime配置与已选组合，不自动改变会话模型或effort。
   */
  const adopt = async (saved) => {
    if (disposed || saved.settings === null) return // 无政策不播种默认或清空原生状态。
    if (confirmed && saved.revision < confirmed.revision) {
      rerun = true
      return
    } // 较旧异步采用不能落后于已确认提交。
    bootstrapAdoptionConfirmed = false // 正在采用或失败期间，旧同revision完成记录不能冒充这轮完整确认。
    await applyNativeNamespaces(ctx.settings, saved.settings, nativeBaseline)
    if (confirmed && saved.revision < confirmed.revision) {
      rerun = true
      return
    }
    const pluginResults = pluginApplier ? await pluginApplier(saved.settings.plugins, saved.settings.bundles ?? {}) ?? [] : [] // 正式回调返回SDK数组；旧无结果接线仍兼容，但实际插件变化须由当前受管manager明确报告。
    if (!disposed) {
      appliedRevision =
        (!confirmed || saved.revision === confirmed.revision) &&
        (pluginApplier || Object.keys(saved.settings.plugins).length === 0 && Object.keys(saved.settings.bundles ?? {}).length === 0)
        && pluginResults.every(result => result?.application === 'applied')
          ? saved.revision
          : null
      if (confirmed && saved.revision < confirmed.revision) rerun = true
      bootstrapAdoptionConfirmed = appliedRevision === confirmed?.revision // 只有最新确认、全部namespace及所需插件均完成的副本可供当前HTML读取。
    } // 等待服务装配或较旧在途采用时不伪造最新完成。
  }
  /**
   * 合并失效通知并确认当前最新策略。
   * @returns {Promise<void>} 串行回读和采用结算；故障保持可恢复状态，不令 Host 激活失败。
   * @sideEffects 确认新 revision 才广播失效，较旧在途采用触发最新补偿。
   */
  const refresh = () => {
    if (disposed) return Promise.resolve()
    if (pending) {
      rerun = true
      return pending
    }
    pending = (async () => {
      do {
        rerun = false
        try {
          const saved = await request('GET') // 所有角色只采纳持久化政策。
          if (disposed || (confirmed && saved.revision < confirmed.revision))
            continue
          const changed = !confirmed || saved.revision !== confirmed.revision // 不把相同 GET 当作新管理员写入。
          confirmed = saved
          unsupported = false
          if (changed) notifyBrowsers(saved)
          await adopt(saved)
        } catch (error) {
          bootstrapAdoptionConfirmed = false // 请求或采用失败只回退现有HTTP路径，不用上次完成记录冒充当前引导确认。
          if (!disposed) {
            unsupported = error.status === 404
            ctx.logger?.warn?.(
              unsupported
                ? '原生设置接口等待受管发布'
                : '原生共享设置同步暂不可用',
            )
          }
        }
      } while (rerun && !disposed)
    })().finally(() => {
      pending = null
    })
    return pending
  }
  /**
   * 顺序提交管理员完整 native region 和可选旧 General region。
   * @param {object} body 标准 expectedRevision/settings/legacyGeneralUpdate 契约。
   * @returns {Promise<object>} 已持久化结果及当前 Runtime 真实分发状态。
   * @throws {Error} 角色拒绝、非法字段、后端 CAS 冲突或传输失败。
   * @sideEffects 后端一次事务提交双 CAS；采用失败不重发也不撤销已保存策略。
   */
  const commit = (body) => {
    const operation = writes.then(async () => {
      if (disposed || options.isAdmin !== true) {
        const error = new Error('管理员权限不足')
        error.status = 403
        throw error
      }
      if (
        !Number.isSafeInteger(body?.expectedRevision) ||
        body.expectedRevision < 0 ||
        !isNativePolicy(body?.settings) ||
        Object.keys(body).some(
          (key) =>
            !['expectedRevision', 'settings', 'legacyGeneralUpdate'].includes(
              key,
            ),
        )
      ) {
        const error = new Error('原生共享设置请求无效')
        error.status = 400
        throw error
      }
      const previous = confirmed?.settings ?? emptyNativePolicy() // 只用真正确认的Native基线判断插件区域是否变化，不借浏览器修订。
      const managementChanged = JSON.stringify(body.settings.plugins) !== JSON.stringify(previous.plugins)
        || JSON.stringify(body.settings.bundles ?? {}) !== JSON.stringify(previous.bundles ?? {}) // 任一管理区域变化都在服务器保存前完成当前SDK目标及兼容性检查。
      if (managementChanged) {
        if (!pluginValidator) throw new Error('官方插件管理验证尚未就绪，请重新连接')
        await pluginValidator(body.settings.plugins, body.settings.bundles ?? {}, previous)
      }
      const saveBody = { ...body, settings: { ...body.settings, harnessVersion: NATIVE_POLICY_VERSION } } // 读旧版本不改存档；新管理员明确保存才标当前已核验官方协议。
      const saved = await request('PUT', saveBody) // 两个独立CAS由后端同一事务检查，不拆写也不丢旧值。
      if (!disposed && (!confirmed || saved.revision >= confirmed.revision))
        confirmed = saved
      if (!disposed) notifyBrowsers(saved) // 仅 clientPreferences 更新也立刻使所有已开页面回读。
      let delayed = saved.delayed // 保存已成功；各 Runtime 尚未应用属于另一条结果。
      try {
        await adopt(saved)
        if (appliedRevision !== saved.revision) delayed = true // 原SDK要求重启、被覆盖或失败时不能向浏览器声称全员已应用。
      } catch {
        bootstrapAdoptionConfirmed = false // 数据库保存与当前Runtime采用分离；delayed回执不能作为已采用HTML初值。
        delayed = true
      }
      return { ...saved, delayed }
    })
    writes = operation.then(
      () => {},
      () => {},
    ) // 一次失败不永久阻塞管理员后续原生操作。
    return operation
  }
  ctx.effect(
    () =>
      ctx.on('webserver/index-inject', (table) => {
        const preload = '<link rel="modulepreload" crossorigin href=".' + MODULE_PATH + '?rev=' + revision + '">' // 当前固定Native桥代码提前下载，模块不执行且不触发政策GET/管理写入。
        if (!table.some(row => row.kind === 'html' && row.html === preload))
          table.unshift({ kind: 'html', placement: 'head', html: preload }) // 保留官方图与合并包预载，只补图外既有受管模块并防止同一文档重复提示。
        table.push({ kind: 'global', name: REVISION_GLOBAL, value: revision })
      }),
    'adminsmart-native-policy: trusted module revision',
  )
  ctx.effect(
    () =>
      ctx.on('webserver/index-inject', (table) =>
        table.push({
          kind: 'global',
          name: BASELINE_GLOBAL,
          value: nativeBaseline,
        }),
      ),
    'adminsmart-native-policy: shared business baseline',
  )
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact', // 固定完整路径匹配，不能泛映射服务器文件。
        path: MODULE_PATH, // 当前冻结纯模块的唯一公开代码入口。
        /**
         * 返回同字节静态实体或 HEAD 元数据。
         * @param {object} request 官方受权 WebServer 请求。
         * @param {object} response 当前 HTTP 响应。
         * @returns {void} 当前 SHA 私有永久缓存；legacy 不缓存，错误/重复 SHA 返回410。
         */
        handler(request, response) {
          if (!['GET', 'HEAD'].includes(request.method)) {
            response.writeHead(405, {
              allow: 'GET, HEAD',
              'cache-control': 'no-store',
            })
            response.end()
            return
          }
          const versions = new URL(
            request.url || MODULE_PATH,
            'http://runtime.invalid',
          ).searchParams.getAll('rev') // URL 不能选择文件或影响身份。
          if (
            versions.length > 1 ||
            (versions.length === 1 && versions[0] !== revision)
          ) {
            response.writeHead(410, { 'cache-control': 'no-store' })
            response.end()
            return
          }
          response.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8', // 明确纯模块 MIME，不接受类型嗅探。
            'content-length': String(moduleSource.byteLength), // GET/HEAD 同一个冻结实体字节长度。
            'cache-control': versions.length
              ? 'private, max-age=31536000, immutable'
              : 'no-store', // 仅正确代码身份允许浏览器私有不可变缓存。
            'x-content-type-options': 'nosniff', // 避免把代码资源嗅探为其它内容。
          })
          response.end(request.method === 'HEAD' ? undefined : moduleSource)
        },
      }),
    'adminsmart-native-policy: fixed pure module',
  )
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact', // 精确策略 API，不接受任意后端路径。
        path: BROWSER_PATH, // 当前 Runtime 受权同源桥。
        /**
         * 读取策略或提交可信管理员操作。
         * @param {object} request 官方已绑定 Runtime 的请求。
         * @param {object} response 当前不可缓存 JSON 响应。
         * @returns {Promise<void>} 普通 PUT 在解析正文前拒绝，错误仅返回稳定业务文案。
         */
        async handler(request, response) {
          if (!['GET', 'PUT'].includes(request.method)) {
            response.writeHead(405, {
              allow: 'GET, PUT',
              'cache-control': 'no-store',
            })
            response.end()
            return
          }
          try {
            try {
              helpers.assertSameOrigin(request)
            } catch {
              const error = new Error('跨站请求已拒绝')
              error.status = 403
              throw error
            }
            if (request.method === 'PUT' && options.isAdmin !== true) {
              const error = new Error('管理员权限不足')
              error.status = 403
              throw error
            }
            const saved =
              request.method === 'GET'
                ? await requestBackendGet()
                : await commit(await helpers.readJsonBody(request, MAXIMUM_NATIVE_POLICY_BODY_BYTES)) // 动态数据始终受权且不缓存，超预算在保存前明确拒绝。
            response.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
              ...(request.method === 'PUT'
                ? {
                    'X-AdminSmart-UI-Policy-Delivery': saved.delayed
                      ? 'delayed'
                      : 'delivered',
                  }
                : {}),
            })
            response.end(
              JSON.stringify({
                revision: saved.revision, // 后端确认的 Native 独立修订。
                settings: saved.settings, // 严格白名单非敏感策略，不包含 Token 或 Provider。
                writable: options.isAdmin === true, // 只取 Gateway 可信角色，不从浏览器声明取值。
                ...(saved.general ? { general: saved.general } : {}),
              }),
            )
          } catch (error) {
            response.writeHead(
              [400, 403, 404, 409].includes(error.status) ? error.status : 503,
              {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
              },
            )
            response.end(JSON.stringify({ error: '原生共享设置暂不可用' }))
          }
        },
      }),
    'adminsmart-native-policy: signed global bridge',
  )
  /**
   * 为页面取得后端当前确认策略。
   * @returns {Promise<object>} 原始确认信封；API 不存在时不伪造 revision0。
   * @throws {Error} 稳定传输/后端错误，由路由转换为不可缓存业务响应。
   */
  const requestBackendGet = () => request('GET')
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact', // 只匹配当前固定 SSE 入口。
        path: EVENTS_PATH, // 当前 Runtime 非敏感 revision-only 流。
        /**
         * 订阅当前受权 Runtime 的策略失效事件。
         * @param {object} request 官方请求上下文，仍需同源校验。
         * @param {object} response 当前 SSE 响应，关闭后从连接集合解除。
         * @returns {void} 首次补发已确认 revision，不广播设置、身份或凭据。
         */
        handler(request, response) {
          if (request.method !== 'GET') {
            response.writeHead(405, {
              allow: 'GET',
              'cache-control': 'no-store',
            })
            response.end()
            return
          }
          try {
            helpers.assertSameOrigin(request)
          } catch {
            response.writeHead(403, { 'cache-control': 'no-store' })
            response.end()
            return
          }
          response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
          })
          response.write(': connected\n\n')
          connections.add(response)
          response.on('close', () => connections.delete(response))
          if (confirmed)
            response.write(
              `event: native-policy-changed\ndata: ${JSON.stringify({ revision: confirmed.revision })}\n\n`,
            )
        },
      }),
    'adminsmart-native-policy: revision-only browser events',
  )
  ctx.effect(() => {
    const timer = setInterval(() => {
      void refresh()
    }, REFRESH_MS) // 发布顺序兼容与事件断线的低频补偿。
    timer.unref?.()
    const unsubscribe = helpers.watchEvents
      ? helpers.watchEvents(options, refresh)
      : watchUiPolicyEvents(options, refresh, { kind: 'native', fetchImpl }) // 复用有界签名流，事件仅使政策失效，不采纳广播正文。
    void refresh()
    const dispose = () => {
      disposed = true
      lifecycle.abort()
      clearInterval(timer)
      unsubscribe?.()
      for (const response of connections) {
        try {
          response.end()
        } catch {
          /* 卸载忽略单个断开的SSE。 */
        }
      }
      connections.clear()
      for (const cleanup of cleanups.reverse()) cleanup?.()
    }
    cleanups.push(() => clearInterval(timer))
    return dispose
  }, 'adminsmart-native-policy: global confirmation loop')
  return {
    refresh, // 根和可信失效流使用同一个合并确认器。
    getPolicySnapshot: () => confirmed && structuredClone(confirmed), // 管理桥只使用已确认政策，不公开 Token。
    /**
     * 读取已完整采用且可用于当前HTML首次装配的确认副本。
     * @returns {object|null} 有效revision/settings/writable；未确认、空政策、采用失败、等待插件或卸载时返回null。
     * @sideEffects 无网络、写入或新缓存，不改变原getPolicySnapshot的管理桥语义。
     */
    getBootstrapSnapshot() {
      if (disposed || unsupported || !bootstrapAdoptionConfirmed || !confirmed?.settings || appliedRevision !== confirmed.revision) return null
      try {
        if (!bootstrapValuesMatch() || !bootstrapAdoptionConfirmed) return null // describe期间的原生变化事件同样不能用旧确认覆盖。
      } catch { return null } // 描述异常保留既有HTTP恢复，不以旧成功状态下发HTML。
      return {
        revision: confirmed.revision, // Native独立CAS；不能与官方namespace或General修订混用。
        settings: structuredClone(confirmed.settings), // 当前确认安全region的分离副本。
        writable: options.isAdmin === true, // 可信Runtime角色；HTML装配仍与公开SettingsController能力求交集。
      }
    },
    getStatus: () => ({ unsupported, appliedRevision }), // 不假称所有用户原子应用。
    /**
     * 根官方插件服务激活后接入受限内部采用能力。
     * @param {Function} applyPlugins 仅接后端确认启停状态的原SDK回调，组合先于对应行采用。
     * @param {Function} [validatePolicy] 当前官方库存和业务兼容性准入；实际管理区域变更缺此能力时拒绝保存。
     * @returns {Promise<void>} 再确认一次最新政策，补回初始装配缺口。
     * @throws {Error} 非函数能力拒绝；不允许从浏览器提供回调。
     */
    async setPluginApplier(applyPlugins, validatePolicy) {
      if (typeof applyPlugins !== 'function')
        throw new Error('插件采用能力无效')
      pluginApplier = applyPlugins
      if (validatePolicy !== undefined && typeof validatePolicy !== 'function') throw new Error('插件管理验证能力无效')
      pluginValidator = validatePolicy ?? pluginValidator
      await refresh()
    }, // 根服务激活后补回初始确认政策。
    /**
     * 保存当前官方可管理行的明确启停操作，实际目标在commit前再次由SDK验证。
     * @param {string} patchId 当前SDK返回的稳定可寻址行身份。
     * @param {boolean} enabled 管理员明确选择的启用状态。
     * @returns {Promise<object>} 后端已保存的完整策略与真实 delayed 状态。
     * @throws {Error} 未批准插件、无确认政策、角色/校验/CAS 或传输失败。
     */
    async commitPlugin(patchId, enabled) {
      if (
        !isNativePluginId(patchId) ||
        typeof enabled !== 'boolean'
      )
        throw new Error('插件不属于共享设置范围')
      if (!confirmed) await refresh()
      if (!confirmed) throw new Error('共享插件设置尚未确认')
      const settings = structuredClone(
        confirmed.settings ?? emptyNativePolicy(),
      ) // 只修改当前确认副本上的一行，保留其它 namespace 与偏好。
      settings.plugins[patchId] = enabled
      return commit({ expectedRevision: confirmed.revision, settings })
    },
    /**
     * 保存已安装官方组合的明确选择，保持其原SDK依赖与实际应用结果。
     * @param {string} name 当前固定官方包名，不是安装规格。
     * @param {boolean} enabled 明确启停选择，不自动打开其它实验组合。
     * @returns {Promise<object>} 独立NativeCAS结果及真实delayed状态。
     * @throws {Error} 身份/安装/兼容/原生保护或CAS不满足，不提前局部修改。
     */
    async commitBundle(name, enabled) {
      if (!isOfficialBundleName(name) || typeof enabled !== 'boolean') throw new Error('官方插件组合身份无效')
      if (!confirmed) await refresh()
      if (!confirmed) throw new Error('共享插件设置尚未确认')
      const settings = structuredClone(confirmed.settings ?? emptyNativePolicy()) // 保留其他管理行与原生偏好，只修改当前明确选择。
      settings.bundles = { ...(settings.bundles ?? {}), [name]: enabled }
      return commit({ expectedRevision: confirmed.revision, settings })
    },
  }
}
