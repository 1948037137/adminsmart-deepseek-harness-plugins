/** 原件重复传输与整轮资源预算回归；全部API、字节、会话和存储均为隔离Fake。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRuntimeModule, runtimeRoot } from '../src/runtime.mjs'
import { bindSessionParent } from '../src/session-authority.mjs'

process.env.ADMINSMART_DSH_ROOT ??= runtimeRoot // 独立目标运行时以同一可移植固定安装解析官方Tool，不绑定用户目录。
const { apply, MAX_FILES_PER_TURN } = await import('../src/knowledge-attachments.mjs') // 必需运行配置在加载业务Tool前完成。
const llm = await loadRuntimeModule('@deepseek-ai/dsh-llm') // 官方消息工厂，避免手写错消息身份协议。
const bytes = Buffer.from('SYNTHETIC-KNOWLEDGE-IMPORT') // 所有原件均为固定合成字节，不使用生产文档。
const digest = createHash('sha256').update(bytes).digest('hex') // 新manifest和FakeStore都必须匹配此摘要。

/**
 * 注册原件Tool及官方Projection契约替身，每次提交仍驱动实际业务纯fold。
 * @param {object} t 当前测试生命周期，负责还原fetch/环境并清理独占临时目录。
 * @returns {Promise<object>} 隔离工具、数据及显式提交成功事件的能力。
 */
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'knowledge-import-budget-')) // 当前测试唯一临时数据根。
  const prior = { token: process.env.ADMINSMART_AGENT_TOKEN_FILE, user: process.env.ADMINSMART_AGENT_USER_ID, mode: process.env.ADMINSMART_AGENT_MODE_ID, preset: process.env.ADMINSMART_AGENT_PRESET_ID, fetch: globalThis.fetch } // 只在内存恢复，不输出真实配置。
  process.env.ADMINSMART_AGENT_TOKEN_FILE = join(home, 'fixture-token')
  process.env.ADMINSMART_AGENT_USER_ID = '42'
  process.env.ADMINSMART_AGENT_MODE_ID = 'knowledge'
  process.env.ADMINSMART_AGENT_PRESET_ID = 'adminsmart-knowledge'
  await writeFile(process.env.ADMINSMART_AGENT_TOKEN_FILE, 'synthetic-only-token')
  t.after(async () => {
    globalThis.fetch = prior.fetch
    for (const [key, field] of [['ADMINSMART_AGENT_TOKEN_FILE', 'token'], ['ADMINSMART_AGENT_USER_ID', 'user'], ['ADMINSMART_AGENT_MODE_ID', 'mode'], ['ADMINSMART_AGENT_PRESET_ID', 'preset']]) {
      if (prior[field] === undefined) delete process.env[key]
      else process.env[key] = prior[field]
    }
    await rm(home, { recursive: true, force: true })
  })
  let definition // 业务投影纯fold，由FakeRegistry按真实事件顺序驱动。
  let tool // 经官方defineTool构建的当前原件工具。
  const states = new WeakMap() // 每个合成Session独立状态，不能按字符串身份跨Session授权。
  const sources = [] // 当前后端可信清单的合成原件描述。
  const counts = { manifest: 0, content: 0, saves: 0 } // 实际调用数验证重复复用仍查权限清单但不下载原件。
  const session = { id: 'budget-session', header: {}, seq: 0 } // 只用可信执行对象，不把模型sessionId作为权限来源。
  const ctx = {
    effect: operation => operation(), // 测试拥有单次注册，不启动常驻服务。
    tools: { register(value) { tool = value; return () => {} } }, // 捕获同一官方Tool实例。
    sessionProjections: {
      register(value) { definition = value; return () => {} }, // 只替换公开Registry接线，不复制授权判断。
      stateOf(current) { if (!states.has(current)) states.set(current, definition.init()); return states.get(current) }, // 未接受成功事件时始终空权限。
    },
    attachments: {
      imageLimits: { maxImageBytes: 2048 }, // Fake规范化图片准入仍有明确源字节上限。
      async saveImages(input) {
        counts.saves += 1
        assert.deepEqual(Buffer.from(input[0].data), bytes)
        return [{ attachmentId: 'sha256:' + 'c'.repeat(64), name: input[0].name, mediaType: 'image/png', bytes: 32, width: 1, height: 1 }] // 模拟官方规范化后摘要/大小不同，不能拿原始digest直接猜图片身份。
      },
      async saveFileStream(input) {
        counts.saves += 1
        const chunks = [] // FakeStore只聚合这份很小的合成字节。
        for await (const chunk of input.data) chunks.push(Buffer.from(chunk))
        const actual = Buffer.concat(chunks) // 模拟官方内容寻址与大小返回。
        return { attachmentId: 'sha256:' + createHash('sha256').update(actual).digest('hex'), name: input.name, bytes: actual.length }
      },
    },
  }
  apply(ctx)
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/manifest')) {
      counts.manifest += 1
      const request = JSON.parse(init.body) // 清单请求的有界选择，由真实Tool生成。
      const visible = request.scope === 'selected' ? sources.filter(source => request.assetIds.includes(source.assetId)) : sources.slice(request.offset, request.offset + request.limit) // Fake资源归属与分页不访问真实数据库。
      const nextOffset = request.scope === 'selected' || request.offset + visible.length >= sources.length ? -1 : request.offset + visible.length // 真实下一页仍需模型显式继续。
      return new Response(JSON.stringify({ code: 200, data: { files: visible, totalCount: sources.length, nextOffset, truncated: nextOffset >= 0 } }))
    }
    counts.content += 1
    return new Response(bytes)
  }
  const append = (current, event) => { states.set(current, definition.apply(ctx.sessionProjections.stateOf(current), { ...event, seq: current.seq++ })) } // 只提交本测试显式接受的事件。
  append(session, { type: 'turn/start', data: { turn: 1 } })
  const execute = async (args, current = session, accept = true) => {
    const callId = 'fixture-call-' + current.seq // 调用身份始终属于当前Session。
    append(current, { type: 'tool/call', data: { name: tool.name, callId, turn: 1, step: 1 } })
    const value = await tool.execute(args, { agent: { session: current }, signal: new AbortController().signal }) // 官方取消与实际业务execute，无模型网络。
    if (accept) append(current, { type: 'tool/result', surfaceOp: 'append', sourceEventSeqs: [current.seq - 1], data: { turn: 1, step: 1, message: llm.createToolResultMessage({ callId, content: tool.output.render(args, value), isError: false }), meta: tool.output.presentationMeta(args, value) } }) // 仅成功且匹配真实调用才进入权限投影。
    return value
  }
  return { sources, counts, session, ctx, append, execute }
}

