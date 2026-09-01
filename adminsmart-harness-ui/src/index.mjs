/**
 * AdminSmart Harness host and client-module owner.
 *
 * The Host half creates the one tenant-local knowledge Workspace and provides
 * a cancellation-only directory picker. The browser half is published through
 * package.json `exports["./client"]` and discovered by dsh-client-modules.
 */

import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const name = 'adminsmart-client-ui-host'
export const inject = ['workspaceRegistry', 'sessionPersistence', 'sessionQuery', 'sessions', 'webServer']

const KNOWLEDGE_SCOPE_ROUTE = '/adminsmart/knowledge/scope' // Browser-safe Host route proxied only through the authenticated Agent Gateway.
const SESSION_SEARCH_ROUTE = '/adminsmart/sessions/search' // Browser-safe wrapper around Harness's user-isolated SessionQuery service.
const AURASEARCH_LOGO_ROUTE = '/adminsmart/assets/aurasearch-logo.jpg' // Client-visible product logo route owned by this plugin.
const AURASEARCH_LOGO_PATH = fileURLToPath(new URL('../assets/aurasearch-logo.jpg', import.meta.url)) // Repository-owned logo file supplied by the AdminSmart operator.
const MAXIMUM_SCOPE_BODY_BYTES = 64 * 1024 // Session ID and at most one thousand UUIDs fit well below this defensive bound.
const MAXIMUM_SESSION_SEARCH_RESULTS = 20 // Matches the public Session Controller search result bound.
const MAXIMUM_SESSION_SEARCH_QUERY_LENGTH = 200 // Client and Host share one bounded literal-query contract.
const MAXIMUM_LITERAL_SCAN_SESSIONS = 200 // Short Chinese fallback scans only the newest bounded tenant Sessions.
const MAXIMUM_SEARCH_SNIPPET_CODE_POINTS = 240 // Matches the Session Controller's public snippet bound.
const FIXED_WORKSPACE_TITLE = '知识问答' // Hidden Runtime workspace title retained only for Harness internal accounting.
const WORKSPACE_REPAIR_INTERVAL_MS = 500 // Cheap in-memory registry check restores a deleted fixed workspace without visible user intervention.

/**
 * Read one required runtime path without exposing its value.
 *
 * @param {string} variableName - Managed Gateway environment variable.
 * @returns {string} Trimmed non-empty path value.
 * @throws {Error} When the Gateway omitted the required path.
 */
function requiredEnvironment(variableName) {
  const environmentValue = String(process.env[variableName] ?? '').trim() // Runtime-only path; never logged or persisted by this plugin.
  if (!environmentValue) throw new Error(`AdminSmart Harness 缺少运行配置：${variableName}`)
  return environmentValue
}

/** Load the current Runtime capability token from its protected tenant file. */
async function loadCapabilityToken() {
  const tokenFilePath = resolve(requiredEnvironment('ADMINSMART_AGENT_TOKEN_FILE')) // Gateway-owned protected token path.
  const capabilityToken = String(await readFile(tokenFilePath, 'utf8')).trim() // Token remains process memory only.
  if (!capabilityToken) throw new Error('AdminSmart Agent 能力凭证文件为空')
  return capabilityToken
}

/** Read one bounded JSON request body from the Harness Web client. */
async function readJsonBody(request) {
  const chunks = [] // Current request body chunks retained only until JSON parsing completes.
  let receivedBytes = 0 // Exact byte count prevents unbounded browser input buffering.
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    receivedBytes += bytes.length
    if (receivedBytes > MAXIMUM_SCOPE_BODY_BYTES) throw new Error('知识范围请求过大')
    chunks.push(bytes)
  }
  const bodyText = Buffer.concat(chunks).toString('utf8') // Scope payload contains only Session ID and document UUIDs.
  return JSON.parse(bodyText || '{}')
}

/** Normalize one browser-supplied Session search phrase as literal bounded data. */
function normalizeSessionSearchQuery(value) {
  const normalizedQuery = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim() // Control characters and repeated whitespace never reach the full-text provider.
  if (!normalizedQuery || normalizedQuery.length > MAXIMUM_SESSION_SEARCH_QUERY_LENGTH) {
    throw new Error('会话搜索关键词无效')
  }
  return normalizedQuery
}

/** Normalize searchable event text for case-insensitive whitespace-flexible literal matching. */
function comparableSessionSearchText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase()
}

