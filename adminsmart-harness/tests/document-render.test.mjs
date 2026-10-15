/** 受控官方渲染的离线权限、生命周期与真实 PDF 像素回归，不访问模型、外部服务或用户资料。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, link, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createDocumentRenderer } from '../src/document-render.mjs'
import { authorizedRenderSource, renderSelection, MAX_RENDER_IMAGES, MAX_RENDER_INPUT_BYTES } from '../src/document-render-policy.mjs'
import { loadRuntimeModule } from '../src/runtime.mjs'
import { fixture as nativeFixture, llmModule } from './helpers/native-delegation.mjs'
import { syntheticRenderPdf } from './helpers/render-fixtures.mjs'

/** @param {object} t 测试生命周期。 @returns {Promise<object>} 完全合成的业务/区外文件和仅用于测试的公开服务替身。 */
async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'controlled-render-')) // 只清理本项明确创建的目录。
  const root = join(temporary, 'business') // 模拟运行目录，测试不使用真实用户 Home。
  const outside = join(temporary, 'outside.pdf') // 用合成 PDF 作为越界 canary。
  const input = join(root, 'fixture.pdf') // 正常业务文件。
  const bytes = syntheticRenderPdf() // 原件字节固定可核对，不含真实资料。
  await mkdir(root)
  await writeFile(input, bytes)
  await writeFile(outside, bytes)
  const originalRoot = process.env.ADMINSMART_AGENT_BUSINESS_ROOT // 测试后恢复调用者环境，不泄漏环境值。
  process.env.ADMINSMART_AGENT_BUSINESS_ROOT = root
  t.after(async () => {
    if (originalRoot === undefined) delete process.env.ADMINSMART_AGENT_BUSINESS_ROOT
    else process.env.ADMINSMART_AGENT_BUSINESS_ROOT = originalRoot
    await rm(temporary, { recursive: true, force: true })
  })
  const events = [] // 当前测试已接受的原生消息，不接受模型伪造身份。
  const reads = [] // 确认越界输入在读取或引擎调用之前拒绝。
  const session = { id: 'render-fixture', header: { cwd: root }, snapshotEvents: () => events } // 普通根会话的官方形状替身。
  const ctx = {
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) }, // 不能从更宽模式偷偷启用入口。
    attachments: {
      fileHostPath: reference => reference.name === 'own.pdf' ? outside : join(temporary, 'foreign.pdf'), // 官方路径计算 Fake，只映射本测试引用。
      async *readFileStream() { reads.push('attachment'); yield bytes }, // 字节来源仍通过公开 AttachmentStore seam。
    },
    fs: {
      resolve: async path => ({ path }), // 测试只替换公开文件服务，不改生产路径校验。
      processPath: target => target.path, // 与当前本机执行世界相同。
      readBytes: async (target, signal, maxBytes) => { signal.throwIfAborted(); reads.push(target.path); const value = await readFile(target.path); assert.ok(value.byteLength <= maxBytes); return value }, // 有界合成读取替身。
    },
  }
  const exec = { agent: { session }, signal: new AbortController().signal } // 取消与 Session 生命周期独立，不来自工具参数。
  return { root, temporary, input, outside, bytes, events, reads, ctx, exec }
}

/** @returns {Function} 有限正常 PNG 的 Fake 官方工厂；用于权限和失败测试，不冒充真实渲染验收。 */
function fakeFactory() {
  return async options => ({
    async renderImages(request, signal) {
      signal.throwIfAborted()
      assert.equal(options.fontMetadataCacheDirectory, false)
      assert.equal(options.maxInputBytes, MAX_RENDER_INPUT_BYTES)
      assert.equal(request.maxPages, MAX_RENDER_IMAGES)
      await mkdir(request.outputDir)
      const path = join(request.outputDir, 'page-1.png') // Fake 只有固定 PNG，不解析输入文档。
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') // 一像素有效图片只用于元数据契约。
      await writeFile(path, png)
      return { schemaVersion: 1, source: 'saved', sourceSha256: createHash('sha256').update(await readFile(request.inputPath)).digest('hex'), backend: 'native', rasterEngine: 'pdfium', pageCount: 1, missingFonts: [], images: [{ path, page: 1, width: 1, height: 1, byteLength: png.length }] }
    },
    async dispose() {}, // Fake 生命周期由各测试追加断言。
  })
}

