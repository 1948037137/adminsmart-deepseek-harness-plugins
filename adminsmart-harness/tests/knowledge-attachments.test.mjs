/** 验证知识原件桥接只使用内部 API、官方 FileBlock 和当前 Session 身份。 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const pluginRoot = resolve(import.meta.dirname, '..') // 当前知识插件项目根。
const projectRoot = resolve(pluginRoot, '..', '..') // 固定 Runtime 和插件库的共享父目录。
const temporaryHome = await mkdtemp(join(tmpdir(), 'adminsmart-knowledge-attachments-')) // 能力凭证测试独占目录。
const tokenPath = join(temporaryHome, 'token') // 测试用短期能力凭证文件，不写入仓库。
await writeFile(tokenPath, 'fixture-capability-token', 'utf8')
process.env.ADMINSMART_DSH_ROOT = resolve(projectRoot, 'deepseek-harness-runtime') // 只加载固定 0.1.7-alpha.2 官方包。
process.env.ADMINSMART_AGENT_API_BASE = 'http://127.0.0.1:9099'
process.env.ADMINSMART_AGENT_TOKEN_FILE = tokenPath
process.env.ADMINSMART_AGENT_USER_ID = '42'
process.env.ADMINSMART_AGENT_MODE_ID = 'knowledge'
process.env.ADMINSMART_AGENT_PRESET_ID = 'adminsmart-knowledge'

const { apply } = await import('../src/knowledge-attachments.mjs') // 在受管 Runtime 环境已准备后加载 Tool。

test.after(async () => {
  await rm(temporaryHome, { recursive: true, force: true })
})

test('knowledge file bridge streams server files into native FileBlock output', async () => {
  let tool // 捕获唯一桥接 Tool，执行仍走官方 defineTool 输出验证。
  const saved = [] // 记录 Host Store 实际消费的原件字节，不访问真实用户数据。
  const context = {
    effect(registerEffect) { return registerEffect() },
    tools: { register(definition) { tool = definition; return () => {} } },
    attachments: {
      async saveFileStream(input) {
        const chunks = [] // 测试存储只在 Fixture 内聚合，生产实现保持官方流式落盘。
        for await (const chunk of input.data) chunks.push(Buffer.from(chunk))
        const data = Buffer.concat(chunks)
        saved.push({ name: input.name, data })
        return { attachmentId: `sha256:${'a'.repeat(64)}`, name: input.name, bytes: data.byteLength }
      },
    },
  }
  apply(context)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    assert.equal(init.headers['X-AdminSmart-Agent-Token'], 'fixture-capability-token')
    assert.equal(init.headers['X-AdminSmart-User-Id'], '42')
    assert.equal(init.headers['X-AdminSmart-Session-Id'], 'fixture-session')
    if (url.endsWith('/manifest')) {
      return new Response(JSON.stringify({
        code: 200,
        data: {
          scope: 'all',
          files: [{ assetId: 'asset-1', documentId: 'doc-1', name: 'fixture.csv', extension: 'csv', mediaType: 'text/csv', bytes: 18, sha256: 'a'.repeat(64) }],
          totalCount: 1,
          nextOffset: -1,
          truncated: false,
          note: 'fixture manifest',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    assert.match(url, /\/attachments\/asset-1\/content$/u)
    return new Response(Buffer.from('year,total\n2023,1\n'), { status: 200 })
  }
  try {
    const result = await tool.execute(
      { scope: 'all', assetIds: [], offset: 0, limit: 100 },
      { agent: { session: { id: 'fixture-session' } }, signal: new AbortController().signal },
    )
    assert.equal(result.files.length, 1)
    assert.equal(result.files[0].name, 'fixture.csv')
    assert.equal(saved[0].data.toString('utf8'), 'year,total\n2023,1\n')
    const rendered = tool.output.render({}, result)
    assert.match(rendered[0].text, /sha256:/)
    assert.match(rendered[0].text, /不是 file_path/)
    assert.match(rendered[0].text, /只读副本真实路径/)
    assert.match(rendered[0].text, /不得自行拼接存储路径/)
    assert.doesNotMatch(rendered[0].text, /asset-1/)
    assert.equal(rendered.at(-1).type, 'file')
    assert.equal(rendered.at(-1).attachment.name, 'fixture.csv')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('list scope returns selectable asset identities without storing file bytes', async () => {
  let tool // 捕获清单模式使用的同一 Tool 定义。
  let saveCalls = 0 // list 模式不得调用 AttachmentStore 写入。
  const context = {
    effect(registerEffect) { return registerEffect() },
    tools: { register(definition) { tool = definition; return () => {} } },
    attachments: { async saveFileStream() { saveCalls += 1; throw new Error('list must not store') } },
  }
  apply(context)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    assert.match(String(input), /\/attachments\/manifest$/u)
    return new Response(JSON.stringify({
      code: 200,
      data: {
        scope: 'all',
        files: [{ assetId: 'asset-list-1', documentId: 'doc-list-1', name: 'contract.pdf', extension: 'pdf', mediaType: 'application/pdf', bytes: 1024, sha256: 'b'.repeat(64) }],
        totalCount: 1,
        nextOffset: -1,
        truncated: false,
        note: 'fixture list',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await tool.execute(
      { scope: 'list', assetIds: [], offset: 0, limit: 100 },
      { agent: { session: { id: 'fixture-list-session' } }, signal: new AbortController().signal },
    )
    assert.equal(saveCalls, 0)
    assert.deepEqual(result.files, [])
    assert.equal(result.sourceFiles[0].assetId, 'asset-list-1')
    const rendered = tool.output.render({}, result)[0].text // 列表模式必须清楚区分选择身份和附件身份。
    assert.match(rendered, /asset-list-1/)
    assert.match(rendered, /不能作为原生文件路径或附件身份/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('knowledge images use the official ImageBlock branch instead of generic files', async () => {
  let tool // 捕获图片分支使用的桥接 Tool。
  let fileSaveCalls = 0 // 图片不能进入通用 FileBlock 存储。
  const imageBytes = Buffer.from('synthetic bounded raster bytes') // Fake Store 接收的离线图片字节。
  const imageSha256 = createHash('sha256').update(imageBytes).digest('hex') // 后端原件摘要 Fixture。
  const context = {
    effect(registerEffect) { return registerEffect() },
    tools: { register(definition) { tool = definition; return () => {} } },
    attachments: {
      imageLimits: { maxImageBytes: 1024 }, // 当前部署允许的原始图片字节上限。
      async saveFileStream() { fileSaveCalls += 1; throw new Error('image must not enter file storage') },
      async saveImages(images) {
        assert.equal(images[0].mediaType, 'image/png')
        assert.deepEqual(Buffer.from(images[0].data), imageBytes)
        return [{ attachmentId: `sha256:${'c'.repeat(64)}`, mediaType: 'image/png', bytes: 128, width: 20, height: 10, name: images[0].name }]
      },
    },
  }
  apply(context)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/manifest')) {
      return new Response(JSON.stringify({
        code: 200,
        data: {
          scope: 'all',
          files: [{ assetId: 'asset-image-1', documentId: 'doc-image-1', name: 'diagram.png', extension: 'png', mediaType: 'application/octet-stream', bytes: imageBytes.byteLength, sha256: imageSha256 }],
          totalCount: 1,
          nextOffset: -1,
          truncated: false,
          note: 'fixture image',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(imageBytes, { status: 200 })
  }
  try {
    const result = await tool.execute(
      { scope: 'all', assetIds: [], offset: 0, limit: 100 },
      { agent: { session: { id: 'fixture-image-session' } }, signal: new AbortController().signal },
    )
    assert.equal(fileSaveCalls, 0)
    assert.deepEqual(result.files, [])
    assert.equal(result.images.length, 1)
    assert.equal(tool.output.render({}, result).at(-1).type, 'image')
  } finally {
    globalThis.fetch = originalFetch
  }
})
