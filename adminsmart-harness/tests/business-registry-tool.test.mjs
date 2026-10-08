/** 验证工商 Tool 只调用受管 FastAPI，且普通网页字段不能混入参数。 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const pluginRoot = resolve(import.meta.dirname, '..') // 当前 AdminSmart 知识插件项目根。
const projectRoot = resolve(pluginRoot, '..', '..') // 固定 Harness npm 运行项目所在多项目根。
const temporaryRoot = await mkdtemp(join(tmpdir(), 'adminsmart-business-registry-')) // 隔离能力凭证目录。
const tokenPath = join(temporaryRoot, 'runtime-token') // 当前测试唯一能力凭证文件。
process.env.ADMINSMART_DSH_ROOT = resolve(process.env.ADMINSMART_DSH_TEST_ROOT || resolve(projectRoot, 'deepseek-harness-runtime')) // 解析官方 defineTool。
process.env.ADMINSMART_AGENT_API_BASE = 'http://127.0.0.1:19099/' // Fake 内部 API 回环根。
process.env.ADMINSMART_AGENT_USER_ID = '42' // Gateway 绑定的可信用户身份 Fixture。
process.env.ADMINSMART_AGENT_MODE_ID = 'knowledge' // 当前业务模式 Fixture。
process.env.ADMINSMART_AGENT_PRESET_ID = 'adminsmart-knowledge' // 当前 Agent Preset Fixture。
process.env.ADMINSMART_AGENT_TOKEN_FILE = tokenPath // Tool 只能从受保护文件读取能力凭证。
await writeFile(tokenPath, 'fixture-capability-token', 'utf8')

const originalFetch = globalThis.fetch // 测试结束恢复 Node 原生 fetch。
const observedRequests = [] // 当前测试实际提交给 FastAPI 的请求摘要。
globalThis.fetch = async (url, options) => {
  observedRequests.push({ url: String(url), options })
  return new Response(JSON.stringify({
    code: 200,
    msg: '操作成功',
    data: {
      query: '海州市星河服务中心',
      matchStatus: 'exact',
      candidates: [],
      entityName: '海州市星河服务中心',
      formerNames: ['海州县星河服务中心'],
      entityType: '个体工商户',
      principalRole: '经营者',
      principalName: '测试人员',
      legalRepresentative: '测试人员',
      creditCode: 'fixture-credit-code',
      registrationNumber: 'fixture-registration-number',
      registrationStatus: '存续',
      registeredAddress: '测试地址',
      registeredCapital: '10万元',
      establishedAt: '2020-01-01',
      approvedAt: '2026-01-01',
      registrationAuthority: '测试市场监督管理局',
      region: '测试地区',
      industry: '测试行业',
      businessScope: '测试经营范围',
      sourceProvider: '企查查智能体数据平台',
      sourceTool: 'get_company_registration_info',
      answerBoundary: '只使用当前精确工商登记结果。',
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

try {
  const { apply, BUSINESS_REGISTRY_TOOL_NAME } = await import('../src/business-registry-tool.mjs') // 环境就绪后加载真实 Tool。
  const definitions = [] // 当前隔离作用域注册的 Tool 定义。
  const context = {
    effect(registerEffect) { return registerEffect() },
    tools: {
      register(definition) {
        definitions.push(definition)
        return () => {}
      },
    },
  }
  apply(context)
  assert.equal(definitions.length, 1)
  const [tool] = definitions // 当前模块唯一注册的工商查询 Tool。
  assert.equal(tool.name, BUSINESS_REGISTRY_TOOL_NAME)
  assert.match(tool.description, /新闻、官网、产品、招聘、舆情、招投标/)
  assert.match(tool.description, /必须继续使用 Harness 官方 web_search/)
  const result = await tool.execute({
    entityName: '海州市星河服务中心',
    targetFields: ['principal', 'credit_code'],
  }, {
    signal: new AbortController().signal,
    agent: { id: 'fixture-session', session: { id: 'fixture-session' } },
  })
  assert.equal(observedRequests.length, 1)
  assert.equal(observedRequests[0].url, 'http://127.0.0.1:19099/internal/agent-tools/knowledge/business-registry')
  assert.equal(observedRequests[0].options.headers['X-AdminSmart-Agent-Token'], 'fixture-capability-token')
  assert.deepEqual(JSON.parse(observedRequests[0].options.body), {
    entityName: '海州市星河服务中心',
    targetFields: ['principal', 'credit_code'],
  })
  assert.equal(result.principalRole, '经营者')
  const rendered = tool.output.render({}, result).map(block => block.text).join('\n') // 模型可见结果必须保留外部数据边界和来源格式。
  assert.match(rendered, /BEGIN UNTRUSTED BUSINESS REGISTRY DATA/)
  assert.match(rendered, /工商数据：企查查智能体数据平台/)
  await assert.rejects(tool.execute({
    entityName: '海州市星河服务中心',
    targetFields: ['recent_news'],
  }, { signal: new AbortController().signal }), /非登记字段/)
  assert.equal(observedRequests.length, 1, '非法普通网页字段不得到达 FastAPI 或企查查')
} finally {
  globalThis.fetch = originalFetch
  await rm(temporaryRoot, { recursive: true, force: true })
}

process.stdout.write('business_registry_tool_contract=ok\n')
