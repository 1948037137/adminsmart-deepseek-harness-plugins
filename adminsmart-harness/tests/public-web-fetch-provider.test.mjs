/** Offline public-DNS and official HTTP-provider compatibility checks. */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const pluginRoot = resolve(import.meta.dirname, '..') // Current plugin and Profile source root.
process.env.ADMINSMART_DSH_ROOT = resolve(pluginRoot, '..', '..', 'deepseek-harness-runtime') // Fixed npm package tree; no real model is used.
const {
  PUBLIC_FETCH_PROVIDER_ID,
  PublicDohWebFetchProvider,
  apply,
  createPublicDohResolver,
  publicLiteralOrHostname,
  queryPublicDoh,
} = await import('../src/public-web-fetch-provider.mjs') // Environment is set before resolving official packages.
const signal = new AbortController().signal // Offline DNS fixtures share a non-aborted caller signal.
const runtimeRequire = createRequire(resolve(process.env.ADMINSMART_DSH_ROOT, 'package.json')) // Public proxy API from the same fixed Runtime installation.
const { installProxyFromEnvironment } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-http-proxy')).href) // Test the actual official process routing decision.
const { Context } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/cordis')).href) // Official service container for provider-selection integration.
const { default: WebRuntime } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-web')).href) // Actual fixed-version Web seam, not a hand-rolled registry.

test('Profile pins only web_fetch to the scoped provider', async () => {
  const profile = await readFile(resolve(pluginRoot, '../adminsmart-harness-platform/profiles/adminsmart-web/cordis.patch.yml'), 'utf8') // Versioned Profile text, not a materialized user Home.
  assert.match(profile, /searchProvider: adminsmart-openai-responses/u)
  assert.match(profile, /fetchProvider: adminsmart-public-doh/u)
  assert.equal(PUBLIC_FETCH_PROVIDER_ID, 'adminsmart-public-doh')
})

test('fixed Harness Web seam selects the new fetch provider without selecting search', async () => {
  const context = new Context() // Isolated service graph without Agent, model, or network transport.
  await context.plugin(WebRuntime, { fetchProvider: PUBLIC_FETCH_PROVIDER_ID })
  apply(context)
  await assert.rejects(context.web.fetch({ url: 'http://127.0.0.1/private' }, signal), error => error?.code === 'WEB_BLOCKED_URL')
  await assert.rejects(context.web.search({ query: 'fixture' }, signal), error => error?.code === 'WEB_PROVIDER_UNAVAILABLE')
})

test('private literals and local names fail before any DNS request', async () => {
  const blocked = ['127.0.0.1', '10.0.0.1', '169.254.169.254', '198.18.1.67', '[::1]', 'fdfe:dcba:9876::139', '64:ff9b::a00:1', '::ffff:10.0.0.1', 'localhost', 'host.local', 'host.internal', 'host.test', 'host.home.arpa'] // Loopback, metadata, Fake-IP, transition, and private names.
  for (const hostname of blocked) assert.throws(() => publicLiteralOrHostname(hostname), error => error?.code === 'WEB_BLOCKED_URL')
  let calls = 0 // Public DNS transport must never see blocked hostnames.
  const resolver = createPublicDohResolver(async () => { calls++; return ['8.8.8.8'] }) // Unexpected fake query indicates private-name leakage.
  for (const hostname of blocked) await assert.rejects(resolver(hostname, signal), error => error?.code === 'WEB_BLOCKED_URL')
  assert.equal(calls, 0)
  assert.deepEqual(await resolver('8.8.8.8', signal), [{ address: '8.8.8.8', family: 4 }])
  assert.equal(calls, 0)
})