test('render selection refuses commands, output paths, permissions and ambiguous page/sheet choices', () => {
  assert.deepEqual(renderSelection({ file_path: 'report.pdf' }).pages, [1])
  assert.deepEqual(renderSelection({ file_path: 'report.pdf', pages: [1], sheet: '', range: '' }).pages, [1], '真实模型会补齐可选空字段，不能误判正常 PDF 调用')
  assert.throws(() => renderSelection({ file_path: 'report.pdf', pages: [1], sheet: 'Sales', range: '' }))
  assert.deepEqual(renderSelection({ file_path: 'report.pdf', pages: [] }).pages, [1], '官方技能的空可选页码仍只渲染第一页')
  assert.throws(() => renderSelection({ file_path: 'report.pdf', pages: [1, 1] }))
  assert.throws(() => renderSelection({ file_path: 'report.pdf', pages: [1, 2, 3, 4] }))
  assert.throws(() => renderSelection({ file_path: 'report.pdf', pages: [-1] }))
  for (const property of ['command', 'outputDir', 'output_path', 'sandbox_permissions', 'userId', 'sessionId', 'code']) assert.throws(() => renderSelection({ file_path: 'report.pdf', [property]: 'forged' }))
  assert.throws(() => renderSelection({ file_path: 'report.docm' }))
  assert.throws(() => renderSelection({ file_path: 'report.xlsx', pages: [1] }))
  assert.match(renderSelection({ file_path: 'report.xlsx' }).skippedReason, /实际工作表/)
  assert.throws(() => renderSelection({ file_path: 'report.xlsx', sheet: 'Sales', range: 'A1;whoami' }))
  assert.equal(renderSelection({ file_path: 'report.xlsx', sheet: 'Sales', range: 'A1:D12' }).range, 'A1:D12')
  assert.equal(renderSelection({ file_path: 'report.xlsx', pages: [], sheet: 'Sales', range: '' }).sheet, 'Sales', '表格的可选空页码只表示未选择物理页，不扩大处理范围')
})

test('foreign inputs, traversal, links and missing Session fail before bytes or engine access', async t => {
  const f = await fixture(t) // 只使用本测试自己的合成原件和区外 canary。
  let engines = 0 // 任意越界尝试都不能启动高于 Shell 权限的受控引擎。
  const render = createDocumentRenderer(async () => { engines += 1; return fakeFactory()() })
  await symlink(f.outside, join(f.root, 'link.pdf'), 'file')
  await link(f.outside, join(f.root, 'hard.pdf'))
  for (const file_path of [f.outside, '../outside.pdf', '//server/share/a.pdf', '\\\\server\\share\\a.pdf', 'link.pdf', 'hard.pdf']) await assert.rejects(render(f.ctx, { file_path }, f.exec), /未获/)
  await assert.rejects(render(f.ctx, { file_path: f.input }, { ...f.exec, agent: {} }), /未获/)
  await assert.rejects(render(f.ctx, { file_path: f.input, outputDir: f.outside }, f.exec), /未获/)
  assert.equal(engines, 0)
  assert.deepEqual(f.reads, [])
  assert.deepEqual(await readFile(f.outside), f.bytes)
})

