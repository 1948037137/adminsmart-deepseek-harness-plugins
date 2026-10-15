/** 旧 V3 原件授权通过官方迁移规范化，权限层只接受当前 V4 协议；全部事件与引用均为合成数据。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadRuntimeModule } from '../src/runtime.mjs'
import { sessionFiles } from '../src/session-files.mjs'

const llm = await loadRuntimeModule('@deepseek-ai/dsh-llm') // 官方消息工厂只创建内存消息，不注册模型或调用网络。
const sessions = await loadRuntimeModule('@deepseek-ai/dsh-session') // 官方事件封装、序号与恢复验证。
const formats = await loadRuntimeModule('@deepseek-ai/dsh-session-format-v3-to-v4') // 固定发行版公开的相邻格式迁移与释放版 Codec。

/**
 * 构造完整闭合的合成 V3 工具执行，包含模型声明、执行与结果以及轮次生命周期。
 * @param {boolean|undefined} isError 历史包装内的可选错误标志；缺省与 false 都是合法成功。
 * @returns {{header:object,events:object[],reference:object}} 不对应真实 Session 或存储原件的旧格式 Fixture。
 * @sideEffects 无；只使用官方消息工厂构造内存 JSON。
 */
function historicalLog(isError) {
  const reference = {
    attachmentId: `sha256:${'a'.repeat(64)}`, // 合成内容身份，不指向任何实际附件。
    name: 'historical-fixture.md', // 迁移必须保持的原件显示名。
    bytes: 12, // 合成元数据，测试不读取或解析文件字节。
  } // 当前历史知识调用唯一允许导入的合成附件。
  const callId = 'fixture-historical-load' // 与结果、来源和执行事件配对的本测试调用身份。
  const block = {
    type: 'tool-call', // 官方模型声明一个待执行工具。
    id: callId, // 相同身份必须贯穿调用及结果。
    name: 'load_knowledge_files', // 唯一可信知识原件导入能力。
    arguments: '{}', // 不需要真实业务参数，本测试只核对事件授权契约。
  } // 合成模型块，不调用实际工具或主应用 API。
  const assistant = llm.createAssistantMessage({
    content: [block], // 与执行事件一致的公开工具声明。
    source: { provider: 'fixture', model: 'fixture' }, // 不存在的合成模型路由，仅作已接受历史标识。
  }) // 官方冻结消息，避免自造错误的 assistant 消息格式。
  const oldMessage = llm.createUserMessage({
    source: { kind: 'tool', callId }, // V3 工具结果虽然使用 user role，来源仍必须绑定真实工具调用。
    content: [{
      type: 'tool-result', // 只有旧格式存在的包装，必须交官方迁移提升而非权限层递归解释。
      toolCallId: callId, // 与消息来源和调用事件完全相同。
      ...(isError === undefined ? {} : { isError }), // 模拟真实历史缺省错误标志及显式状态。
      content: [{ type: 'file', attachment: reference }], // 唯一旧格式原件引用。
    }],
  }) // 使用官方工厂建立合法 V3 user-role 消息身份。
  const stream = [
    { type: 'chunk', time: 3, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } },
    { type: 'chunk', time: 3, chunk: { type: 'block-end', index: 0, block } },
    { type: 'chunk', time: 3, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } },
  ] // 与 assistant 工具声明一致的合成官方流；不以缺失 stream 的假日志冒充合法恢复。
  const rows = [
    { type: 'turn/start', data: { turn: 1 } }, // 开始当前执行轮次。
    { type: 'step/start', data: { turn: 1, step: 1 } }, // 开始模型与工具所在步骤。
    { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: assistant, stream } }, // 官方工具声明先于实际执行。
    { type: 'tool/call', data: { turn: 1, step: 1, callId, name: block.name, arguments: block.arguments } }, // 真正开始的受管导入调用。
    { type: 'tool/result', surfaceOp: 'append', sourceEventSeqs: [3], data: { turn: 1, step: 1, message: oldMessage } }, // 成功或失败历史结果精确引用原调用。
    { type: 'step/end', data: { turn: 1, step: 1 } }, // 所有工具终结后才结束步骤。
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'stop' } } }, // 完整闭合轮次，公开恢复器会校验关系。
  ] // 全部历史都是合成事件；不存在凭据、真实用户或网络。
  return {
    header: {
      version: 3, // 指定释放版 V3，必须经官方转换才能供 V4 Session 使用。
      id: 'fixture-historical-session', // 不对应真实磁盘 Session。
      createdAt: 1, // 合成创建时间，用于官方顺序验证。
      isSeeded: false, // 当前 Fixture 没有父会话或继承事件。
      delegationDepth: 0, // 独立根会话，不能绕过可信子会话授权。
    },
    events: rows.map((row, seq) => ({ ...row, seq, time: seq + 2 })), // 公开 Codec 要求事件序号连续且时间为数字。
    reference, // 原件身份必须在编码、迁移及恢复后保持一致。
  }
}

