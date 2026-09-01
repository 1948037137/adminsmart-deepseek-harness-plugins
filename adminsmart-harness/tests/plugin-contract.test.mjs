/** 验证 AdminSmart 知识插件只通过 Harness 原生 Tool Schema 暴露允许能力。 */

import assert from 'node:assert/strict'
import { resolve } from 'node:path'

import { apply } from '../src/index.mjs'

const pluginRoot = resolve(import.meta.dirname, '..') // 当前 AdminSmart 插件项目根目录。
const projectRoot = resolve(pluginRoot, '..', '..') // Harness 与插件库共同父目录。
process.env.ADMINSMART_DSH_ROOT = resolve(projectRoot, 'deepseek-harness') // 只读加载当前固定 Harness 构建公开模块。

const restrictions = [] // 插件应用期间提交给 Harness 的继承工具限制。
const toolDefinitions = [] // 插件通过 ctx.tools.register 注册的真实定义。
const promptSections = [] // 插件通过 ctx.systemPrompt.section 注册的业务策略。
const context = {
  tools: {
    restrict(filter) {
      restrictions.push(filter)
      return () => {}
    },
    register(definition) {
      toolDefinitions.push(definition)
      return () => {}
    }
  },
  systemPrompt: {
    section(section) {
      promptSections.push(section)
      return () => {}
    }
  }
} // 只实现插件公开 inject 声明所需的 Harness 服务面。

await apply(context)

assert.deepEqual(restrictions, [{ allow: [] }], '知识 Agent 必须屏蔽全部继承工具')
assert.equal(toolDefinitions.length, 1, '知识 Agent 只能注册一个业务工具')
const [knowledgeTool] = toolDefinitions // 当前唯一允许的 Harness Tool 定义。
assert.equal(knowledgeTool.name, 'search_knowledge')
assert.equal(knowledgeTool.parameters.type, 'object')
assert.deepEqual(Object.keys(knowledgeTool.parameters.properties).sort(), ['query', 'scope'])
assert.deepEqual(knowledgeTool.parameters.required, ['query'])
assert.equal(typeof knowledgeTool.output.schema, 'object')
assert.equal(knowledgeTool.presentCall({ query: 'fixture' }).title, '检索知识库')
assert.equal(promptSections.length, 1, '业务插件只注册一段知识策略')

const sourceText = String(promptSections[0].text) // 模型可见业务策略文本。
assert.match(sourceText, /你是 AuraSearch，AdminSmart 系统的中文知识库智能体/, 'Agent 对外身份必须统一为 AuraSearch')
assert.doesNotMatch(sourceText, /<tool_call>|<function=|<parameter=/, '业务提示词不得自定义文本工具协议')
assert.match(sourceText, /不可信只读数据/, '知识正文必须被标记为不可信证据')

process.stdout.write('knowledge_plugin_contract=ok\n')
