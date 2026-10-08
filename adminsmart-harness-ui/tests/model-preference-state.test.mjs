/** 验证用户模型偏好只保存公开目录身份，并可供新会话继承。 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  readModelPreferenceState,
  updateModelPreferenceState
} from '../src/index.mjs'

test('model preference persists provider, model and reasoning without credentials', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'adminsmart-model-preference-')) // 当前测试独占状态目录。
  const statePath = join(temporaryRoot, '.adminsmart-state', 'model-preference.json') // 与生产相同的固定文件布局。
  const withFileLock = async (_path, operation) => operation() // 单进程测试替代官方文件锁，不改变原子写顺序。
  const writeFileAtomic = async (path, content, options) => writeFile(path, content, { encoding: 'utf8', mode: options.mode }) // 当前测试唯一原子写替身。
  try {
    assert.deepEqual(await readModelPreferenceState(statePath), { version: 1, selection: null })
    const saved = await updateModelPreferenceState({
      statePath,
      selection: {
        provider: 'provider-gpt', // Harness 当前可路由 Provider 身份。
        model: 'gpt-5.6-terra', // 用户最近主动选择的供应商模型 ID。
        reasoningEffort: 'high' // 当前模型真实支持的思考等级。
      },
      withFileLock,
      writeFileAtomic
    })
    assert.equal(saved.provider, 'provider-gpt')
    assert.equal(saved.model, 'gpt-5.6-terra')
    assert.equal(saved.reasoningEffort, 'high')
    assert.ok(saved.updatedAt > 0)
    const reloaded = await readModelPreferenceState(statePath)
    assert.equal(reloaded.selection.provider, 'provider-gpt')
    assert.equal(reloaded.selection.model, 'gpt-5.6-terra')
    const serialized = await readFile(statePath, 'utf8')
    assert.doesNotMatch(serialized, /apiKey|token|credential/i)
    await assert.rejects(updateModelPreferenceState({
      statePath,
      selection: { provider: 'provider\u0000bad', model: 'fixture' },
      withFileLock,
      writeFileAtomic
    }), /模型供应商无效/)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
