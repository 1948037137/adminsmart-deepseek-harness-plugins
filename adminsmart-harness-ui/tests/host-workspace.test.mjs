/** Verify hidden Workspace recovery reattaches only the current tenant path's persisted and live Sessions. */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureKnowledgeWorkspace } from '../src/index.mjs'

const logoPath = new URL('../assets/aurasearch-logo.jpg', import.meta.url) // Repository-owned product artwork served by the Host plugin.
const logoMetadata = await stat(logoPath) // Binary asset must remain present for every Runtime activation.
const hostSource = await readFile(new URL('../src/index.mjs', import.meta.url), 'utf8') // Host route contract checked without starting a real web server.
assert.ok(logoMetadata.size > 1024, 'AuraSearch logo asset must be non-empty')
assert.match(hostSource, /AURASEARCH_LOGO_ROUTE = '\/adminsmart\/assets\/aurasearch-logo\.jpg'/)
assert.match(hostSource, /'content-type': 'image\/jpeg'/)
assert.match(hostSource, /SESSION_SEARCH_ROUTE = '\/adminsmart\/sessions\/search'/)
assert.match(hostSource, /sessionFilters: \[{ kind: 'cwd', values: \[fixedWorkspacePath\] }\]/)
assert.match(hostSource, /seq: Number\(hit\.bestMatch\.seq\)/)
assert.match(hostSource, /time: Number\(hit\.bestMatch\.time\)/)
assert.match(hostSource, /Array\.from\(query\)\.length <= 4/)
assert.match(hostSource, /ctx\.sessionQuery\.filterSessions/)
assert.match(hostSource, /ctx\.sessionQuery\.readSurface/)
assert.match(hostSource, /extractSessionEventText\(event\)/)

const temporaryRoot = await mkdtemp(join(tmpdir(), 'adminsmart-fixed-workspace-')) // Isolated filesystem fixture for canonical cwd validation.
const workspaceDirectory = join(temporaryRoot, 'tenant-workspace') // Current tenant's only valid hidden Runtime directory.
const foreignDirectory = join(temporaryRoot, 'foreign-workspace') // Different canonical directory that must never be attached.
await mkdir(workspaceDirectory)
await mkdir(foreignDirectory)
const canonicalWorkspacePath = await realpath(workspaceDirectory) // Workspace Registry publishes canonical paths.
const attachedSessionIds = [] // Session identities accepted by the mock Workspace membership boundary.
let assignedTitle = '旧标题' // Existing registration title should be normalized without changing its path identity.
const workspace = {
  id: 'workspace-fixture', // Stable mock registration identity returned by create or reuse.
  path: canonicalWorkspacePath, // Canonical tenant path used for header comparison.
  get title() { return assignedTitle }, // Live title projection after normalization.
  async setTitle(title) { assignedTitle = title }, // Durable title mutation seam exercised by the helper.
  async attachSession(sessionId) { attachedSessionIds.push(String(sessionId)) } // Idempotence belongs to the real Workspace implementation.
}
const context = {
  workspaceRegistry: {
    async create(path, title) {
      assert.equal(path, workspaceDirectory)
      assert.equal(title, '知识问答')
      return workspace
    }
  },
  sessionPersistence: {
    async list() {
      return [
        { id: 'persisted-history', cwd: workspaceDirectory }, // Valid durable history must be restored.
        { id: 'foreign-history', cwd: foreignDirectory } // Different cwd must remain ungrouped and inaccessible to this Runtime.
      ]
    }
  },
  sessions: {
    list() {
      return [
        { id: 'live-session', header: { id: 'live-session', cwd: workspaceDirectory } }, // Live blank Session may precede persistence refresh.
        { id: 'persisted-history', header: { id: 'persisted-history', cwd: workspaceDirectory } } // Duplicate identity must attach only once.
      ]
    }
  }
} // Minimal public Host service faces consumed by ensureKnowledgeWorkspace.

try {
  const recovered = await ensureKnowledgeWorkspace(context, workspaceDirectory) // Recovery must reuse/create, retitle, and repair membership.

  assert.equal(recovered, workspace)
  assert.equal(assignedTitle, '知识问答')
  assert.deepEqual(attachedSessionIds.sort(), ['live-session', 'persisted-history'])
  process.stdout.write('host_workspace_recovery=ok\n')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
