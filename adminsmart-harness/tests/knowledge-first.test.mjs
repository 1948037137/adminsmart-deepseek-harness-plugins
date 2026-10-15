/** 验证知识优先判定只进入真实用户回合首步，不调用模型、工具、网络或业务服务。 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pluginRoot = resolve(import.meta.dirname, '..') // 当前 AdminSmart 知识插件项目根。
const projectRoot = resolve(pluginRoot, '..', '..') // 固定 Harness npm 运行项目所在的多项目根。
process.env.ADMINSMART_DSH_ROOT = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || resolve(projectRoot, 'deepseek-harness-runtime')) // 与生产一致地解析官方消息构造器。

const { apply, name } = await import('../src/knowledge-first.mjs') // 环境就绪后再加载固定 npm 依赖。
const harnessRequire = createRequire(resolve(process.env.ADMINSMART_DSH_ROOT, 'package.json')) // 测试只使用生产同版的官方 V4 编码器。
const { releasedV4SessionFormatCodec } = await import(pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-session-format-v3-to-v4')).href) // 实际持久化准入在离线 Fixture 上验证。
const listeners = [] // 当前隔离作用域注册的 agent/pre-step 监听器。
const context = {
  effect(registerEffect) {
    return registerEffect()
  },
  on(eventName, listener) {
    assert.equal(eventName, 'agent/pre-step')
    listeners.push(listener)
    return () => {}
  },
} // 该插件只依赖 Cordis effect 与官方 Agent 前置事件，不需要工具、Session 或模型服务。

apply(context)
assert.equal(listeners.length, 1)
const [preStep] = listeners // 唯一的每轮信息依赖判定入口。
const userMessage = {
  id: 'fixture-user-message', // Fake 消息身份只用于数组稳定比较。
  role: 'user', // Agent 前置事件只接收用户角色消息。
  content: [{ type: 'text', text: '解释物权是什么' }], // 需要知识证据的普通概念问题 Fixture。
  source: { kind: 'user' }, // 真实用户来源是触发知识优先判定的唯一依据。
}
const activeController = new AbortController() // 正常首步使用的未取消信号。
const entered = await preStep({
  messages: [userMessage], // Agent Inbox 当前认领的真实用户输入。
  signal: activeController.signal, // 当前回合协作式取消信号。
  step: 1, // 只有首个模型步骤允许注入判定消息。
}, async () => ({ kind: 'enter', messages: [userMessage] }))

assert.equal(entered.kind, 'enter')
assert.equal(entered.messages.length, 2)
const notice = entered.messages[1] // 插件上下文必须位于用户输入之后，提高当前请求中的规则显著性。
assert.equal(notice.source.kind, `plugin:${name}`)
assert.equal(Object.hasOwn(notice.source, 'plugin'), false)
assert.equal(notice.source.form, 'notice')
assert.doesNotThrow(() => releasedV4SessionFormatCodec.encodeEvent({
  type: 'user/message', // 使用用户角色 Context 在官方 Session V4 中真实占据的持久化事件。
  seq: 1, // 独立合成会话的第一条事件坐标。
  time: 1, // 与真实时钟、用户历史无关的固定时间。
  data: notice, // 当前插件创建的真实消息构造器输出。
}))
assert.throws(() => releasedV4SessionFormatCodec.encodeEvent({
  type: 'user/message', seq: 1, time: 1,
  data: { ...notice, source: { kind: 'plugin', plugin: name } },
}), /format v4 message requires a producer-owned source kind/)
assert.match(notice.content[0].text, /先取得必要证据/)
assert.match(notice.content[0].text, /selected 相关原件/)
assert.match(notice.content[0].text, /单字段证据充分立即回答/)
assert.match(notice.content[0].text, /不按任务主题建立白名单/)
assert.doesNotMatch(notice.content[0].text, /read_chat_file|read_chat_pdf_pages|analyze_xlsx/)
assert.match(notice.content[0].text, /不默认 all、写脚本或布局渲染/)
assert.match(notice.content[0].text, /失败、未读或片段未命中不等于知识库没有资料/)

const laterStep = await preStep({
  messages: [userMessage], // 后续步骤即使带有工具结果或续写消息也不能重复注入。
  signal: activeController.signal,
  step: 2,
}, async () => ({ kind: 'enter', messages: [userMessage] }))
assert.deepEqual(laterStep.messages, [userMessage])

const pluginOnlyMessage = {
  ...userMessage,
  id: 'fixture-plugin-message',
  source: { kind: 'plugin:fixture-context' }, // 其它插件拥有的 V4 来源不能伪装成真实用户回合。
}
const pluginOnlyStep = await preStep({
  messages: [pluginOnlyMessage],
  signal: activeController.signal,
  step: 1,
}, async () => ({ kind: 'enter', messages: [pluginOnlyMessage] }))
assert.deepEqual(pluginOnlyStep.messages, [pluginOnlyMessage])

const rejected = await preStep({
  messages: [userMessage],
  signal: activeController.signal,
  step: 1,
}, async () => ({ kind: 'reject' }))
assert.deepEqual(rejected, { kind: 'reject' })

const abortedController = new AbortController() // 已取消回合不能在拒绝边界后追加新上下文。
abortedController.abort()
const aborted = await preStep({
  messages: [userMessage],
  signal: abortedController.signal,
  step: 1,
}, async () => ({ kind: 'enter', messages: [userMessage] }))
assert.deepEqual(aborted.messages, [userMessage])

process.stdout.write('knowledge_first_contract=ok\n')
