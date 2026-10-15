/** 官方候选语义完整性、兼容原件身份及事实核验边界；只调用渲染函数，不运行网络或模型。 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'

process.env.ADMINSMART_DSH_ROOT = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || process.env.ADMINSMART_DSH_ROOT || resolve(import.meta.dirname, '../../../deepseek-harness-runtime')) // 显式测试根优先，不误测旧安装。
const { apply } = await import('../src/lightrag-tool.mjs') // 实际业务Tool定义和候选信封，不手写相似实现。
let knowledgeTool // apply同步注册的真实官方defineTool对象。
apply({ effect: register => register(), tools: { register: definition => { knowledgeTool = definition; return () => {} } } })

/**
 * 构造完整旧版结果Fixture，保留原排序/数值/边界供渲染完整性检查。
 * @param {object[]} evidence 当前用例官方候选片段。
 * @returns {object} 通过旧输出契约的合成知识结果。
 */
function response(evidence) {
  return {
    question: '固定合成查询', // 不代表实际用户问题。
    scope: 'focused', // 官方相关性范围，不声明全量。
    queries: ['固定合成查询'], // 本用例只有一个官方查询。
    knowledgeFound: evidence.length > 0, // 候选存在性，不是事实确认。
    evidence, // 完整官方顺序，别名、冲突与无关候选不从本Fixture删掉。
    sourceCount: 1, // 合成覆盖数，不当作人物或业务记录数。
    chunkCount: evidence.length, // 当前候选数量。
    totalCandidateCount: evidence.length, // 没有预算裁剪。
    tokenBudget: 100, // 有界合成预算。
    usedTokens: evidence.length * 10, // 固定合成Token估计。
    truncated: false, // 渲染不得通过额外过滤偷偷改为true。
    completeCoverage: false, // 官方结果不证明知识全量。
    answerBoundary: '仅候选片段，不保证完整覆盖。', // 原边界也必须保持不变。
  }
}

/**
 * 从实际模型Tool信封取回规范JSON，验证数据前后严格分离。
 * @param {object} args 当前合成检索参数。
 * @param {object} result 完整合成官方结果。
 * @returns {{payload:object,text:string}} 原结果投影和包含静态核验要求的全文。
 */
function render(args, result) {
  const blocks = knowledgeTool.output.render(args, result) // 真正Tool渲染，不执行业务API。
  const data = blocks[1].text.split('\n') // 边界行闭合，不扫描任意Markdown猜JSON。
  return { payload: JSON.parse(data.slice(1, -1).join('\n')), text: blocks.map(block => block.text).join('\n') }
}

test('attribute words and matching filenames never turn candidates into confirmed entities', () => {
  const result = response([{
    rank: 1, // 官方当前候选顺序，不表示事实置信度。
    title: '海州市星河汽车修理厂.docx', // 标题可被上传者命名，不能确认正文主体。
    fileName: '海州市星河汽车修理厂.docx', // 来源名称恰好包含目标企业。
    content: '这是另一企业的地址，正文没有目标企业身份。', // 只含属性并非所问主体证据。
    score: 0.4, // 官方相关度只保留，不重算真伪。
    location: '1', // 原响应位置。
    tokenCount: 10, // 固定候选估计预算。
  }]) // 文件名命中目标、属性词出现，仍不能证明正文主体。
  const { payload, text } = render({ query: '星河汽车修理厂地址', highLevelKeywords: ['工商'], lowLevelKeywords: ['海州市星河汽车修理厂', '地址！'] }, result) // 通用词带标点不能成为新的放行逻辑。
  assert.deepEqual(payload, result)
  assert.match(text, /候选/)
  assert.match(text, /文件名/)
  assert.match(text, /主体/)
  assert.match(text, /不能|不代表|不等于/)
  assert.doesNotMatch(text, /已排除未命中|相关性门禁/)
})