test('a current accepted attachment uses the official byte stream and leaves original input unchanged', async t => {
  const f = await fixture(t) // 原件在业务 cwd 外，但当前会话引用明确授权只读。
  const reference = { attachmentId: 'sha256:' + createHash('sha256').update(f.bytes).digest('hex'), name: 'own.pdf', bytes: f.bytes.length } // 完全合成的原生文件身份。
  f.events.push({ type: 'user/message', data: { content: [{ type: 'file', attachment: reference }] } })
  assert.deepEqual(authorizedRenderSource(f.ctx, { ...f.exec, arguments: { file_path: f.outside } }).reference, reference)
  const result = await createDocumentRenderer(fakeFactory())(f.ctx, { file_path: f.outside }, f.exec)
  assert.equal(result.status, 'ready')
  assert.equal(result.fileName, 'own.pdf')
  assert.deepEqual(f.reads, ['attachment'])
  assert.ok(result.images[0].path.startsWith(f.root))
  const jobs = (await readdir(f.root)).filter(name => name.startsWith('office-render-')) // 只检查本测试业务根，不能枚举真实 Session。
  assert.equal(jobs.length, 1)
  assert.deepEqual(await readdir(join(f.root, jobs[0])), ['pages'], '成功后不保留输入副本')
  assert.deepEqual(await readFile(f.outside), f.bytes)
})

test('Session目录切换后受控渲染与路径Guard使用同一个相对文件，不能误取业务根同名文件', async t => {
  const f = await fixture(t) // 所有同名文件和区外canary均由本项生成。
  const directory = join(f.root, 'worktree') // 合成Session已切换的业务子目录，不创建真实Git检出。
  const currentInput = join(directory, 'fixture.pdf') // 与业务根原件同名，内容必须可以区分。
  const currentBytes = Buffer.concat([f.bytes, Buffer.from('\n% SYNTHETIC-CURRENT-SESSION\n')]) // 合成PDF增加可区分的末尾注释，不含真实文档。
  await mkdir(directory)
  await writeFile(currentInput, currentBytes)
  let currentDirectory = directory // 仅由可信公开工作目录服务的Fixture改变，工具参数不能覆盖。
  f.ctx.get = name => name === 'workingDirectory' ? { get: () => currentDirectory } : undefined // 只替换外围目录数据，实际授权、快照和render管道仍运行。
  const source = authorizedRenderSource(f.ctx, { ...f.exec, arguments: { file_path: 'fixture.pdf', pages: [1] } }) // 同名文件不能以根目录作为第二套基准。
  assert.equal(source.path, currentInput)
  assert.equal((await createDocumentRenderer(fakeFactory())(f.ctx, { file_path: 'fixture.pdf', pages: [1] }, f.exec)).status, 'ready')
  assert.deepEqual(f.reads, [currentInput])
  assert.deepEqual(await readFile(currentInput), currentBytes)
  assert.deepEqual(await readFile(f.input), f.bytes)
  await symlink(f.outside, join(directory, 'escape.pdf'), 'file') // 当前Session子目录内的链接仍只能指向授权业务文件，区外自建canary不可借链接读取。
  assert.throws(() => authorizedRenderSource(f.ctx, { ...f.exec, arguments: { file_path: 'escape.pdf', pages: [1] } }), /不属于业务目录或当前会话附件/u)
  assert.deepEqual(f.reads, [currentInput]) // 拒绝发生在快照与引擎之前，不读取链接目标字节。
  currentDirectory = f.temporary // 即便绝对输入仍在业务根，当前Session目录越界时不得借此跳过Guard。
  assert.throws(() => authorizedRenderSource(f.ctx, { ...f.exec, arguments: { file_path: f.input, pages: [1] } }), /不属于业务目录或当前会话附件/u)
  assert.deepEqual(f.reads, [currentInput])
})

