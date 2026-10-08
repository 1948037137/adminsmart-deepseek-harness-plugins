/** Scoped public DNS resolver for the official Harness HTTP fetch provider. */

import { isIP } from 'node:net'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const name = 'adminsmart-public-web-fetch-provider' // Agent-scoped fetch registration, separate from the existing search provider.
export const inject = ['web'] // Only the official Web capability registry is consumed.
export const PUBLIC_FETCH_PROVIDER_ID = 'adminsmart-public-doh' // Explicit Profile selection does not change other outgoing requests.

const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query' // Only fetched public hostnames are disclosed to this fixed HTTPS DNS endpoint.
const DOH_TIMEOUT_MS = 7_000 // Per-family DNS bound remains inside the official fetch deadline.
const MAX_DOH_BYTES = 65_536 // An untrusted DNS response cannot be read into unbounded memory.
const MAX_DNS_RECORDS = 64 // Address set cap before pinning a connection.
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.lan', '.home', '.home.arpa', '.internal', '.test', '.invalid', '.onion'] // Local names are not sent to external DNS.

if (!String(process.env.ADMINSMART_DSH_ROOT ?? '').trim()) throw new Error('AdminSmart web fetch runtime root is missing')
const harnessRoot = resolve(process.env.ADMINSMART_DSH_ROOT) // Gateway-selected fixed official npm tree, not the source checkout.
const harnessRequire = createRequire(pathToFileURL(resolve(harnessRoot, 'package.json'))) // One module graph for all official dependencies.
const { HttpFetchProvider, DEFAULT_USER_AGENT } = await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-web-fetch-http')).href) // Official URL, redirect, body, timeout and pinned-connection behavior.
const { WebError } = await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-web')).href) // Stable Web Tool error codes.
const { proxyRouteFor } = await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-http-proxy')).href) // Proxied official calls would bypass the resolver and must fail closed.
const ipaddr = harnessRequire('ipaddr.js') // Fixed Runtime dependency shared with the official HTTP provider.

/**
 * Validate a literal address, or refuse local hostnames before external DNS sees them.
 * @param {string} hostname URL hostname or one DNS address answer.
 * @returns {{address: string, family: 4 | 6} | null} Validated literal, or null for a public hostname.
 * @throws {WebError} Non-public literal or local hostname.
 * @sideEffects None.
 */
export function publicLiteralOrHostname(hostname) {
  const bare = String(hostname).replace(/^\[|\]$/gu, '').replace(/\.$/u, '').toLowerCase() // URL brackets and DNS final dot are not address bytes.
  const family = isIP(bare) // Literal addresses do not require DNS disclosure.
  if (family) {
    const address = ipaddr.parse(bare) // IP ranges include Fake-IP, private, reserved, and transition prefixes.
    const destination = address.isIPv4MappedAddress?.() ? address.toIPv4Address() : address // IPv4-mapped IPv6 is classified by its embedded destination.
    if (destination.range() !== 'unicast' || address.range() !== 'unicast' && address.range() !== 'ipv4Mapped') {
      throw new WebError('web fetch destination is not a public IP', 'WEB_BLOCKED_URL')
    }
    return { address: bare, family }
  }
  if (!bare.includes('.') || BLOCKED_HOST_SUFFIXES.some(suffix => bare === suffix.slice(1) || bare.endsWith(suffix))) {
    throw new WebError('web fetch destination is not a public hostname', 'WEB_BLOCKED_URL')
  }
  return null
}

/**
 * Read one bounded DoH JSON response without following a redirect.
 * @param {string} hostname Public hostname without URL path or query.
 * @param {'A' | 'AAAA'} type Requested DNS address family.
 * @param {AbortSignal} signal Official fetch cancellation signal.
 * @returns {Promise<string[]>} Address answer strings of the requested family.
 * @throws {WebError} DNS transport, status, or response bounds failure.
 * @sideEffects Sends this public hostname to the fixed DoH endpoint only.
 */