test('all public A and AAAA answers are handed to the official pinned connector', async () => {
  const queries = [] // Query types and hostname observed by the isolated fake DNS service.
  const resolver = createPublicDohResolver(async (hostname, type) => {
    queries.push({ hostname, type })
    return type === 'A' ? ['8.8.8.8', '1.1.1.1'] : ['2606:4700:4700::1111']
  })
  assert.deepEqual(await resolver('example.com', signal), [
    { address: '8.8.8.8', family: 4 },
    { address: '1.1.1.1', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ])
  assert.deepEqual(queries, [{ hostname: 'example.com', type: 'A' }, { hostname: 'example.com', type: 'AAAA' }])
})

test('mixed, Fake-IP, malformed, empty, and partial-failure answers fail closed', async () => {
  for (const invalid of ['198.18.1.67', '10.0.0.2', 'not-an-ip', '::ffff:127.0.0.1']) {
    const resolver = createPublicDohResolver(async (_hostname, type) => type === 'A' ? ['8.8.8.8', invalid] : []) // Public first must not permit a later unsafe answer.
    await assert.rejects(resolver('example.com', signal))
  }
  await assert.rejects(createPublicDohResolver(async () => [])('example.com', signal), error => error?.code === 'WEB_PROVIDER_ERROR')
  await assert.rejects(createPublicDohResolver(async (_hostname, type) => {
    if (type === 'AAAA') throw new Error('DNS unavailable')
    return ['8.8.8.8']
  })('example.com', signal))
})

test('DoH request sends only an encoded hostname and enforces response bounds', async () => {
  const previousFetch = globalThis.fetch // Restore process fetch after each isolated protocol assertion.
  try {
    let captured // Fixed DNS endpoint and redirect behavior of one scoped lookup.
    globalThis.fetch = async (url, options) => {
      captured = { url, options }
      return new Response(JSON.stringify({ Status: 0, Answer: [
        { name: 'example.com.', type: 5, data: 'alias.example.com.' },
        { name: 'alias.example.com.', type: 1, data: '8.8.8.8' },
      ] }), { headers: { 'content-type': 'application/dns-json' } })
    }
    assert.deepEqual(await queryPublicDoh('example.com', 'A', signal), ['8.8.8.8'])
    assert.equal(captured.url.origin, 'https://cloudflare-dns.com')
    assert.equal(captured.url.searchParams.get('name'), 'example.com')
    assert.equal(captured.url.searchParams.get('type'), 'A')
    assert.equal(captured.options.redirect, 'error')
    globalThis.fetch = async () => new Response('x'.repeat(65_537))
    await assert.rejects(queryPublicDoh('example.com', 'A', signal), error => error?.code === 'WEB_PROVIDER_ERROR')
    globalThis.fetch = async () => new Response(JSON.stringify({ Status: 3 }))
    await assert.rejects(queryPublicDoh('example.com', 'A', signal), error => error?.code === 'WEB_PROVIDER_ERROR')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('DoH cancellation remains scoped to the current fetch call', async () => {
  const previousFetch = globalThis.fetch // A fake pending DNS transport; no external service is contacted.
  const controller = new AbortController() // Simulates official Tool cancellation of this request only.
  try {
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('fixture aborted')), { once: true })
    })
    const pending = queryPublicDoh('example.com', 'A', controller.signal) // The DNS promise waits only for the caller abort.
    controller.abort()
    await assert.rejects(pending, error => error?.code === 'WEB_ABORTED')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('wrapper delegates URL safety to the fixed official HTTP implementation', async () => {
  const provider = new PublicDohWebFetchProvider(createPublicDohResolver(async () => { throw new Error('unexpected network') })) // Unsafe URLs must fail before transport.
  assert.equal(provider.available(), true)
  await assert.rejects(provider.fetch({ url: 'file:///etc/passwd' }, signal), error => error?.code === 'WEB_INVALID_URL')
  await assert.rejects(provider.fetch({ url: 'http://127.0.0.1/private' }, signal), error => error?.code === 'WEB_BLOCKED_URL')
})

test('an installed process proxy cannot bypass the per-fetch pinned resolver', async () => {
  let resolutions = 0 // A proxied route must be blocked before any destination DNS or HTTP call.
  const provider = new PublicDohWebFetchProvider(async () => { resolutions++; return [{ address: '8.8.8.8', family: 4 }] }) // Offline address fixture.
  const dispose = await installProxyFromEnvironment({
    get(name) { return name === 'HTTPS_PROXY' ? { value: 'http://127.0.0.1:19097' } : undefined },
  }, () => {}) // Synthetic local proxy URL; no service is contacted.
  try {
    await assert.rejects(provider.fetch({ url: 'https://example.com/' }, signal), error => error?.code === 'WEB_PROVIDER_ERROR')
    assert.equal(resolutions, 0)
  } finally {
    await dispose() // Restore dispatcher and environment inside this isolated test process.
  }
})
