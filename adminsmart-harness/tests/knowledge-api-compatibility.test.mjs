/** 发布/回退混合版本窗口的精确可选字段降级；HTTP、凭据和知识均使用隔离合成Fixture。 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

process.env.ADMINSMART_DSH_ROOT = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || process.env.ADMINSMART_DSH_ROOT || resolve(import.meta.dirname, '../../../deepseek-harness-runtime')) // 候选或显式安装根优先，不修改官方Runtime。
const { apply } = await import('../src/lightrag-tool.mjs') // 实际Tool transport逻辑，不手写重试代理。
let tool // 官方defineTool构造的真实只读检索定义。
apply({ effect: register => register(), tools: { register: definition => { tool = definition; return () => {} } } })
const QUERY = { query: '合成知识问题', highLevelKeywords: ['合成主题'], lowLevelKeywords: ['合成实体'] } // 两次可能请求必须使用完全相同的已校验检索目标。
const RESULT = {
  question: '合成知识问题', // 无真实用户正文。
  scope: 'focused', // 仅相关检索。
  queries: ['合成知识问题'], // 固定一次查询。
  knowledgeFound: false, // 正常空候选，不制造事实。
  evidence: [], // 旧响应没有sourceAssetId也可使用。
  sourceCount: 0, // 合成覆盖数。
  chunkCount: 0, // 没有正文。
  totalCandidateCount: 0, // 没有候选。
  tokenBudget: 100, // 固定预算。
  usedTokens: 0, // 未使用正文。
  truncated: false, // 未裁剪。
  completeCoverage: false, // 不宣称全量。
  answerBoundary: '仅合成候选。', // 固定测试边界。
}

/** @returns {Response} 标准旧Pydantic extra_forbidden，仅可选字段在Service开始前被拒绝。 */
function oldFieldError() {
  return new Response(JSON.stringify({ detail: [{ type: 'extra_forbidden', loc: ['body', 'includeSourceAssets'], msg: 'Extra inputs are not permitted', input: true }] }), { status: 422 })
}

/** @returns {Response} 不含可选来源身份的合法旧版本空检索响应。 */
function success() {
  return new Response(JSON.stringify({ code: 200, data: RESULT }), { status: 200 })
}

/**
 * 建立只读Tool所需合成能力环境，所有HTTP都由单个Fake接收。
 * @param {object} t Node测试生命周期。
 * @param {Function} transport 当前用例的HTTP替身，接收URL和规范请求参数。
 * @returns {Promise<object>} 合成执行信号和查询操作。
 * @sideEffects 创建当前测试临时能力文件，结束恢复环境/fetch/timer并仅删除该目录。
 */
async function fixture(t, transport) {
  const home = await mkdtemp(join(tmpdir(), 'adminsmart-knowledge-compat-')) // 当前用例独占的合成能力根。
  const environmentNames = ['ADMINSMART_AGENT_API_BASE', 'ADMINSMART_AGENT_USER_ID', 'ADMINSMART_AGENT_MODE_ID', 'ADMINSMART_AGENT_PRESET_ID', 'ADMINSMART_AGENT_TOKEN_FILE'] // 仅本Tool实际读取的受管配置键。
  const originalEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]])) // 恢复已有配置但不输出任何敏感值。
  const originalFetch = globalThis.fetch // 完成后恢复，不影响其它测试。
  const originalSetTimeout = globalThis.setTimeout // 时限测试可缩短固定预算，不能影响后续生产或测试。
  const controller = new AbortController() // 当前合成用户调用唯一取消通道。
  process.env.ADMINSMART_AGENT_API_BASE = 'http://127.0.0.1:19099'
  process.env.ADMINSMART_AGENT_USER_ID = '42'
  process.env.ADMINSMART_AGENT_MODE_ID = 'knowledge'
  process.env.ADMINSMART_AGENT_PRESET_ID = 'adminsmart-knowledge'
  process.env.ADMINSMART_AGENT_TOKEN_FILE = join(home, 'fixture-capability')
  await writeFile(process.env.ADMINSMART_AGENT_TOKEN_FILE, 'fixture-capability-token')
  globalThis.fetch = transport
  t.after(async () => {
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalSetTimeout
    for (const name of environmentNames) {
      if (originalEnvironment[name] === undefined) delete process.env[name]
      else process.env[name] = originalEnvironment[name]
    }
    assert.ok(home.startsWith(join(tmpdir(), 'adminsmart-knowledge-compat-')), '只清理当前测试创建的绝对目录')
    await rm(home, { recursive: true, force: true })
  })
  return {
    controller, // 取消由用例显式触发，不取消其它调用。
    originalSetTimeout, // 截止用例的延迟使用原计时器，不改变真实耗时观测。
    execute: () => tool.execute(QUERY, { agent: { session: { id: 'fixture-session' } }, signal: controller.signal }), // 不启动Agent、真实网络或模型。
  }
}

