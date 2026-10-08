import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import {
  FEEDBACK_MUTATION_PATH,
  deliverFeedbackMutation,
  feedbackMutationPayload,
  installFeedbackMutationSync,
} from '../src/feedback.mjs'

const runtimeRoot = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || resolve(import.meta.dirname, '../../..', 'deepseek-harness-runtime')) // 与共享固定版本相同的 SDK 解析锚点。
const runtimeRequire = createRequire(resolve(runtimeRoot, 'package.json')) // 禁止从全局或插件目录加载另一份 SDK。
const { deriveEventMessage, foldSurface } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-session/surface')).href)

/** @returns {object[]} 包含用户问题和目标 assistant 回答的最小官方当前表面。 */
function surfaceEvents() {
  return [
    { type: 'user/message', seq: 0, time: 1, surfaceOp: 'append', data: { id: 'question', role: 'user', content: [{ type: 'text', text: 'fixture question' }] } },
    { type: 'assistant/message', seq: 1, time: 2, surfaceOp: 'append', data: { message: { id: 'answer', role: 'assistant', content: [{ type: 'text', text: 'fixture answer' }, { type: 'reasoning', text: 'hidden reasoning' }] } } },
  ] // 使用固定 SDK deriveEventMessage 读取，测试不自行实现消息协议。
}

test('official feedback put and delete events become bounded backend mutations', () => {
  const put = feedbackMutationPayload({
    type: 'feedback/message-put',
    seq: 2,
    time: 12,
    data: {
      sessionId: 'session-a',
      item: { messageId: 'answer', rating: 'negative', note: 'fixture note', category: 'task-result', version: 'opaque', createdAt: 10, updatedAt: 11 },
    },
  }, surfaceEvents(), deriveEventMessage)
  const deletion = feedbackMutationPayload({
    type: 'feedback/message-delete',
    seq: 3,
    time: 13,
    data: { sessionId: 'session-a', messageId: 'answer' },
  }, surfaceEvents(), deriveEventMessage)

  assert.deepEqual(put, {
    operation: 'upsert',
    sessionId: 'session-a',
    messageId: 'answer',
    rating: 'negative',
    note: 'fixture note',
    category: 'task-result',
    question: 'fixture question',
    answer: 'fixture answer',
    contentAvailable: true,
    questionTruncated: false,
    answerTruncated: false,
    createdAt: 10,
    updatedAt: 11,
    occurredAt: 12,
  })
  assert.deepEqual(deletion, { operation: 'delete', sessionId: 'session-a', messageId: 'answer', occurredAt: 13 })
  assert.doesNotMatch(JSON.stringify(put), /hidden reasoning/)
})

test('mutation delivery uses only the managed loopback API and runtime capability headers', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'adminsmart-feedback-sync-')) // 当前测试独占能力文件目录。
  const capabilityTokenPath = join(temporaryRoot, 'capability.token') // 不含真实凭据的测试证明文件。
  await writeFile(capabilityTokenPath, 'fixture-runtime-capability', 'utf8')
  const originalFetch = globalThis.fetch // 测试结束后恢复 Node 原生 fetch。
  let observedRequest // 捕获唯一内存请求，不发起真实网络。
  globalThis.fetch = async (url, options) => {
    observedRequest = { url: String(url), options }
    return { ok: true, status: 200 }
  }
  try {
    await deliverFeedbackMutation(
      { operation: 'delete', sessionId: 'session-a', messageId: 'answer', occurredAt: 13 },
      {
        apiBase: 'http://127.0.0.1:9099',
        capabilityTokenPath,
        ownerUserId: '7',
        agentModeId: 'knowledge',
        agentPresetId: 'adminsmart-knowledge',
      },
    )
  } finally {
    globalThis.fetch = originalFetch
    await rm(temporaryRoot, { recursive: true, force: true })
  }

  assert.equal(observedRequest.url, `http://127.0.0.1:9099${FEEDBACK_MUTATION_PATH}`)
  assert.equal(observedRequest.options.headers['X-AdminSmart-Agent-Token'], 'fixture-runtime-capability')
  assert.equal(observedRequest.options.headers['X-AdminSmart-User-Id'], '7')
  assert.equal(JSON.parse(observedRequest.options.body).operation, 'delete')
})

