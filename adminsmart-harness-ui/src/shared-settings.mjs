/** 共享 Settings 双面插件的 Host：保留官方 Schema/生命周期，仅提供原始官方 Client 资源。 */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const configuredRoot = String(process.env.ADMINSMART_DSH_ROOT ?? '').trim() // Gateway 指定的同一固定 SDK 安装，不能绑定本机用户名或缓存目录。
if (!configuredRoot) throw new Error('AdminSmart Settings runtime root is missing')
const runtimeRequire = createRequire(pathToFileURL(resolve(configuredRoot, 'package.json'))) // 所有官方模块只从当前固定运行安装解析。
const officialHost = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-client-ui-settings')).href) // 官方公开 Host apply 与 Config，不读取或复制私有源码。
const officialClientPath = runtimeRequire.resolve('@deepseek-ai/dsh-client-ui-settings/client') // 唯一允许响应的公开原始 Client 发布文件。
const officialClientSource = await readFile(officialClientPath) // 当前固定安装的公开原字节，按 Runtime 生命周期复用，不包含策略或凭据。
const officialClientGzip = gzipSync(officialClientSource) // 一次生成完整 gzip 编码，后续请求不会反复压缩。
export const OFFICIAL_SETTINGS_CLIENT_REVISION = createHash('sha256').update(officialClientSource).digest('hex') // 官方源码字节的可信版本身份，换安装字节后必须换 URL。

export const Config = officialHost.Config // Profile通过公开insert使用owned entry ID，原生enabled Schema完全继承官方定义。
export const inject = ['webServer'] // 原始 Client 资源通过官方受控同源 Web 服务注册。
export const OFFICIAL_SETTINGS_CLIENT_ROUTE = '/adminsmart/shared-settings/official-client.js' // 固定资源入口，不允许浏览器选择包名或服务器路径。

/**
 * 注册官方 Settings Host 与其未修改的 Client 资源。
 * @param {object} ctx 官方 Host Context，提供 webServer 与可选 settings。
 * @param {object} config 经官方 Config 解析的原生参数。
 * @returns {void} 路由和原生设置注册由当前 fiber 生命周期清理。
 * @sideEffects 不改写上游文件；GET/HEAD 仅读固定公开 Client 导出字节。
 */
export function apply(ctx, config) {
  officialHost.apply(ctx, config)
  ctx.effect(() => ctx.on('webserver/index-inject', table => {
    const source = '.' + OFFICIAL_SETTINGS_CLIENT_ROUTE + '?rev=' + OFFICIAL_SETTINGS_CLIENT_REVISION // 与后续经典script完全相同的同源URL和凭据模式，浏览器可复用预载响应。
    if (!table.some(row => row.kind === 'script-preload' && row.src === source))
      table.unshift({ kind: 'script-preload', src: source }) // 只下载原始官方代码、不执行factory、不请求策略；置于已有阻塞script之前让HTML扫描器尽早发现。
    table.push({
      kind: 'global', // 官方先渲染安全启动元数据，再运行 Client。
      name: '__ADMINSMART_SHARED_SETTINGS_CLIENT_REVISION__', // Client 只据此选固定资源版本，不接受用户参数作为授权。
      value: OFFICIAL_SETTINGS_CLIENT_REVISION, // 非敏感公开代码哈希，不含 Runtime/用户身份。
    })
  }), 'adminsmart-shared-settings: trusted static revision')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', // 不提供任意 SDK 文件或目录映射。
    path: OFFICIAL_SETTINGS_CLIENT_ROUTE, // 原始 Client 代码仍以其官方模块身份登记。
    async handler(request, response) {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' })
        response.end()
        return
      }
      try {
        const revision = new URL(request.url || OFFICIAL_SETTINGS_CLIENT_ROUTE, 'http://runtime.invalid').searchParams.get('rev') // 只比较当前固定资源哈希；查询不能改变文件路径。
        if (revision !== null && revision !== OFFICIAL_SETTINGS_CLIENT_REVISION) {
          response.writeHead(410, { 'cache-control': 'no-store' })
          response.end()
          return
        }
        const acceptsGzip = String(request.headers?.['accept-encoding'] || '').split(',').some(part => {
          const [encoding, ...parameters] = part.trim().toLowerCase().split(';') // 当前编码和 q 参数仅用于选择相同源码字节的传输格式。
          const quality = parameters.find(parameter => parameter.trim().startsWith('q='))?.trim().slice(2) // 显式 q=0 必须尊重，不能返回 gzip。
          return encoding === 'gzip' && (quality === undefined || Number(quality) > 0)
        })
        const source = acceptsGzip ? officialClientGzip : officialClientSource // 两种编码都由同一公开源码快照生成。
        response.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8', // 官方公开 Client 脚本原格式。
          'cache-control': revision === OFFICIAL_SETTINGS_CLIENT_REVISION ? 'private, max-age=31536000, immutable' : 'no-store', // 仅可信版本 URL 可缓存，旧入口仍不缓存。
          'content-length': String(source.byteLength), // HEAD 与 GET 具有一致的完整编码实体大小。
          'x-content-type-options': 'nosniff', // 浏览器只按脚本资源使用返回字节。
          vary: 'Accept-Encoding', // private 缓存必须区分编码变体。
          ...(acceptsGzip ? { 'content-encoding': 'gzip' } : {}), // 不支持 gzip 的请求保留原字节。
        })
        response.end(request.method === 'HEAD' ? undefined : source)
      } catch {
        response.writeHead(503, { 'cache-control': 'no-store' })
        response.end()
      }
    },
  }), 'adminsmart-shared-settings: original official client resource')
}
