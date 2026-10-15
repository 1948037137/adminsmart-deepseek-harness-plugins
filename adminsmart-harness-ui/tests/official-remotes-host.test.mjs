/** 固定官方Client资源的真实原字节/缓存/Head/版本与公开IndexInjection目标，不调用业务API。 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { apply, inject, OFFICIAL_REMOTE_CLIENT_PATHS, OFFICIAL_REMOTE_CLIENT_REVISIONS } from '../official-remotes/index.mjs'

const sdkRequire = createRequire(pathToFileURL(join(process.env.ADMINSMART_DSH_ROOT, 'package.json'))) // 与Host同一固定公开安装，不读用户目录或凭据。
const { renderIndexInjections } = await import(pathToFileURL(sdkRequire.resolve('@deepseek-ai/dsh-host-webserver')).href) // 使用原官方HTML渲染验证经典script协议，不手写HTML模板替代。

/** @returns {object} 本测试拥有的HTTP响应，不连接真实服务。 */
function responseFixture() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = body } }
}

test('独立Host仅登记两原始Client实体和官方script-src，不装Controller/伪造Graph，字节与缓存契约完整', async () => {
  const routes = new Map() // 实际公开WebServer注册的固定路由集合。
  const cleanups = [] // 本Host所有副作用必须释放，不能留永久监听。
  let onIndex // 官方结构化启动表监听器，测试只传合成表。
  apply({
    effect(register) { const dispose = register(); cleanups.push(dispose); return dispose },
    on(event, listener) { assert.equal(event, 'webserver/index-inject'); onIndex = listener; return () => { onIndex = undefined } },
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
    plugin() { throw new Error('Client-only wrapper不得装原Host Controller') },
  })
  try {
    assert.deepEqual(inject, ['webServer', 'clientModules']) // 原始registration queue必须先就绪，不能依赖偶然Host激活顺序。
    assert.equal(routes.size, 2)
    const table = [] // 原始Graph保持由官方ClientModules所有，wrapper只追加公开资源注册声明。
    onIndex(table)
    assert.equal(table.some(row => row.kind === 'global' && row.name === '__DSH_BOOT__'), false)
    assert.deepEqual(table[0], { kind: 'global', name: '__ADMINSMART_OFFICIAL_REMOTE_CLIENT_REVISIONS__', value: OFFICIAL_REMOTE_CLIENT_REVISIONS })
    const html = renderIndexInjections('<html><head></head><body><script type="module" src="application.js"></script></body></html>', table) // 原始应用module开始前，两个parser-blocking经典script都在head完成。
    for (const key of ['workspace', 'session']) {
      const path = OFFICIAL_REMOTE_CLIENT_PATHS[key] // 精确公开入口，不能被URL替换成本机任意文件。
      const revision = OFFICIAL_REMOTE_CLIENT_REVISIONS[key] // 原SDK字节SHA，与全站政策CAS无关。
      assert.match(revision, /^[a-f0-9]{64}$/u)
      assert.ok(html.indexOf(path) < html.indexOf('application.js'))
      const source = await readFile(sdkRequire.resolve(`@deepseek-ai/dsh-api-${key}-controller/client`)) // 对照当前固定原始发布文件。
      const route = routes.get(path) // 真正由当前Host注册的handler。
      for (const method of ['GET', 'HEAD']) for (const encoding of ['gzip', 'gzip;q=0']) {
        const response = responseFixture() // 每个方法/编码独立响应实体。
        route.handler({ method, url: path + '?rev=' + revision, headers: { 'accept-encoding': encoding } }, response)
        assert.equal(response.status, 200)
        assert.equal(response.headers['cache-control'], 'private, max-age=31536000, immutable')
        assert.equal(response.headers.vary, 'Accept-Encoding')
        assert.equal(response.headers['content-encoding'], encoding === 'gzip' ? 'gzip' : undefined)
        if (method === 'GET') {
          assert.deepEqual(encoding === 'gzip' ? gunzipSync(response.body) : response.body, source)
          assert.equal(Number(response.headers['content-length']), response.body.byteLength)
        } else assert.equal(response.body, undefined)
      }
      for (const suffix of ['', '?rev=', '?rev=unknown', '?rev=' + revision + '&rev=' + revision]) {
        const response = responseFixture() // 错/重复版本必须拒绝，旧legacy入口必须不缓存。
        route.handler({ method: 'GET', url: path + suffix }, response)
        assert.equal(response.status, suffix === '' ? 200 : 410)
        assert.equal(response.headers['cache-control'], 'no-store')
      }
      const rejected = responseFixture() // 公开固定代码入口没有任何写入操作。
      route.handler({ method: 'PUT', url: path }, rejected)
      assert.equal(rejected.status, 405)
      assert.equal(rejected.headers['cache-control'], 'no-store')
    }
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup()
    assert.equal(routes.size, 0)
    assert.equal(onIndex, undefined)
  }
})
