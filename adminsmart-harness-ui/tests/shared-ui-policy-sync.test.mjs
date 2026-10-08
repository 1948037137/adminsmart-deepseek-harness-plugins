/** Administrator publication and ordinary-user read-only adoption without real HTTP or data. */

import assert from 'node:assert/strict'
import test from 'node:test'

// 专属 Fake 与 SDK 契约沿用现有测试入口，不扩大 package.json 或 Runtime 安装脚本的修改范围。
import './shared-ui-policy-general-fake.mjs'
import './shared-ui-policy-rc2-contract-fake.mjs'
import './ui-policy-http-fake.mjs'
import './ui-policy-client-fake.mjs'
import './shared-ui-policy-push-fake.mjs'
import './read-only-settings-owned.test.mjs'

import { captureGeneralSettings, installSharedUiPolicy } from '../src/shared-ui-policy.mjs'

const initial = { locale: 'zh', theme: 'dark', fontSize: 15, transcriptView: 'expanded', performanceUsage: 'compact', developerTools: false, busyEnter: 'steer', linkOpening: 'new-tab' } // Explicit administrator General choices.

/** @param {object} values Complete policy-like native values. @returns {object} Official SettingsForms fake with only General descriptors. */
function settingsFixture(values) {
  const entries = new Map([
    ['locale', { preference: values.locale }],
    ['ui-theme', { preference: values.theme, fontSize: values.fontSize }],
    ['ui-chat', { transcriptView: values.transcriptView, performanceUsage: values.performanceUsage, linkOpening: values.linkOpening }],
    ['ui-conversation', { busyEnter: values.busyEnter }],
    ['ui-settings', { enabled: values.developerTools }],
  ]) // Official field owners, not a copied settings implementation.
  return {
    entries,
    describe: () => [...entries].map(([ns, value]) => ({ ns, value })),
    async update(ns, fields) { entries.set(ns, { ...entries.get(ns), ...fields }) },
    async mutate(ns) { entries.set(ns, {}) },
  }
}

/** @param {object} settings Native forms. @returns {object} Fake Cordis lifecycle with administrator event delivery. */
function contextFixture(settings) {
  const listeners = new Set() // Only the official settings/document-updated event is simulated.
  let dispose // Cordis effect cleanup invoked after every isolated case.
  return {
    settings,
    logger: { warn() {} },
    on(name, listener) { if (name === 'settings/document-updated') listeners.add(listener); return () => listeners.delete(listener) },
    effect(register) { dispose = register() },
    changed(ns) { for (const listener of listeners) listener(ns) },
    close() { dispose?.() },
  }
}

test('administrator publishes saved native settings; ordinary user adopts without any write', async () => {
  const previousFetch = globalThis.fetch // Restore the process network surface after the offline fake.
  let remote = { revision: 0, settings: null } // One environment-wide authoritative policy record.
  const writes = [] // Signed PUT requests, never a real API Key.
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body) // Admin submission contains exact non-secret fields.
      assert.equal(body.expectedRevision, remote.revision)
      remote = { revision: remote.revision + 1, settings: body.settings }
      writes.push(body)
    }
    return { ok: true, json: async () => remote }
  }
  const admin = contextFixture(settingsFixture(initial)) // First admin boot has already saved native Profile values.
  const ordinary = contextFixture(settingsFixture({ ...initial, theme: 'system', developerTools: true })) // Different user's default view.
  const options = { apiBase: 'http://127.0.0.1:19099', readToken: async () => 'fixture-token', userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge' } // Signed identity fixture.
  try {
    installSharedUiPolicy(admin, { ...options, isAdmin: true })
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(writes.length, 1)
    assert.deepEqual(remote.settings, initial)
    admin.settings.entries.set('ui-theme', { preference: 'light', fontSize: 15 }) // Official administrator form commits a live choice.
    admin.changed('ui-theme')
    await new Promise(resolve => setTimeout(resolve, 260))
    assert.equal(writes.length, 2)
    assert.equal(remote.settings.theme, 'light')
    installSharedUiPolicy(ordinary, { ...options, userId: '8', isAdmin: false })
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.deepEqual(captureGeneralSettings(ordinary.settings), remote.settings)
    assert.equal(writes.length, 2, 'ordinary Runtime must never publish or change the shared policy')
  } finally {
    admin.close()
    ordinary.close()
    globalThis.fetch = previousFetch
  }
})

