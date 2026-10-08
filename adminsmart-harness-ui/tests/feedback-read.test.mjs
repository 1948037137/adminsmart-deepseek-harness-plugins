import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readRuntimeFeedback } from '../src/feedback.mjs'

const root = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || resolve(import.meta.dirname, '../../..', 'deepseek-harness-runtime')) // 与固定运行项目相同的 SDK 解析锚点，不修改第三方包。
const require = createRequire(resolve(root, 'package.json')) // 不从全局或插件目录加载另一版本。
const { deriveEventMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session/surface')).href) // 当前实际安装固定 SDK 的公开投影，而非本地旧源码副本。
const dependencies = { ownerUserId: 7, agentModeId: 'knowledge', agentPresetId: 'knowledge-agent', deriveEventMessage } // 单个受管 Realm 的测试身份与真实 SDK 语义函数。

/** @param {number} index Fixture 评分序号。 @returns {object} 原生消息反馈的当前值，不触发真实保存。 */
function item(index) { return { messageId: `message-${index}`, rating: index % 2 ? 'negative' : 'positive', createdAt: index + 1, updatedAt: index + 1, note: 'fixture note', category: 'task-result' } }

/** @param {object[]} feedback 当前原生评分 Fixture。 @param {object[]} [headers] 官方逻辑目录 Fixture。 @returns {object} 只实现公开读取服务并使用真实 SDK 投影的隔离 Context。 */
function context(feedback, headers = [{ id: 'session-a', createdAt: 1, agentPreset: 'knowledge-agent' }]) {
  return {
    sessionQuery: {
      filterSessions: async () => headers.map(header => ({ header })), // 不读取真实目录或 Workspace。
      readSurface: async () => ({ events: [
        { type: 'system-prompt', data: { text: 'fixture-hidden-system' } },
        { type: 'user/message', data: { id: 'question', role: 'user', content: [{ type: 'text', text: 'fixture question' }] } },
        ...feedback.map(value => ({ type: 'assistant/message', data: { message: { id: value.messageId, role: 'assistant', content: [{ type: 'text', text: 'fixture answer' }, { type: 'reasoning', text: 'fixture-hidden-reasoning' }, { type: 'tool-call', name: 'fixture-hidden-tool', arguments: 'fixture-hidden-arguments' }] } } })),
        { type: 'tool/result', data: { text: 'fixture-hidden-result' } }
      ] }) // 当前表面只供 SDK 官方 deriveEventMessage 阅读，不复制消息重放引擎。
    },
    messageFeedback: { list: async () => ({ ok: true, value: { items: feedback } }) } // 不调用 put/delete，不持久化 Fixture。
  }
}

test('native feedback pagination preserves categories and excludes prompts, reasoning and tools', async () => {
  const fixture = Array.from({ length: 5 }, (_, index) => item(index)) // 同一逻辑会话跨两批读取的纯原生值。
  const ctx = context(fixture) // 不访问用户日志、数据库或模型。
  const first = await readRuntimeFeedback(ctx, { limit: 3 }, dependencies) // 首批只读三个真实评分。
  const second = await readRuntimeFeedback(ctx, { limit: 3, cursor: first.nextCursor }, dependencies) // 沿公开游标读取剩余评分。
  assert.equal(first.rows.length, 3)
  assert.equal(second.rows.length, 2)
  assert.equal(second.nextCursor, null)
  assert.equal(first.rows[0].category, 'task-result')
  assert.equal(first.rows[0].question, 'fixture question')
  assert.equal(first.rows[0].answer, 'fixture answer')
  assert.equal(first.rows[0].contentAvailable, true)
  assert.doesNotMatch(JSON.stringify([first, second]), /fixture-hidden/)
  assert.deepEqual(fixture.map(value => value.messageId), ['message-0', 'message-1', 'message-2', 'message-3', 'message-4'], '不能排序或修改官方返回值的原数组')
})

test('cursor cannot cross actor realm or rating filters and deleted cursor targets are explicit failures', async () => {
  const ctx = context([item(0), item(1), item(2)]) // 三份不含用户内容的纯评分 Fixture。
  const first = await readRuntimeFeedback(ctx, { limit: 1 }, dependencies) // 获取包含当前账号、模式及评分范围的游标。
  await assert.rejects(readRuntimeFeedback(ctx, { limit: 1, cursor: first.nextCursor }, { ...dependencies, ownerUserId: 8 }))
  await assert.rejects(readRuntimeFeedback(ctx, { limit: 1, cursor: first.nextCursor, rating: 'negative' }, dependencies))
  await assert.rejects(readRuntimeFeedback(context([item(1)]), { limit: 1, cursor: first.nextCursor }, dependencies))
})

test('empty histories are scanned in bounded batches and ordinary forks are retained while subagents are excluded', async () => {
  const headers = Array.from({ length: 25 }, (_, index) => ({ id: `session-${index}`, createdAt: index + 1, agentPreset: 'knowledge-agent' })) // 超出单次扫描上限的空逻辑目录。
  headers.push({ id: 'fork', createdAt: 26, parentSession: 'session-0', agentPreset: 'knowledge-agent' })
  headers.push({ id: 'subagent', createdAt: 27, origin: 'subagent', delegationDepth: 1 })
  headers.push({ id: 'foreign-preset', createdAt: 28, agentPreset: 'other-preset' })
  const first = await readRuntimeFeedback(context([], headers), { limit: 20 }, dependencies) // 不因无反馈遍历无限会话。
  assert.equal(first.totalSessions, 26)
  assert.equal(first.scannedSessions, 20)
  assert.ok(first.nextCursor)
  const second = await readRuntimeFeedback(context([], headers), { cursor: first.nextCursor }, dependencies) // 第二批完成剩余目录检查。
  assert.equal(second.scannedSessions, 26)
  assert.equal(second.nextCursor, null)
})

test('partial read failures remain visible and absent current message text does not delete the rating', async () => {
  const ctx = context([item(0)]) // 当前评分仍然存在但表面消息可缺失的 Fixture。
  ctx.sessionQuery.readSurface = async () => ({ events: [] })
  const missing = await readRuntimeFeedback(ctx, {}, dependencies) // 不自行裁决并删除原生反馈。
  assert.equal(missing.rows[0].contentAvailable, false)
  assert.equal(missing.rows[0].note, 'fixture note')
  ctx.messageFeedback.list = async () => { throw new Error('private fixture path') }
  const failed = await readRuntimeFeedback(ctx, {}, dependencies) // 基础设施局部故障必须区别于成功无反馈。
  assert.equal(failed.unavailableSessions, 1)
  assert.doesNotMatch(JSON.stringify(failed), /private fixture/)
})
