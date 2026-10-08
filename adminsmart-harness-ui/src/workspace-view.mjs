/** Current user's official Workspace-browser view, persisted outside cross-user localStorage. */

import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

const MAX_BYTES = 256 * 1024 // A view contains only bounded ids and display choices, never Session bodies.
const MAX_KEYS = 2_000 // Manual order and expansion cannot grow without a limit.
const MAX_ID_LENGTH = 200 // Matches the Host Session identifier boundary.
const GROUPS = new Set(['workspace', 'workspace-tree', 'flat']) // Official fixed-version grouping options.
const ORDERS = new Set(['manual', 'updated']) // Official fixed-version sorting options.
const FILTERS = new Set(['default', 'show', 'only']) // Official archived Session filters.

/**
 * Validate and detach one official sidebar Store snapshot before persistence or rehydration.
 * @param {unknown} input Untrusted browser JSON or saved Host JSON.
 * @returns {object} Safe official Store state without arbitrary fields or large identifiers.
 * @throws {Error} Invalid state is rejected, never silently used for another account.
 * @sideEffects None.
 */
export function normalizeWorkspaceView(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('工作区视图状态无效')
  if (!GROUPS.has(input.groupBy) || !ORDERS.has(input.orderBy) || !FILTERS.has(input.archivedFilter ?? 'default')) throw new Error('工作区视图选项无效')
  const expansion = input.groupExpansion // Per-Workspace collapse choices; keys are opaque official identities.
  const orders = input.sessionOrderByAccount // Per-Workspace and flat-list manual Session orders.
  if (!expansion || typeof expansion !== 'object' || Array.isArray(expansion)
    || !orders || typeof orders !== 'object' || Array.isArray(orders)
    || Object.keys(expansion).length > MAX_KEYS || Object.keys(orders).length > MAX_KEYS) throw new Error('工作区视图状态过大')
  const validId = id => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH && !/[\u0000-\u001f\u007f]/u.test(id) // No paths or content are interpreted as instructions.
  const groupExpansion = Object.fromEntries(Object.entries(expansion).map(([id, value]) => {
    if (!validId(id) || typeof value !== 'boolean') throw new Error('工作区展开状态无效')
    return [id, value]
  })) // Detached map cannot mutate the original official Store snapshot.
  const sessionOrderByAccount = Object.fromEntries(Object.entries(orders).map(([id, values]) => {
    if (!validId(id) || !Array.isArray(values) || values.length > MAX_KEYS || !values.every(validId)) throw new Error('会话顺序状态无效')
    return [id, [...values]]
  })) // Opaque Session ids remain current-user-only; no Session content is saved.
  const view = {
    groupBy: input.groupBy,
    orderBy: input.orderBy,
    archivedFilter: input.archivedFilter ?? 'default',
    groupExpansion,
    sessionOrderByAccount,
  }
  if (Buffer.byteLength(JSON.stringify(view), 'utf8') > MAX_BYTES) throw new Error('工作区视图状态过大')
  return view
}

/**
 * Read the current Runtime Home's optional view state.
 * @param {string} path Current user and mode isolated state file.
 * @returns {Promise<object|null>} Last saved official view or null for a new user.
 * @throws {Error} Corrupt files are reported rather than replaced with another user's data.
 * @sideEffects Reads one bounded file only.
 */
export async function readWorkspaceView(path) {
  try {
    const metadata = await stat(path) // Reject directories and oversized snapshots before reading bytes.
    if (!metadata.isFile() || metadata.size > MAX_BYTES) throw new Error('工作区视图文件无效')
    const payload = JSON.parse(await readFile(path, 'utf8')) // No browser cookie, message or credential is persisted.
    if (payload?.version !== 1) throw new Error('工作区视图版本无效')
    return normalizeWorkspaceView(payload.view)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/**
 * Atomically replace the current user's view after validating the complete official snapshot.
 * @param {object} input State path, browser snapshot, and official atomic writer utilities.
 * @returns {Promise<object>} Saved detached state.
 * @throws {Error} Invalid or oversized snapshots cannot reach disk.
 * @sideEffects Creates one private state directory and replaces one current-user file.
 */
export async function writeWorkspaceView({ path, view, withFileLock, writeFileAtomic }) {
  const safe = normalizeWorkspaceView(view) // Validate before creating or locking filesystem state.
  const serialized = JSON.stringify({ version: 1, view: safe }) // Fixed envelope supports later schema migration.
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await withFileLock(path, async () => {
    await writeFileAtomic(path, serialized, { mode: 0o600, dirMode: 0o700 })
  })
  return safe
}
