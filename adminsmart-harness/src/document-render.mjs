/** 受控调用官方 LibreOffice Kit；只负责权限、字节快照、输出检查和生命周期，不实现解析或渲染。 */
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, open, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { within } from './native-file-policy.mjs'
import {
  authorizedRenderSource, DOCUMENT_RENDER_TOOL_NAME, MAX_RENDER_DIMENSION, MAX_RENDER_IMAGES,
  MAX_RENDER_INPUT_BYTES, MAX_RENDER_OUTPUT_BYTES, MAX_RENDER_PIXELS, RENDER_TIMEOUT_MS,
} from './document-render-policy.mjs'
import { loadRuntimeModule } from './runtime.mjs'

const { defineTool } = await loadRuntimeModule('@deepseek-ai/dsh-tools') // 工具 Schema、返回验证和 UI 仍使用固定版 Harness。
const { createConverter } = await loadRuntimeModule('@deepseek-ai/libreoffice-kit') // 只导入官方公开 API，不调用私有引擎或修改上游。
const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ready', 'skipped'], required: true }, // 与当前官方Office技能一致；只有ready且images非空才能进行视觉判断。
    fileName: { type: 'string', required: true }, // 本次实际渲染的原始文件显示名。
    pageCount: { type: 'integer', required: true }, // 官方返回的物理页、幻灯片或工作表总数，不代表全部已查看。
    backend: { type: 'string', enum: ['native', 'wasm', 'unavailable'], required: true }, // skipped没有实际引擎时明确unavailable，不伪造渲染完成。
    rasterEngine: { type: 'string', enum: ['pdfium', 'libreoffice', 'unavailable'], required: true }, // 只有ready时才对应实际页面像素来源。
    images: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true }, // 已核对且仅在业务输出目录中的图片，后续交给原生 read_image/present。
          page: { type: 'integer', required: true }, // 文档一基物理页；表格没有物理页时为零。
          sheet: { type: 'string', required: true }, // 官方表格区域所属工作表，非表格为空。
          range: { type: 'string', required: true }, // 官方绘制的单元格范围，非表格为空。
          width: { type: 'integer', required: true }, // 经像素上限核对的真实图像宽度。
          height: { type: 'integer', required: true }, // 经像素上限核对的真实图像高度。
          bytes: { type: 'integer', required: true }, // 磁盘实际编码字节数，与官方返回值一致。
        },
      },
    },
    missingFonts: { type: 'array', required: true, items: { type: 'string' } }, // 官方字体诊断，仅描述视觉保真度限制。
    note: { type: 'string', required: true }, // 明确已渲染选择范围及下一步真实看图要求。
  },
} // 规范化输出，不传原件正文、内部引擎诊断或用户凭据。

/**
 * 明确结束未执行的视觉检查，不声称已经生成、查看或覆盖任何页面。
 * @param {object} source 已验证的当前会话或业务目录输入。
 * @param {string} note 固定业务限制文案，不包含服务器路径或底层异常。
 * @returns {object} 符合官方Office技能ready/skipped判断的空产物结果。
 */
function skippedRenderResult(source, note) {
  return {
    status: 'skipped', // 模型必须结束本次视觉检查，不能把空图片当ready。
    fileName: source.reference?.name ?? basename(source.path), // 只公开当前授权输入的显示名。
    pageCount: 0, // 未调用引擎不能猜测物理页或工作表总数。
    backend: 'unavailable', // 没有实际运行的引擎。
    rasterEngine: 'unavailable', // 没有页面像素来源。
    images: [], // 无可读取或可交付图像。
    missingFonts: [], // 未运行渲染，不伪造字体诊断。
    note, // 明确未核验范围与停止行为。
  }
}

/**
 * 取得有界源字节快照；附件由官方 Store 完整性流读取，业务文件由官方 fs seam 读取。
 * @param {object} ctx 当前 Context 的 fs 与 attachments。
 * @param {object} source 已验证输入，含 root、path 和可选 reference。
 * @param {AbortSignal} signal 当前渲染的协作取消信号。
 * @returns {Promise<Buffer>} 最多固定大小的完整文件；从不解析其格式。
 * @throws {Error} 超限、损坏、路径变化、链接或取消时拒绝。
 */