test('aliases and followup pronouns preserve official candidate content and order', () => {
  const result = response([
    {
      rank: 1, // 别名片段先于同名片段返回。
      title: '人物资料', // 固定来源标题。
      fileName: '人物.docx', // 不含用户输入姓名，也应保留候选。
      content: '小旭亦称李东旭，2000年出生。', // 明确别名关系由正文提供。
      score: 0.2, // 分数较低仍不得删掉别名证据。
      location: '1', // 第一个片段参考身份。
      tokenCount: 10, // 固定候选Token预算。
    },
    {
      rank: 2, // 次序保留官方结果。
      title: '人物资料', // 同一标题不能保证同一人物。
      fileName: '人物.docx', // 同一文件可能包含同名人物。
      content: '同名李东旭的另一条记录，1998年出生。', // 此记录不能因分数较高替另一条出生年。
      score: 0.8, // 相关度不是事实选择规则。
      location: '2', // 第二个片段参考身份。
      tokenCount: 10, // 固定候选Token预算。
    },
  ]) // 别名和同名候选不能按指代关键词删除或自动择值。
  const { payload, text } = render({ query: '他的年龄呢', highLevelKeywords: ['年龄'], lowLevelKeywords: ['他', '小旭'] }, result) // 测试不加入实体字面提示也保留语义结果。
  assert.deepEqual(payload, result)
  assert.match(text, /同名|别名/)
})

test('units, time ranges and conflicting facts remain unchanged and are not ranked as truth', () => {
  const result = response([
    {
      rank: 1, // 当前高分候选顺序。
      title: '记录', // 固定来源标题。
      fileName: '记录.docx', // 不含单位和主体确认信息。
      content: '2023年数值80，单位未标注。', // 缺失单位必须继续保留缺失状态。
      score: 0.9, // 高分不代表可信概率。
      location: '', // 未提供的位置不能猜测页码。
      tokenCount: 10, // 固定Token估计。
    },
    {
      rank: 2, // 当前低分候选顺序。
      title: '记录', // 相同标题不能消除数值冲突。
      fileName: '记录.docx', // 冲突来自同一文档也需要保留。
      content: '同一主体2023年数值90，2024年数值100。', // 同年冲突与跨年变化必须分开核验。
      score: 0.1, // 低分不能成为静默排除冲突的理由。
      location: '', // 未提供来源位置。
      tokenCount: 10, // 固定Token估计。
    },
  ]) // 低score真实冲突不能被排序或多数来源规则删除。
  const { payload, text } = render({ query: '体重是多少', highLevelKeywords: ['统计'], lowLevelKeywords: ['体重'] }, result)
  assert.deepEqual(payload, result)
  for (const boundary of ['单位', '时间', '冲突']) assert.ok(text.includes(boundary))
})

test('source asset identity is optional, bounded and does not grant filesystem or factual authority', () => {
  const original = { // 旧结果无原件身份仍可使用，字段含义与正式协议一致。
    rank: 1, // 原候选顺序。
    title: '资料', // 用户可读来源标题。
    fileName: '资料.docx', // 原件显示名，不是授权路径。
    content: '固定候选正文', // 合成检索内容。
    score: 0, // 官方未提供评分时的兼容零值。
    location: '', // 官方未提供位置。
    tokenCount: 10, // 固定Token估计。
  }
  const legacy = response([original]) // 缺省字段保持旧JSON契约。
  assert.deepEqual(render({}, legacy).payload, legacy)
  const enhanced = response([{ ...original, sourceAssetId: 'bb000000-0000-4000-8000-000000000001' }]) // 仅后端已核验身份；模型不能自己加入。
  const { payload, text } = render({}, enhanced)
  assert.deepEqual(payload, enhanced)
  assert.match(text, /sourceAssetId/)
  assert.match(text, /原件/)
  assert.equal(knowledgeTool.output.schema.properties.evidence.items.properties.sourceAssetId.required, undefined)
  assert.equal(knowledgeTool.output.schema.properties.evidence.items.properties.sourceAssetId.type, 'string', '官方DSL不接受pattern；执行层及后端Schema另外验证规范UUID')
})