test('cancellation, failed engines and tampered output settle disposal without publishing partial pages', async t => {
  const f = await fixture(t) // 取消和坏结果均使用本测试文件。
  let disposed = 0 // 必须等官方实例生命周期结束，才能重新开放单槽。
  const controller = new AbortController() // 模拟用户按下停止生成，不来自模型字段。
  const render = createDocumentRenderer(async () => ({
    async renderImages(_request, signal) { controller.abort(); signal.throwIfAborted() }, // 官方 API 接收到工具取消信号。
    async dispose() { disposed += 1 }, // 清理次数用于防止资源泄漏。
  }))
  await assert.rejects(render(f.ctx, { file_path: f.input }, { ...f.exec, signal: controller.signal }), /取消/)
  assert.equal(disposed, 1)
  assert.equal((await readdir(f.root)).filter(name => name.startsWith('office-render-')).length, 0)
  const bad = createDocumentRenderer(async () => ({
    async renderImages(request) { await mkdir(request.outputDir); return { schemaVersion: 1, source: 'saved', sourceSha256: 'forged', pageCount: 1, images: [] } }, // 假引擎结果不能出现在成功 Tool。
    async dispose() { disposed += 1 },
  }))
  await assert.rejects(bad(f.ctx, { file_path: f.input }, f.exec), /未生成可交付页面/)
  assert.equal(disposed, 2)
  assert.equal((await readdir(f.root)).filter(name => name.startsWith('office-render-')).length, 0)
})

test('one Runtime render slot refuses overlap and is released after engine completion', async t => {
  const f = await fixture(t) // 同一用户多个会话共享有限渲染槽，不创建无界队列。
  let release // 测试自己的引擎等待器，与任何真实进程无关。
  let entered // 用门闩精确定位第一次进入官方引擎后的并发窗口。
  const wait = new Promise(resolveWait => { release = resolveWait }) // 测试主动释放，不使用盲等定时器。
  const entry = new Promise(resolveEntry => { entered = resolveEntry })
  const normal = await fakeFactory()({ fontMetadataCacheDirectory: false, maxInputBytes: MAX_RENDER_INPUT_BYTES }) // 固定 PNG 的 Fake 引擎。
  const render = createDocumentRenderer(async () => ({ ...normal, async renderImages(request, signal) { entered(); await wait; return normal.renderImages(request, signal) } }))
  const first = render(f.ctx, { file_path: f.input }, f.exec) // 第一项真正占槽的任务。
  await entry
  await assert.rejects(render(f.ctx, { file_path: f.input }, f.exec), /正在渲染/)
  release()
  assert.equal((await first).images.length, 1)
  assert.equal((await render(f.ctx, { file_path: f.input }, f.exec)).images.length, 1)
})

test('official Office default requests return explicit skipped without another rendering pipeline', async t => {
  const f = await fixture(t) // 全部输入在本测试自己的业务根，不能读取生产文件。
  const workbook = join(f.root, 'fixture.xlsx') // 只测试范围准入，不声称此固定字节是可解析工作簿。
  await writeFile(workbook, 'synthetic-no-render')
  let engines = 0 // 无sheet的默认调用不读取源、不启动任何渲染引擎。
  const render = createDocumentRenderer(async () => { engines += 1; throw Object.assign(new Error('fixture unavailable'), { code: 'unavailable' }) }) // Fake只验证官方引擎不可用状态传播。
  const defaultWorkbook = await render(f.ctx, { file_path: workbook, pages: [], sheet: '', range: '' }, f.exec) // 模拟官方技能无页码默认请求。
  assert.equal(defaultWorkbook.status, 'skipped')
  assert.deepEqual(defaultWorkbook.images, [])
  assert.equal(defaultWorkbook.pageCount, 0)
  assert.equal(engines, 0)
  assert.deepEqual(f.reads, [])
  const unavailable = await render(f.ctx, { file_path: f.input }, f.exec) // 授权PDF可以读源，但明确缺引擎不伪造ready。
  assert.equal(unavailable.status, 'skipped')
  assert.equal(unavailable.backend, 'unavailable')
  assert.deepEqual(unavailable.images, [])
  assert.match(unavailable.note, /没有视觉核验/)
  assert.equal((await readdir(f.root)).filter(name => name.startsWith('office-render-')).length, 0)
})

