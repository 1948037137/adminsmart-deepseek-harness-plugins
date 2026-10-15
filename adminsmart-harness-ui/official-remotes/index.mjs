/** 固定官方Remote Client的只读资源及注册队列接线；不构造Host Controller或改写Boot Graph。 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

export const inject = ['webServer', 'clientModules'] // 注册队列提供方必须先active，保证index中的原script在官方__ModuleLoader__队列建立后登记；不依赖Controller自身。
const sdkRoot = String(process.env.ADMINSMART_DSH_ROOT ?? '').trim() // 与Gateway相同的固定发行包，不能从页面或RPC选择。
if (!sdkRoot) throw new Error('官方Remote Client运行依赖未配置')
const sdkRequire = createRequire(
  pathToFileURL(resolve(sdkRoot, 'package.json')),
) // 公开Client导出与版本信息统一从当前受管安装解析。
const packages = Object.freeze({
  workspace: '@deepseek-ai/dsh-api-workspace-controller', // 原始Workspace浏览器模块身份，与受管Host继承服务匹配。
  session: '@deepseek-ai/dsh-api-session-controller', // 原始Session浏览器模块身份，保留模型选择和会话协议。
})
export const OFFICIAL_REMOTE_CLIENT_PATHS = Object.freeze({
  workspace: '/adminsmart/official-remotes/workspace-client.js', // 唯一固定Workspace原始资源，没有文件参数。
  session: '/adminsmart/official-remotes/session-client.js', // 唯一固定Session原始资源，没有包名参数。
})
const artifacts = new Map() // 两个公开原始发布实体的生命周期快照，不包含用户配置或数据。
for (const [key, packageName] of Object.entries(packages)) {
  if (sdkRequire(packageName + '/package.json').version !== '0.2.1-alpha.3')
    throw new Error('官方Remote Client固定版本不匹配')
  const source = await readFile(sdkRequire.resolve(packageName + '/client')) // 只读公开发布文件，绝不修改或重新构建上游。
  artifacts.set(key, {
    source, // 原始经典script字节，继续以官方module ID登记factory。
    gzip: gzipSync(source), // 同一原字节的一次预压缩，避免重复请求压缩成本。
    revision: createHash('sha256').update(source).digest('hex'), // 只描述原始代码身份，不混入Runtime/用户政策修订。
  })
}
export const OFFICIAL_REMOTE_CLIENT_REVISIONS = Object.freeze(
  Object.fromEntries(
    [...artifacts].map(([key, value]) => [key, value.revision]),
  ),
) // 非敏感固定代码哈希供诊断及Client确认，不公开源码对象引用。

/**
 * 通过官方IndexInjection与HTTP协议提供两个固定原始Client实体。
 * @param {object} ctx 官方Host Context，当前fiber拥有注册和释放。
 * @returns {void} 不启动原Host Controller，不伪造Loader/Boot Graph行。
 * @sideEffects 头部parser-blocking script只登记官方factory；实际apply由独立Client wrapper同fiber执行。
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.on('webserver/index-inject', (table) => {
        table.push({
          kind: 'global', // 官方global先于后续script输出，不包含身份或凭据。
          name: '__ADMINSMART_OFFICIAL_REMOTE_CLIENT_REVISIONS__', // 只允许当前固定两模块的原字节SHA。
          value: OFFICIAL_REMOTE_CLIENT_REVISIONS, // 无用户数据的可信代码元信息。
        })
        for (const key of Object.keys(packages))
          table.push({
            kind: 'script-src', // 官方经典script载入协议，served为parser-blocking，worker为awaited执行。
            placement: 'head', // 原始应用module启动前完成登记；不改写HTML或公共Graph对象。
            src:
              '.' +
              OFFICIAL_REMOTE_CLIENT_PATHS[key] +
              '?rev=' +
              OFFICIAL_REMOTE_CLIENT_REVISIONS[key], // 固定同源路径与可信哈希，页面输入无法换文件。
          })
      }),
    'adminsmart-official-remotes: original registration scripts',
  )
  for (const [key, artifact] of artifacts)
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'exact', // 不提供任意SDK包或目录映射。
          path: OFFICIAL_REMOTE_CLIENT_PATHS[key], // 当前原始实体唯一受管入口。
          handler(request, response) {
            if (!['GET', 'HEAD'].includes(request.method)) {
              response.writeHead(405, {
                allow: 'GET, HEAD',
                'cache-control': 'no-store',
              })
              response.end()
              return
            }
            const revisions = new URL(
              request.url || OFFICIAL_REMOTE_CLIENT_PATHS[key],
              'http://runtime.invalid',
            ).searchParams.getAll('rev') // URL只作身份比较，不决定源文件。
            if (
              revisions.length > 1 ||
              (revisions.length === 1 && revisions[0] !== artifact.revision)
            ) {
              response.writeHead(410, { 'cache-control': 'no-store' })
              response.end()
              return
            }
            const encoded = String(request.headers?.['accept-encoding'] ?? '')
              .split(',')
              .some((part) => {
                const [name, ...parameters] = part
                  .trim()
                  .toLowerCase()
                  .split(';') // 编码与可选质量参数只决定相同实体的传输格式。
                const quality = parameters
                  .find((value) => value.trim().startsWith('q='))
                  ?.trim()
                  .slice(2) // 显式gzip;q=0不得压缩。
                return (
                  name === 'gzip' &&
                  (quality === undefined || Number(quality) > 0)
                )
              })
            const source = encoded ? artifact.gzip : artifact.source // 两种编码拥有相同解压后SHA。
            response.writeHead(200, {
              'content-type': 'text/javascript; charset=utf-8', // 固定原始经典script MIME。
              'content-length': String(source.byteLength), // GET与HEAD使用相同编码实体长度。
              'cache-control': revisions.length
                ? 'private, max-age=31536000, immutable'
                : 'no-store', // 只缓存可信版本代码，legacy不缓存。
              vary: 'Accept-Encoding', // 浏览器私有缓存区分传输编码。
              'x-content-type-options': 'nosniff', // 禁止类型嗅探。
              ...(encoded ? { 'content-encoding': 'gzip' } : {}), // 明确压缩实体，未接受编码则原字节返回。
            })
            response.end(request.method === 'HEAD' ? undefined : source)
          },
        }),
      'adminsmart-official-remotes: fixed original ' + key,
    )
}
