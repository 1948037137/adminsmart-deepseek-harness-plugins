/** 当前业务会话的文件授权；子会话只能沿 Host 验证过的官方父子关系继承。 */

const parentResolvers = new WeakMap() // 以官方 Session 对象绑定可信父解析器，不接受模型提供的会话 ID。

/**
 * 判断会话是否声明了子代理身份，异常深度也必须进入最小权限校验。
 * @param {object} session 官方 Session；只读取不可变 header。
 * @returns {boolean} 子代理标记或非零委派深度是否存在。
 * @sideEffects 无。
 */
export function isDelegatedSession(session) {
  return session?.header?.origin === 'subagent' || (session?.header?.delegationDepth ?? 0) !== 0
}

/**
 * 为官方创建事件中的子会话绑定可信父解析器。
 * @param {object} session 已发布的官方子 Session 对象。
 * @param {() => object | undefined} resolveParent 每次重新验证 live 身份与运行时归属，失败返回 undefined。
 * @returns {() => void} 只移除本次绑定的幂等清理函数。
 * @throws {Error} 绑定对象或解析器无效时拒绝授权。
 * @sideEffects 只写入进程内弱引用表，不存储文件正文或持久化会话。
 */
export function bindSessionParent(session, resolveParent) {
  if (!isDelegatedSession(session) || typeof resolveParent !== 'function') throw new Error('子会话授权上下文无效')
  parentResolvers.set(session, resolveParent)
  return () => {
    if (parentResolvers.get(session) === resolveParent) parentResolvers.delete(session)
  }
}

/**
 * 解析当前附件授权的会话集合，不遍历祖先、兄弟或用户指定的 ID。
 * @param {object} session 当前工具执行携带的官方 Session。
 * @returns {object[]} 主会话仅返回自身；已验证的一层子会话返回父、自身。
 * @throws {Error} 子会话未绑定、父失效、自指或出现更深委派时拒绝所有继承。
 * @sideEffects 仅读取可信解析器提供的 live 对象，不读取网络或用户正文。
 */
export function authorizedSessionFamily(session) {
  if (!session) throw new Error('当前会话身份不可用')
  if (!isDelegatedSession(session)) return [session]
  const parent = parentResolvers.get(session)?.() // 父会话必须由受管注册表重新解析，不能信任模型传参或缓存 ID。
  if (!parent || parent === session || isDelegatedSession(parent)
    || session.header.origin !== 'subagent' || session.header.delegationDepth !== 1
    || session.header.parentSession !== parent.id) throw new Error('子会话的可信父会话不可用')
  return [parent, session]
}
