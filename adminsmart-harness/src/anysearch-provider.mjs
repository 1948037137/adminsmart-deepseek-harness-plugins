/** Anonymous public-search adapter for the official Harness Web capability. */

import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { publicLiteralOrHostname } from './public-web-fetch-provider.mjs'

export const name = 'adminsmart-anysearch-provider' // Agent-scoped registration; the model-facing tool remains Harness web_search.
export const inject = ['web'] // Search uses only the official Web capability registry.
export const ANYSEARCH_PROVIDER_ID = 'adminsmart-openai-responses' // Historical registry ID retained for existing Profiles and shared Gateway validation.

const SEARCH_ENDPOINT = 'https://api.anysearch.com/v1/search' // Fixed anonymous endpoint; no model input can select a destination.
const SEARCH_TIMEOUT_MS = 12_000 // One bounded provider attempt; there is no hidden engine fallback.
const MAX_QUERY_CHARACTERS = 1_000 // Search text is public-only and cannot grow without bound.
const MAX_RESULTS = 8 // Match the fixed Harness web_search default source cap.
const MAX_RESULT_ROWS = 64 // Reject an unexpectedly large upstream result list.
const MAX_RESPONSE_BYTES = 262_144 // Bound the complete JSON body even without Content-Length.
const MAX_URL_CHARACTERS = 2_048 // Citations are not allowed to carry oversized URLs.
const MAX_TITLE_CHARACTERS = 160 // Provider metadata is untrusted model-visible text.
const MAX_SNIPPET_CHARACTERS = 800 // Search snippets are evidence, never instructions.

if (!String(process.env.ADMINSMART_DSH_ROOT ?? '').trim()) throw new Error('AdminSmart web search runtime root is missing')
const harnessRoot = resolve(process.env.ADMINSMART_DSH_ROOT) // Gateway-selected fixed official npm tree.
const harnessRequire = createRequire(pathToFileURL(resolve(harnessRoot, 'package.json'))) // Resolve the same WebError class as the running Harness.
const { WebError } = await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-web')).href) // Official machine-routable Web failure type.

/**
 * Validate the single query passed by the official web_search Tool.
 * @param {unknown} value Model-generated public search query.
 * @returns {string} Bounded query with transport control characters removed.
 * @throws {WebError} Empty or oversized queries cannot reach the external service.
 */
function normalizeQuery(value) {
  const query = String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim() // Preserve searchable words without transport controls.
  if (!query || query.length > MAX_QUERY_CHARACTERS) throw new WebError('联网搜索查询为空或过长', 'WEB_PROVIDER_ERROR')
  return query
}

/**
 * Accept only a public HTTP(S) citation from an untrusted search result.
 * @param {unknown} value Provider-supplied URL field.
 * @returns {string | null} Canonical citation URL, or null when unsafe or malformed.
 */
function publicSourceUrl(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_URL_CHARACTERS || /[\u0000-\u001f\u007f]/u.test(value)) return null
  try {
    const url = new URL(value) // Structured parsing rejects opaque schemes and malformed hostnames.
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) return null
    publicLiteralOrHostname(url.hostname) // Reuse the fetch provider's private-IP and local-name boundary.
    return url.href
  } catch {
    return null
  }
}

/**
 * Normalize untrusted title and snippet fields for the official Web result shape.
 * @param {unknown} value One provider text field.
 * @param {number} maximum Character cap for this field.
 * @returns {string} Compact text, possibly empty.
 */
function boundedText(value, maximum) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum) : ''
}

/**
 * Convert the documented AnySearch JSON envelope to citeable Harness sources.
 * @param {unknown} payload Complete JSON response from the fixed search endpoint.
 * @param {unknown} requestedMaximum Official Web request source cap.
 * @returns {{sources: Array<{url: string, title?: string, snippet?: string}>, truncated: boolean}} Search results without invented citations.
 * @throws {WebError} Invalid envelopes or nonempty lists containing no public URLs.
 */
export function normalizeAnySearchResponse(payload, requestedMaximum) {
  const results = payload?.data?.results // Only documented structured results may become sources.
  if (payload?.code !== 0 || !Array.isArray(results) || results.length > MAX_RESULT_ROWS) {
    throw new WebError('免费联网搜索响应格式无效', 'WEB_PROVIDER_ERROR')
  }
  const maximum = Number.isInteger(requestedMaximum) && requestedMaximum > 0 ? Math.min(requestedMaximum, MAX_RESULTS) : MAX_RESULTS // Never exceed the Tool's source budget.
  const sources = [] // De-duplicated public citations in upstream order.
  const seen = new Set() // Canonical URL identities already examined in this response.
  let truncated = false // True only when a distinct valid source exceeds the caller's cap.
  for (const result of results) {
    const url = publicSourceUrl(result?.url) // Private, local, credential-bearing, and malformed URLs are discarded.
    if (!url || seen.has(url)) continue
    seen.add(url)
    if (sources.length >= maximum) {
      truncated = true
      continue
    }
    const title = boundedText(result?.title, MAX_TITLE_CHARACTERS) // Optional provider title; never synthesize one.
    const snippet = boundedText(result?.snippet, MAX_SNIPPET_CHARACTERS) // Optional provider excerpt; never treat as an instruction.
    sources.push({ url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}) })
  }
  if (results.length > 0 && sources.length === 0) throw new WebError('免费联网搜索未返回可引用的公开网址', 'WEB_PROVIDER_ERROR')
  return { sources, truncated }
}

/**
 * Read a complete JSON response with a hard byte cap, including chunked bodies.
 * @param {Response} response Successful response from the fixed endpoint.
 * @returns {Promise<unknown>} Parsed JSON envelope.
 * @throws {WebError} Missing, oversized, or malformed JSON body.
 */
