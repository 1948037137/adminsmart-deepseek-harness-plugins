/** Minimal Settings Remote for ordinary users: a redacted General view, no writes or credentials. */

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const runtimeRoot = resolve(String(process.env.ADMINSMART_DSH_ROOT ?? '').trim()) // Fixed official npm installation selected by the Gateway.
if (!String(process.env.ADMINSMART_DSH_ROOT ?? '').trim()) throw new Error('AdminSmart Settings runtime root is missing')
const runtimeRequire = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // All public protocol types resolve from one installation.
const { Remote, TypertRemoteService } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-typert-protocol')).href) // Official Remote service protocol.

export const GENERAL_SETTINGS_NAMESPACES = Object.freeze(['locale', 'ui-theme', 'ui-chat', 'ui-conversation', 'ui-settings']) // No provider, credential, plugin or sandbox settings.
const OWNED_SETTINGS_NAMESPACE = 'adminsmart-shared-settings' // 停用旧官方 ui-settings 后，同一展示 Schema 的唯一自有 entry ID。
const generalNames = new Set([...GENERAL_SETTINGS_NAMESPACES, OWNED_SETTINGS_NAMESPACE]) // 仅放行五种 General Schema 及此固定 entry 别名，不扩大模型、凭据或插件配置范围。
const remoteInitializers = [] // Standard decorator initializers invoked on each first-party Remote Service instance.

/** Read-only wire owner for the official ConfigForms mirror. */
export class AdminSmartReadOnlySettings extends TypertRemoteService {
  /** @param {object} ctx - Official Cordis Host context containing the SettingsForms service. */
  constructor(ctx) {
    super(ctx, 'settingsController', { namespace: 'settings' })
    this.owner = ctx // Service methods must use the provider context, not a caller's fiber.
    for (const initialize of remoteInitializers) initialize.call(this)
  }

  /**
   * Return only the live, redacted General namespaces needed for shared presentation.
   * @returns {object} Official settings.describe wire envelope with no mutation capability.
   * @sideEffects Reads current SettingsForms descriptors; no file or network write.
   */
  describe() {
    const settings = this.owner.get('settings') // The same official SettingsForms instance used by administrator pages.
    if (!settings) throw new Error('AdminSmart shared settings are unavailable')
    return {
      writable: false,
      hasDocument: false,
      namespaces: settings.describe({ redactSecrets: true })
        .filter(row => generalNames.has(String(row.ns)))
        .map(row => ({
          ns: String(row.ns), // 保留官方实际 entry 身份；Client 将固定 owned 别名规范为 canonical ui-settings。
          autoGenerate: false, // Ordinary users have no settings form UI.
          schema: row.schema, // Official validator for this non-secret section.
          value: row.value, // Effective administrator policy already installed in this Runtime.
          applies: row.applies, // Official live-vs-restart marker.
          secrets: [], // General fields carry no credential references.
          revision: row.revision, // Client mirror invalidation fence.
        })),
    }
  }
}

// The public @Remote decorator uses standard method initializers; invoking it here keeps this
// JavaScript plugin loadable by Node without compiling or changing any official package.
Remote(AdminSmartReadOnlySettings.prototype.describe, {
  kind: 'method', name: 'describe', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})