test('live session feedback event is delivered asynchronously and drained on plugin disposal', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'adminsmart-feedback-event-')) // 当前测试独占能力文件目录。
  const capabilityTokenPath = join(temporaryRoot, 'capability.token') // 不含真实凭据的测试证明文件。
  await writeFile(capabilityTokenPath, 'fixture-runtime-capability', 'utf8')
  const listeners = new Map() // Cordis 事件名到当前测试监听器集合。
  let pluginDisposer // ctx.effect 返回的异步清理器。
  const ctx = {
    on(name, listener) {
      const eventListeners = listeners.get(name) || new Set()
      eventListeners.add(listener)
      listeners.set(name, eventListeners)
      return () => eventListeners.delete(listener)
    },
    effect(register) {
      pluginDisposer = register()
      return pluginDisposer
    },
  }
  const originalFetch = globalThis.fetch // 测试结束后恢复 Node 原生 fetch。
  const delivered = [] // 收集后端收到的纯 Fixture 载荷。
  globalThis.fetch = async (_url, options) => {
    delivered.push(JSON.parse(options.body))
    return { ok: true, status: 200 }
  }
  try {
    installFeedbackMutationSync(ctx, {
      apiBase: 'http://127.0.0.1:9099',
      capabilityTokenPath,
      ownerUserId: '7',
      agentModeId: 'knowledge',
      agentPresetId: 'adminsmart-knowledge',
      deriveEventMessage,
      foldSurface,
    })
    const events = surfaceEvents() // 当前 live Session 的官方表面事件。
    const session = {
      id: 'session-a',
      surface: { nodes: [0, 1] },
      eventAt: seq => events[seq],
    }
    for (const listener of listeners.get('session/event')) listener(session, {
      type: 'feedback/message-put',
      seq: 2,
      time: 12,
      data: { sessionId: 'session-a', item: { messageId: 'answer', rating: 'positive', version: 'opaque', createdAt: 10, updatedAt: 11 } },
    })
    await pluginDisposer() // 清理必须等待已经接受的官方事件完成回环投递。
  } finally {
    globalThis.fetch = originalFetch
    await rm(temporaryRoot, { recursive: true, force: true })
  }

  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].rating, 'positive')
  assert.equal(delivered[0].question, 'fixture question')
})

test('durable cold feedback event is folded from the committed official inspection', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'adminsmart-feedback-cold-')) // 当前测试独占能力文件目录。
  const capabilityTokenPath = join(temporaryRoot, 'capability.token') // 不含真实凭据的测试证明文件。
  await writeFile(capabilityTokenPath, 'fixture-runtime-capability', 'utf8')
  const listeners = new Map() // Cordis 事件名到当前测试监听器集合。
  let pluginDisposer // ctx.effect 返回的异步清理器。
  const ctx = {
    on(name, listener) {
      const eventListeners = listeners.get(name) || new Set()
      eventListeners.add(listener)
      listeners.set(name, eventListeners)
      return () => eventListeners.delete(listener)
    },
    effect(register) {
      pluginDisposer = register()
      return pluginDisposer
    },
  }
  const originalFetch = globalThis.fetch // 测试结束后恢复 Node 原生 fetch。
  const delivered = [] // 收集后端收到的纯 Fixture 载荷。
  globalThis.fetch = async (_url, options) => {
    delivered.push(JSON.parse(options.body))
    return { ok: true, status: 200 }
  }
  try {
    installFeedbackMutationSync(ctx, {
      apiBase: 'http://127.0.0.1:9099',
      capabilityTokenPath,
      ownerUserId: '7',
      agentModeId: 'knowledge',
      agentPresetId: 'adminsmart-knowledge',
      deriveEventMessage,
      foldSurface,
    })
    const committedEvents = [
      ...surfaceEvents(),
      { type: 'feedback/message-put', seq: 2, time: 12, data: { sessionId: 'session-a', item: { messageId: 'answer', rating: 'negative', version: 'opaque', createdAt: 10, updatedAt: 11 } } },
    ] // 完整持久前缀最后一项是官方冷反馈写入事件。
    for (const listener of listeners.get('feedback/committed')) listener({ meta: { id: 'session-a' }, inheritedEventCount: 0, events: committedEvents })
    await pluginDisposer()
  } finally {
    globalThis.fetch = originalFetch
    await rm(temporaryRoot, { recursive: true, force: true })
  }

  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].operation, 'upsert')
  assert.equal(delivered[0].answer, 'fixture answer')
})
