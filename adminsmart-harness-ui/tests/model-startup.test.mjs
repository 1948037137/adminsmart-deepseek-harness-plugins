/** 完整自有 Bundle 不再接管模型选择；原始官方 ModelDirectory 的默认、历史与手动选择使用隔离 Remote。 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const runtimeRoot = process.env.ADMINSMART_DSH_ROOT // 显式固定 SDK 安装，不访问生产 Runtime 或配置。

/**
 * 提供官方公开 SnapshotStore 的离线等价订阅协议。
 * @param {object} initial 合成目录或 Session 投影。
 * @returns {object} 稳定快照与更新、订阅方法，不执行网络。
 */
function store(initial) {
  let value = initial // 更新前保持同一快照引用。
  const listeners = new Set() // 当前测试独占的公开订阅者。
  return { getSnapshot: () => value, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }, set(next) { value = next; for (const listener of listeners) listener() }, update(edit) { const next = structuredClone(value); edit(next); this.set(next) } }
}

/**
 * 读取完整官方 ModelSelection 与完整自有 Bundle，不改写或抽取内部实现。
 * @returns {Promise<object>} 官方原始 ModelDirectory 与自有公开装配、请求观察。
 */
async function fixture() {
  const require = createRequire(pathToFileURL(resolve(runtimeRoot, 'package.json'))) // 官方模块只从本轮固定安装解析。
  const cordis = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href) // 实际 SDK 类身份用于原始 Bundle 导出。
  let registration // 当前完整 Bundle 的官方 load 登记。
  const document = { querySelector: () => null, createElement: () => ({ dataset: {}, setAttribute() {}, remove() {} }), head: { appendChild() {} } } // 未挂载的官方和品牌样式容器，不使用浏览器。
  const seeds = { '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': { createSnapshotStore: store }, '@deepseek-ai/dsh-client-ui-primitives': {} } // 原始目录只依赖公开 SDK 与 Store。
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8') // 自有完整交付源码，退役逻辑不得通过另一个入口残留。
  runInNewContext(source, { document, window: { __ModuleLoader__: { load(value) { registration = value } } }, fetch() { throw new Error('自有模型覆盖不得发起HTTP') } })
  const product = registration.factory(name => name.startsWith('react') ? require(name) : seeds[name]) // 原始产品工厂，不复制其模型业务。
  const effects = [] // 自有公开生命周期登记中不得包含模型修复、默认或偏好流程。
  const slots = [] // 自有席位不得覆盖模型卡片或官方思考选择器。
  product.apply({ inject() {}, slots: { inject(name) { slots.push(name); return () => {} } }, effect(_register, label) { effects.push(label); return () => {} }, get modelDirectories() { throw new Error('自有插件不得接管官方模型目录') } })
  assert.equal(product.inject.includes('modelDirectories'), false)
  assert.equal(slots.includes('settings.models.provider-card'), false)
  assert.ok(effects.every(label => !/model|reasoning/u.test(label)))
  assert.doesNotMatch(source, /modelDirectories|requestModelPreference|requestModelDefaults|AdminSmartProviderPolicy|MODEL_REASONING_URL/u)
  const file = require.resolve('@deepseek-ai/dsh-client-ui-model-selection/client') // 原始官方公开 Client 发布文件。
  runInNewContext(await readFile(file, 'utf8'), { window: { __ModuleLoader__: { load(value) { registration = value } } }, document, structuredClone, queueMicrotask }, { filename: file })
  const native = registration.factory(name => name.startsWith('react') ? require(name) : seeds[name]) // 官方 ModelDirectory 完整类与流程，无业务覆写。
  return { ModelDirectory: native.ModelDirectory }
}

for (const next of [undefined, { provider: 'fixture', model: 'fixture-model', reasoningEffort: 'high' }]) test(`自有插件不覆盖官方${next ? '历史Session' : '新Session默认'}模型与思考选择`, { skip: !runtimeRoot }, async () => {
  const { ModelDirectory } = await fixture() // 完整产品装配必须先通过无覆盖契约。
  const defaultSelection = { provider: 'fixture', model: 'fixture-model', reasoningEffort: 'low' } // 官方 Host 目录提供的默认选择，不由自有插件推导。
  const metadata = { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } // 官方 Remote 实际声明的两档，不补齐五档或线值。
  const projected = store({ next }) // 当前 Session 历史投影，未选时才使用官方默认。
  const selections = [] // 只有明确用户操作才允许发起原生选择调用。
  const catalog = { store: store({ status: 'ready', value: { default: defaultSelection, groups: [{ id: 'fixture', models: [{ id: 'fixture-model', reasoning: metadata }] }], failures: [] }, error: null }), load: async () => undefined, reasoningFor: () => metadata } // 合成官方公开目录，不调用真实模型。
  const directory = new ModelDirectory({ selectModel: async value => { selections.push(structuredClone(value)); projected.set({ next: structuredClone(value) }); return { ok: true } } }, 'session-fixture', () => true, catalog, projected, () => next === undefined) // 官方原始 Controller 负责默认、保留与实际选择。
  try {
    await directory.load()
    assert.deepEqual(directory.store.getSnapshot().current, next ?? defaultSelection)
    assert.equal(selections.length, 0)
    assert.deepEqual(directory.store.getSnapshot().groups[0].models[0].reasoning.efforts.map(item => item.id), ['low', 'high'])
    await directory.select({ provider: 'fixture', model: 'fixture-model', reasoningEffort: 'high' })
    assert.equal(selections.length, 1)
    assert.deepEqual(selections[0], { sessionId: 'session-fixture', provider: 'fixture', model: 'fixture-model', reasoningEffort: 'high' })
    assert.equal(directory.store.getSnapshot().current.reasoningEffort, 'high')
  } finally { directory.dispose() }
})

test('官方未声明思考能力时目录保持原始模型选择，不追加档位或思考参数', { skip: !runtimeRoot }, async () => {
  const { ModelDirectory } = await fixture() // 同一完整产品装配，不存在另一条自定义菜单。
  const selection = { provider: 'fixture', model: 'plain-model' } // 官方无思考模型默认不带 reasoningEffort。
  const projected = store({ next: undefined }) // 新 Session 没有历史选择。
  const catalog = { store: store({ status: 'ready', value: { default: selection, groups: [{ id: 'fixture', models: [{ id: 'plain-model' }] }], failures: [] }, error: null }), load: async () => undefined, reasoningFor: () => undefined } // 官方 Remote 不提供推理 metadata，业务不能按模型名补齐。
  const selections = [] // 捕获原生 Remote 实际参数，不能把无档位变成 low/off。
  const directory = new ModelDirectory({ selectModel: async value => { selections.push(structuredClone(value)); projected.set({ next: structuredClone(value) }); return { ok: true } } }, 'plain-session', () => true, catalog, projected, () => true) // 原始官方 Controller。
  try {
    await directory.load()
    assert.deepEqual(directory.store.getSnapshot().current, selection)
    assert.equal(directory.store.getSnapshot().groups[0].models[0].reasoning, undefined)
    await directory.select(selection)
    assert.equal(Object.hasOwn(selections[0], 'reasoningEffort'), false)
  } finally { directory.dispose() }
})