async function snapshotBytes(ctx, source, signal) {
  if (source.reference) {
    if (!Number.isSafeInteger(source.reference.bytes) || source.reference.bytes <= 0 || source.reference.bytes > MAX_RENDER_INPUT_BYTES) throw new Error('页面渲染输入超过单文件限制')
    const chunks = [] // 当前单个附件的有限字节段，不跨会话缓存。
    let bytes = 0 // 在消费流时核对上限和官方引用的实际大小。
    for await (const chunk of ctx.attachments.readFileStream(source.reference, signal)) {
      signal.throwIfAborted()
      bytes += chunk.byteLength
      if (bytes > MAX_RENDER_INPUT_BYTES || bytes > source.reference.bytes) throw new Error('页面渲染输入超过单文件限制')
      chunks.push(Buffer.from(chunk))
    }
    if (bytes !== source.reference.bytes) throw new Error('附件内容与当前会话引用不一致')
    return Buffer.concat(chunks, bytes)
  }
  const before = await lstat(source.path) // 业务原件不允许通过链接别名获得额外写入或读取范围。
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size <= 0 || before.size > MAX_RENDER_INPUT_BYTES) throw new Error('页面渲染输入必须是大小受限的普通文件')
  const target = await ctx.fs.resolve(source.path, { cwd: source.root, signal }) // 公共文件系统负责真实目标身份和进程路径。
  if (await realpath(ctx.fs.processPath(target)) !== source.path) throw new Error('页面渲染文件路径发生变化')
  const data = await ctx.fs.readBytes(target, signal, MAX_RENDER_INPUT_BYTES) // 固定上限在官方后端生效，不能无界读入再检查。
  const after = await lstat(source.path) // 快照前后必须保持普通原件身份、尺寸与更新时间。
  if (after.ino !== before.ino || after.dev !== before.dev || after.nlink !== 1 || after.size !== before.size || after.mtimeMs !== before.mtimeMs || data.byteLength !== before.size) throw new Error('页面渲染输入在读取时发生变化')
  return Buffer.from(data)
}

/**
 * 规范化官方渲染产物；任何越界链接、伪路径、超限或错误结果都不能交付给模型。
 * @param {object} manifest 官方 RenderImagesResult。
 * @param {string} outputDir 本次自动生成的独占页面输出目录。
 * @param {string} digest 本次输入快照的 SHA-256，不返回原件字节。
 * @param {object} selection 已校验页码或工作表选择，产物不能超出该范围。
 * @returns {Promise<object[]>} 经过磁盘与尺寸复核的有限图片元数据。
 * @throws {Error} 官方结果或磁盘产物不满足可信边界时失败关闭。
 */
