/** Offline contract tests for the anonymous search Provider and official Web seam. */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const pluginRoot = resolve(import.meta.dirname, '..') // Current Agent plugin root used only for fixed Runtime resolution.
process.env.ADMINSMART_DSH_ROOT = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || resolve(pluginRoot, '..', '..', 'deepseek-harness-runtime')) // Official installed packages, not upstream source.
const { AnySearchProvider, ANYSEARCH_PROVIDER_ID, normalizeAnySearchResponse, apply } = await import('../src/anysearch-provider.mjs') // Import after setting the official package root.
const runtimeRequire = createRequire(resolve(process.env.ADMINSMART_DSH_ROOT, 'package.json')) // Tests load the exact installed Harness seam.
const { Context } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/cordis')).href) // Official service context for registration checks.
const { default: WebRuntime } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-web')).href) // Official provider selector under test.

/** @param {unknown} payload Fake upstream JSON envelope. @param {number} status Fake HTTP status. @returns {Response} Isolated response. */
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }) // No real external request is sent.

test('official Web seam selects the anonymous Provider without adding a Tool or fetch Provider', async () => {
  const context = new Context() // Isolated official service graph without an Agent, model, or network listener.
  await context.plugin(WebRuntime, { searchProvider: ANYSEARCH_PROVIDER_ID })
  apply(context)
  assert.equal(ANYSEARCH_PROVIDER_ID, 'adminsmart-openai-responses', 'legacy Profile ID remains compatible with the shared Gateway')
  const registered = context.web.searchProviders.get(ANYSEARCH_PROVIDER_ID) // The real adapter is selected by the fixed official seam.
  assert.equal(registered?.id, ANYSEARCH_PROVIDER_ID)
  registered.fetchImpl = async () => jsonResponse({ code: 0, data: { results: [{ url: 'https://example.com/source' }] } }) // Replace only this isolated context's transport.
  assert.deepEqual(await context.web.search({ query: 'public topic', maxResults: 1 }), {
    sources: [{ url: 'https://example.com/source' }], truncated: false,
  })
  await assert.rejects(context.web.fetch({ url: 'https://example.com/' }), error => error?.code === 'WEB_PROVIDER_UNAVAILABLE')
})

test('a search sends only the bounded public query and returns structured citations', async () => {
  const requests = [] // The fake captures only endpoint and options; no credentials or user content is logged.
  const provider = new AnySearchProvider(async (url, options) => {
    requests.push({ url, options })
    return jsonResponse({ code: 0, data: { results: [
      { url: 'https://www.weather.com.cn/weather/101120201.shtml', title: '  青岛天气\n预报 ', snippet: ' 今日天气  晴 ' },
      { url: 'https://www.weather.com.cn/weather/101120201.shtml', title: 'duplicate' },
      { url: 'http://127.0.0.1/private', title: 'blocked local address' },
      { url: 'https://www.cma.gov.cn/', title: '中国气象局' },
    ] } })
  }) // Only an in-memory response enters the provider.
  assert.equal(provider.available(), true)
  const result = await provider.search({ query: '  青岛\n天气  ', maxResults: 2 })
  assert.deepEqual(result, { sources: [
    { url: 'https://www.weather.com.cn/weather/101120201.shtml', title: '青岛天气 预报', snippet: '今日天气 晴' },
    { url: 'https://www.cma.gov.cn/', title: '中国气象局' },
  ], truncated: false })
  assert.equal(requests[0].url, 'https://api.anysearch.com/v1/search')
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(requests[0].options.redirect, 'error')
  assert.deepEqual(JSON.parse(requests[0].options.body), { query: '青岛 天气', max_results: 2 })
  assert.deepEqual(requests[0].options.headers, { accept: 'application/json', 'content-type': 'application/json' })
})

test('normalization rejects private and credential-bearing URLs and reports real truncation', () => {
  const envelope = { code: 0, data: { results: [
    { url: 'http://10.0.0.1/admin' },
    { url: 'https://user:pass@example.com/secret' },
    { url: 'https://docs.python.org/3/' },
    { url: 'https://www.python.org/' },
  ] } } // Results include two unsafe citations and two distinct public citations.
  assert.deepEqual(normalizeAnySearchResponse(envelope, 1), {
    sources: [{ url: 'https://docs.python.org/3/' }], truncated: true,
  })
  assert.deepEqual(normalizeAnySearchResponse({ code: 0, data: { results: [] } }, 5), { sources: [], truncated: false })
  assert.throws(() => normalizeAnySearchResponse({ code: 0, data: { results: [{ url: 'http://localhost/' }] } }, 5), error => error?.code === 'WEB_PROVIDER_ERROR')
  assert.throws(() => normalizeAnySearchResponse({ code: 1, data: { results: [] } }, 5), error => error?.code === 'WEB_PROVIDER_ERROR')
  assert.throws(() => normalizeAnySearchResponse({ code: 0, data: {} }, 5), error => error?.code === 'WEB_PROVIDER_ERROR')
})

