/** Verify the public-web admin bridge without real Credentials, database, or model requests. */

import assert from 'node:assert/strict'
import test from 'node:test'
import { AdminModelError, deleteAdminModels, discoverAdminModels, listAdminModels, saveAdminModels } from '../src/admin-models.mjs'

/** @returns {{ctx:object, entry:object, credentials:Map<string,string>}} Official Host service fixtures. */
function hostFixture() {
  const entry = { options: { id: 'llm-pi-ai', config: { providers: {} } } } // 管理员私有官方 Profile 替身。
  const credentials = new Map() // 只在测试内存中保存合成 Key。
  const ctx = {
    configEditor: {
      entries: () => [entry], // 同一官方配置条目的最新快照。
      async edit(_entry, mutator) { entry.options.config = mutator(entry.options.config) }, // 原子编辑边界替身。
    },
    credentials: {
      async set(ref, value) { credentials.set(ref, value) }, // 受保护凭据写入替身。
      async resolve(ref) { return credentials.has(ref) ? { value: credentials.get(ref) } : undefined }, // 只在 Host 发现调用中解引用。
      async describe(ref) { return { configured: credentials.has(ref), writable: true } }, // 永不回显 Key。
      async unset(ref) { credentials.delete(ref) }, // 删除后清理未共享的引用。
    },
  }
  return { ctx, entry, credentials }
}

/** @returns {object} 一个与固定 pi-ai 模型字段一致的非敏感管理员草稿。 */
function modelDraft() {
  return {
    displayName: 'GPT', // 官方 Provider 展示名称。
    api: 'openai-responses', // 模型代理实际支持的线协议。
    baseURL: 'https://models.example.test/v1', // 不带凭据或查询串的 API 根。
    apiKey: 'fixture-secret', // 仅测试 Credentials 隔离，不调用真实供应商。
    models: [{ id: 'gpt-test', name: 'GPT Test', contextWindow: 128000, maxTokens: 8192, input: ['text'] }], // 已确认容量的单模型目录。
  }
}

test('provider creation saves only a credential reference in the official profile', async () => {
  const { ctx, entry, credentials } = hostFixture() // 独立管理员 Runtime 的官方服务替身。
  const result = await saveAdminModels(ctx, modelDraft()) // 新供应商与 Key 同轮保存。
  const provider = entry.options.config.providers[result.routeId] // 官方 ConfigEditor 已确认的 Provider。
  assert.match(result.routeId, /^model-[a-f0-9]+$/u)
  assert.match(provider.apiKeyEnv, /^DSH_MODEL_[A-F0-9]+$/u)
  assert.equal(credentials.get(provider.apiKeyEnv), 'fixture-secret')
  assert.equal(result.providers[0].credentialConfigured, true)
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|apiKeyEnv/u)
  assert.equal(provider.models[0].reasoningEfforts, false)
})

test('editing preserves advanced official settings and rejects stale drafts', async () => {
  const { ctx, entry, credentials } = hostFixture() // 当前管理员隔离 Profile。
  const created = await saveAdminModels(ctx, modelDraft()) // 原模型供后续无 Key 更新。
  const previous = entry.options.config.providers[created.routeId] // 最新官方配置而不是浏览器回传字段。
  previous.compat = { thinkingFormat: 'deepseek' } // 官方高级 Provider 字段不属于公网简化表单。
  previous.models[0].reasoningEfforts = { high: 'reasoning-high' } // 逐模型思考线值由现有插件独立维护。
  const before = await listAdminModels(ctx) // 保存了高级字段后的并发指纹。
  const keyCount = credentials.size // 无新 Key 时不得轮换现有 Credential。
  const updated = await saveAdminModels(ctx, {
    ...modelDraft(), apiKey: undefined, routeId: created.routeId, fingerprint: before.providers[0].fingerprint,
    displayName: 'GPT Updated', models: [{ id: 'gpt-test', name: 'GPT Updated', contextWindow: 128000, maxTokens: 16384, input: ['text'] }],
  })
  assert.equal(entry.options.config.providers[created.routeId].compat.thinkingFormat, 'deepseek')
  assert.deepEqual(entry.options.config.providers[created.routeId].models[0].reasoningEfforts, { high: 'reasoning-high' })
  assert.equal(credentials.size, keyCount)
  assert.equal(updated.providers[0].displayName, 'GPT Updated')
  await assert.rejects(saveAdminModels(ctx, {
    ...modelDraft(), apiKey: undefined, routeId: created.routeId, fingerprint: before.providers[0].fingerprint,
  }), AdminModelError)
})