async function checkedImages(manifest, outputDir, digest, selection) {
  if (manifest?.schemaVersion !== 1 || manifest.source !== 'saved' || manifest.sourceSha256 !== digest || !['native', 'wasm'].includes(manifest.backend) || !['pdfium', 'libreoffice'].includes(manifest.rasterEngine)
    || !Number.isSafeInteger(manifest.pageCount) || manifest.pageCount < 1 || !Array.isArray(manifest.images) || !manifest.images.length || manifest.images.length > MAX_RENDER_IMAGES) throw new Error('官方页面渲染结果无效')
  const outputRoot = await realpath(outputDir) // 目录刚由官方创建，仍要检查没有被替换为越界链接。
  if (outputRoot !== resolve(outputDir)) throw new Error('页面渲染输出目录发生变化')
  const images = [] // 本次实际成功的页面，不推导未渲染页面的内容。
  const pages = new Set() // 官方结果不能重复或超出已授权页码范围。
  let totalBytes = 0 // 整批输出大小，不能把多张图片分别低于上限当作整批受限。
  for (const image of manifest.images) {
    if (selection.pages && (!selection.pages.includes(image.page) || pages.has(image.page))) throw new Error('官方页面渲染返回了未选择的页码')
    if (!selection.pages && image.sheet !== selection.sheet) throw new Error('官方页面渲染返回了未选择的工作表')
    pages.add(image.page)
    if (typeof image.path !== 'string' || !within(outputRoot, resolve(image.path)) || !image.path.toLowerCase().endsWith('.png')) throw new Error('官方页面渲染返回了越界图片')
    const metadata = await lstat(image.path) // 页面必须为单链接普通文件；符号链接不进入官方模型图片链路。
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || await realpath(image.path) !== resolve(image.path) || metadata.size !== image.byteLength) throw new Error('页面渲染图片身份无法确认')
    if (![image.width, image.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= MAX_RENDER_DIMENSION) || image.width * image.height > MAX_RENDER_PIXELS) throw new Error('页面渲染图片超过像素限制')
    const handle = await open(image.path, 'r') // 仅检查 PNG 标识和 IHDR 尺寸，不自行解码或重新渲染。
    const header = Buffer.alloc(24) // PNG 固定头的有界读取，实际图片解码归原生 read_image。
    try { await handle.read(header, 0, header.length, 0) } finally { await handle.close() }
    if (!header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || header.readUInt32BE(16) !== image.width || header.readUInt32BE(20) !== image.height) throw new Error('页面渲染图片格式或尺寸不一致')
    totalBytes += metadata.size
    if (totalBytes > MAX_RENDER_OUTPUT_BYTES) throw new Error('页面渲染输出超过整批限制')
    images.push({ path: resolve(image.path), page: image.page ?? 0, sheet: image.sheet ?? '', range: image.range ?? '', width: image.width, height: image.height, bytes: metadata.size })
  }
  if (selection.pages && images.length !== selection.pages.length) throw new Error('官方页面渲染没有完整返回选定页码')
  return images
}

/**
 * 创建当前 Runtime 的有限渲染入口；测试可注入 Fake 引擎，但生产始终使用官方 createConverter。
 * @param {Function} converterFactory 官方公开工厂，唯一参数由本模块固定，模型不能覆盖。
 * @returns {Function} 接收当前 Context、工具参数和执行上下文的异步办公能力。
 * @sideEffects 每个 Runtime 最多同时一项渲染；不增加常驻服务或后台队列。
 */