/**
 * 使用官方释放版 Codec、相邻迁移与 Session 恢复器处理独占合成旧日志。
 * @param {object} input historicalLog 返回的头、事件及附件身份。
 * @returns {{session:object,events:object[]}} 已通过官方生命周期及 V4 消息验证的真实 Session。
 * @sideEffects 无文件或网络；公开迁移只处理当前测试独占的内存 JSON。
 */
function migrateAndRestore(input) {
  const decoded = [] // 官方 V3 Codec 验证后的旧格式事件。
  const decodeContext = {
    emitEvent: event => decoded.push(event), // 单行或解码后的逻辑事件进入当前 Fixture 数组。
    emitRun: run => decoded.push(...run.expand()), // 公开紧凑事件运行展开为同样的受控历史。
  }
  const codec = formats.releasedV3SessionFormatCodec // 使用固定包公开的 Codec，不自行解释历史格式。
  const physicalHeader = codec.encodeHeader(input.header, 0) // 原始 V3 物理头，继承切点为零。
  const decoder = codec.createDecoder(physicalHeader, 'strict') // 合法历史必须严格通过，不用容错忽略来隐藏问题。
  for (const event of input.events) decoder.decodeRow(codec.encodeEvent(event), decodeContext)
  const sourceCut = decoder.finish(decodeContext) // 官方确认的旧格式继承切点。
  const migration = formats.createSessionFormatV3ToV4([]) // 空子会话事实明确声明该合成根会话没有历史子代理。
  const header = migration.migrateHeader(decoder.header) // 官方将释放版头从 V3 规范化到 V4。
  const stage = migration.createStage({
    sourceHeader: decoder.header, // 已经通过释放版 Codec 的源头。
    targetHeader: header, // 官方头转换产物，不自行改版本号。
    sourceInheritedEventCount: sourceCut, // 实际解码的继承切点。
    sourceKind: 'decoded', // 输入来自原始释放版 Codec。
  }) // 正式相邻迁移负责提升包装、映射来源序号和维持事件顺序。
  const events = [] // 已规范化的当前 V4 事件。
  const migrateContext = {
    emitEvent: event => events.push(event), // 当前迁移同步发布的逻辑事件。
    emitRun: run => events.push(...run.expand()), // 同样只在内存展开公开紧凑运行。
  }
  for (const event of decoded) stage.transformEvent(event, migrateContext)
  const inheritedEventCount = stage.finish(migrateContext) // 官方转换确认的 V4 继承切点。
  const artifact = formats.restoreReleasedV4Artifact({
    header, // 经过官方头迁移的当前元数据。
    inheritedEventCount, // 与完整日志关系一起验证。
    events, // 迁移后的消息、调用和结果不能存在退役包装。
  }, sessions.KNOWN_SESSION_EVENT_TYPES) // 校验完整闭合轮次及工具声明/执行/结果关系。
  const durable = JSON.parse(JSON.stringify(artifact)) // 模拟日志持久化再读取，不保留 undefined 等内存专有值。
  const session = sessions.Session.fromRestore(
    sessions.SessionId(durable.header.id),
    durable.events,
    durable.header,
    sessions.SessionLogOffset(durable.inheritedEventCount),
    'detached',
  ) // 官方真实恢复再次确认消息角色、序号、surface 和 Runtime 必需字段。
  return { session, events: durable.events }
}

test('released V3 successful file results normalize through official migration and restore attachment authority', () => {
  for (const isError of [undefined, false]) { // 官方历史允许缺省或显式成功，权限层不能要求只接受 false。
    const source = historicalLog(isError) // 独占合成 V3 日志，没有实际文件读取。
    const migrated = migrateAndRestore(source) // 正式 Codec、迁移及真实 Session 恢复均必须成功。
    const result = migrated.events.find(event => event.type === 'tool/result').data.message // 当前 V4 的独立 tool-role 消息。
    assert.equal(result.role, 'tool')
    assert.equal(result.toolCallId, result.source.callId)
    assert.deepEqual(result.content.map(block => block.type), ['file'])
    assert.equal(result.isError, isError)
    assert.deepEqual([...sessionFiles(migrated.session).values()], [source.reference])
  }
})

test('released V3 failed file result remains unauthorized after official normalization', () => {
  const source = historicalLog(true) // 失败结果即使包含附件引用也不能给当前 Session 新权限。
  const migrated = migrateAndRestore(source) // 失败状态仍是合法历史，恢复器必须保留它。
  assert.equal(migrated.events.find(event => event.type === 'tool/result').data.message.isError, true)
  assert.equal(sessionFiles(migrated.session).size, 0)
})
