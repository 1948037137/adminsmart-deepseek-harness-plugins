import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const profileSource = readFileSync(process.env.ADMINSMART_PROFILE_TEST_PATCH ?? new URL('../profiles/adminsmart-web/cordis.patch.yml', import.meta.url), 'utf8') // 默认检查正式 Profile；隔离候选验收只通过进程级路径指定本任务模板。
const knowledgePresetSource = readFileSync(new URL('../presets/adminsmart-knowledge/agent.cordis.yml', import.meta.url), 'utf8') // 知识 Agent 会话级工具装配。

test('the official Web Tool is scoped only to the knowledge Agent', () => {
  assert.match(profileSource, /- id: tool-web\s+disabled: true(?:\s|$)/, '共享 Profile 不得向其它业务 Agent 暴露网页工具')
  assert.match(knowledgePresetSource, /- id: tool-web\s+name: '@deepseek-ai\/dsh-tool-web'\s+config:\s+search: true\s+fetch: true/, '知识 Agent 保留官方搜索和抓取 Tool')
  assert.match(profileSource, /- id: web\s+config:\s+searchProvider: adminsmart-openai-responses\s+fetchProvider: adminsmart-public-doh/, '受管 Provider 仍负责隔离的公网访问')
})

test('web profile keeps the official document preview client available', () => {
  assert.match(
    profileSource,
    /- id: ui-sidebar-documentpreview\s+disabled: false/,
    '官方文档预览必须继续由 Harness 原生客户端提供'
  )
  assert.match(profileSource, /- id: workspace-files\s+disabled: false/, '文档预览需要官方 Workspace Files Remote')
  assert.match(
    profileSource,
    /- id: attachment-local\s+name: '@deepseek-ai\/dsh-attachment-local'\s+disabled: false(?:\s|$)/,
    '上传、附件存储与发送回执必须装配已启用的官方 LocalAttachmentStore'
  )
  assert.doesNotMatch(profileSource, /adminsmart-input-attachment/, '历史自有附件读取插件已退役，不得恢复重复装配')
  assert.match(profileSource, /id: ui-conversation/, '聊天与附件上传调度必须继续保留')
})

test('development and production both use the managed Models section', () => {
  assert.match(
    profileSource,
    /- id: ui-settings-models\s+disabled: true(?:\s|$)/,
    '开发与生产都停用原生 Models 页面，由同一插件提供管理员入口'
  )
})

test('ordinary users have neither management launchers nor their Host services', () => {
  for (const id of ['ui-settings-general', 'ui-settings-plugin-inventory', 'ui-plugin-manager', 'ui-settings-plugins', 'ui-shortcuts']) {
    assert.match(profileSource, new RegExp(`- id: ${id}\\s+disabled: !!js "process\\.env\\.ADMINSMART_AGENT_IS_ADMIN !== '1'"`), `${id} 只在可信管理员 Runtime 装载`)
  }
  for (const id of ['settings-controller', 'plugin-manager', 'plugin-inventory']) {
    assert.match(profileSource, new RegExp(`- id: ${id}\\s+disabled: !!js "process\\.env\\.ADMINSMART_AGENT_IS_ADMIN !== '1'"`), `${id} 不得向普通用户暴露 Remote`)
  }
})

test('managed General and shortcut providers have unique portable deployment markers', () => {
  assert.match(profileSource, /- id: ui-settings\s+disabled: true/, '原生 ConfigForms 提供方必须退出插件激活，防止重复提供服务')
  assert.match(profileSource, /id: adminsmart-shared-settings\s+name: '__ADMINSMART_SHARED_SETTINGS_PLUGIN_URI__'/, '共享表单以公开 insert 注册唯一提供方，普通 patch 的 name 不是替换接口')
  assert.equal(profileSource.split('__ADMINSMART_SHARED_SETTINGS_PLUGIN_URI__').length - 1, 1, '通用设置入口必须唯一，禁止重复提供 ConfigForms')
  assert.equal(profileSource.split('__ADMINSMART_SHARED_SHORTCUTS_PLUGIN_URI__').length - 1, 1, '快捷键桥只装配一次，避免重复发布')
  assert.match(profileSource, /id: adminsmart-shared-shortcuts\s+name: '__ADMINSMART_SHARED_SHORTCUTS_PLUGIN_URI__'/, '各角色都采用同一共享快捷键实现')
})

test('all native session telemetry upload paths remain disabled for every role', () => {
  assert.match(profileSource, /- id: session-telemetry-otel\s+disabled: true/, '知识会话不得启用 OTel 上传')
  assert.match(profileSource, /- id: session-log-deepseek\s+disabled: true\s+config:\s+enabled: false/, '独立模型日志上传必须显式关闭，不能依赖当前模型类型')
  assert.match(profileSource, /- id: ui-settings-session-log\s+disabled: true/, '禁止上传的固定边界不能通过界面开关重新开放')
})

test('knowledge conversations keep the native Chat and Trajectory views', () => {
  assert.match(profileSource, /- id: ui-trajectory\s+disabled: false/, '官方轨迹页签只展示当前 Session 的原生事件，不注册额外工具')
})

test('the knowledge mode is the only declared executable preset for new tasks', () => {
  assert.match(profileSource, /- id: agent-preset-registry\s+config:\s+default: !!js process\.env\.ADMINSMART_AGENT_PRESET_ID\s+modeSelectionEnabled: false/)
  for (const presetId of ['standard', 'ptc', 'minimal', 'cordis']) {
    assert.match(profileSource, new RegExp(`- id: preset-${presetId}\\s+disabled: true`), `内置 ${presetId} 不得进入知识业务 Runtime`)
  }
  assert.match(profileSource, /id: preset-adminsmart-knowledge/, '唯一可执行预设必须由当前业务模式白名单提供')
})