test('an omitted output cap uses the native Harness profile and clears an older override', async () => {
  const { ctx, entry, credentials } = hostFixture() // 同一管理员 Profile 的前后两次保存。
  const created = await saveAdminModels(ctx, modelDraft()) // 首次明确设置输出上限。
  const withoutCap = { ...modelDraft(), apiKey: undefined, routeId: created.routeId,
    fingerprint: created.providers[0].fingerprint,
    models: [{ id: 'gpt-test', name: 'GPT Test', contextWindow: 128000, maxTokens: '', input: ['text'] }] } // 浏览器清空模型级覆盖值。
  const updated = await saveAdminModels(ctx, withoutCap)
  assert.equal('maxTokens' in entry.options.config.providers[created.routeId].models[0], false)
  assert.equal(updated.providers[0].models[0].maxTokens, null)
  assert.equal(credentials.size, 1) // 未提交新 Key 时原生凭据引用不变。
  assert.doesNotMatch(JSON.stringify(updated), /fixture-secret|apiKeyEnv/u)
})

test('a new model can omit the native optional output cap but rejects an invalid explicit value', async () => {
  const { ctx, entry } = hostFixture() // 不访问外部模型 API 的 ConfigEditor 替身。
  const draft = { ...modelDraft(), models: [{ id: 'gpt-test', name: 'GPT Test', contextWindow: 128000, input: ['text'] }] } // 原生模型条目不声明输出上限。
  const saved = await saveAdminModels(ctx, draft)
  assert.equal('maxTokens' in entry.options.config.providers[saved.routeId].models[0], false)
  await assert.rejects(saveAdminModels(ctx, { ...draft, models: [{ ...draft.models[0], maxTokens: 0 }] }), /模型 token 容量无效/u)
})

test('invalid API addresses never reach Credentials or ConfigEditor', async () => {
  const { ctx, entry, credentials } = hostFixture() // 没有真实外部连接的安全验证环境。
  await assert.rejects(saveAdminModels(ctx, { ...modelDraft(), baseURL: 'https://user:secret@example.test/v1' }), AdminModelError)
  await assert.rejects(saveAdminModels(ctx, { ...modelDraft(), baseURL: 'http://public.example.test/v1' }), AdminModelError)
  await assert.rejects(saveAdminModels(ctx, { ...modelDraft(), apiKey: { nested: 'invalid' } }), AdminModelError)
  assert.equal(credentials.size, 0)
  assert.deepEqual(entry.options.config.providers, {})
})

test('official discovery uses a one-shot key and returns only bounded model metadata', async () => {
  const { ctx } = hostFixture() // 本地官方 LLM 服务替身，不连接真实供应商。
  let calls = 0 // 明确点击一次才触发一次官方发现。
  ctx.llm = { async discoverModels(namespace, request, signal) {
    calls += 1
    assert.equal(namespace, 'llm-pi-ai')
    assert.equal(request.apiKey, 'fixture-secret')
    assert.equal(signal instanceof AbortSignal, true)
    return [
      { id: 'gpt-6-sol', name: 'GPT-6 Sol', contextWindow: 128000, maxTokens: 8192, inputModalities: ['text', 'image'] },
      { id: 'gpt-6-sol', name: 'duplicate' },
      { id: 'gpt-unknown' },
    ]
  } } // 官方发现结果只含候选元数据，不负责自动保存配置。
  const result = await discoverAdminModels(ctx, { api: 'openai-responses', baseURL: 'https://models.example.test/v1', apiKey: 'fixture-secret' })
  assert.equal(calls, 1)
  assert.deepEqual(result.models, [
    { id: 'gpt-6-sol', name: 'GPT-6 Sol', contextWindow: 128000, maxTokens: 8192, input: ['text', 'image'] },
    { id: 'gpt-unknown', name: 'gpt-unknown', contextWindow: null, maxTokens: null, input: ['text'] },
  ])
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|apiKey/u)
})

test('discovery reuses only the unchanged saved provider credential', async () => {
  const { ctx } = hostFixture() // 已保存凭据仍不返回浏览器。
  const saved = await saveAdminModels(ctx, modelDraft()) // 配置指纹只绑定当前管理员 Profile。
  let calls = 0 // 旧页面的指纹冲突不得触发上游请求。
  ctx.llm = { async discoverModels(_namespace, request) { calls += 1; assert.equal(request.apiKey, 'fixture-secret'); return [] } }
  const request = { routeId: saved.routeId, fingerprint: saved.providers[0].fingerprint, api: 'openai-responses', baseURL: 'https://models.example.test/v1', apiKey: '' } // 浏览器不回传已保存 Key。
  assert.deepEqual(await discoverAdminModels(ctx, request), { models: [] })
  await assert.rejects(discoverAdminModels(ctx, { ...request, fingerprint: '0'.repeat(64) }), /配置已变化/u)
  assert.equal(calls, 1)
})

