/** AdminSmart Harness Host routes and client-module owner. */

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installFeedbackMutationSync, installFeedbackRoute } from './feedback.mjs'
import { installManagedProviderSync } from './model-provider.mjs'
import { installSharedUiPolicy } from './shared-ui-policy.mjs'
import { installPolicyBootstrapHost } from './policy-bootstrap-host.mjs'
import { installUiPolicyHttp } from './ui-policy-http.mjs'
import { installPersonalThemeHttp } from './personal-theme-http.mjs'
import { installShortcutPolicyHttp } from '../shared-shortcuts/src/shortcut-policy-http.mjs'
import { installGuardedSettingsControllers, providerDeletionError } from './guarded-settings-controller.mjs'
import { installGuardedPluginManager } from './guarded-plugin-manager.mjs'
import { installNativePolicy } from './native-policy-host.mjs'
import { installManagedModelSync } from './managed-model-sync.mjs'
import { installManagedWorkspace } from './managed-workspace.mjs'

export const name = 'adminsmart-client-ui-host'
export const inject = ['workspaceRegistry', 'sessionPersistence', 'sessions', 'webServer', 'messageFeedback', 'configEditor', 'credentials', 'settings', 'llm', 'agentDefaultModel', 'agents', 'attachments', 'fileUploads', 'fs', 'sessionProjections', 'sessionQuery', 'typert', 'remoteAccess'] // 联合当前原Workspace/Session完整依赖；主Host只有基础服务齐备才执行apply，不能把pending子fiber当作已装配。

const AURASEARCH_LOGO_ROUTE = '/adminsmart/assets/aurasearch-logo.webp' // 当前受管256像素WebP品牌入口，原始JPG仍在仓库保留，不要求浏览器下载大原图。
const AURASEARCH_LOGO_PATH = fileURLToPath(new URL('../assets/aurasearch-logo.webp', import.meta.url)) // 同一已批准画面的压缩副本，禁止从用户上传或运行目录选择图片。
const MAXIMUM_HOST_JSON_BODY_BYTES = 64 * 1024 // Host 控制路由默认的 JSON 请求体上限，限制模型及偏好输入占用的内存。

/** Read one required Runtime environment value without exposing it. */
function requiredEnvironment(variableName) {
  const environmentValue = String(process.env[variableName] ?? '').trim() // Runtime-only value; never logged or persisted by this plugin.
  if (!environmentValue) throw new Error(`AdminSmart Harness 缺少运行配置：${variableName}`)
  return environmentValue
}
/**
 * 在各 Host 路由自己的字段校验前读取有界 JSON 正文。
 * @param {import('node:http').IncomingMessage} request 当前浏览器请求的正文流；内容只在本次调用中使用。
 * @param {number} maximumBytes 当前路由允许的最大字节数；较大视图快照可以显式指定上限。
 * @returns {Promise<unknown>} 已解析的 JSON 值；空正文返回空对象，业务字段由调用路由继续验证。
 * @throws {Error} 正文超出上限、请求流失败或 JSON 无效时拒绝，不保留部分正文。
 * @sideEffects 消费当前请求流，不写入文件或日志。
 */
async function readJsonBody(request, maximumBytes = MAXIMUM_HOST_JSON_BODY_BYTES) {
  const chunks = [] // 当前请求的临时正文分片，完成解析后不持久化。
  let receivedBytes = 0 // 累计实际收到的字节数，防止浏览器输入造成无界缓冲。
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk) // 把当前请求分片统一为字节，保持上限计算准确。
    receivedBytes += bytes.length
    if (receivedBytes > maximumBytes) throw new Error('请求正文过大')
    chunks.push(bytes)
  }
  const bodyText = Buffer.concat(chunks).toString('utf8') // 有界控制正文只供当前路由解析，可能包含模型凭据，不写入日志或持久状态。
  return JSON.parse(bodyText || '{}')
}

/** Reject cross-site browser writes before a Session setting is read or changed. */
function assertSameOriginBrowserRequest(request) {
  const fetchSite = String(request.headers['sec-fetch-site'] ?? '').trim().toLowerCase() // 浏览器提供的 Fetch Metadata 站点关系。
  if (fetchSite && fetchSite !== 'same-origin') throw new Error('跨站请求已拒绝')
  const origin = String(request.headers.origin ?? '').trim() // 浏览器发起 CORS 相关请求时携带的来源。
  if (!origin) return
  const host = String(request.headers.host ?? '').trim() // 当前 Harness Host 的同源主机和端口。
  let parsedOrigin // 结构化来源用于比较协议和完整 host。
  try {
    parsedOrigin = new URL(origin)
  } catch {
    throw new Error('请求来源无效')
  }
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.host !== host) {
    throw new Error('跨站请求已拒绝')
  }
}

