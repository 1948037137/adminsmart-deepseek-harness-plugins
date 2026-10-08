import assert from 'node:assert/strict'
import test from 'node:test'
import { link, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { nativeExecutionDenial, permitsPath, within } from '../src/native-file-policy.mjs'
import { sessionFiles } from '../src/session-files.mjs'

/** @param {import('node:test').TestContext} t 用例生命周期。 @returns {Promise<object>} 完全合成的业务根、会话与官方服务替身。 */
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'native-office-policy-')) // 只创建本任务自己的临时文件，不读真实用户或凭据。
  const root = join(home, 'business') // 可读写的合成业务根。
  const outside = join(home, 'outside.txt') // 模拟越界文件的合成 canary，不是服务器私有文件。
  await mkdir(root)
  await writeFile(outside, 'synthetic outside canary')
  const old = process.env.ADMINSMART_AGENT_BUSINESS_ROOT // 测试结束恢复原运行环境，不污染其它用例。
  process.env.ADMINSMART_AGENT_BUSINESS_ROOT = root
  t.after(async () => {
    if (old === undefined) delete process.env.ADMINSMART_AGENT_BUSINESS_ROOT
    else process.env.ADMINSMART_AGENT_BUSINESS_ROOT = old
    await rm(home, { recursive: true, force: true })
  })
  const events = [] // 仅本测试会话已接受的合成事件。
  const session = { id: 'fixture-session', header: { cwd: root }, snapshotEvents: () => events } // 不从请求参数接受外部身份。
  const ctx = {
    attachments: { fileHostPath: () => outside, imageHostPath: () => outside }, // 官方路径计算接口的 Fake，不打开存储。
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) }, // 写入模式可逐项替换测试。
  }
  return { home, root, outside, events, session, ctx, execution: { agent: { session }, arguments: {} } }
}

test('business paths and new output files are allowed, siblings and traversal are denied', async t => {
  const f = await fixture(t) // 完全离线的文件权限用例。
  assert.equal(within(f.root, `${f.root}-sibling/file`), false)
  assert.equal(await permitsPath(f.ctx, f.execution, 'new-output/result.txt', true), true)
  assert.equal(await permitsPath(f.ctx, f.execution, f.outside), false)
  assert.equal(await permitsPath(f.ctx, f.execution, '../outside.txt', true), false)
  assert.equal(await permitsPath(f.ctx, f.execution, '\\\\server\\share\\file.txt'), false)
  assert.equal(permitsPath(f.ctx, f.execution, '//server/share/file.txt'), false)
  assert.equal(permitsPath(f.ctx, f.execution, 'https://example.test/file'), false)
  if (process.platform === 'win32') assert.equal(permitsPath(f.ctx, f.execution, 'new.txt:hidden', true), false)
})

test('accepted native attachment references are readable but never writable outside business cwd', async t => {
  const f = await fixture(t) // 模拟用户真正发送文件后才产生的原生引用。
  f.events.push({ type: 'user/message', data: { content: [{ type: 'file', attachment: { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'fixture.txt', bytes: 26 } }] } })
  assert.equal(sessionFiles(f.session).size, 1)
  assert.equal(await permitsPath(f.ctx, f.execution, f.outside), true)
  assert.equal(await permitsPath(f.ctx, f.execution, f.outside, true), false)
})

test('symlinked file paths cannot escape the explicit file-tool boundary', async t => {
  const f = await fixture(t) // 只对自己创建的文件设置链接，不触碰系统路径。
  const link = join(f.root, 'outside-link.txt') // 合成逃逸入口。
  await symlink(f.outside, link, 'file')
  assert.equal(await permitsPath(f.ctx, f.execution, link), false)
  assert.equal(await permitsPath(f.ctx, f.execution, link, true), false)
})

test('native commands keep business cwd and workspace-write without escalation or background mode', async t => {
  const f = await fixture(t) // 不执行命令，仅验证官方执行前的业务 Guard。
  const execution = { ...f.execution, name: 'pwsh', arguments: { command: 'synthetic command' } } // command 为不可执行占位，不能当作真实隔离测试。
  assert.equal(await nativeExecutionDenial(f.ctx, execution), undefined)
  assert.equal(await nativeExecutionDenial(f.ctx, { ...execution, arguments: { ...execution.arguments, sandbox_permissions: 'workspace-write', justification: '读取合成办公文件' } }), undefined)
  assert.equal(nativeExecutionDenial(f.ctx, execution) instanceof Promise, false, '官方 Guard 不等待 Promise，必须同步作出允许或拒绝')
  assert.match(nativeExecutionDenial(f.ctx, { ...execution, arguments: { sandbox_permissions: 'workspace-write', justification: '' } }), /非空/)
  assert.match(await nativeExecutionDenial(f.ctx, { ...execution, arguments: { ...execution.arguments, workdir: f.home } }), /工作目录/)
  assert.match(await nativeExecutionDenial(f.ctx, { ...execution, arguments: { ...execution.arguments, sandbox_permissions: 'danger-full-access' } }), /提高/)
  assert.match(await nativeExecutionDenial(f.ctx, { ...execution, arguments: { ...execution.arguments, run_in_background: true } }), /后台/)
  f.ctx.sandboxPolicy.resolve = () => ({ mode: 'danger-full-access', workspaceRoot: f.root })
  assert.match(await nativeExecutionDenial(f.ctx, execution), /写入沙箱/)
})

test('hard-linked files cannot disguise foreign input as a business file', async t => {
  const f = await fixture(t) // 仅用测试创建的区外 canary，不打开真实文件。
  const linked = join(f.root, 'linked-canary.txt') // 与区外源共享同一 inode 的伪业务路径。
  await link(f.outside, linked)
  assert.equal(permitsPath(f.ctx, f.execution, linked), false)
  assert.equal(permitsPath(f.ctx, f.execution, linked, true), false)
})

test('official skill and deliverable scopes do not authorize arbitrary host resources', async t => {
  const f = await fixture(t) // 只核对参数和业务边界，官方技能本体不被改写。
  assert.equal(await nativeExecutionDenial(f.ctx, { ...f.execution, name: 'skill', arguments: { name: 'office-xlsx' } }), undefined)
  assert.match(await nativeExecutionDenial(f.ctx, { ...f.execution, name: 'skill', arguments: { name: 'host-admin' } }), /办公技能/)
  assert.match(await nativeExecutionDenial(f.ctx, { ...f.execution, name: 'present', arguments: { files: [{ path: f.outside }] } }), /交付/)
})