test('new API needs one request and legacy exact field error retries once without changing identity or query', async t => {
  const calls = [] // 仅捕获本用例合成请求，不包含真实Token或正文。
  let legacy = false // 先验证正常新版，再切到旧DTO公开错误响应。
  const f = await fixture(t, async (url, options) => {
    calls.push({ url, ...options, fields: JSON.parse(options.body) })
    return legacy && calls.length === 2 ? oldFieldError() : success()
  })
  assert.deepEqual(await f.execute(), RESULT)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].fields.includeSourceAssets, true)
  legacy = true
  assert.deepEqual(await f.execute(), RESULT)
  assert.equal(calls.length, 3)
  const enhanced = calls[1] // 首次新契约请求只到达旧DTO校验。
  const fallback = calls[2] // 同一次Tool在Service开始前降级，只有这一请求可实际检索。
  const { includeSourceAssets: _optional, ...originalFields } = enhanced.fields // 仅剥离可选字段，不重做关键词/身份。
  assert.deepEqual(fallback.fields, originalFields)
  assert.deepEqual(fallback.headers, enhanced.headers)
  assert.equal(fallback.url, enhanced.url)
  assert.equal(fallback.signal, enhanced.signal)
})

test('authorization, other fields, generic 422 and malformed bodies are never replayed', async t => {
  const cases = [
    { status: 403, body: { detail: [{ type: 'extra_forbidden', loc: ['body', 'includeSourceAssets'] }] } }, // HTTP权限拒绝不能因body像旧Schema而重试。
    { status: 401, body: {} }, // 登录能力失败。
    { status: 429, body: {} }, // 限流失败。
    { status: 422, body: { detail: [{ type: 'extra_forbidden', loc: ['body', 'otherField'] }] } }, // 其它字段不是版本增强能力。
    { status: 422, body: { detail: [{ type: 'value_error', loc: ['body', 'includeSourceAssets'] }] } }, // 明确业务校验失败。
    { status: 422, body: { detail: [{ type: 'extra_forbidden', loc: ['body', 'includeSourceAssets'] }, { type: 'missing', loc: ['body', 'question'] }] } }, // 多处错误不能掩盖真正无效请求。
    { status: 422, body: { code: 422, msg: 'synthetic failure' } }, // 只有通用422文案不能证明未开始检索。
    { status: 422, body: 'not-json' }, // 错误body不能宽松解析。
  ] // 不使用供应商文本或模型输出猜协议。
  let calls = 0 // 不允许每个用例产生第二个HTTP请求。
  let current // 当前固定错误Fixture，不读取外部状态。
  const f = await fixture(t, async () => { calls += 1; return new Response(typeof current.body === 'string' ? current.body : JSON.stringify(current.body), { status: current.status }) })
  for (current of cases) {
    const before = calls // 当前用例实际发送数起点。
    await assert.rejects(f.execute(), /知识检索权限校验失败|知识检索请求过于频繁|知识检索暂时失败/)
    assert.equal(calls, before + 1)
  }
})

test('a failed legacy request produces stable error and cannot trigger a third attempt', async t => {
  let calls = 0 // 降级失败总共最多两次HTTP，不循环422或错误。
  const f = await fixture(t, async () => { calls += 1; return calls === 1 ? oldFieldError() : new Response('synthetic internal path/token must not escape', { status: 500 }) })
  await assert.rejects(f.execute(), error => error.message === '知识检索暂时失败，请稍后重试')
  assert.equal(calls, 2)
})

test('cancellation before fallback or before first send never starts another request', async t => {
  let calls = 0 // 验证取消发生在422JSON读取后也不能启动降级。
  let f // Fake响应需要调用当前执行的合成取消控制器。
  f = await fixture(t, async () => {
    calls += 1
    const response = oldFieldError() // 只有JSON读期间触发取消，才能覆盖降级边界竞态。
    const parse = response.json.bind(response) // 真正JSON解析不由测试伪造。
    response.json = async () => { const payload = await parse(); f.controller.abort(new Error('fixture cancelled')); return payload }
    return response
  })
  await assert.rejects(f.execute(), /fixture cancelled/)
  assert.equal(calls, 1)
  await assert.rejects(f.execute(), /fixture cancelled/)
  assert.equal(calls, 1, '预取消连首次请求也不能发出')
})

test('fallback consumes the original absolute deadline rather than rearming its budget', async t => {
  const signals = [] // 两次请求必须观察同一AbortSignal。
  let timers = 0 // 固定检索期限只允许创建一次。
  const f = await fixture(t, async (_url, options) => {
    signals.push(options.signal)
    if (signals.length === 1) {
      await new Promise(resolve => f.originalSetTimeout(resolve, 30)) // 第一次旧Schema请求已经消耗总预算的大部分。
      return oldFieldError()
    }
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })) // 第二次不返回直到真实截止取消。
  })
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    if (milliseconds === 120_000) timers += 1
    return f.originalSetTimeout(callback, milliseconds === 120_000 ? 45 : milliseconds, ...args)
  } // 仅缩短固定总期限，实际发送和signal取消逻辑不模拟。
  const started = performance.now() // 测量同次Tool两次请求的总耗时。
  await assert.rejects(f.execute(), error => error.message === '知识检索超时，请稍后重试')
  assert.equal(signals.length, 2)
  assert.equal(signals[0], signals[1])
  assert.equal(timers, 1)
  assert.ok(performance.now() - started < 100)
})
