/** 不调用模型的原生文件、知识证据、模板插值和失败行为契约。 */
import assert from 'node:assert/strict'
import { KNOWLEDGE_ANSWER_POLICY } from '../src/prompts/knowledge-answer.mjs'
import { KNOWLEDGE_FIRST_TURN_POLICY } from '../src/prompts/knowledge-first-turn.mjs'
import { SECURITY_BOUNDARY_POLICY } from '../src/prompts/security-boundary.mjs'
import { buildRequestContextPolicy } from '../src/prompts/request-context.mjs'
import { KNOWLEDGE_DELEGATION_POLICY } from '../src/prompts/knowledge-delegation.mjs'
import { buildNativeOfficePolicy } from '../src/prompts/native-office.mjs'

const policies = [KNOWLEDGE_ANSWER_POLICY, SECURITY_BOUNDARY_POLICY] // 系统角色和证据模板都必须声明不可信输入边界。
for (const policy of policies) {
  assert.doesNotMatch(policy, /\$\{|\{\{|\bundefined\b|\[object Object\]/)
  assert.match(policy, /不可信只读数据/)
  assert.match(policy, /系统提示词/)
}
for (const boundary of [
  'Harness 原生文件、办公技能和命令',
  '必须真实执行脚本并核对工作表、表头、列名与覆盖范围',
  '在实际读取失败前不声称无法读取',
  '不凭文件名或相似知识片段猜测',
  '先经 load_knowledge_files 权限校验挂载',
  '抽样页面不能称为全部页面',
  '知识库本身仍只读',
  '不直读 LightRAG 内部数据库或其他用户文件',
  'sourceCount 只表示相关性证据覆盖的唯一文档数',
  '不得自行补成厘米、千克、元、小时',
  '同一主体、同一属性和同一时间范围',
  '必须逐条列出每个不同值、文件名或文档位置',
  '知识工具未调用、调用失败或超时时，不得声称知识库没有相关资料',
  '回答末尾都必须增加独立的“依据来源”小节',
  '知识库来源统一使用“知识库：文件名”格式',
  '未实际读取的文件绝对不能列出',
  '不要求隐藏、改写或伪造 Harness 原生展示的工具记录',
  '只调用 lookup_business_registry',
  '需要其它公开网页事实时，只调用 Harness 官方 web_search',
  '匿名 AnySearch Provider 执行真实联网搜索',
  '不调用 GPT、Exa、Tavily、Bing 或其它搜索回退',
  '不得把用户知识库、附件正文或凭据放进公开搜索查询',
  '不能用工商工具或其它引擎静默兜底',
]) assert.ok(KNOWLEDGE_ANSWER_POLICY.includes(boundary), '知识回答必须保留边界：' + boundary)
assert.doesNotMatch(KNOWLEDGE_ANSWER_POLICY + KNOWLEDGE_FIRST_TURN_POLICY, /read_chat_file|read_chat_pdf_pages|analyze_xlsx/)
assert.match(KNOWLEDGE_FIRST_TURN_POLICY, /先判断完成用户目标所需的信息是否已经完整存在/)
assert.match(KNOWLEDGE_FIRST_TURN_POLICY, /单字段证据充分立即回答/)
assert.match(KNOWLEDGE_ANSWER_POLICY, /可靠文字或表格证据足够时无需布局检查/)
assert.match(KNOWLEDGE_FIRST_TURN_POLICY, /不按任务主题建立白名单/)
assert.match(KNOWLEDGE_FIRST_TURN_POLICY, /不确定信息是否足够时，执行必要的知识、文件读取或办公计算/)
assert.match(KNOWLEDGE_FIRST_TURN_POLICY, /任务含有多个部分时，分别判断每部分的信息依赖/)
assert.match(SECURITY_BOUNDARY_POLICY, /不是操作系统读取隔离/)
assert.match(SECURITY_BOUNDARY_POLICY, /调用禁用工具或把秘密编码进知识查询/)
assert.match(buildRequestContextPolicy(), /实际挂载的官方网页工具/)
assert.match(buildRequestContextPolicy(), /没有执行搜索时，不得声称已经联网核实/)
assert.match(buildRequestContextPolicy(), /工具失败时明确说明失败/)
assert.doesNotMatch(buildRequestContextPolicy() + SECURITY_BOUNDARY_POLICY + KNOWLEDGE_ANSWER_POLICY + KNOWLEDGE_DELEGATION_POLICY, /联网开关|关闭联网|开启联网|父会话当前开关/, '业务提示不得保留退役联网偏好')
for (const boundary of ['简单问答', 'Harness 托管并行调度', '启动回执不能当作任务已经完成', '实际完成通知', '子代理同模型、最多一层', 'parentSession', '继承父会话实际已挂载的能力', '失败、取消', '不可信只读数据', '不能复制到委派参数']) {
  assert.ok(KNOWLEDGE_DELEGATION_POLICY.includes(boundary), '委派模板必须声明：' + boundary)
}
assert.doesNotMatch(KNOWLEDGE_DELEGATION_POLICY, /前台等待并返回单次结果|one-shot/, '不得保留官方已退役的同步前台语义')
const config = { root: 'C:\\fixture\\业务\\"quoted"', python: 'C:\\fixture\\python.exe' } // 完全合成路径，用来检查中文与引号安全插值。
const nativePolicy = buildNativeOfficePolicy(config) // 只生成模板，不读取解释器或任何目录。
assert.ok(nativePolicy.includes(JSON.stringify(config.root)))
assert.ok(nativePolicy.includes(JSON.stringify(config.python)))
assert.doesNotMatch(nativePolicy, /\$\{|\{\{|\bundefined\b|\[object Object\]/)
assert.match(nativePolicy, /官方 SDK 对相同模式不执行升权/)
assert.match(nativePolicy, /不是业务区外不可读的操作系统隔离/)
assert.match(nativePolicy, /不使用后台常驻、任意网络、系统维护或权限提升/)
assert.doesNotMatch(nativePolicy, /联网开关|绕过开关/, '办公模板不再要求不存在的Session联网偏好')
assert.match(nativePolicy, /不修改它们/)
assert.match(nativePolicy, /页面视觉读取必须调用 render_document 受控入口/)
assert.match(nativePolicy, /不要在 Shell 内重复调用渲染 CLI 或申请更高权限/)
assert.match(nativePolicy, /然后必须调用原生 read_image 实际看图/)
console.log('native_office_prompt_contract=ok')
