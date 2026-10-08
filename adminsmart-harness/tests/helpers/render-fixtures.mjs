/** 生成完全合成的 PDF 验收文件，不读取用户文件、不调用模型。 */

/**
 * 构造只有一页的标准测试 PDF：固定标签、数字以及上下排列的不同颜色矩形。
 * @returns {Buffer} 可供真实官方引擎渲染的合成 PDF 字节。
 */
export function syntheticRenderPdf() {
  const content = 'BT /F1 20 Tf 30 370 Td (NATIVE-RENDER-20261002) Tj 0 -30 Td (VALUE 57) Tj ET\n1 0 0 rg 30 260 130 45 re f\n0 0.6 0 rg 30 180 220 45 re f\n0 0 1 rg 30 100 90 45 re f\n' // 数字和颜色只存在于测试 PDF，验收提问不提前给模型答案。
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', // 合成 PDF 文档目录。
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', // 只有一页，不依赖真实文档结构。
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', // 固定页面、字体与绘图流。
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', // 标准字体使 Fixture 跨部署可重复。
    '<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + 'endstream', // 绘图内容用于真像素检查，生产不包含这个生成逻辑。
  ]
  let document = '%PDF-1.4\n' // ASCII 字节让 xref 偏移可准确由 Buffer.byteLength 得到。
  const offsets = [0] // 合成对象的真实字节坐标，零号为空对象。
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document))
    document += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'
  })
  const startXref = Buffer.byteLength(document) // 交叉引用表起始位置。
  document += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + startXref + '\n%%EOF\n'
  return Buffer.from(document)
}
