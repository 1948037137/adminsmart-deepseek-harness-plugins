import assert from 'node:assert/strict'
import test from 'node:test'
import { link, mkdtemp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { nativeExecutionDenial, permitsPath, within, worktreeExecutionDenial } from '../src/native-file-policy.mjs'
import { sessionFiles } from '../src/session-files.mjs'
import { loadRuntimeModule } from '../src/runtime.mjs'

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

test('official hard-linked attachments remain readonly even when their Store is inside business cwd', async t => {
  const f = await fixture(t) // 只在本测试业务根内安装独立的官方 Store，不使用真实 Runtime Home。
  const { Context } = await loadRuntimeModule('@deepseek-ai/cordis') // 固定版本官方注册图，不启动服务或模型。
  const { default: InputStore } = await loadRuntimeModule('@deepseek-ai/dsh-attachment-local') // 通过真实公开入口验证内容寻址附件的硬链接行为。
  const context = new Context() // 当前测试唯一的附件服务上下文。
  const store = await context.plugin(InputStore, {
    dshHome: f.root, // 官方 Store 只保存于本测试业务根，不能解析真实用户 Home。
  }) // 当前测试官方附件原件实际位于业务根内。
  try {
    const reference = await context.attachments.saveFile({
      name: 'authorized-fixture.md', // 当前合成会话接受的原件显示名。
      data: Buffer.from('# accepted synthetic document\n'), // 本测试生成的小型 Markdown 字节，不含用户数据。
    }) // 官方公开保存 API 返回的可信内容身份。
    const source = context.attachments.fileHostPath(reference) // 使用官方公开地址计算，不复制内部存储目录格式。
    const metadata = await stat(source) // 真实 nlink 证明该对象经过官方硬链接发布。
    f.events.push({
      type: 'user/message', // 已接受用户消息，而非模型生成或任意路径声明。
      data: {
        content: [{
          type: 'file', // 官方原件引用块，不把文件名当读取路径。
          attachment: reference, // 当前会话唯一获得授权的 Store 引用。
        }], // 合成消息的结构化内容。
      }, // 官方用户消息数据区域。
    }) // 只有该引用属于当前合成会话。
    assert.equal(within(f.root, source), true)
    assert.ok(metadata.nlink > 1, '官方不可变文件 alias 通过硬链接发布')
    assert.equal(permitsPath(context, f.execution, source), true)
    assert.equal(permitsPath(context, f.execution, source, true), false)
    assert.equal(nativeExecutionDenial(context, {
      ...f.execution, // 可信当前合成会话的 Guard 上下文。
      name: 'read', // 官方读取工具走附件精确授权路径。
      arguments: { file_path: source }, // 输入为官方 fileHostPath，不使用 sha256 身份冒充路径。
    }), undefined)
    assert.match(nativeExecutionDenial(context, {
      ...f.execution, // 仍是同一已授权会话，写入拒绝不能依赖身份失效。
      name: 'write', // 原件即使根内也不能被官方写入工具覆盖。
      arguments: {
        file_path: source, // 已授权原件的准确读取地址，不能转换为写入授权。
        content: 'synthetic forbidden overwrite', // Guard 不应允许这段合成覆盖内容触达文件工具。
      },
    }), /文件路径/)
    assert.match(nativeExecutionDenial(context, {
      ...f.execution, // 同一文件权限边界也约束原生编辑。
      name: 'edit', // 编辑工具同样属于写入操作。
      arguments: {
        file_path: source, // 官方不可变原件地址。
        old_string: 'synthetic', // 合成待匹配片段，实际编辑工具不会被执行。
        new_string: 'forbidden', // 合成替换内容，必须在 Guard 被拒绝。
      },
    }), /文件路径/)

    const alias = join(f.root, 'unauthorized-hardlink-alias.md') // 同 inode 的另一个业务路径没有官方 Store 的精确授权身份。
    await link(source, alias)
    assert.equal(permitsPath(context, f.execution, alias), false)
    assert.equal(permitsPath(context, f.execution, alias, true), false)

    const stranger = await context.attachments.saveFile({
      name: 'unaccepted-fixture.md', // 当前会话从未接受的附件显示名。
      data: Buffer.from('# unaccepted synthetic document\n'), // 与授权原件不同的合成字节，得到独立内容身份。
    }) // 同一 Store 的存在性不等于当前会话已接受附件。
    const strangerSource = context.attachments.fileHostPath(stranger) // 官方路径仍须与会话内引用精确匹配。
    assert.equal(permitsPath(context, f.execution, strangerSource), false)
    assert.equal(permitsPath(context, f.execution, strangerSource, true), false)
  } finally {
    await store.dispose() // 停止测试上下文；业务根由原 fixture 的生命周期统一清理。
  }
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

test('Session工作目录切换后相对文件检查与官方执行同基准，业务根及链接边界仍生效', async t => {
  const f = await fixture(t) // 仅当前任务自建路径和区外canary。
  const checkout = join(f.root, 'checkout') // 模拟官方工作树已提交的目录，仍属于业务根。
  await mkdir(checkout)
  await symlink(f.outside, join(checkout, 'foreign-link.txt'), 'file')
  f.ctx.get = name => name === 'workingDirectory' ? { get: () => checkout } : undefined // 可信Session目录服务，不从工具参数取cwd。
  assert.equal(permitsPath(f.ctx, f.execution, 'local.txt', true), true)
  assert.equal(permitsPath(f.ctx, f.execution, 'foreign-link.txt'), false)
  assert.equal(permitsPath(f.ctx, f.execution, '../allowed.txt', true), true)
  assert.equal(permitsPath(f.ctx, f.execution, '../../outside.txt'), false)
  f.ctx.get = name => name === 'workingDirectory' ? { get: () => f.home } : undefined
  assert.equal(permitsPath(f.ctx, f.execution, 'outside.txt'), false)
})

test('Worktree只允许业务根内仓库，不沿外部祖先Git元数据创建检出', async t => {
  const f = await fixture(t) // 不执行git，不初始化真实仓库，只检查合成标记归属。
  await mkdir(join(f.home, '.git')) // 业务根之外的祖先仓库诱饵，不能作为来源。
  assert.match(worktreeExecutionDenial(f.ctx, f.execution), /没有可用Git仓库/u)
  await mkdir(join(f.root, '.git')) // 业务根内的合成仓库标记才通过前置范围判断。
  assert.equal(worktreeExecutionDenial(f.ctx, f.execution), undefined)
  const checkout = join(f.root, 'checkout') // 官方linked checkout同样必须指向业务内元数据。
  await mkdir(checkout)
  await writeFile(join(checkout, '.git'), 'gitdir: ../../.git') // 明确指向业务根外诱饵。
  f.ctx.get = name => name === 'workingDirectory' ? { get: () => checkout } : undefined
  assert.match(worktreeExecutionDenial(f.ctx, f.execution), /超出当前业务范围/u)
})
