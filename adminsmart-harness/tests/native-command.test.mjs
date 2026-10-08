/** 用真实官方工具与 Windows 写入沙箱验证合成文件，不调用模型、网络或用户数据。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import { fixture } from './helpers/native-delegation.mjs'
import { loadRuntimeModule } from '../src/runtime.mjs'

/** @param {string} path 本测试生成的受控路径。 @returns {string} PowerShell 单引号路径字面量。 */
function literal(path) {
  return "'" + path.replaceAll("'", "''") + "'"
}

test('official command SDK keeps equal-mode calls, blocks escalation and enforces the Windows write fence', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const f = await fixture(t) // 官方 Session、Agent、ToolRuntime 和知识 Guard；模型使用离线 Fake。
  const outside = join(dirname(f.home), basename(f.home) + '-outside.txt') // 仅本任务的区外合成 canary，不触碰系统或他人文件。
  const inside = join(f.home, 'command-output.txt') // 允许办公脚本生成的业务结果。
  await writeFile(outside, 'SYNTHETIC-OUTSIDE-ONLY')
  t.after(() => rm(outside, { force: true }))
  const Subprocess = await loadRuntimeModule('@deepseek-ai/dsh-subprocess-local') // 与 Gateway 一致的官方进程机制。
  const Sandbox = await loadRuntimeModule('@deepseek-ai/dsh-sandbox-local') // 官方平台选择与受限令牌提供方。
  const Executor = await loadRuntimeModule('@deepseek-ai/dsh-pwsh-sandbox') // 失败时不回退无限制执行的官方命令执行器。
  const Tool = await loadRuntimeModule('@deepseek-ai/dsh-tool-pwsh') // 参数、no-op 权限处理与输出全部由固定版 SDK 执行。
  const fibers = [] // 本测试额外挂载的官方进程服务，结束后逆序释放。
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  fibers.push(await f.context.plugin(Subprocess.default))
  fibers.push(await f.context.plugin(Sandbox.default))
  fibers.push(await f.context.plugin(Executor.default, { cwd: f.home, timeoutMs: 10000, maxTimeoutMs: 15000 }))
  f.context.provide('shellEnv', { collect: () => ({}) }) // 不注入宿主凭据或业务数据。
  fibers.push(await f.context.plugin(Tool, { enableRunInBackground: false }))
  const parent = await f.parent('native-office-command-fixture') // 可信 live 根会话，工作目录等于合成业务根。
  const args = {
    command: 'Set-Content -LiteralPath ' + literal(inside) + " -Value 'NATIVE-WRITE-OK' -Encoding utf8", // 只写任务临时文件。
    description: '写入业务目录的合成结果', // 原生工具必需的明确办公目的。
    workdir: f.home, // 命令工作目录必须通过同一业务 Guard。
    sandbox_permissions: 'workspace-write', // 当前同模式，不申请更高权限。
    justification: '生成合成办公验收结果', // 固定版 SDK 不允许空理由。
  }
  const allowed = await f.execute(parent, 'pwsh', args) // 真实进入 SDK、受限进程和工具输出 Schema。
  assert.equal(allowed.isError, false, JSON.stringify(allowed))
  assert.equal(allowed.value.exitCode, 0)
  assert.equal(allowed.value.sandbox.mode, 'workspace-write')
  assert.equal(allowed.value.sandbox.enforcement, 'partial', 'Windows 官方后端明确只有部分强制执行')
  assert.match(await readFile(inside, 'utf8'), /NATIVE-WRITE-OK/)
  const empty = await f.execute(parent, 'pwsh', { ...args, justification: '' }) // 空理由不能再循环误报为完整权限升级。
  assert.equal(empty.isError, true)
  const escalation = await f.execute(parent, 'pwsh', { ...args, sandbox_permissions: 'danger-full-access' }) // 绝不授予绕开写入沙箱的权限。
  assert.equal(escalation.isError, true)
  const background = await f.execute(parent, 'pwsh', { ...args, run_in_background: true }) // 无论工具 Schema 是否声明，都由业务 Guard 拒绝。
  assert.equal(background.isError, true)
  const denied = await f.execute(parent, 'pwsh', { ...args, command: '$ErrorActionPreference = "Stop"; Set-Content -LiteralPath ' + literal(outside) + " -Value 'SHOULD-NOT-WRITE' -Encoding utf8" }) // 用自建 canary 实测命令内部的区外写入。
  assert.equal(denied.value.exitCode !== 0, true)
  assert.equal(denied.value.sandbox.denied, true)
  assert.equal(await readFile(outside, 'utf8'), 'SYNTHETIC-OUTSIDE-ONLY')
  const readable = await f.execute(parent, 'pwsh', { ...args, command: 'Get-Content -LiteralPath ' + literal(outside) }) // 如实验证读取缺口，不能把可读取误报为已经隔离。
  assert.equal(readable.value.exitCode, 0)
  assert.match(readable.value.stdout.text, /SYNTHETIC-OUTSIDE-ONLY/)
  const pipeScript = "const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', '0'], { stdio: 'pipe' }); child.on('error', error => { console.error(error.code); process.exitCode = 1; });" // 最小复现官方渲染器所需的管道子进程，不读取或转换任何真实文件。
  const piped = await f.execute(parent, 'pwsh', { ...args, command: '& ' + literal(process.execPath) + ' -e ' + literal(pipeScript) }) // 保留官方受限令牌，不能用升权掩盖渲染失败。
  assert.notEqual(piped.value.exitCode, 0)
  assert.match(piped.value.stderr.text, /EPERM/, '当前固定 Windows 后端拒绝管道子进程，不能把 PDF 文字读取当作页面视觉通过')
})