/** Read the current Runtime capability token for a Host-to-FastAPI admin call. */
async function readRuntimeCapabilityToken() {
  const tokenPath = resolve(requiredEnvironment('ADMINSMART_AGENT_TOKEN_FILE')) // Gateway-owned protected capability file; never returned to the browser.
  const token = String(await readFile(tokenPath, 'utf8')).trim() // Token remains in the current server call stack only.
  if (!token) throw new Error('Runtime 能力凭证为空')
  return token
}

/**
 * 使用官方结构化 Index Injection 在插件启动前公开当前 Runtime 的 UI 角色。
 * @param {object} ctx 提供 webserver/index-inject 事件的官方 Host Context。
 * @param {boolean} isAdmin Gateway 签名租约传入的可信管理员标记。
 * @returns {Function} 释放当前 Host 的 Index Injection 监听器。
 * @remarks 只传角色枚举，不传用户标识、Token 或模型凭据；服务端授权仍独立校验。
 */
export function installRuntimeRoleIndexInjection(ctx, isAdmin) {
  return ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global', // 官方先渲染 JSON 全局值，再启动客户端模块。
      name: '__ADMINSMART_RUNTIME_ROLE__', // 自有 Client 唯一使用的 UI 启动标记。
      value: isAdmin === true ? 'admin' : 'managed-user', // 普通用户只补原生语音启动依赖。
    })
  })
}

/**
 * 读取 Gateway 从冻结模板验证并注入的受管子代理继承值。
 * @returns {object} 只包含一层子代理边界和冻结模板的官方并行配置继承值。
 * @throws {Error} 缺失、损坏或越界时拒绝装配，不猜测供应商或 SDK 默认值。
 */
function nativePolicyBaseline() {
  let baseline // 当前 Gateway 传入的非敏感固定 Profile 字段。
  try { baseline = JSON.parse(requiredEnvironment('ADMINSMART_AGENT_NATIVE_BASELINE_JSON')) }
  catch { throw new Error('受管原生配置基线无效') }
  const limits = baseline?.subagent // 子代理实际模板值，深度保持项目的一层业务边界。
  const loop = baseline?.['agent-loop'] // 官方工具并行预算的受管继承值，不把当前默认当作新的权限上限。
  if (!baseline || Object.keys(baseline).sort().join() !== 'agent-loop,subagent' || !limits
    || Object.keys(limits).sort().join() !== 'maxActiveSubagents,maxDepth'
    || !Number.isInteger(limits.maxDepth) || limits.maxDepth < 0 || limits.maxDepth > 1
    || !Number.isSafeInteger(limits.maxActiveSubagents) || limits.maxActiveSubagents < 1
    || !loop || Object.keys(loop).join() !== 'maxParallelToolCalls'
    || !Number.isSafeInteger(loop.maxParallelToolCalls) || loop.maxParallelToolCalls < 1) throw new Error('受管原生配置基线无效')
  return baseline
}

/**
 * 装配产品资源、Session 控制、模型管理和用户界面状态的 Host 能力。
 * @param {import('@deepseek-ai/cordis').Context} ctx 当前隔离 Runtime 的官方 Host 服务与生命周期上下文。
 * @returns {Promise<void>} 完成官方兼容 Workspace 和自有路由注册；会话搜索由官方 Workspace/SessionQuery 提供。
 * @throws {Error} 受管环境配置或必要官方服务缺失时停止装配，不降级为未授权服务。
 * @sideEffects 注册可卸载路由与监听器，在当前用户 Runtime 中创建官方兼容 Workspace 和状态目录。
 */