test('oversized attachment metadata fails before byte access and forged engine output cannot escape', async t => {
  const f = await fixture(t) // 所有越界对象只在本测试临时目录内。
  let engines = 0 // 超限请求不得启动官方高权限渲染器。
  const oversized = { attachmentId: 'sha256:' + 'a'.repeat(64), name: 'own.pdf', bytes: MAX_RENDER_INPUT_BYTES + 1 } // 不创建巨大文件，只验证官方引用准入的大小边界。
  f.events.push({ type: 'user/message', data: { content: [{ type: 'file', attachment: oversized }] } })
  const render = createDocumentRenderer(async () => { engines += 1; return fakeFactory()({}) })
  await assert.rejects(render(f.ctx, { file_path: f.outside }, f.exec), /未生成可交付页面/)
  assert.equal(engines, 0)
  assert.deepEqual(f.reads, [])
  const attacker = createDocumentRenderer(async options => {
    const normal = await fakeFactory()(options) // 正常固定 PNG 是 Fake 结果的唯一可用产物。
    return { ...normal, async renderImages(request, signal) { const result = await normal.renderImages(request, signal); result.images[0].path = join(f.temporary, 'foreign.png'); return result } } // 即使可信 API 的返回异常，也不能读/交付区外路径。
  })
  await assert.rejects(attacker(f.ctx, { file_path: f.input }, f.exec), /未生成可交付页面/)
  assert.equal((await readdir(f.root)).filter(name => name.startsWith('office-render-')).length, 0)
  assert.deepEqual(await readFile(f.outside), f.bytes)
})

