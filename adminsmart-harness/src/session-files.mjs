import { authorizedSessionFamily } from './session-authority.mjs'

/**
 * 从官方会话事件收集用户发送及受管知识桥接产生的文件引用，不解析文件内容。
 * @param {object} session 当前官方 live Session；子代理必须已绑定可信直接父会话。
 * @returns {Map<string,object>} 以原生附件身份和名称去重的引用集合。
 * @throws {Error} 子代理的 live 父会话无法验证时拒绝全部继承。
 */
export function sessionFiles(session) {
  const files = new Map() // 文件身份只来自已接受的官方事件，不接受模型提供的路径或附件身份。
  const messageContent = data => Array.isArray(data?.content) ? data.content : Array.isArray(data?.message?.content) ? data.message.content : [] // 兼容官方直接消息和历史包装消息。
  const collect = blocks => {
    for (const block of blocks ?? []) {
      if (['file', 'image'].includes(block?.type) && block.attachment?.attachmentId) files.set(`${block.attachment.attachmentId}\0${block.attachment.name ?? ''}`, block.attachment)
      else if (block?.type === 'tool-result') collect(block.content)
    }
  } // 仅提取结构化附件引用，绝不执行附件文字或解析 Office/PDF。
  for (const current of authorizedSessionFamily(session)) {
    const calls = new Set() // 每个会话分别绑定真实知识原件桥接调用。
    for (const event of current.snapshotEvents()) {
      if (event.type === 'tool/call' && event.data?.name === 'load_knowledge_files') calls.add(String(event.data.callId))
      else if (event.type === 'user/message') collect(messageContent(event.data))
      else if (event.type === 'tool/result') {
        for (const block of messageContent(event.data)) {
          if (block?.type === 'tool-result' && calls.has(String(block.toolCallId))) collect(block.content)
        }
      }
    }
  }
  return files
}
