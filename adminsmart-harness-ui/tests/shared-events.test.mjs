/** 同一已认证失效流的四类独立修订目标，不读真实用户、Token或Redis。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseUiPolicyEvent, watchUiPolicyEvents } from '../src/shared-ui-policy.mjs'

/** @param {string} kind 已批准事件类别。 @param {number} revision 该类别自己的修订。 @returns {string} 合成标准SSE帧。 */
const frame = (kind, revision) => `event: policy-invalidated\ndata: ${JSON.stringify({ kind, revision })}\n\n`

test('四类事件严格仅kind/revision，不将新合法类别误当断流，也不接收策略或身份正文', () => {
  for (const kind of ['general', 'shortcuts', 'native', 'models']) assert.deepEqual(parseUiPolicyEvent(frame(kind, 3).trim()), { kind, revision: 3 })
  for (const payload of [{ kind: 'native', revision: 0 }, { kind: 'models', revision: 1.5 }, { kind: 'permission', revision: 1 }, { kind: 'native', revision: 1, userId: 'fixture' }, { kind: 'models', revision: 1, settings: {} }]) assert.throws(() => parseUiPolicyEvent(`event: policy-invalidated\ndata: ${JSON.stringify(payload)}`), /消息无效/u)
})

for (const kind of ['general', 'native', 'models']) test(`同一混合流只消费${kind}及恢复信号，忽略其它类高修订/重复值而不重新连接`, async () => {
  const delivered = [] // 当前类别回调实际收到的有限元数据。
  let requests = 0 // 不靠重连跳过新合法类别。
  let completed // Fake流处理到最后恢复帧后释放本测试。
  const done = new Promise(resolve => { completed = resolve }) // 没有长sleep或真实网络。
  const source = ['event: ready\ndata: {}\n\n', frame('shortcuts', 999), frame('general', 1), frame('native', 1), frame('models', 1), frame(kind, 1), frame(kind, 2), 'event: resync\ndata: {}\n\n'].join('') // 三种策略不混用CAS号码。
  const stop = watchUiPolicyEvents({ apiBase: 'http://fixture.invalid', readToken: async () => 'fixture-capability', userId: '7', modeId: 'knowledge', presetId: 'fixture' }, async event => { delivered.push(event); if (delivered.length >= 4) completed() }, { kind, fetchImpl: async (url, options) => {
    requests += 1
    assert.equal(url, 'http://fixture.invalid/internal/agent-model/v1/ui-policy/events')
    assert.equal(options.headers.Authorization, 'Bearer fixture-capability')
    assert.equal(options.redirect, 'error')
    return { ok: true, body: [Buffer.from(source.slice(0, 41)), Buffer.from(source.slice(41))] } // 跨块解析字段与正文，只有合成Buffer。
  } })
  try {
    await done
    assert.deepEqual(delivered, [{ kind: null, revision: null }, { kind, revision: 1 }, { kind, revision: 2 }, { kind: null, revision: null }])
    assert.equal(requests, 1)
  } finally { stop() }
})
