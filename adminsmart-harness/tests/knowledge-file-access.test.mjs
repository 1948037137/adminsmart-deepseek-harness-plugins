/** 真实官方模型循环、知识桥接、附件存储及文件读取的离线端到端回归；所有正文均为合成数据。 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { call, fixture, llmModule, sessionModule } from './helpers/native-delegation.mjs'
import { loadRuntimeModule } from '../src/runtime.mjs'
import { sessionFiles, sessionFileState } from '../src/session-files.mjs'
import { within } from '../src/native-file-policy.mjs'

const ASSET_ID = 'ee000000-0000-4000-8000-000000000001' // 内部清单使用的合成知识资产身份，不对应任何真实数据库对象。
const DOCUMENT_NAME = 'synthetic-knowledge-reference.md' // 官方 Store 保存和 Session 消息使用的合成原件名称。
const DOCUMENT_TEXT = '# SYNTHETIC-KNOWLEDGE-REFERENCE\nOnly this fixture owns the synthetic evidence.\nAmount: 123\n' // 可明确验证真实读取结果的固定合成正文。
const DOCUMENT_BYTES = Buffer.from(DOCUMENT_TEXT, 'utf8') // Fake 内部 API 返回的原件字节，不从用户目录读取。
const DOCUMENT_SHA256 = createHash('sha256').update(DOCUMENT_BYTES).digest('hex') // 真实桥接必须通过字节长度与内容摘要一致性校验。

/**
 * 从官方 Session 中定位某次工具调用的原生结果消息。
 * @param {object} agent 当前测试创建的真实官方 Agent。
 * @param {string} callId Fake 模型发出的确定调用身份。
 * @returns {object|undefined} 最新的独立 tool-role 消息，不解释任何文本包装。
 */
function resultMessage(agent, callId) {
  return agent.session.snapshotEvents().findLast(event => (
    event.type === 'tool/result' && event.data?.message?.toolCallId === callId
  ))?.data.message
}

/**
 * 创建装配真实知识 Preset 的 Agent；创建和恢复使用相同公开 setup 协议。
 * @param {object} context 已挂载官方服务的 Cordis 图。
 * @param {string} id 合成会话身份。
 * @param {string} businessRoot 当前测试的独立业务工作目录。
 * @returns {Promise<object>} 官方 AgentHandle，测试持有其清理能力。
 */
function createKnowledgeAgent(context, id, businessRoot) {
  return context.agents.create({
    sessionId: sessionModule.SessionId(id), // Agent 与 Session 共用的官方身份。
    meta: { cwd: businessRoot }, // 与附件 Home 分离的业务工作目录，模拟生产布局。
    agentOptions: { provider: 'fixture', model: 'fixture-model' }, // 已有 Helper 提供的离线模型适配器。
    setup: agentCtx => context.agentPresets.mount(agentCtx, 'adminsmart-knowledge').then(() => undefined), // 使用真实业务插件及其原生 Guard。
  })
}

/**
 * 通过官方构造器创建明确来源为用户的合成输入，满足真实 V4 持久化协议。
 * @param {string} text 本测试指定的合成用户指令，不读取真实消息。
 * @returns {object} 带官方消息身份和 producer-owned 来源的用户消息。
 */
function syntheticUserMessage(text) {
  return llmModule.createUserMessage({
    content: [{
      type: 'text', // 合成输入只有普通文字，不通过伪造附件或工具结果授予权限。
      text, // 当前用例提供的固定指令。
    }],
    source: { kind: 'user' }, // 官方 V4 不持久化无 producer 来源的测试消息。
  })
}