export async function queryPublicDoh(hostname, type, signal) {
  const url = new URL(DOH_ENDPOINT) // Fixed HTTPS origin prevents model-supplied URLs becoming DNS transport destinations.
  url.searchParams.set('name', hostname)
  url.searchParams.set('type', type)
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(DOH_TIMEOUT_MS)]) // Does not set process or system proxy/DNS state.
  try {
    const response = await fetch(url, { headers: { accept: 'application/dns-json' }, redirect: 'error', signal: deadline }) // A single read-only DNS query.
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_DOH_BYTES || !response.body) throw new Error('DNS response unavailable')
    const reader = response.body.getReader() // Stream bound also applies when Content-Length is absent.
    const chunks = [] // Bounded byte chunks for one DNS answer.
    let length = 0 // Cumulative bytes consumed from the DoH response.
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > MAX_DOH_BYTES) throw new Error('DNS response too large')
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const payload = JSON.parse(Buffer.concat(chunks, length).toString('utf8')) // Only structured DNS fields are used; no text becomes instructions.
    if (payload?.Status !== 0 || payload.Answer !== undefined && !Array.isArray(payload.Answer)) throw new Error('DNS status invalid')
    const records = payload.Answer ?? [] // CNAME records do not enter the pinned address set.
    if (records.length > MAX_DNS_RECORDS) throw new Error('DNS answer too large')
    return records.filter(record => record?.type === (type === 'A' ? 1 : 28)).map(record => record.data)
  } catch (error) {
    if (signal.aborted) throw new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error })
    throw new WebError('web fetch DNS lookup failed', 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/**
 * Build the official HttpFetchResolver with all DNS answers checked before connection pinning.
 * @param {(hostname: string, type: 'A' | 'AAAA', signal: AbortSignal) => Promise<string[]>} query DNS transport; tests supply a fake.
 * @returns {(hostname: string, signal: AbortSignal) => Promise<Array<{address: string, family: 4 | 6}>>} Address resolver.
 * @sideEffects The default transport sends only public hostnames to DoH.
 */
export function createPublicDohResolver(query = queryPublicDoh) {
  return async (hostname, signal) => {
    const literal = publicLiteralOrHostname(hostname) // Private literal and local-name checks precede any DNS request.
    if (literal) return [literal]
    const addresses = [] // Entire answer set is validated before any official pinned connection.
    for (const type of ['A', 'AAAA']) {
      const answers = await query(hostname, type, signal) // An unavailable family must fail closed, not silently authorize a partial set.
      for (const answer of answers) {
        if (typeof answer !== 'string') throw new WebError('invalid web fetch DNS answer', 'WEB_PROVIDER_ERROR')
        const address = publicLiteralOrHostname(answer) // Mixed public/private and Fake-IP responses reject the complete request.
        if (!address || address.family !== (type === 'A' ? 4 : 6)) throw new WebError('invalid web fetch DNS answer', 'WEB_PROVIDER_ERROR')
        addresses.push(address)
      }
    }
    if (addresses.length === 0) throw new WebError('web fetch hostname has no public addresses', 'WEB_PROVIDER_ERROR')
    return addresses
  }
}

/** Anonymous official HTTP reader with a web_fetch-only public DNS resolver. */
export class PublicDohWebFetchProvider {
  id = PUBLIC_FETCH_PROVIDER_ID // Unique ID leaves the original official http provider registered and unchanged.

  /** @param {Function} resolver Public-address resolver, replaceable by an offline test fake. */
  constructor(resolver = createPublicDohResolver()) {
    this.reader = new HttpFetchProvider({
      maxResponseBytes: 5_000_000,
      maxBodyChars: 100_000,
      timeoutMs: 30_000,
      maxRedirects: 5,
      userAgent: DEFAULT_USER_AGENT,
    }, resolver) // Match the official plugin defaults, including same-origin redirect and body caps.
  }

  /** @returns {boolean} Anonymous HTTP reading has no credentials to probe. */
  available() { return this.reader.available() }

  /**
   * @param {{url: string}} request Official web_fetch request.
   * @param {AbortSignal | undefined} signal Tool cancellation signal.
   * @returns {Promise<object>} Official WebFetchResult.
   * @throws {WebError} A process proxy route would bypass the pinned resolver.
   * @sideEffects Only the selected web_fetch call makes DNS and HTTP requests.
   */
  async fetch(request, signal) {
    let url // Used only to reject a proxy route; the official provider validates the complete URL.
    try { url = new URL(request.url) } catch { return this.reader.fetch(request, signal) }
    if (proxyRouteFor(url).proxied) throw new WebError('web fetch proxy would bypass public-address validation', 'WEB_PROVIDER_ERROR')
    return this.reader.fetch(request, signal)
  }
}

/** @param {object} ctx Agent context containing the official Web registry. */
export function apply(ctx) {
  ctx.web.registerFetchProvider(new PublicDohWebFetchProvider())
}