test('rotating a key removes only an unshared credential created by this editor', async () => {
  const { ctx, entry, credentials } = hostFixture() // 与旧官方 Key 隔离的内存凭据记录。
  const created = await saveAdminModels(ctx, modelDraft()) // 首次保存产生插件自有引用。
  const oldRef = entry.options.config.providers[created.routeId].apiKeyEnv // 此值是引用名称，不是 Key 明文。
  const changed = await saveAdminModels(ctx, {
    ...modelDraft(), routeId: created.routeId, fingerprint: created.providers[0].fingerprint,
    apiKey: 'rotated-fixture-secret',
  })
  const newRef = entry.options.config.providers[created.routeId].apiKeyEnv // 轮换后新的官方 Credential 引用。
  assert.notEqual(newRef, oldRef)
  assert.equal(credentials.has(oldRef), false)
  assert.equal(credentials.get(newRef), 'rotated-fixture-secret')
  assert.doesNotMatch(JSON.stringify(changed), /rotated-fixture-secret|apiKeyEnv/u)
})

test('deletion waits for business revocation and removes only an unshared reference', async () => {
  const { ctx, entry, credentials } = hostFixture() // 服务端业务撤销与官方私有配置分离。
  const created = await saveAdminModels(ctx, modelDraft()) // 待撤销管理员供应商。
  const request = { routeId: created.routeId, fingerprint: created.providers[0].fingerprint } // 只传稳定身份和最新配置指纹。
  let checkedWhilePresent = false // 后端撤销必须先于私有 Profile 删除。
  await assert.rejects(deleteAdminModels(ctx, request, async () => { throw new AdminModelError('默认模型仍在使用') }), AdminModelError)
  assert.ok(entry.options.config.providers[created.routeId])
  const result = await deleteAdminModels(ctx, request, async routeId => {
    checkedWhilePresent = Boolean(entry.options.config.providers[routeId])
  }, async () => { throw new Error('unexpected restoration') })
  assert.equal(checkedWhilePresent, true)
  assert.deepEqual(result.providers, [])
  assert.equal(credentials.size, 0)
})

test('deletion retains a credential reference owned by native Harness settings', async () => {
  const { ctx, entry, credentials } = hostFixture() // 历史官方 Provider 不由本插件拥有其凭据生命周期。
  const { apiKey: _unusedKey, ...nativeProfile } = modelDraft() // 官方 Profile 只保存非敏感字段和凭据引用。
  entry.options.config.providers.native = { ...nativeProfile, apiKeyEnv: 'NATIVE_SHARED_KEY' } // 仅用于测试的官方旧引用。
  credentials.set('NATIVE_SHARED_KEY', 'fixture-native-secret')
  const listed = await listAdminModels(ctx) // 删除必须使用当前配置指纹。
  await deleteAdminModels(ctx, { routeId: 'native', fingerprint: listed.providers[0].fingerprint }, async () => {}, async () => {})
  assert.equal(credentials.get('NATIVE_SHARED_KEY'), 'fixture-native-secret')
})

test('failed official deletion restores the managed catalog from the still-saved profile', async () => {
  const { ctx, entry, credentials } = hostFixture() // ConfigEditor 写入失败时不能留下长期的业务目录分叉。
  const created = await saveAdminModels(ctx, modelDraft())
  const request = { routeId: created.routeId, fingerprint: created.providers[0].fingerprint } // 旧页面的明确删除目标。
  const sequence = [] // 后端撤销、官方编辑和补偿发布的顺序证据。
  ctx.configEditor.edit = async () => { sequence.push('edit'); throw new Error('fixture-reconcile-failed') }
  await assert.rejects(deleteAdminModels(ctx, request,
    async () => { sequence.push('unpublish') },
    async routeId => { sequence.push('restore'); assert.equal(routeId, created.routeId) }), /业务模型已恢复/u)
  assert.deepEqual(sequence, ['unpublish', 'edit', 'restore'])
  assert.ok(entry.options.config.providers[created.routeId])
  assert.equal(credentials.size, 1)
})
