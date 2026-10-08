/** 共享快捷键配置桥；全部实际键盘配置均经公开 ctx.shortcuts.edit，不替换官方键盘服务。 */

export const MANAGED_SHORTCUT_IDS = Object.freeze([
  'sidebar.left.toggle', 'sidebar.right.toggle', 'pane.split', 'pane.fullscreen.toggle',
  'page.close', 'page.refresh', 'session.new', 'session.search', 'workspace.add',
  'session.rename', 'session.fork', 'session.archive', 'workspace.openLocal',
  'terminal.new', 'browser.new', 'workspace.files', 'shortcuts.open', 'settings.open',
]) // 当前 alpha.1 官方可编辑指令；未挂载的这些指令仍保留服务端偏好。
const IDS = new Set(MANAGED_SHORTCUT_IDS) // 不接受任意插件动作或固定输入 id。
const PROFILES = new Set(['web:windows', 'web:macos', 'web:linux', 'desktop:windows', 'desktop:macos', 'desktop:linux']) // 官方六种设备边界。
const MODIFIERS = new Set(['primary', 'control', 'alt', 'shift', 'meta']) // 偏好只描述物理组合，不携带命令正文。
const CODES = new Set(['Slash', 'Comma', 'Period', 'Backslash', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Semicolon', 'Quote', 'Enter', 'Escape', 'Space', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) // 字母/数字/F键之外的官方命名键。
const POLICY_URL = './adminsmart/shortcut-policy' // Gateway 当前签名 Runtime 的固定同源入口。
const EVENTS_URL = './adminsmart/shortcut-policy/events' // 只接收安全分类/修订，不接收设置正文。
const REQUEST_TIMEOUT_MS = 5_000 // 单次回读/保存的有界等待。
const STREAM_TIMEOUT_MS = 70_000 // 配合内部六十秒租约重连释放异常长连接。
const RECONNECT_MS = 1_000 // 断线后重新签名连接，不进行高频设置轮询。
const MAXIMUM_BYTES = 32_768 // 当前有限设备/指令文档的硬上限。
const MAXIMUM_EVENT_BYTES = 16_384 // 失效事件只含 kind/revision，禁止无界流缓冲。

/** @param {unknown} value 未信任结构 @returns {boolean} 是否为无数组的记录。 */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
/** @param {object} value 纯JSON偏好 @returns {object} 独立副本，不共享后端或官方快照引用。 */
const copy = value => JSON.parse(JSON.stringify(value))
/** @param {object} value JSON字段 @returns {string} 键顺序无关的比较表示，保留 null/缺失差别。 */
const stable = value => JSON.stringify(value, (_, item) => record(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
/** @param {string} code 物理键码 @returns {boolean} 是否为固定 alpha.1 允许的 code。 */
const knownCode = code => typeof code === 'string' && (CODES.has(code) || /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4]))$/u.test(code))

/**
 * 浏览器只做有限DTO边界；Host与后端再校验官方设备协议，采用时仍由官方服务检查组合。
 * @param {unknown} value 后端官方文档。
 * @returns {object} 字段受控的独立文档，null override不会丢失。
 * @throws {Error} 顶层、平台、指令、字段、数量或键码非法。
 */
export function shortcutDocument(value) {
  if (!record(value) || Object.keys(value).length !== 2 || ![1, 2].includes(value.schemaVersion) || !record(value.profiles)
    || Object.keys(value.profiles).length > 6 || new TextEncoder().encode(JSON.stringify(value)).byteLength > MAXIMUM_BYTES) throw new Error('共享快捷键文档无效')
  for (const [profile, overrides] of Object.entries(value.profiles)) {
    if (!PROFILES.has(profile) || !record(overrides) || Object.keys(overrides).length > MANAGED_SHORTCUT_IDS.length) throw new Error('共享快捷键设备配置无效')
    for (const [id, binding] of Object.entries(overrides)) {
      if (!IDS.has(id)) throw new Error('共享快捷键包含不支持的指令')
      if (binding === null) continue
      if (!record(binding) || !Object.hasOwn(binding, 'code') || !Object.hasOwn(binding, 'modifiers')
        || Object.keys(binding).some(key => !['code', 'secondCode', 'modifiers'].includes(key)) || !knownCode(binding.code)
        || !Array.isArray(binding.modifiers) || binding.modifiers.length > 5 || new Set(binding.modifiers).size !== binding.modifiers.length
        || binding.modifiers.some(item => !MODIFIERS.has(item))
        || (Object.hasOwn(binding, 'secondCode') && (!knownCode(binding.secondCode) || binding.secondCode === binding.code || value.schemaVersion !== 2))) throw new Error('共享快捷键物理组合无效')
    }
  }
  return copy(value)
}

/**
 * 只接受当前Host确认的权威信封，浏览器不自行决定管理员身份。
 * @param {unknown} value GET/PUT的同源响应。
 * @returns {object} 独立 revision/document/writable 信封。
 * @throws {Error} 额外字段、修订、空态或权限提示不合法。
 */
export function shortcutEnvelope(value) {
  if (!record(value) || Object.keys(value).length !== 3 || !Number.isSafeInteger(value.revision) || value.revision < 0
    || typeof value.writable !== 'boolean' || !Object.hasOwn(value, 'document')
    || (value.document === null ? value.revision !== 0 : value.revision < 1)) throw new Error('共享快捷键响应无效')
  return { revision: value.revision, document: value.document === null ? null : shortcutDocument(value.document), writable: value.writable }
}

/**
 * 根据管理员真实接受的差异合并权威文档，保留休眠命令和其他设备。
 * @param {object|null} remote 服务端确认文档。
 * @param {object} local 官方完整已接受文档。
 * @param {string} profile 当前runtime/platform。
 * @param {Map<string, object>} changes 指令到{present,binding}的编辑差异。
 * @returns {object} 可提交的完整偏好文档，缺失字段表示恢复默认。
 */
export function mergeShortcutChanges(remote, local, profile, changes) {
  const document = copy(remote ?? shortcutDocument(local)) // 首次明确编辑可发布已有合法偏好，后续以服务端真源合并。
  document.schemaVersion = Math.max(document.schemaVersion, local.schemaVersion) // 官方Desktop首次双键编辑可从一升级到二，任何设备保存不能降级既有文档。
  const overrides = { ...(document.profiles[profile] ?? {}) } // 仅复制当前设备的独立override区域。
  for (const [id, change] of changes) {
    if (!IDS.has(id)) throw new Error('共享快捷键包含不支持的指令')
    if (change.present) overrides[id] = change.binding === null ? null : copy(change.binding)
    else delete overrides[id]
  }
  document.profiles[profile] = overrides
  return shortcutDocument(document)
}

/**
 * 从纯物理键组合得到公开官方服务使用的比较键。
 * @param {object} shortcuts 当前窗口的公开快捷键服务。
 * @param {object|null} binding 候选组合，null表示取消绑定。
 * @returns {string} 官方规范化结果，不使用键位显示文案比较。
 */
const bindingKey = (shortcuts, binding) => stable(shortcuts.describeBinding(binding).binding)

/**
 * 安装共享偏好桥；普通用户只采用，管理员真实编辑才CAS发布。
 * @param {object} options 当前Client公开能力和可隔离传输。
 * @param {object} options.shortcuts 官方ctx.shortcuts，不能提供private registry/configure。
 * @param {Function} [options.fetchImpl] 当前同源fetch；测试必须使用Fake。
 * @param {Function} [options.notifyError] 可见安全错误提示，未传时不泄露内部异常。
 * @param {Function} [options.schedule] 重连计时器，测试可隔离。
 * @param {Function} [options.cancelSchedule] 卸载释放计时器。
 * @param {boolean} [options.events] 是否启用生产SSE；离线目标测试可显式关闭。
 * @returns {object} ready/refresh/retry/idle/dispose生命周期，卸载不会重新发布。
 */
export function installSharedShortcutsClient({ shortcuts, fetchImpl = globalThis.fetch, notifyError = () => {}, schedule = setTimeout, cancelSchedule = clearTimeout, events = true } = {}) {
  if (!shortcuts?.edit || !shortcuts?.config?.subscribe || !shortcuts?.catalog?.subscribe || !shortcuts?.describeBinding) throw new Error('官方快捷键服务未就绪')
  const profile = `${shortcuts.runtime}:${shortcuts.platform}` // 当前窗口官方提供的设备profile，不由后端文档重定向。
  let disposed = false // 卸载后阻止网络、配置和迟到回调。
  let remote = null // 服务端权威revision/document，不把本地随机revision当作全局CAS。
  let applying = 0 // 远端逐项采用期间禁止把中间态反向发布。
  let baseline = false // 初次官方本地读入不能被误判为管理员编辑。
  let lastLocal = copy(shortcuts.config.getSnapshot().document) // 上一次公开已接受原始override快照。
  let lastStatus = shortcuts.config.getSnapshot().status // 区分初次loading→ready和后续真实编辑。
  let work = Promise.resolve() // 回读、采用和CAS保存串行处理，减少失序与覆盖。
  let streamController = null // 唯一当前同源SSE连接。
  let streamReader = null // 公开标准reader，卸载时连同正在等待的读取一起取消。
  let reconnectTimer = null // 卸载时释放的单个重连计时器。
  let errorText = '' // 相同故障不重复弹提示；成功恢复清除去重基线。
  const pending = new Map() // 管理员尚未全局持久化的明确指令差异，失败不静默丢弃。
  const requests = new Set() // 当前请求AbortController，卸载全部取消。

  /** @param {string} message 脱敏用户提示 @returns {void} 去重并公开保存/采用失败。 */
  const fail = message => { if (!disposed && message !== errorText) { errorText = message; notifyError(message) } }
  /** @param {Function} operation 串行任务 @returns {Promise<void>} 当前任务完成，错误转可见安全提示。 */
  const enqueue = operation => {
    work = work.then(async () => { if (!disposed) await operation() }).catch(() => fail('共享快捷键暂不可用，请重试'))
    return work
  }
  /** @param {'GET'|'PUT'} method 固定同源方法 @param {object} [body] 管理员CAS偏好 @returns {Promise<object>} 权威信封。 */
  const request = async (method, body) => {
    const controller = new AbortController() // 单次请求生命周期，不沿用旧stream身份。
    requests.add(controller)
    const timeout = schedule(() => controller.abort(), REQUEST_TIMEOUT_MS) // 故障请求不能无限等待。
    try {
      const response = await fetchImpl(POLICY_URL, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      if (!response.ok) {
        const error = new Error(response.status === 409 ? 'conflict' : 'unavailable') // 不读取任意上游异常正文。
        error.status = response.status
        throw error
      }
      const reader = response.body?.getReader?.() // 同源Host回应仍按有限JSON预算逐块读取。
      if (!reader) throw new Error('response body unavailable')
      const decoder = new TextDecoder() // 跨字节块保持UTF-8完整性。
      let size = 0 // 已接受的响应字节数，超限立即取消。
      let raw = '' // 有界JSON文本，不分配任意大文档。
      try {
        while (!disposed && !controller.signal.aborted) {
          const { done, value } = await reader.read() // 纯临时响应字节。
          if (done) break
          size += value.byteLength
          if (size > MAXIMUM_BYTES) throw new Error('response too large')
          raw += decoder.decode(value, { stream: true })
        }
      } finally { await reader.cancel().catch(() => {}) }
      const accepted = shortcutEnvelope(JSON.parse(raw + decoder.decode())) // 必须校验完整契约后才能推进全局基线。
      if (response.headers?.get?.('X-AdminSmart-UI-Policy-Delivery') === 'delayed') fail('快捷键已保存，实时同步暂有延迟')
      return accepted
    } finally { cancelSchedule(timeout); requests.delete(controller) }
  }
  /** @returns {Set<string>} 当前已注册的可编辑官方命令，固定与未知指令始终跳过。 */
  const editable = () => {
    const fixed = new Set((shortcuts.fixedCatalog?.getSnapshot?.() ?? []).map(row => row.id)) // 固定动作不能仅按id前缀判断。
    return new Set(shortcuts.catalog.getSnapshot().map(row => row.id).filter(id => IDS.has(id) && !fixed.has(id)))
  }
  /** @param {object} operation 仅set/reset官方编辑 @returns {Promise<void>} 每项保存由官方revision和冲突边界确认。 */
  const edit = async operation => {
    if (disposed) return
    const result = await shortcuts.edit(operation, shortcuts.config.getSnapshot().revision) // 当前公开accepted本地revision，不伪造远端编号。
    if (disposed) return
    if (result.status !== 'saved') throw new Error(result.status)
  }
  /** @returns {Promise<void>} 将当前已挂载可编辑目标采用到官方服务，不接触内部Store。 */
  const adopt = async () => {
    if (!remote?.document || disposed || shortcuts.config.getSnapshot().status !== 'ready') return
    const target = remote.document.profiles[profile] ?? {} // 此设备未指定命令意味着官方默认，null仍是显式关闭。
    const current = shortcuts.config.getSnapshot().document.profiles[profile] ?? {} // 用原始override成员关系判断差异。
    const ids = [...editable()].filter(id => !pending.has(id) && (Object.hasOwn(current, id) !== Object.hasOwn(target, id) || stable(current[id]) !== stable(target[id]))) // 休眠命令等catalog挂载，管理员未保存草稿不被远端回读覆盖。
    for (const id of ids) {
      if (target[id] != null && shortcuts.describeBinding(target[id]).issue !== null) throw new Error('unsupported')
    }
    applying += 1
    try {
      for (const id of ids) {
        if (disposed) return
        const row = shortcuts.catalog.getSnapshot().find(item => item.id === id) // 当前真实有效绑定用于判断是否需释放互换占用。
        if (row?.binding !== null && row?.binding !== undefined && (target[id] == null || bindingKey(shortcuts, row.binding) !== bindingKey(shortcuts, target[id]))) await edit({ type: 'set', id, binding: null })
      }
      for (const id of ids.filter(id => !Object.hasOwn(target, id))) { if (disposed) return; await edit({ type: 'reset', id }) }
      for (const id of ids.filter(id => Object.hasOwn(target, id))) { if (disposed) return; await edit({ type: 'set', id, binding: target[id] }) }
      errorText = ''
    } catch {
      fail('部分共享快捷键尚未应用，当前组合可能冲突，请重试')
    } finally { lastLocal = copy(shortcuts.config.getSnapshot().document); applying -= 1 }
  }
  /** @returns {Promise<void>} 回读真源，迟到旧响应不能覆盖已接受新修订。 */
  const read = async () => {
    const accepted = await request('GET') // 数据库GET是唯一权威，SSE只驱动失效。
    if (disposed || (remote && accepted.revision < remote.revision)) return
    remote = accepted
    baseline = true
    await adopt()
  }
  /** @returns {Promise<void>} 串行合并管理员明确差异，CAS冲突要求重新查看，不静默覆盖。 */
  const publish = async () => {
    if (!pending.size || disposed || !baseline || remote?.writable !== true) return
    const changes = new Map(pending) // 此次保存固定差异；请求期间的新编辑在下一次CAS处理。
    const local = copy(shortcuts.config.getSnapshot().document) // 首次发布可沿用管理员已有合法偏好。
    const document = mergeShortcutChanges(remote.document, local, profile, changes) // 不抹除服务端休眠或其他设备偏好。
    try {
      const accepted = await request('PUT', { expectedRevision: remote.revision, document })
      if (disposed) return
      if (accepted.revision <= remote.revision) throw new Error('invalid revision')
      for (const [id, change] of changes) if (stable(pending.get(id)) === stable(change)) pending.delete(id)
      remote = accepted
      await adopt()
      errorText = ''
    } catch (error) {
      if (error.status === 409) {
        const winner = await request('GET') // 同origin原生storage事件可能让多个管理员窗口发布同一份文档，先读取真正已保存结果。
        if (disposed) return
        if (winner.revision < remote.revision) throw new Error('invalid winner revision')
        const latestChanges = new Map(pending) // 409回读期间可能产生后续真实编辑，不能一并当作旧草稿清除。
        const latestDraft = mergeShortcutChanges(remote.document, shortcuts.config.getSnapshot().document, profile, latestChanges) // 当前完整欲发布文档仍保留休眠与其他设备区域。
        const matchesLatest = stable(winner.document) === stable(latestDraft) // 只按完整文档判断重复保存，不以当前一条键位掩盖其他管理员差异。
        const matchesSubmitted = stable(winner.document) === stable(document) // 本次旧请求可能已被另一窗口保存，后续新草稿仍独立存在。
        remote = winner
        baseline = true
        if (matchesLatest || matchesSubmitted) {
          const matchedChanges = matchesLatest ? latestChanges : changes // 只清理已经与数据库真源匹配的那批明确编辑。
          for (const [id, change] of matchedChanges) if (stable(pending.get(id)) === stable(change)) pending.delete(id)
          errorText = ''
          notifyError('') // 已保存的同文档收敛同时清除旧错误提示，不产生空错误框。
          await adopt()
        } else {
          pending.clear() // 真正不同的胜出文档不能被旧排队草稿自动覆盖。
          await adopt()
          fail('快捷键已由其他管理员更新，请查看新设置后重新编辑')
        }
      } else fail('全局快捷键保存失败，本地选择尚未同步；请重试保存')
    }
  }
  /** @returns {void} 比较真实document差异；catalog/local revision变化不等于用户编辑。 */
  const configChanged = () => {
    const snapshot = shortcuts.config.getSnapshot() // 官方公开accepted快照，不能读取浏览器底层存储。
    const previous = lastLocal.profiles[profile] ?? {} // 前一份已接受当前设备override。
    const next = snapshot.document.profiles[profile] ?? {} // 新已接受当前设备override。
    const previouslyReady = lastStatus === 'ready' // 初次加载原有浏览器偏好不视作管理员发布动作。
    lastLocal = copy(snapshot.document)
    lastStatus = snapshot.status
    if (disposed || applying || !previouslyReady || snapshot.status !== 'ready') return
    const ids = editable() // 只有此窗口当前可编辑官方指令可构成管理差异。
    const changed = [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(id => ids.has(id) && (Object.hasOwn(previous, id) !== Object.hasOwn(next, id) || stable(previous[id]) !== stable(next[id]))) // 保留unset/null差异，不按展示文字读值。
    if (!changed.length) return
    if (remote?.writable === true) {
      for (const id of changed) pending.set(id, { present: Object.hasOwn(next, id), binding: next[id] === null ? null : next[id] === undefined ? undefined : copy(next[id]) })
      void enqueue(publish)
    } else if (baseline) void enqueue(adopt)
  }
  const offConfig = shortcuts.config.subscribe(configChanged) // 只听公开服务，不监听localStorage或修改官方原型。
  const offCatalog = shortcuts.catalog.subscribe(() => { if (!disposed && !applying) void enqueue(adopt) }) // 延迟挂载的已知命令首次出现后采用权威目标。
  const offFixed = shortcuts.fixedCatalog?.subscribe?.(() => { if (!disposed && !applying) void enqueue(adopt) }) ?? (() => {}) // 新固定动作出现时重新走官方冲突边界。

  /** @returns {Promise<void>} 一条有界同源SSE；断线和ready都回读数据库真源。 */
  const connect = async () => {
    if (disposed) return
    const controller = new AbortController() // 本次连接独立取消，不能覆盖旧GET请求。
    streamController = controller
    const timeout = schedule(() => controller.abort(), STREAM_TIMEOUT_MS) // 服务器停止响应时仍释放连接。
    try {
      const response = await fetchImpl(EVENTS_URL, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal })
      if (!response.ok || !response.body?.getReader) throw new Error('stream unavailable')
      const reader = response.body.getReader() // 标准流读入，不访问浏览器或后端凭据。
      streamReader = reader
      const decoder = new TextDecoder() // 以标准UTF-8增量解码SSE。
      let buffer = '' // 仅保留一个受限事件片段，卸载或断线丢弃。
      try {
        while (!disposed && !controller.signal.aborted) {
          const { done, value } = await reader.read() // 标准reader结果是纯临时传输字节。
          if (done) break
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/gu, '\n')
          if (buffer.length > MAXIMUM_EVENT_BYTES) throw new Error('stream too large')
          let boundary // 当前已完整收到的SSE帧边界。
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary) // 独立有限事件，不作为配置或脚本解释。
            buffer = buffer.slice(boundary + 2)
            const lines = frame.split('\n') // 标准SSE字段。
            const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() // 受控事件类型。
            if (!event) continue
            const data = JSON.parse(lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')) // 只允许无正文失效协议。
            if (['ready', 'resync'].includes(event) && record(data) && Object.keys(data).length === 0) void enqueue(read)
            else if (event === 'policy-invalidated' && record(data) && Object.keys(data).length === 2 && data.kind === 'shortcuts' && Number.isSafeInteger(data.revision) && data.revision > 0) {
              if (data.revision > (remote?.revision ?? 0)) void enqueue(read)
            } else throw new Error('invalid event')
          }
        }
      } finally { if (streamReader === reader) streamReader = null; await reader.cancel().catch(() => {}) }
    } catch { if (!disposed) fail('快捷键实时同步暂不可用，连接恢复后自动重读') }
    finally {
      cancelSchedule(timeout)
      if (streamController === controller) streamController = null
      if (!disposed) { reconnectTimer = schedule(() => { reconnectTimer = null; void connect() }, RECONNECT_MS); reconnectTimer?.unref?.() }
    }
  }
  const ready = enqueue(read) // 初次权威回读不等待用户打开设置，也不发布浏览器原有偏好。
  if (events) void connect()
  return {
    ready, // 调用方/目标测试可等待首次有限回读。
    refresh: () => enqueue(read), // SSE恢复和显式刷新使用同一串行真源读取。
    retry: () => enqueue(async () => { await publish(); await adopt() }), // 失败提示对应的明确重试，CAS仍保护远端管理员。
    idle: async () => { let previous; do { previous = work; await previous } while (previous !== work) }, // 等待已经排队的目标工作，无常驻睡眠或真实浏览器依赖。
    dispose() { disposed = true; offConfig(); offCatalog(); offFixed(); requests.forEach(controller => controller.abort()); streamController?.abort(); void streamReader?.cancel().catch(() => {}); if (reconnectTimer !== null) cancelSchedule(reconnectTimer); pending.clear() }, // 卸载释放监听、请求、流和重连；迟到结果不再采用。
  }
}