export function createDocumentRenderer(converterFactory = createConverter) {
  let active = false // 父子代理和不同 Session 共用进程级单槽；冲突立即可见，不无界排队。
  return async (ctx, args, exec) => {
    let source // 执行时再次验证身份和路径，任何系统路径错误都转换成稳定拒绝。
    try { source = authorizedRenderSource(ctx, { ...exec, arguments: args }) } catch { throw new Error('页面渲染文件或参数未获当前业务会话授权') }
    if (source.selection.skippedReason) return skippedRenderResult(source, source.selection.skippedReason) // 授权验证仍完成，但未明确表格范围时不读取字节、不启动引擎。
    if (active) throw new Error('当前正在渲染文件页面，请等待完成后重试')
    active = true
    const controller = new AbortController() // 将用户取消与独立期限都传给官方引擎及原件读取。
    const abort = () => controller.abort(new Error('文件页面渲染已取消')) // 不把取消原因中的用户正文或秘密写进工具结果。
    exec.signal.addEventListener('abort', abort, { once: true })
    if (exec.signal.aborted) abort()
    const deadline = setTimeout(() => controller.abort(new Error('文件页面渲染超时')), RENDER_TIMEOUT_MS) // 额外覆盖工厂初始化和读取，不改变官方内部生命周期。
    let converter // 当前调用唯一官方实例；成功、取消和失败都必须等待 dispose。
    let directory // 本次独占输出根，只有成功页面保留供原生交付。
    let identity // 清理时核对创建时目录身份，不递归删除被替换或越界的位置。
    let succeeded = false // 失败不发布部分页面，也不保留输入副本。
    const startedAt = Date.now() // 脱敏审计只输出耗时、状态和数量，不记录路径或正文。
    try {
      controller.signal.throwIfAborted()
      const bytes = await snapshotBytes(ctx, source, controller.signal) // 官方存储完整性或 fs 上限先通过，之后才调用引擎。
      directory = await mkdtemp(join(source.root, 'office-render-'))
      identity = await lstat(directory)
      if (!within(source.root, await realpath(directory))) throw new Error('页面渲染输出目录不属于业务范围')
      const inputPath = join(directory, 'input' + source.selection.extension) // 输入副本为固定文件名；原件永远不交给引擎改写。
      const outputDir = join(directory, 'pages') // 不接受模型输出路径，官方 API 要求新目录。
      await writeFile(inputPath, bytes, { flag: 'wx', mode: 0o600, signal: controller.signal })
      const digest = createHash('sha256').update(bytes).digest('hex') // 核对官方结果确实来自当前授权快照。
      converter = await converterFactory({
        timeoutMs: RENDER_TIMEOUT_MS, // 与工具独立取消合并，包含官方字体和渲染工作。
        maxInputBytes: MAX_RENDER_INPUT_BYTES, // 引擎再次校验输入上限。
        maxOutputBytes: MAX_RENDER_OUTPUT_BYTES, // 不开放无界页面输出。
        maxArchiveEntries: 10_000, // ZIP 包结构由官方验证；业务只给资源预算。
        maxUncompressedBytes: 128 * 1024 * 1024, // 不将压缩文件大小视为解压后体积。
        maxFontFiles: 2048, // 官方字体发现有界，系统字体仅作必要只读资源。
        maxFontFileBytes: 32 * 1024 * 1024, // 不导入无界字体文件。
        maxLoadedFontBytes: 128 * 1024 * 1024, // 官方加载预算不等同于完整进程内存上限。
        fontMetadataCacheDirectory: false, // 不在服务器用户缓存目录持久化渲染数据；官方私有临时目录随生命周期清理。
      })
      controller.signal.throwIfAborted()
      const result = await converter.renderImages({
        inputPath, // 已授权且独占的只读输入副本。
        outputDir, // 只能由当前调用生成的业务输出目录。
        ...(source.selection.pages ? { pages: source.selection.pages } : { sheet: source.selection.sheet, ...(source.selection.range ? { range: source.selection.range } : {}) }), // 仅已验证物理页或表格矩形。
        dpi: 120, // 保持普通 A4 页可辨认并在固定像素预算内。
        maxPages: MAX_RENDER_IMAGES, // 不静默截断超限页面。
        maxPixels: MAX_RENDER_PIXELS, // 官方引擎直接实施像素上限。
        maxDimension: MAX_RENDER_DIMENSION, // 官方引擎直接实施单边上限。
      }, controller.signal)
      controller.signal.throwIfAborted()
      const images = await checkedImages(result, outputDir, digest, source.selection) // 工具输出前再核对实际文件，不信任错误路径、空结果或未授权选择。
      if (!Array.isArray(result.missingFonts) || result.missingFonts.some(font => typeof font !== 'string' || font.length > 256)) throw new Error('官方字体诊断结果无效')
      await unlink(inputPath)
      await converter.dispose()
      converter = undefined
      controller.signal.throwIfAborted()
      succeeded = true
      console.info('adminsmart_document_render ' + JSON.stringify({ outcome: 'success', images: images.length, elapsedMs: Date.now() - startedAt }))
      return { status: 'ready', fileName: source.reference?.name ?? basename(source.path), pageCount: result.pageCount, backend: result.backend, rasterEngine: result.rasterEngine, images, missingFonts: (result.missingFonts ?? []).slice(0, 32), note: '只渲染了返回的页面/区域。必须使用官方 read_image 实际看图；支持图片的当前模型才可作视觉判断。需要交付时使用原生 present，不把抽样说成全部页面。' }
    } catch (error) {
      console.info('adminsmart_document_render ' + JSON.stringify({ outcome: controller.signal.aborted ? 'cancelled-or-timeout' : error.code === 'unavailable' ? 'skipped' : 'failed', elapsedMs: Date.now() - startedAt }))
      if (controller.signal.aborted) throw new Error(controller.signal.reason?.message ?? '文件页面渲染已取消')
      if (error.code === 'unavailable') return skippedRenderResult(source, '官方页面渲染引擎当前不可用，本次没有视觉核验。保留可用原件并明确此限制，不安装替代转换器或重复尝试另一条渲染管线。') // 官方技能据skipped结束视觉检查，不把缺引擎解释为可继续绕过限制。
      throw new Error('文件页面渲染失败：文件可能损坏、页码/区域无效、超过资源限制或官方引擎无法处理；未生成可交付页面')
    } finally {
      let cleanupFailed = false // 资源无法释放时不开放后续渲染槽，不泄漏底层异常诊断。
      try {
        if (converter) {
          try { await converter.dispose() } catch { cleanupFailed = true }
        }
        if (!succeeded && directory) {
          try {
            const current = await lstat(directory) // 只清理本次创建并保持身份的目录，不能跟随链接删除别处。
            if (current.isDirectory() && !current.isSymbolicLink() && current.ino === identity?.ino && current.dev === identity?.dev && within(source.root, await realpath(directory))) await rm(directory, { recursive: true, force: true })
          } catch (error) { if (error.code !== 'ENOENT') cleanupFailed = true }
        }
      } finally {
        clearTimeout(deadline)
        exec.signal.removeEventListener('abort', abort)
        active = cleanupFailed // 官方资源清理失败时保持失败关闭，需重新连接 Runtime。
      }
      if (cleanupFailed) throw new Error('页面渲染资源清理未完成，请重新连接后重试')
    }
  }
}