/** Build one bounded Unicode-safe excerpt around a literal match. */
function sessionSearchSnippet(sourceText, query) {
  const normalizedSource = String(sourceText ?? '').replace(/\s+/gu, ' ').trim() // Harness-extracted semantic event text.
  const comparableSource = normalizedSource.toLocaleLowerCase() // Case-insensitive search copy with identical character offsets for Chinese text.
  const comparableQuery = comparableSessionSearchText(query) // Already bounded query normalized for literal fallback.
  const matchIndex = comparableSource.indexOf(comparableQuery) // First exact literal match inside this event.
  if (matchIndex < 0) return ''
  const prefixStart = Math.max(0, matchIndex - 48) // Small amount of preceding context distinguishes similar messages.
  const suffixEnd = Math.min(normalizedSource.length, matchIndex + comparableQuery.length + 160) // Bounded following context.
  const excerpt = normalizedSource.slice(prefixStart, suffixEnd) // Current matching excerpt before Unicode code-point bounding.
  const boundedExcerpt = Array.from(excerpt).slice(0, MAXIMUM_SEARCH_SNIPPET_CODE_POINTS).join('')
  return `${prefixStart > 0 ? '…' : ''}${boundedExcerpt}${suffixEnd < normalizedSource.length ? '…' : ''}`
}