async function readBoundedJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) throw new WebError('免费联网搜索响应过大或为空', 'WEB_PROVIDER_ERROR')
  const reader = response.body.getReader() // Stream reading enforces the cap when Content-Length is absent.
  const chunks = [] // Each byte chunk belongs only to the current bounded response.
  let length = 0 // Total body bytes consumed before JSON decoding.
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_RESPONSE_BYTES) throw new WebError('免费联网搜索响应过大', 'WEB_PROVIDER_ERROR')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  try {
    return JSON.parse(Buffer.concat(chunks, length).toString('utf8'))
  } catch {
    throw new WebError('免费联网搜索响应格式无效', 'WEB_PROVIDER_ERROR')
  }
}

/**
 * Emit a query-free diagnostic without letting logging change search behavior.
 * @param {(record: object) => void} sink Runtime diagnostic sink.
 * @param {object} record Bounded operational fields only; never query, URL, or credentials.
 * @returns {void} Logger failures are deliberately ignored.
 */
function logOutcome(sink, record) {
  try { sink(record) } catch { /* Search results must not depend on the diagnostic sink. */ }
}

/** Anonymous search backend; no key, shared secret, model call, or fallback engine is used. */
export class AnySearchProvider {
  id = ANYSEARCH_PROVIDER_ID // Stable legacy ID prevents changing shared Gateway/Profile deployment contracts.

  /**
   * @param {typeof fetch} fetchImpl Injectable transport for isolated tests.
   * @param {number} timeoutMs Per-search deadline, fixed to 12 seconds in the production registration.
   * @param {(record: object) => void} logImpl Structured, query-free Runtime diagnostic sink.
   */
  constructor(fetchImpl = globalThis.fetch, timeoutMs = SEARCH_TIMEOUT_MS, logImpl = record => console.info(`adminsmart_web_search ${JSON.stringify(record)}`)) {
    this.fetchImpl = fetchImpl // Only this Provider's fixed HTTPS request uses the transport.
    this.timeoutMs = timeoutMs // Deadline does not alter process-wide network settings.
    this.logImpl = logImpl // Gateway captures Runtime stdout in the tenant's redacted log directory.
  }

  /** @returns {boolean} Local transport availability without a network probe. */
  available() { return typeof this.fetchImpl === 'function' }

  /**
   * Execute one anonymous search through the official Web seam.
   * @param {{query: string, maxResults?: number}} request Harness-validated search request.
   * @param {AbortSignal | undefined} signal Current Tool cancellation signal.
   * @returns {Promise<{sources: Array<object>, truncated: boolean}>} Citeable results or an honest empty result.
   * @throws {WebError} Cancellation, timeout, rate limit, transport, or response failure.
   * @sideEffects Sends only this public query to the fixed external AnySearch endpoint.
   */
  async search(request, signal) {
    if (signal?.aborted) throw new WebError('联网搜索已取消', 'WEB_ABORTED')
    const query = normalizeQuery(request?.query) // Bound model input before any external request.
    const maximum = Number.isInteger(request?.maxResults) && request.maxResults > 0 ? Math.min(request.maxResults, MAX_RESULTS) : MAX_RESULTS // Apply the same source cap at the provider request layer.
    const deadline = AbortSignal.timeout(this.timeoutMs) // Only this search attempt receives the deadline.
    const combinedSignal = signal ? AbortSignal.any([signal, deadline]) : deadline // User cancellation takes priority in error reporting.
    const attemptId = randomUUID() // Distinguishes concurrent retries without recording queries, URLs, identities, or credentials.
    const startedAt = performance.now() // Monotonic clock used only for the current provider attempt duration.
    let httpStatus = null // Upstream status is logged without its untrusted response body.
    try {
      const response = await this.fetchImpl(SEARCH_ENDPOINT, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ query, max_results: maximum }),
        redirect: 'error',
        signal: combinedSignal,
      }) // Never forward a model key or follow a provider redirect.
      httpStatus = response.status
      if (response.status === 429) throw new WebError('免费联网搜索额度暂时受限，请稍后重试', 'WEB_PROVIDER_ERROR')
      if (!response.ok) throw new WebError('免费联网搜索服务暂不可用', 'WEB_PROVIDER_ERROR')
      const payload = await readBoundedJson(response) // Untrusted JSON is parsed only after the byte cap.
      const result = normalizeAnySearchResponse(payload, maximum) // Only validated public citations reach the official Web Tool.
      logOutcome(this.logImpl, { event: 'search', attemptId, provider: 'anysearch', outcome: 'success', elapsedMs: Math.round(performance.now() - startedAt), httpStatus, sourceCount: result.sources.length })
      return result
    } catch (error) {
      const failure = signal?.aborted
        ? new WebError('联网搜索已取消', 'WEB_ABORTED', { cause: error })
        : deadline.aborted
          ? new WebError('免费联网搜索超时', 'WEB_TIMEOUT', { cause: error })
          : error instanceof WebError
            ? error
            : new WebError('免费联网搜索请求失败', 'WEB_PROVIDER_ERROR', { cause: error }) // One stable category reaches the model; low-level details remain in the cause chain.
      logOutcome(this.logImpl, { event: 'search', attemptId, provider: 'anysearch', outcome: 'error', elapsedMs: Math.round(performance.now() - startedAt), httpStatus, errorCode: failure.code })
      throw failure
    }
  }
}

/** @param {object} ctx Agent context exposing Harness's official Web registry. */
export function apply(ctx) {
  ctx.web.registerSearchProvider(new AnySearchProvider())
}
