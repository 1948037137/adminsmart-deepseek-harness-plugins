/** 共享 Settings 双面插件的 Host：保留官方 Schema/生命周期，仅提供原始官方 Client 资源。 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const configuredRoot = String(process.env.ADMINSMART_DSH_ROOT ?? '').trim() // Gateway 指定的同一固定 SDK 安装，不能绑定本机用户名或缓存目录。
if (!configuredRoot) throw new Error('AdminSmart Settings runtime root is missing')
const runtimeRequire = createRequire(pathToFileURL(resolve(configuredRoot, 'package.json'))) // 所有官方模块只从当前固定运行安装解析。
const officialHost = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-client-ui-settings')).href) // 官方公开 Host apply 与 Config，不读取或复制私有源码。
const officialClientPath = runtimeRequire.resolve('@deepseek-ai/dsh-client-ui-settings/client') // 唯一允许响应的公开原始 Client 发布文件。

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
        const source = await readFile(officialClientPath) // 每次读取当前固定安装的原字节，不生成自有副本或修改工厂。
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        response.end(request.method === 'HEAD' ? undefined : source)
      } catch {
        response.writeHead(503, { 'cache-control': 'no-store' })
        response.end()
      }
    },
  }), 'adminsmart-shared-settings: original official client resource')
}
