/** Current-user sidebar state and redacted global Settings Remote contract. */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const pluginRoot = resolve(import.meta.dirname, '..') // Current first-party Host plugin project.
process.env.ADMINSMART_DSH_ROOT = resolve(pluginRoot, '..', '..', 'deepseek-harness-runtime') // Fixed npm runtime; no official source is edited.
const { normalizeWorkspaceView, readWorkspaceView, writeWorkspaceView } = await import('../src/workspace-view.mjs') // Pure/current-user persistence API.
const { AdminSmartReadOnlySettings } = await import('../src/read-only-settings.mjs') // Public Typert Remote with only describe marked.
const { captureGeneralSettings, applyGeneralSettings } = await import('../src/shared-ui-policy.mjs') // Whitelist-only native Settings adaptation.
const runtimeRequire = createRequire(resolve(process.env.ADMINSMART_DSH_ROOT, 'package.json')) // Official public protocol lookup.
const { Context } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/cordis')).href)
const { remoteMethods } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-typert-protocol')).href)

const view = { groupBy: 'flat', orderBy: 'manual', archivedFilter: 'show', groupExpansion: { workspaceA: true }, sessionOrderByAccount: { workspaceA: ['sessionA', 'sessionB'] } } // One isolated user's official view snapshot.

test('official view settings survive a new Host process and reject malformed accounts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adminsmart-workspace-view-')) // Task-owned disposable state root.
  const path = join(root, 'user-one', '.adminsmart-state', 'workspace-view.json') // Mirrors one Runtime Home, never a shared browser key.
  const second = join(root, 'user-two', '.adminsmart-state', 'workspace-view.json') // A different user starts empty.
  const lock = async (_file, work) => work() // Offline stand-in for the official cross-process writer lock.
  const atomic = async (file, content) => writeFile(file, content, 'utf8') // Only this temporary root is written.
  try {
    assert.equal(await readWorkspaceView(path), null)
    await writeWorkspaceView({ path, view, withFileLock: lock, writeFileAtomic: atomic })
    assert.deepEqual(await readWorkspaceView(path), view)
    assert.equal(await readWorkspaceView(second), null)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).view.sessionOrderByAccount.workspaceA, ['sessionA', 'sessionB'])
    for (const invalid of [{ ...view, groupBy: 'other' }, { ...view, sessionOrderByAccount: { workspaceA: ['bad\u0000id'] } }, { ...view, groupExpansion: { workspaceA: 'true' } }]) {
      await assert.rejects(writeWorkspaceView({ path, view: invalid, withFileLock: lock, writeFileAtomic: atomic }))
    }
    assert.deepEqual(normalizeWorkspaceView(view), view)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ordinary Settings Remote exposes five redacted General forms and no write or credential method', () => {
  const ctx = new Context() // Isolated Cordis context with no Gateway, database or network.
  ctx.provide('settings', { describe: () => [
    { ns: 'ui-theme', schema: { type: 'object' }, value: { preference: 'dark', fontSize: 15 }, applies: 'live', revision: 3 },
    { ns: 'llm-pi-ai', schema: { type: 'object' }, value: { apiKey: 'fixture-secret' }, applies: 'live', revision: 4 },
  ] })
  const controller = new AdminSmartReadOnlySettings(ctx) // Public Remote marker is installed on this first-party service.
  assert.deepEqual(remoteMethods(controller).map(method => method.method), ['describe'])
  assert.equal(controller.update, undefined)
  assert.equal(controller.mutate, undefined)
  assert.equal(controller.openSettingsDocument, undefined)
  assert.deepEqual(controller.describe().namespaces.map(row => row.ns), ['ui-theme'])
  assert.equal(controller.describe().writable, false)
  assert.doesNotMatch(JSON.stringify(controller.describe()), /fixture-secret|llm-pi-ai/u)
  assert.equal(ctx.get('credentialsController'), undefined)
})

test('shared UI adoption changes only native General fields', async () => {
  const values = new Map([
    ['locale', {}], ['ui-theme', { preference: 'system', fontSize: 14 }],
    ['ui-chat', { transcriptView: 'compact', performanceUsage: 'detailed', linkOpening: 'sidebar' }],
    ['ui-conversation', { busyEnter: 'queue' }], ['ui-settings', { enabled: true }],
    ['llm-pi-ai', { providers: { fixture: { apiKey: 'fixture-secret' } } }],
  ]) // Native values plus a forbidden credential namespace trap.
  const writes = [] // Capture official SettingsForms operations, never a Profile file.
  const settings = {
    describe: () => [...values].map(([ns, value]) => ({ ns, value })),
    async update(ns, fields) { writes.push({ ns, fields }); values.set(ns, { ...values.get(ns), ...fields }) },
    async mutate(ns, ops) { writes.push({ ns, ops }); values.set(ns, {}) },
  }
  const policy = { locale: 'zh', theme: 'dark', fontSize: 15, transcriptView: 'expanded', performanceUsage: 'compact', developerTools: false, busyEnter: 'steer', linkOpening: 'new-tab' } // Complete signed admin policy.
  await applyGeneralSettings(settings, policy)
  assert.deepEqual(captureGeneralSettings(settings), policy)
  assert.deepEqual(new Set(writes.map(write => write.ns)), new Set(['locale', 'ui-theme', 'ui-chat', 'ui-conversation', 'ui-settings']))
  assert.equal(values.get('llm-pi-ai').providers.fixture.apiKey, 'fixture-secret')
  writes.length = 0
  await applyGeneralSettings(settings, policy)
  assert.equal(writes.length, 0)
})