const renderDocument = createDocumentRenderer() // 生产唯一入口，父子代理和会话共享同一 Runtime 渲染槽。

/**
 * 在知识 Preset 注册受控页面工具；所有渲染仍由当前固定版官方引擎完成。
 * @param {object} ctx 官方 tools、attachments、fs 和 sandboxPolicy。
 * @returns {void} 生命周期归 Cordis 作用域，无后台服务。
 */
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: DOCUMENT_RENDER_TOOL_NAME,
    description: '使用官方 LibreOffice Kit 把当前会话附件或业务文件的指定 PDF/Office 页面、表格区域渲染成图片。只读原件，自动输出业务目录；默认第一页，每次最多三张。仅status=ready时用官方read_image看图；status=skipped结束视觉检查并报告限制。表格须给实际sheet，精确计算使用原生办公工作流。不能传命令、代码、输出路径或权限参数。',
    parameters: {
      file_path: { type: 'string', required: true, description: '当前会话已授权附件路径或业务工作目录中的普通文档路径。' }, // 服务端重新校验授权和真实路径。
      pages: { type: 'array', items: { type: 'integer' }, description: 'PDF、Word 或演示文稿的一基物理页码，最多三个，不传时第一页。表格不使用此字段。' }, // 实际上限由纯选择校验与官方引擎共同实施。
      sheet: { type: 'string', description: 'Excel/ODS 的实际工作表名称；表格渲染必填，非表格不传。' }, // 不能用名字推断未读取的表格结构。
      range: { type: 'string', description: '表格可选 A1 区域，例如 A1:D12；不传时官方绘制指定工作表数据区域。' }, // 固定声明式矩形，不接受代码。
    },
    output: { schema: RESULT_SCHEMA, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, // 官方 read_image 负责后续图像编码与模型能力门禁。
    isConcurrencySafe: () => false, // 由原生工具调度避免重叠，入口仍有进程单槽兜底。
    execute: (args, exec) => renderDocument(ctx, args, exec), // 不转给模型可控 Shell，不调用第二个模型。
    presentCall: args => ({ card: 'generic', title: '渲染文件页面', content: [{ type: 'text', text: basename(args.file_path) }] }), // 保留原生工具卡片，不创建自有文件 UI。
  })), 'adminsmart: controlled official document rendering')
}