test('official knowledge load grants readonly native access only to its Session and survives durable resume', { timeout: 30_000 }, async t => {
  const f = await fixture(t) // 真正的官方 Context、Agent Loop、Session、AttachmentStore 与知识 Preset，默认禁止网络。
  const businessRoot = join(f.home, 'business') // 业务文件允许的根，与 DSH_HOME 下附件存储分开。
  const extraFibers = [] // 本测试附加的官方服务，结束时逆序释放。
  const handles = [] // 本测试拥有的根 AgentHandle；重复 dispose 必须保持官方幂等语义。
  const apiCalls = [] // Fake 内部 API 到达的路径及合成 Session 身份，不保存令牌。
  const ownerId = 'knowledge-file-access-owner' // 首次真实知识挂载及后续恢复的同一会话身份。
  const strangerId = 'knowledge-file-access-stranger' // 同一官方 Store 下未获得原件引用的陌生会话。
  let sourcePath = '' // 仅通过官方 AttachmentStore.fileHostPath 得到的原件读取地址。
  let loadedReference // 真实 load_knowledge_files 输出并被官方 Session 接受的附件元数据。
  let modelPhase = 'owner' // Fake 模型的有限脚本阶段，不调用真实模型或解析自然语言工具调用。
  let ownerSteps = 0 // 首轮三个模型步骤分别加载、读取和结束。
  let strangerSteps = 0 // 陌生会话实际尝试原生读取后结束，不通过伪造事件拒绝。
  let resumedSteps = 0 // 恢复后的同一会话只读取已有原件，不重新调用桥接 API。
  await mkdir(businessRoot)
  process.env.ADMINSMART_AGENT_BUSINESS_ROOT = businessRoot
  f.context.set('sandboxPolicy', {
    defaultMode: 'workspace-write', // 当前业务保留既定写入模式，不授予更高权限。
    workspaceRoot: businessRoot, // 权限配置与合成 Session cwd 一致。
    overrideOf: () => undefined, // 本测试不注入额外会话权限覆盖。
    resolve: () => ({ mode: 'workspace-write', workspaceRoot: businessRoot }), // 官方 Tool 使用相同业务根判断权限。
  })
  const ToolFs = await loadRuntimeModule('@deepseek-ai/dsh-tool-fs') // 固定官方 read/write/edit 工具与输出 Schema。
  assert.ok(f.context.fs && f.context.sessionPersistence, 'alpha2托管激活Fixture已经装载真实官方FS及JSONL，原件恢复复用同一服务图')
  extraFibers.push(await f.context.plugin(ToolFs)) // 必须先于 Agent Preset 挂载，让官方文件工具进入其 Guard 和可见性快照。
  t.after(async () => {
    for (const handle of handles.reverse()) await handle.dispose()
    for (const fiber of extraFibers.reverse()) await fiber.dispose()
  })

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)) // 模型不能选择地址，所有到达请求必须匹配唯一 Fake 内部 API。
    const sessionId = init.headers?.['X-AdminSmart-Session-Id'] // 可信当前 Session Header，不能从模型参数取得。
    assert.equal(url.origin, 'http://127.0.0.1:19099')
    assert.equal(sessionId, ownerId)
    assert.equal(init.headers?.['X-AdminSmart-User-Id'], '42')
    assert.equal(init.headers?.['X-AdminSmart-Agent-Token'], 'fixture-capability-token')
    apiCalls.push({ path: url.pathname, sessionId })
    if (url.pathname === '/internal/agent-tools/knowledge/attachments/manifest') {
      assert.equal(init.method, 'POST')
      assert.deepEqual(JSON.parse(init.body), { scope: 'selected', assetIds: [ASSET_ID], offset: 0, limit: 1 })
      return new Response(JSON.stringify({
        code: 200, // 受管内部 API 的成功协议形状。
        data: {
          scope: 'selected', // 当前仅挂载用户明确选择的一个原件。
          files: [{
            assetId: ASSET_ID, // 合成资产标识，不能被当作文件路径。
            documentId: 'synthetic-knowledge-document', // Fake 文件业务身份。
            name: DOCUMENT_NAME, // 原件显示名，由官方 Store 规范化保存。
            extension: 'md', // 本测试验证 UTF-8 文本官方读取，不引入文档解析服务。
            mediaType: 'text/markdown', // 使用通用 FileBlock，不能冒充图片。
            bytes: DOCUMENT_BYTES.byteLength, // 桥接必须核对完整原件字节数。
            sha256: DOCUMENT_SHA256, // 官方内容身份必须等于真实合成摘要。
          }],
          totalCount: 1, // 当前用户 Fake 清单只有此合成文件。
          nextOffset: -1, // 无下一页，不让模型追加无必要 API 请求。
          truncated: false, // 本测试原件未被预算截断。
          note: 'synthetic selected fixture', // 纯合成清单说明。
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    assert.equal(url.pathname, `/internal/agent-tools/knowledge/attachments/${ASSET_ID}/content`)
    assert.equal(init.method, 'GET')
    return new Response(DOCUMENT_BYTES, { status: 200, headers: { 'content-type': 'text/markdown' } }) // 唯一合成原件字节来源。
  }

  f.state.reply = async (_options, agent) => {
    if (agent.id === strangerId) {
      if (strangerSteps++ === 0) return [call('read', { file_path: sourcePath }, 'stranger-read')]
      const denied = resultMessage(agent, 'stranger-read') // 官方 Agent Loop 实际追加的拒绝结果，不是手写 Guard 断言。
      assert.equal(denied?.role, 'tool')
      assert.equal(denied?.isError, true)
      assert.match(JSON.stringify(denied.content), /文件路径不属于当前业务目录或本会话授权附件/)
      assert.equal(sessionFiles(agent.session).size, 0)
      return [{ type: 'text', text: 'synthetic stranger remained denied' }]
    }
    assert.equal(agent.id, ownerId)
    if (modelPhase === 'resumed') {
      if (resumedSteps++ === 0) {
        assert.deepEqual([...sessionFiles(agent.session).values()], [loadedReference])
        return [call('read', { file_path: sourcePath }, 'resumed-read')]
      }
      const resumedRead = resultMessage(agent, 'resumed-read') // 恢复后由真实官方 read 返回的结果。
      assert.equal(resumedRead?.isError, false)
      assert.match(JSON.stringify(resumedRead.content), /SYNTHETIC-KNOWLEDGE-REFERENCE/)
      return [{ type: 'text', text: 'synthetic resumed reference read' }]
    }
    if (ownerSteps++ === 0) return [call('load_knowledge_files', {
      scope: 'selected', // 必须经过真实知识桥接和内部 API 所有权契约。
      assetIds: [ASSET_ID], // 合成清单中的明确选中原件。
      offset: 0, // selected 范围不会隐式遍历其它文件。
      limit: 1, // 只允许当前一个合成文件进入 Store。
    }, 'owner-load')]
    if (ownerSteps === 2) {
      const loaded = resultMessage(agent, 'owner-load') // 由官方工具结果管道生成并追加的 V4 原生消息。
      assert.equal(loaded?.role, 'tool')
      assert.deepEqual(loaded?.source, { kind: 'tool', callId: 'owner-load' })
      assert.equal(loaded?.isError, false)
      const file = loaded.content.find(block => block.type === 'file') // 只承认工具消息直接携带的官方 FileBlock。
      assert.ok(file)
      loadedReference = file.attachment
      assert.equal(loadedReference.name, DOCUMENT_NAME)
      assert.equal(loadedReference.attachmentId, `sha256:${DOCUMENT_SHA256}`)
      assert.deepEqual([...sessionFiles(agent.session).values()], [loadedReference])
      assert.equal(sessionFileState(agent.session, f.context.sessionProjections).reservedFiles, 1)
      assert.equal(sessionFileState(agent.session, f.context.sessionProjections).reservedBytes, DOCUMENT_BYTES.length)
      sourcePath = f.context.attachments.fileHostPath(loadedReference)
      assert.equal(within(businessRoot, sourcePath), false, '模拟生产附件 Home 与业务 cwd 分离')
      return [call('read', { file_path: sourcePath }, 'owner-read')]
    }
    const read = resultMessage(agent, 'owner-read') // 真实官方 read 从 LocalFileSystem 读取原件后追加的结构化终态。
    assert.equal(read?.role, 'tool')
    assert.equal(read?.isError, false, JSON.stringify(read))
    assert.match(JSON.stringify(read.content), /SYNTHETIC-KNOWLEDGE-REFERENCE/)
    assert.match(JSON.stringify(read.content), /Amount: 123/)
    return [{ type: 'text', text: 'synthetic authorized reference read' }]
  }

  const ownerHandle = await createKnowledgeAgent(f.context, ownerId, businessRoot) // 先创建实际拥有知识 Preset 的可信根会话。
  handles.push(ownerHandle)
  const owner = ownerHandle.agent // 原件首次授权的真实 Agent，不使用 Fake session.snapshotEvents。
  assert.equal(owner.session.header.cwd, businessRoot)
  owner.followup(syntheticUserMessage('Load the selected synthetic knowledge reference and read its real text.'))
  await owner.whenIdle()
  assert.equal(ownerSteps, 3)
  const nativeRead = f.outcomes.find(outcome => outcome.execution.callId === 'owner-read') // 官方文件工具经过 Guard 后的完整输出 Schema。
  assert.equal(nativeRead?.result.isError, false)
  assert.equal(nativeRead.result.value.lines.map(line => line.text).join('\n'), DOCUMENT_TEXT.trimEnd())
  assert.equal(apiCalls.length, 2, '选中原件只调用一次清单及一次原件流')

  const writeDenied = await f.execute(owner, 'write', {
    file_path: sourcePath, // 已授权原件读取地址，不能转换为可写目录。
    content: 'synthetic forbidden overwrite', // Guard 必须阻止这些字节进入真实 FS 写入。
  }) // 使用实际官方工具运行时，不直接调用 permitsPath 代替集成验证。
  assert.equal(writeDenied.isError, true)
  assert.match(JSON.stringify(writeDenied.content), /文件路径不属于当前业务目录或本会话授权附件/, '拒绝来自真实知识 Guard，不能以参数 Schema 错误冒充只读边界')
  const editDenied = await f.execute(owner, 'edit', {
    file_path: sourcePath, // 同一不可变附件原件地址。
    old_string: 'Amount: 123', // 合成待替换片段。
    new_string: 'Amount: 999', // 不允许写入原件的合成内容。
  }) // 写入与编辑两种官方能力都必须被相同知识 Guard 拒绝。
  assert.equal(editDenied.isError, true)
  assert.match(JSON.stringify(editDenied.content), /文件路径不属于当前业务目录或本会话授权附件/)
  assert.deepEqual(await readFile(sourcePath), DOCUMENT_BYTES)

  const strangerHandle = await createKnowledgeAgent(f.context, strangerId, businessRoot) // Store 和业务根相同，但没有知识加载授权结果的另一 Session。
  handles.push(strangerHandle)
  strangerHandle.agent.followup(syntheticUserMessage('Attempt to read only the synthetic unaccepted reference.'))
  await strangerHandle.agent.whenIdle()
  assert.equal(strangerSteps, 2)
  assert.equal(apiCalls.length, 2, '陌生会话读取不允许隐式补授权或调用桥接')

  await f.context.sessions.flush(owner.session) // 官方持久化屏障保证结果引用已经写入本测试 JSONL。
  await ownerHandle.dispose()
  assert.equal(f.context.agents.get(ownerId), undefined)
  assert.equal(f.context.sessions.get(ownerId), undefined)
  modelPhase = 'resumed'
  const restoredHandle = await f.context.agents.resume({
    resumeSessionId: sessionModule.SessionId(ownerId), // 同一持久会话身份，不能把引用复制给陌生用户。
    agentOptions: { provider: 'fixture', model: 'fixture-model' }, // 恢复同一离线模型路由。
    setup: agentCtx => f.context.agentPresets.mount(agentCtx, 'adminsmart-knowledge').then(() => undefined), // 恢复时重新装配同一知识 Guard。
  }) // 官方恢复读取真实 JSONL，非内存 Session.create 伪造。
  handles.push(restoredHandle)
  assert.notEqual(restoredHandle.agent.session, owner.session)
  assert.equal(restoredHandle.agent.session.header.cwd, businessRoot)
  assert.deepEqual([...sessionFiles(restoredHandle.agent.session).values()], [loadedReference])
  assert.equal(sessionFileState(restoredHandle.agent.session, f.context.sessionProjections).reservedFiles, 1, '官方JSONL恢复保留下载前预留，不能凭Runtime重启清空预算')
  assert.equal(sessionFileState(restoredHandle.agent.session, f.context.sessionProjections).reservedBytes, DOCUMENT_BYTES.length)
  restoredHandle.agent.followup(syntheticUserMessage('Read the previously authorized synthetic reference after restore.'))
  await restoredHandle.agent.whenIdle()
  assert.equal(resumedSteps, 2)
  assert.equal(apiCalls.length, 2, '恢复后的读取只消费已有官方授权引用，不重新加载知识原件')
  assert.deepEqual(await readFile(sourcePath), DOCUMENT_BYTES)
})