test('a stale administrator adopts a newer policy after a revision conflict', async () => {
  const previousFetch = globalThis.fetch // Restore this test's fake transport after observing the conflict.
  const previousSetInterval = globalThis.setInterval // A captured tick avoids a real five-second wait.
  let tick // Native Host reconciliation callback installed by the plugin.
  let remote = { revision: 1, settings: { ...initial } } // Another administrator may advance this record.
  let writes = 0 // A rejected stale write must not repeat on the next poll.
  globalThis.setInterval = callback => { tick = callback; return previousSetInterval(() => {}, 60_000) }
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PUT') {
      writes += 1
      remote = { revision: 2, settings: { ...initial, theme: 'system' } } // Simulated concurrent winner.
      return { ok: false, status: 409 }
    }
    return { ok: true, json: async () => remote }
  }
  const admin = contextFixture(settingsFixture(initial)) // Stale admin Runtime still displays revision-one values.
  const options = { apiBase: 'http://127.0.0.1:19099', readToken: async () => 'fixture-token', userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge', isAdmin: true } // Signed fake identity.
  try {
    installSharedUiPolicy(admin, options)
    await new Promise(resolve => setTimeout(resolve, 10))
    admin.settings.entries.set('ui-theme', { preference: 'light', fontSize: 15 }) // This local edit loses the CAS race.
    admin.changed('ui-theme')
    await new Promise(resolve => setTimeout(resolve, 240))
    assert.equal(writes, 1)
    tick() // Next ordinary poll must adopt revision two, not retry the stale write.
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(captureGeneralSettings(admin.settings).theme, 'system')
    assert.equal(writes, 1)
  } finally {
    admin.close()
    globalThis.fetch = previousFetch
    globalThis.setInterval = previousSetInterval
  }
})

test('administrator publishes a native change even when Harness omits the document event', async () => {
  const previousFetch = globalThis.fetch // Restore the isolated transport after the missed-event regression check.
  const previousSetInterval = globalThis.setInterval // Capture the bounded poll for deterministic progression.
  let tick // Native policy reconciliation callback installed by the plugin.
  let remote = { revision: 1, settings: { ...initial } } // Durable baseline already known by the Runtime.
  let writes = 0 // Successful durable writes prove polling compares the last confirmed snapshot.
  globalThis.setInterval = callback => { tick = callback; return previousSetInterval(() => {}, 60_000) }
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PUT') {
      writes += 1
      remote = { revision: remote.revision + 1, settings: JSON.parse(options.body).settings }
    }
    return { ok: true, json: async () => remote }
  }
  const admin = contextFixture(settingsFixture(initial)) // No settings/document-updated event will be delivered for the edit.
  const options = { apiBase: 'http://127.0.0.1:19099', readToken: async () => 'fixture-token', userId: '7', modeId: 'knowledge', presetId: 'adminsmart-knowledge', isAdmin: true }
  try {
    installSharedUiPolicy(admin, options)
    await new Promise(resolve => setTimeout(resolve, 10))
    admin.settings.entries.set('ui-conversation', { busyEnter: 'queue' }) // Harness native value changes without its notification event.
    tick()
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(writes, 1)
    assert.equal(remote.settings.busyEnter, 'queue')
  } finally {
    admin.close()
    globalThis.fetch = previousFetch
    globalThis.setInterval = previousSetInterval
  }
})