export async function apply(ctx) {
  installRuntimeRoleIndexInjection(ctx, process.env.ADMINSMART_AGENT_IS_ADMIN === '1')
  installPersonalThemeHttp(ctx, { assertSameOrigin: assertSameOriginBrowserRequest, readJsonBody }) // 本人明暗独立于管理员共享策略；不扩大普通用户 Settings Remote 写权。
  const harnessRoot = resolve(requiredEnvironment('ADMINSMART_DSH_ROOT')) // 唯一共享的官方 Harness npm 运行项目根。
  const harnessRequire = createRequire(pathToFileURL(resolve(harnessRoot, 'package.json'))) // 以受管项目为解析锚点，避免插件目录或全局依赖影响版本。
  const directoryPickerModuleUrl = pathToFileURL(
    harnessRequire.resolve('@deepseek-ai/dsh-host-directory-picker'),
  ).href // 官方 DirectoryPicker 服务包公开入口，用于提供不访问目录的取消能力。
  const { default: DirectoryPicker } = await import(directoryPickerModuleUrl)
  const surfaceModuleUrl = pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-session/surface')).href // 固定 SDK 公开消息投影入口，不拼接第三方源码路径。
  const { deriveEventMessage, foldSurface } = await import(surfaceModuleUrl)
  const feedbackDependencies = {
    capabilityTokenPath: requiredEnvironment('ADMINSMART_AGENT_TOKEN_FILE'), // Gateway 自有能力文件，用于读取和增量写入的 Runtime 身份证明。
    apiBase: requiredEnvironment('ADMINSMART_AGENT_API_BASE'), // 当前开发或生产 FastAPI 的签名回环根。
    ownerUserId: requiredEnvironment('ADMINSMART_AGENT_USER_ID'), // 当前受管 Runtime 的唯一用户。
    agentModeId: requiredEnvironment('ADMINSMART_AGENT_MODE_ID'), // 当前受管 Runtime 的唯一业务模式。
    agentPresetId: requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'), // 当前已挂载业务能力组合。
    deriveEventMessage, // 官方结构化消息投影，反馈预览只读取 TextBlock。
    foldSurface, // 冷反馈提交事件使用官方 surface fold 重建当前表面。
  } // 反馈读取和增量同步共享同一个可信 Runtime 身份边界。
  installFeedbackRoute(ctx, {
    ...feedbackDependencies,
    ownerUserId: Number(feedbackDependencies.ownerUserId), // 原有读取游标使用数字账号；增量请求头仍保留规范文本。
    readJsonBody, // 复用 Host 有界正文读取器。
  })
  installFeedbackMutationSync(ctx, feedbackDependencies) // 官方反馈事件提交后立即增量更新主应用索引，不扫描其它 Session。
  const auraSearchLogo = await readFile(AURASEARCH_LOGO_PATH) // 当前固定代码快照中的压缩品牌实体，不读取用户图片或未优化原件。
  const brandLogoRevision = createHash('sha256').update(auraSearchLogo).digest('hex') // WebP实际字节的公开版本身份，格式或内容改变后旧浏览器不会沿用同一URL。
  ctx.effect(() => ctx.on('webserver/index-inject', table => table.push({ kind: 'global', name: '__ADMINSMART_BRAND_LOGO_REVISION__', value: brandLogoRevision })), 'adminsmart-client-ui: trusted brand revision')
  const cancelledDirectoryCapability = Object.freeze({
    kind: 'native', // Official DirectoryPickerController expects a native capability descriptor.
    async pick() {
      return null // Every directory request behaves like an operator cancellation and never touches the filesystem.
    },
  }) // Stable capability identity for the full Host plugin lifetime.

  class AdminSmartCancelledDirectoryPicker extends DirectoryPicker {
    /** Return the cancellation-only directory capability required by official Workspace UI services. */
    capability() {
      return cancelledDirectoryCapability
    }
  }

  const pickerFiber = ctx.plugin(AdminSmartCancelledDirectoryPicker) // The Host plugin owns and disposes the restricted service.
  await pickerFiber.await()
  const runtimeCwd = resolve(process.cwd()) // Gateway starts each user-and-mode Runtime inside its neutral runtime-cwd directory.
  await installManagedWorkspace(ctx, { runtimeCwd }) // 唯一受管接线负责恢复基础登记/合法Session归属及原始Workspace/Session Remote，不重复维护旧修复流程。
  if (process.env.ADMINSMART_AGENT_IS_ADMIN !== '1') {
    const { AdminSmartReadOnlySettings } = await import('./read-only-settings.mjs') // Ordinary-only public Remote dependency resolves after the signed Runtime root exists.
    const settingsFiber = ctx.plugin(AdminSmartReadOnlySettings) // Ordinary users only receive redacted General descriptions, never settings writes or Credentials Remote.
    await settingsFiber.await()
  }
  const nativeOptions = {
    apiBase: requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, ''), // 唯一可信后端回环根。
    readToken: readRuntimeCapabilityToken, // 能力凭据仅留在服务端请求栈。
    userId: requiredEnvironment('ADMINSMART_AGENT_USER_ID'), // 当前已签名身份。
    modeId: requiredEnvironment('ADMINSMART_AGENT_MODE_ID'), // 已批准业务模式。
    presetId: requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'), // 已批准能力组合。
    isAdmin: process.env.ADMINSMART_AGENT_IS_ADMIN === '1', // 后端仍再次验签授权。
  } // 普通用户只采用持久配置，管理员才提交共享变更。
  const nativeController = await installNativePolicy(ctx, nativeOptions, {
    assertSameOrigin: assertSameOriginBrowserRequest, // 同源仅是入口检查，身份仍由 Gateway 与签名后端确定。
    readJsonBody, // 受限模块使用自身更小的正文预算。
    nativeBaseline: nativePolicyBaseline(), // 由冻结模板取得的受管继承值，不使用可编辑用户 Profile 猜测。
  })
  const managedPlugins = installGuardedPluginManager(ctx, {
    isAdmin: nativeOptions.isAdmin, // SDK 外部管理 API 在普通角色全部拒绝。
    commitPlugin: nativeController.commitPlugin, // 任一官方行启停先保存全局CAS，不能只修改管理员Profile。
    commitBundle: nativeController.commitBundle, // 已安装官方组合选择复用相同独立NativeCAS和跨Runtime分发。
  }) // 仍使用官方插件目录、配置写入和生命周期实现。
  await managedPlugins.fiber.await()
  ctx.provide('adminsmartPluginCapabilities', managedPlugins.liveCapabilities) // Agent只读可信role与真实SDK已应用选择，未就绪/重启要求不伪装可执行能力。
  await nativeController.setPluginApplier(managedPlugins.applyPlugins, managedPlugins.validatePolicy) // 采用与直接HTTPPUT准入同属一个真实SDK提供方，避免入口差异导致越权。
  const modelSync = installManagedModelSync(ctx, nativeOptions) // 普通 Runtime 通过官方 volatile Provider 字段采用已确认共享模型池；管理员仍编辑自己的原生配置。
  ctx.effect(() => () => modelSync.dispose(), 'adminsmart-client-ui: shared model lifecycle')
  let generalController = null // 未部署General策略桥时不提供HTML快照，保留原有启动兼容路径。
  if (process.env.ADMINSMART_AGENT_UI_POLICY_SUPPORTED !== '0') {
    const uiPolicyOptions = {
      apiBase: requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, ''), // 当前签名租约的受控后端根地址。
      readToken: readRuntimeCapabilityToken, // 每次读取服务端能力令牌，不向浏览器提供凭据。
      userId: requiredEnvironment('ADMINSMART_AGENT_USER_ID'), // Gateway 验签绑定身份，不接受浏览器 Header 或正文覆盖。
      modeId: requiredEnvironment('ADMINSMART_AGENT_MODE_ID'), // 服务端选定业务模式。
      presetId: requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'), // 服务端白名单 Agent Preset。
      isAdmin: process.env.ADMINSMART_AGENT_IS_ADMIN === '1', // 与 Runtime 绑定的可信角色，后端仍再次授权。
    } // 原生 Host 同步与有限 HTTP 桥共用同一身份、角色和 API 装配契约。
    generalController = installSharedUiPolicy(ctx, uiPolicyOptions) // 同一同步器的既有确认状态供HTML首包读取，不创建新缓存。
    const uiPolicyClientSource = await readFile(new URL('./ui-policy-client.mjs', import.meta.url)) // 当前 Runtime 启动时捕获唯一纯浏览器代码快照，哈希与响应必须使用同一字节。
    installUiPolicyHttp(ctx, uiPolicyOptions, {
      assertSameOrigin: assertSameOriginBrowserRequest, // 沿用 Gateway 转发后的同源校验，不读取浏览器 Cookie 值。
      readJsonBody, // 请求体解析仍使用既有有界实现，桥模块收紧为八项设置大小上限。
      clientModuleSource: uiPolicyClientSource, // 固定自有文件字节，不包含任何共享设置、身份、凭据或租约。
    })
    const shortcutProtocol = await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-client-shortcuts/protocol')).href) // 固定 SDK 公开协议只在服务端验证键码、保留键与冲突，不交给模型或浏览器选择包。
    const shortcutPolicyClientSource = await readFile(new URL('../shared-shortcuts/src/shared-shortcuts-client.mjs', import.meta.url)) // 同启动快照的既有纯codec字节用于可信SHA与响应，版本化缓存不能跟随用户政策或hostname变化。
    installShortcutPolicyHttp(ctx, uiPolicyOptions, {
      protocol: shortcutProtocol, // 所有偏好提交都先通过当前固定官方解析与准入算法。
      assertSameOrigin: assertSameOriginBrowserRequest, // 浏览器只可访问当前登录 Runtime 的同源端点。
      readJsonBody, // 按快捷键模块预算读取完整偏好 JSON，不接收命令代码或身份字段。
      clientModuleSource: shortcutPolicyClientSource, // 正式Runtime一次捕获后复用同原字节实体，HTTP和index版本身份一致。
      readClientModule: () => readFile(new URL('../shared-shortcuts/src/shared-shortcuts-client.mjs', import.meta.url), 'utf8'), // 保留旧隔离Fixture接口；正式版本响应优先固定source，不映射任意服务器文件。
    })
  } // A production release without the new signed API keeps its existing UI settings until explicitly upgraded.
  if (process.env.ADMINSMART_AGENT_IS_ADMIN === '1') {
    const publicationSync = installManagedProviderSync(ctx, {
      apiBase: requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, ''), // 当前签名租约的后端回环根。
      readToken: readRuntimeCapabilityToken, // Token 只在单次 Host 请求栈中读取。
      userId: requiredEnvironment('ADMINSMART_AGENT_USER_ID'), // 受管身份与能力声明交叉核对。
      modeId: requiredEnvironment('ADMINSMART_AGENT_MODE_ID'), // 固定业务模式。
      presetId: requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'), // 服务端白名单 Preset。
    }) // 同Host已确认发布集合与删除桥共用串行边界。
    const guardedSettings = installGuardedSettingsControllers(ctx, async routeId => {
      const response = await fetch(`${requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/u, '')}/internal/agent-model/v1/harness-providers/${encodeURIComponent(routeId)}/delete-check`, {
        method: 'POST', // 资格检查只读，不提前撤销共享模型或删除凭据。
        headers: {
          Authorization: `Bearer ${await readRuntimeCapabilityToken()}`, // 当前管理员签名能力不进入浏览器。
          'X-AdminSmart-User-Id': requiredEnvironment('ADMINSMART_AGENT_USER_ID'), // 与内部能力绑定身份交叉验证。
          'X-AdminSmart-Agent-Mode-Id': requiredEnvironment('ADMINSMART_AGENT_MODE_ID'), // 当前受管业务模式。
          'X-AdminSmart-Agent-Preset-Id': requiredEnvironment('ADMINSMART_AGENT_PRESET_ID'), // 当前可信Preset。
        },
        signal: AbortSignal.timeout(5000), // 后端或数据库资格判断不可无限阻塞原生删除，失败时不执行super。
      })
      const result = await response.json().catch(() => null) // 只接受固定允许信封，不回显下层拒绝正文。
      if (!response.ok || result?.code !== 200 || result?.data?.allowed !== true) throw providerDeletionError(result?.error?.code)
    }, publicationSync.withDeletion)
    await guardedSettings.await() // 原生管理Remote在提供方完整激活后才对管理员发布。

  }

  if (generalController) ctx.inject(['settingsController'], owner => installPolicyBootstrapHost(owner, {
    isAdmin: nativeOptions.isAdmin, // 仅采用Gateway已绑定角色，不能从页面状态获取写权限。
    getGeneralSnapshot: () => generalController.getBootstrapSnapshot(), // 只有完整已确认且实际采用的八字段可进入首次HTML。
    getNativeSnapshot: () => nativeController.getBootstrapSnapshot(), // 独立Native修订、采用和失败门禁，不借用General状态。
  })) // Controller由同主Host的角色子fiber提供，公开inject使实际提供方激活后才登记HTML监听，避免反向根依赖死锁。

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: AURASEARCH_LOGO_ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
        response.end()
        return
      }
      const versions = new URL(request.url || AURASEARCH_LOGO_ROUTE, 'http://runtime.invalid').searchParams.getAll('rev') // 查询只能核对当前资源，不能选择其它文件。
      if (versions.length && (versions.length !== 1 || versions[0] !== brandLogoRevision)) {
        response.writeHead(410, { 'cache-control': 'no-store' })
        response.end()
        return
      }
      response.writeHead(200, {
        'content-type': 'image/webp', // 与压缩品牌实体及入口后缀一致，禁止类型嗅探。
        'content-length': String(auraSearchLogo.length), // HEAD 与 GET 使用同一实体大小。
        'cache-control': versions.length === 1 ? 'private, max-age=31536000, immutable' : 'no-store', // 只有当前可信版本可缓存，旧入口随实际字节变化。
        'x-content-type-options': 'nosniff', // 浏览器按图片使用实体。
      })
      response.end(request.method === 'HEAD' ? undefined : auraSearchLogo)
    },
  }), 'adminsmart-client-ui: AuraSearch logo asset')



}