/** @param {number} index 合成身份序号。 @returns {object} 同摘要不同显示名的独立合成来源。 */
function source(index) { return { assetId: 'synthetic-asset-' + index, documentId: 'synthetic-document-' + index, name: 'fixture-' + index + '.txt', bytes: bytes.length, sha256: digest } }

test('same source version reuses only accepted Session files and still checks current manifest ownership', async t => {
  const f = await fixture(t) // 每次测试拥有独立状态、凭证Fixture和请求替身。
  f.sources.push(source(1))
  const first = await f.execute({ scope: 'all' }) // 真正下载并接受一次官方附件结果。
  const second = await f.execute({ scope: 'all' }) // 新权限清单仍读取，相同已授权版本不再传内容。
  assert.equal(first.newFileCount, 1)
  assert.equal(second.reusedCount, 1)
  assert.equal(second.newFileCount, 0)
  assert.equal(second.fullCoverage, true)
  assert.deepEqual(f.counts, { manifest: 2, content: 1, saves: 1 })
  f.sources.splice(0) // 后端归属撤销时，不能把本地已有引用当当前知识清单授权。
  assert.equal((await f.execute({ scope: 'all' })).files.length, 0)
  f.sources.push(source(1))
  const stranger = { id: 'stranger-session', header: {}, seq: 0 } // 相同Store环境但无成功Session事件，必须重新下载。
  await f.execute({ scope: 'all' }, stranger)
  assert.equal(f.counts.content, 2)
})

test('unaccepted results and changed digests cannot authorize reuse', async t => {
  const f = await fixture(t) // 独立Fake原件请求，不读取任何真实文件。
  f.sources.push(source(2))
  await f.execute({ scope: 'all' }, f.session, false) // 模拟输出未被官方接受：磁盘存在不能授权复用。
  assert.equal((await f.execute({ scope: 'all' })).reusedCount, 0)
  f.sources[0].sha256 = 'b'.repeat(64) // 新清单版本与Store字节不符，应下载后明确失败，不复用旧附件。
  await assert.rejects(f.execute({ scope: 'all' }), /完整性/)
  assert.equal(f.counts.content, 3)
})

