/** 联网工具由官方提供；退役自有开关后，浏览器与 Host 都不得恢复其状态链。 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// 当前业务 Client 的实际发布字节，防止遗留资源仍向页面插入开关。
const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
// 当前 Host 装配源，确保入口退役包含后端状态持久化而非只隐藏按钮。
const hostSource = await readFile(new URL('../src/index.mjs', import.meta.url), 'utf8')

test('官方输入工具栏不再混入业务联网按钮或请求', () => {
  assert.doesNotMatch(clientSource, /SESSION_WEB_ACCESS|adminsmart-web-toggle|requestSessionWebAccess|AdminSmartComposerTools/u)
  assert.doesNotMatch(clientSource, /conversation\.input\.left/u)
})

test('Host 不再注册联网开关路由或读写会话开关文件', () => {
  assert.doesNotMatch(hostSource, /SESSION_WEB_ACCESS|session-web-access\.json|readSessionWebAccessState|updateSessionWebAccessState/u)
})