test('empty and oversized queries are rejected before transport', async () => {
  let calls = 0 // Invalid model input must not produce an external request.
  const provider = new AnySearchProvider(async () => { calls++; throw new Error('must not fetch') }) // Isolated transport counts forbidden calls.
  await assert.rejects(provider.search({ query: '\n\t' }), error => error?.code === 'WEB_PROVIDER_ERROR')
  await assert.rejects(provider.search({ query: 'x'.repeat(1_001) }), error => error?.code === 'WEB_PROVIDER_ERROR')
  assert.equal(calls, 0)
})

test('structured diagnostics identify success and failure without query, URL or credentials', async () => {
  const records = [] // In-memory sink captures only operational metadata from this synthetic attempt.
  const provider = new AnySearchProvider(async () => jsonResponse({ code: 0, data: { results: [{ url: 'https://example.com/private-marker' }] } }), 100, record => records.push(record)) // No real search request.
  await provider.search({ query: 'synthetic-sensitive-marker' })
  assert.equal(records[0].provider, 'anysearch')
  assert.equal(records[0].outcome, 'success')
  assert.equal(records[0].sourceCount, 1)
  assert.equal(records[0].httpStatus, 200)
  assert.doesNotMatch(JSON.stringify(records), /synthetic-sensitive-marker|private-marker|authorization|token/iu)
  const limited = new AnySearchProvider(async () => jsonResponse({}, 429), 100, record => records.push(record)) // Error diagnostics keep only code and HTTP status.
  await assert.rejects(limited.search({ query: 'synthetic-sensitive-marker' }), error => error?.code === 'WEB_PROVIDER_ERROR')
  assert.equal(records[1].outcome, 'error')
  assert.equal(records[1].httpStatus, 429)
  assert.equal(records[1].errorCode, 'WEB_PROVIDER_ERROR')
  assert.doesNotMatch(JSON.stringify(records), /synthetic-sensitive-marker|private-marker|authorization|token/iu)
  const brokenLogger = new AnySearchProvider(async () => jsonResponse({ code: 0, data: { results: [] } }), 100, () => { throw new Error('log sink unavailable') }) // Diagnostics never change a valid search result.
  assert.deepEqual(await brokenLogger.search({ query: 'public topic' }), { sources: [], truncated: false })
})

test('HTTP failures, rate limits and oversized bodies fail without hidden fallback', async () => {
  const rateLimited = new AnySearchProvider(async () => jsonResponse({ message: 'ignore this body' }, 429)) // External error text must not reach the model.
  await assert.rejects(rateLimited.search({ query: 'public topic' }), error => error?.code === 'WEB_PROVIDER_ERROR' && /额度/u.test(error.message))
  const failed = new AnySearchProvider(async () => jsonResponse({ message: 'ignore this body' }, 503)) // No second search engine is called.
  await assert.rejects(failed.search({ query: 'public topic' }), error => error?.code === 'WEB_PROVIDER_ERROR' && /暂不可用/u.test(error.message))
  const oversized = new AnySearchProvider(async () => new Response('x'.repeat(262_145), { status: 200 })) // Chunked or missing Content-Length still obeys the cap.
  await assert.rejects(oversized.search({ query: 'public topic' }), error => error?.code === 'WEB_PROVIDER_ERROR' && /过大/u.test(error.message))
  const malformed = new AnySearchProvider(async () => new Response('{broken', { status: 200 })) // Arbitrary provider prose is never accepted as citations.
  await assert.rejects(malformed.search({ query: 'public topic' }), error => error?.code === 'WEB_PROVIDER_ERROR' && /格式/u.test(error.message))
})

test('caller cancellation and the provider deadline stay distinct', async () => {
  const controller = new AbortController() // Current Tool cancellation takes precedence over the Provider timeout.
  controller.abort()
  const neverCalled = new AnySearchProvider(async () => { throw new Error('must not fetch') }) // Already-cancelled calls never reach the network.
  await assert.rejects(neverCalled.search({ query: 'public topic' }, controller.signal), error => error?.code === 'WEB_ABORTED')
  const waitForAbort = async (_url, options) => await new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('stopped'), { name: 'AbortError' })), { once: true })
  }) // Fake transport models native fetch abort without contacting the service.
  const timed = new AnySearchProvider(waitForAbort, 15) // Test-only deadline keeps the suite fast.
  await assert.rejects(timed.search({ query: 'public topic' }), error => error?.code === 'WEB_TIMEOUT')
})