test('normalized images reuse only the successful private source-to-reference mapping', async t => {
  const f = await fixture(t) // 图片字节同样为FakeStore处理的合成资料。
  f.sources.push({ ...source(3), name: 'fixture-3.png', mediaType: 'image/png' })
  const first = await f.execute({ scope: 'all' }) // 源摘要和规范化图片摘要不同，成功结果保存官方私有映射。
  assert.equal(first.images[0].attachmentId, 'sha256:' + 'c'.repeat(64))
  assert.equal(first.importedBindings[0].sha256, digest)
  const second = await f.execute({ scope: 'all' }) // 只有新权限清单+当前Session引用+成功映射同时满足才可复用。
  assert.equal(second.reusedCount, 1)
  assert.equal(second.transferredBytes, 0)
  assert.equal(f.counts.content, 1)
  assert.equal(f.counts.saves, 1)
})

test('failed byte-integrity attempts consume bounded turn reservations and oversized streams stop early', async t => {
  const f = await fixture(t) // 不创建大文件，使用固定小响应验证资源预算先预留再下载。
  f.sources.push({ ...source(4), bytes: 64 * 1024 * 1024 }) // 单文件合法、整轮256MiB允许四次尝试，但响应缺失必须失败。
  for (let attempt = 0; attempt < 4; attempt += 1) await assert.rejects(f.execute({ scope: 'all' }), /完整性/)
  const bounded = await f.execute({ scope: 'all' }) // 第五次不能凭失败无授权状态规避当前轮下载限制。
  assert.equal(bounded.budgetExceeded, 'turn')
  assert.equal(bounded.fullCoverage, false)
  assert.equal(bounded.newFileCount, 0)
  assert.equal(f.counts.content, 4)
  f.append(f.session, { type: 'turn/start', data: { turn: 2 } }) // 新用户轮次有独立有限预算。
  f.sources[0].bytes = bytes.length - 1 // 响应比清单长一字节，业务异步流必须在Store完成前终止。
  await assert.rejects(f.execute({ scope: 'all' }), /超过已确认大小/)
})

test('pagination and delegated import share a finite root-turn budget and report incomplete coverage', async t => {
  const f = await fixture(t) // 很小的真实合成字节验证文件数预算，不制造巨大文件。
  for (let index = 0; index < MAX_FILES_PER_TURN + 10; index += 1) f.sources.push(source(index))
  const first = await f.execute({ scope: 'all', offset: 0, limit: 100 }) // 首页100项，仍有下一页。
  assert.equal(first.nextOffset, 100)
  assert.equal(first.fullCoverage, false)
  const child = { id: 'child-budget-session', header: { origin: 'subagent', delegationDepth: 1, parentSession: f.session.id }, seq: 0 } // 仅Host绑定的可信一层子代理可继承。
  const unbind = bindSessionParent(child, () => f.session) // 当前父会话失效时下一次调用会拒绝。
  try {
    const second = await f.execute({ scope: 'all', offset: 100 }, child) // 子任务不能靠另一个Session规避同轮父预算。
    assert.equal(second.newFileCount, MAX_FILES_PER_TURN - 100)
    assert.equal(second.budgetExceeded, 'turn')
    assert.equal(second.fullCoverage, false)
    assert.equal(second.nextOffset, MAX_FILES_PER_TURN)
    assert.equal(second.remainingAssetIds.length, 10)
    const blocked = await f.execute({ scope: 'selected', assetIds: second.remainingAssetIds }) // 父会话同轮也没有剩余下载预算。
    assert.equal(blocked.newFileCount, 0)
    assert.equal(blocked.fullCoverage, false)
    assert.equal(blocked.budgetExceeded, 'turn')
    assert.equal(f.counts.content, MAX_FILES_PER_TURN)
  } finally { unbind() }
  await assert.rejects(f.execute({ scope: 'all' }, child), /可信父/)
  f.append(f.session, { type: 'turn/start', data: { turn: 2 } }) // 用户新一轮允许新的有限预算，不复用前轮失败预留。
  const next = await f.execute({ scope: 'selected', assetIds: f.sources.slice(MAX_FILES_PER_TURN).map(item => item.assetId) })
  assert.equal(next.newFileCount, 10)
  assert.equal(next.fullCoverage, true)
})