test('the fixed official engine renders real PDF pixels and native Tool rejects unauthenticated source choices', { timeout: 60000 }, async t => {
  const f = await nativeFixture(t) // 真实官方 Context、AttachmentStore、ToolRuntime 与 Guard，模型为 Fake。
  const business = join(f.home, 'runtime-cwd') // 与 Gateway 一致：办公目录不包含官方附件的内容寻址硬链接。
  await mkdir(business)
  process.env.ADMINSMART_AGENT_BUSINESS_ROOT = business
  f.context.sandboxPolicy.resolve = () => ({ mode: 'workspace-write', workspaceRoot: business })
  const parent = await f.parent('official-render-parent') // 附件权限来源于真实官方已接受消息。
  await f.context.workingDirectory.set(parent, business) // 真实Session cwd与本用例缩小后的业务根一致，不凭env模拟目录切换。
  const original = syntheticRenderPdf() // 真实页面像素文件完全由测试生成。
  const reference = await f.context.attachments.saveFile({ name: 'render-fixture.pdf', data: original }) // 正式 Store 保存并校验内容身份。
  parent.followup(llmModule.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: reference }] })) // 官方用户来源让附件通过真实会话消息持久化。
  await parent.whenIdle()
  const path = f.context.attachments.fileHostPath(reference) // 不硬编码官方内部存储布局。
  assert.doesNotThrow(() => authorizedRenderSource(f.context, { agent: parent, arguments: { file_path: path, pages: [1] } }))
  const result = await f.execute(parent, 'render_document', { file_path: path, pages: [1], sheet: '', range: '' }) // 使用真实浏览器观察到的参数形状回归完整 Guard 与 SDK Schema。
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(result.value.pageCount, 1)
  assert.equal(result.value.rasterEngine, 'pdfium')
  const image = result.value.images[0] // 当前实际页面，而不是 Fake PNG 的验收结果。
  assert.equal(image.width, 500)
  assert.equal(image.height, 667)
  const attachmentRequire = (await import('../src/runtime.mjs')).runtimeRequire // 图片像素检查使用当前官方 Store 已安装的解码器。
  const { createRequire } = await import('node:module') // 依赖锚定在官方 AttachmentLocal 安装位置。
  const sharp = createRequire(attachmentRequire.resolve('@deepseek-ai/dsh-attachment-local'))('sharp') // 不下载或安装新图片库。
  const { data, info } = await sharp(await readFile(image.path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) // 实际解码像素，空白页面不能通过。
  let colored = 0 // 非白色彩色图表像素的数量。
  for (let index = 0; index < data.length; index += info.channels) if (Math.max(data[index], data[index + 1], data[index + 2]) - Math.min(data[index], data[index + 1], data[index + 2]) > 80) colored += 1
  assert.ok(colored > 10_000)
  assert.deepEqual(await readFile(path), original, '官方存储原件不能被页面引擎修改')
  const denied = await f.execute(parent, 'render_document', { file_path: path, pages: [1], sandbox_permissions: 'danger-full-access' }) // Schema 未声明的字段仍由业务 Guard 拒绝。
  assert.equal(denied.isError, true)
  const stranger = await f.parent('official-render-stranger') // 同一 Runtime 另一个没有附件引用的真实会话。
  await f.context.workingDirectory.set(stranger, business) // 拒绝必须来自缺少本会话附件授权，不能被无关cwd越界提前替代。
  assert.equal((await f.execute(stranger, 'render_document', { file_path: path, pages: [1] })).isError, true)
  const runtimeRoot = (await import('../src/runtime.mjs')).runtimeRoot // 部署同一安装树，用来定位已有合成文档生成依赖。
  const python = process.env.ADMINSMART_OFFICE_PYTHON || resolve(runtimeRoot, '../智能体后端/.venv/Scripts/python.exe') // 仅测试读取已配置解释器，不新增或下载依赖。
  execFileSync(python, ['-c', "from pathlib import Path; import sys; from docx import Document; from openpyxl import Workbook; p=Path(sys.argv[1]); d=Document(); d.add_paragraph('SYNTHETIC-OFFICE-RENDER'); d.save(p/'render-word.docx'); w=Workbook(); s=w.active; s.title='Sales'; s.append(['Group','Amount']); s.append(['A',100]); s.append(['B',25]); w.save(p/'render-sales.xlsx')", f.home], { stdio: 'pipe', windowsHide: true }) // 只生成本测试隔离目录内的固定数据，不运行用户文档指令。
  for (const fileName of ['render-word.docx', 'render-sales.xlsx']) {
    const officeBytes = await readFile(join(f.home, fileName)) // 全部由上面的 Fixture 生成，不读取用户文件。
    const officeReference = await f.context.attachments.saveFile({ name: fileName, data: officeBytes }) // 两类 Office 都走真实官方附件存储。
    parent.followup(llmModule.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: officeReference }] })) // 只提交本测试生成的办公附件。
    await parent.whenIdle()
    const selection = fileName.endsWith('.xlsx') ? { pages: [], sheet: 'Sales', range: 'A1:B3' } : { pages: [1], sheet: '', range: '' } // 按真实模型完整参数形状测试两种选择语义。
    const officeResult = await f.execute(parent, 'render_document', { file_path: f.context.attachments.fileHostPath(officeReference), ...selection })
    assert.equal(officeResult.isError, false, JSON.stringify(officeResult))
    assert.equal(officeResult.value.rasterEngine, 'libreoffice')
    assert.equal(officeResult.value.images.length, 1)
    assert.deepEqual(await readFile(f.context.attachments.fileHostPath(officeReference)), officeBytes)
  }
  f.state.reply = async (_options, agent) => {
    const inherited = await f.execute(agent, 'render_document', { file_path: path, pages: [1] }) // 子代理必须通过真实官方父关系继承附件，而不是接收模型传入的 Session ID。
    assert.equal(inherited.isError, false)
    assert.equal(inherited.value.rasterEngine, 'pdfium')
    return [{ type: 'text', text: 'synthetic authorized parent page only' }]
  }
  assert.equal((await f.execute(parent, 'subagent', { description: 'synthetic page fixture', prompt: 'render the authorized parent page only' })).isError, false)
  await f.settle(parent)
})