/** Call the FastAPI internal Session-scope endpoint without exposing its capability to the browser. */
async function requestKnowledgeScope(method, sessionId, payload) {
  const normalizedSessionId = String(sessionId ?? '').trim() // Harness Session identity selects scope state, never user ownership.
  if (!normalizedSessionId || normalizedSessionId.length > 200) throw new Error('知识范围会话标识无效')
  const apiBase = requiredEnvironment('ADMINSMART_AGENT_API_BASE').replace(/\/$/, '') // Signed lease-bound loopback FastAPI root.
  const ownerUserId = requiredEnvironment('ADMINSMART_AGENT_USER_ID') // Process-bound user identity from Gateway.
  const capabilityToken = await loadCapabilityToken() // Runtime-bound HMAC capability re-read for every request.
  const response = await fetch(
    `${apiBase}/internal/agent-tools/knowledge/scope/${encodeURIComponent(normalizedSessionId)}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-AdminSmart-Agent-Token': capabilityToken,
        'X-AdminSmart-User-Id': ownerUserId
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    }
  )
  const responseText = await response.text() // FastAPI returns one bounded JSON document without knowledge正文。
  return { status: response.status, body: responseText }
}

/** Collect persisted and currently live Session headers without duplicating one Session identity. */
async function knowledgeSessionHeaders(ctx) {
  const headerById = new Map() // Session ID to newest available header used for fixed-path membership repair.
  const persistedHeaders = await ctx.sessionPersistence.list() // Durable history survives Workspace registration deletion.
  for (const header of persistedHeaders) headerById.set(String(header.id), header)
  const liveSessions = ctx.sessions.list() // A newly created blank Session may be live before its persistence listing refreshes.
  for (const session of liveSessions) headerById.set(String(session.id), session.header)
  return [...headerById.values()]
}

/**
 * Create or recover the hidden fixed knowledge Workspace and reattach every matching history Session.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context containing Workspace and Session services.
 * @param {string} workspacePath - Current tenant Runtime's dedicated working directory.
 * @returns {Promise<import('@deepseek-ai/dsh-workspace').Workspace>} Reused or newly durable fixed Workspace.
 * @throws {Error} When the directory, registry, persistence, or membership repair is unavailable.
 * @sideEffects Writes only the current tenant's Workspace registration and matching Session membership.
 */
export async function ensureKnowledgeWorkspace(ctx, workspacePath) {
  const workspace = await ctx.workspaceRegistry.create(workspacePath, FIXED_WORKSPACE_TITLE) // Re-creation uses the same canonical tenant path after user deletion.
  if (workspace.title !== FIXED_WORKSPACE_TITLE) {
    await workspace.setTitle(FIXED_WORKSPACE_TITLE) // Internal title remains stable even though the custom sidebar never exposes it.
  }
  const sessionHeaders = await knowledgeSessionHeaders(ctx) // Historical Sessions retain their cwd after Workspace registration deletion.
  for (const header of sessionHeaders) {
    if (typeof header.cwd !== 'string' || header.cwd.trim() === '') continue
    let sessionPath // Canonical Session cwd used to prevent cross-directory or cross-tenant membership.
    try {
      sessionPath = await realpath(header.cwd)
    } catch {
      continue // Stale or unavailable Session directories are not attached to the fixed knowledge runtime.
    }
    if (sessionPath !== workspace.path) continue
    await workspace.attachSession(header.id) // Idempotently restores the history row to the recreated fixed Workspace.
  }
  return workspace
}

/**
 * Mount the restricted directory seam and create the tenant's fixed Workspace.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Root Harness host context with Workspace Registry.
 * @returns {Promise<void>} Completes after both Host capabilities are active and durable.
 * @sideEffects Writes only the current tenant Workspace registration under the isolated DSH_HOME.
 */
export async function apply(ctx) {
  const harnessRoot = resolve(requiredEnvironment('ADMINSMART_DSH_ROOT')) // Pinned official checkout supplying the abstract DirectoryPicker service.
  const directoryPickerModuleUrl = pathToFileURL(
    resolve(harnessRoot, 'packages/host/directory-picker/lib/index.js')
  ).href // Public built service definition; no upstream source is copied.
  const { default: DirectoryPicker } = await import(directoryPickerModuleUrl)
  const sessionQueryModuleUrl = pathToFileURL(
    resolve(harnessRoot, 'packages/session-query/session-query/lib/index.js')
  ).href // Public built SessionQuery helpers; no upstream source is copied.
  const { extractSessionEventText } = await import(sessionQueryModuleUrl)
  const cancelledCapability = Object.freeze({
    kind: 'native', // DirectoryPickerController exposes only pick() for this non-browsing capability.
    async pick() {
      return null // Behaves exactly like an operator cancellation without touching the filesystem.
    }
  }) // Capability identity remains stable for the full Host plugin lifetime.

  class AdminSmartRestrictedDirectoryPicker extends DirectoryPicker {
    /** @returns {{kind:'native',pick:() => Promise<null>}} Cancellation-only capability. */
    capability() {
      return cancelledCapability
    }
  }

  const pickerFiber = ctx.plugin(AdminSmartRestrictedDirectoryPicker) // Child service lifetime is owned by this Loader row.
  await pickerFiber.await()
  const workspacePath = resolve(process.cwd()) // Gateway starts each Runtime inside its user-isolated workspace directory.
  const workspace = await ensureKnowledgeWorkspace(ctx, workspacePath) // Startup also repairs Sessions left ungrouped by an earlier deletion.
  const fixedWorkspacePath = workspace.path // Canonical path is the stable identity; recreated Workspace UUIDs are intentionally replaceable.
  const auraSearchLogo = await readFile(AURASEARCH_LOGO_PATH) // Immutable plugin asset cached once per isolated Runtime process.

  ctx.effect(() => {
    let disposed = false // Plugin teardown stops new repair attempts after Runtime shutdown or Host reload.
    let repairInFlight = null // At most one create-and-reattach transaction runs during a deletion burst.
    const reconcileWorkspace = () => {
      if (disposed || repairInFlight !== null) return
      const fixedWorkspaceExists = ctx.workspaceRegistry.list().some(item => item.path === fixedWorkspacePath) // Registry list is an in-memory read with no directory traversal.
      if (fixedWorkspaceExists) return
      repairInFlight = ensureKnowledgeWorkspace(ctx, fixedWorkspacePath)
        .catch(() => {
          if (!disposed) ctx.logger.warn('AdminSmart 固定知识运行空间自动恢复失败')
        })
        .finally(() => { repairInFlight = null })
    }
    const repairTimer = setInterval(reconcileWorkspace, WORKSPACE_REPAIR_INTERVAL_MS) // Deleted registration is repaired within one short UI interaction window.
    repairTimer.unref?.()
    queueMicrotask(reconcileWorkspace)
    return () => {
      disposed = true
      clearInterval(repairTimer)
    }
  }, 'adminsmart-client-ui: fixed workspace repair')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: AURASEARCH_LOGO_ROUTE,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
        response.end()
        return
      }
      response.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': String(auraSearchLogo.length),
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff'
      })
      response.end(request.method === 'HEAD' ? undefined : auraSearchLogo)
    }
  }), 'adminsmart-client-ui: AuraSearch logo asset')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SESSION_SEARCH_ROUTE,
    async handler(request, response) {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        const requestBody = await readJsonBody(request) // Search body contains only one bounded literal phrase.
        const query = normalizeSessionSearchQuery(requestBody.query) // Validated phrase passed to Harness SessionQuery.
        const page = await ctx.sessionQuery.searchSessions({
          query,
          sessionFilters: [{ kind: 'cwd', values: [fixedWorkspacePath] }], // Tenant Runtime may return only its fixed knowledge Workspace.
          eventFilters: [
            { kind: 'type', values: ['user/message', 'assistant/message'] }, // Search user and assistant conversation text only.
            { kind: 'surface', values: ['current'] } // Shadowed and raw-log-only text is not user-visible navigation evidence.
          ],
          limit: MAXIMUM_SESSION_SEARCH_RESULTS
        })
        const items = page.items
          .filter(hit => (
            hit.header.cwd === fixedWorkspacePath
            && hit.bestMatch.sessionId === hit.header.id
            && hit.bestMatch.surface === 'current'
            && ['user/message', 'assistant/message'].includes(hit.bestMatch.type)
          ))
          .map(hit => ({
            sessionId: String(hit.header.id), // Visible Session identity opened by the official Client controller.
            seq: Number(hit.bestMatch.seq), // Exact matching event coordinate retained for future navigation semantics.
            time: Number(hit.bestMatch.time), // Match timestamp drives DeepSeek-style search-result time labels.
            snippet: String(hit.bestMatch.snippet ?? '') // Bounded plain-text excerpt selected by the official provider.
          }))
        const matchedSessionIds = new Set(items.map(item => item.sessionId)) // FTS-ranked Sessions must not be duplicated by literal fallback.
        let literalScanTruncated = false // Whether the bounded fallback left older candidate Sessions unscanned.
        const requiresLiteralFallback = Array.from(query).length <= 4 || items.length === 0 // SQLite tokenization may miss short Chinese substring queries such as “系统”。
        if (requiresLiteralFallback && items.length < MAXIMUM_SESSION_SEARCH_RESULTS) {
          const records = await ctx.sessionQuery.filterSessions([
            { kind: 'cwd', values: [fixedWorkspacePath] }
          ]) // Harness logical corpus filtered to the current tenant's fixed knowledge Workspace.
          const candidateRecords = records.slice(0, MAXIMUM_LITERAL_SCAN_SESSIONS) // Newest-first bounded scan prevents unbounded request work.
          literalScanTruncated = records.length > candidateRecords.length
          const comparableQuery = comparableSessionSearchText(query) // Literal case-insensitive short-query matcher.
          for (const record of candidateRecords) {
            const sessionId = String(record.header.id) // Current fallback candidate identity.
            if (matchedSessionIds.has(sessionId) || items.length >= MAXIMUM_SESSION_SEARCH_RESULTS) continue
            try {
              const surface = await ctx.sessionQuery.readSurface(record.header.id) // Official replay-validated current model surface.
              if (surface.session.cwd !== fixedWorkspacePath) continue
              const matchingEvent = [...surface.events].reverse().find(event => {
                if (!['user/message', 'assistant/message'].includes(event.type)) return false
                const eventText = extractSessionEventText(event) // Harness-owned semantic extraction handles message content blocks.
                return comparableSessionSearchText(eventText).includes(comparableQuery)
              }) // Newest matching current-surface message best reflects what the user will navigate to.
              if (!matchingEvent) continue
              const eventText = extractSessionEventText(matchingEvent) // Exact text reused for the bounded excerpt.
              items.push({
                sessionId, // Official Session controller opens this identity.
                seq: Number(matchingEvent.seq), // Exact event coordinate used by click-to-locate.
                time: Number(matchingEvent.time), // Exact event time used by result labels.
                snippet: sessionSearchSnippet(eventText, query) // Unicode-safe literal excerpt around the short query.
              })
              matchedSessionIds.add(sessionId)
            } catch {
              continue // One corrupt or unavailable historical Session cannot fail every authorized search result.
            }
          }
        }
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        })
        response.end(JSON.stringify({
          items, // Current Workspace's authorized best match per Session.
          hasMore: page.nextCursor !== undefined || literalScanTruncated // Search UI asks for a narrower phrase when either provider path truncated.
        }))
      } catch {
        response.writeHead(500, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        })
        response.end(JSON.stringify({ error: '会话搜索暂时不可用' }))
      }
    }
  }), 'adminsmart-client-ui: Session search route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: KNOWLEDGE_SCOPE_ROUTE,
    async handler(request, response) {
      try {
        const requestUrl = new URL(request.url ?? KNOWLEDGE_SCOPE_ROUTE, 'http://adminsmart.invalid') // Query parsing never trusts Host.
        if (request.method === 'GET') {
          const result = await requestKnowledgeScope('GET', requestUrl.searchParams.get('sessionId'))
          response.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          response.end(result.body)
          return
        }
        if (request.method === 'PUT') {
          const requestBody = await readJsonBody(request)
          const result = await requestKnowledgeScope('PUT', requestBody.sessionId, {
            documentIds: Array.isArray(requestBody.documentIds) ? requestBody.documentIds : []
          })
          response.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          response.end(result.body)
          return
        }
        response.writeHead(405, { allow: 'GET, PUT', 'cache-control': 'no-store' })
        response.end()
      } catch {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ code: 500, msg: '知识范围暂时不可用', data: { errorCode: 'agent_scope_proxy_failed' } }))
      }
    }
  }), 'adminsmart-client-ui: knowledge scope route')
}
