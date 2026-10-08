/** 业务集成只从同一固定安装树解析 Harness 公开入口，不包含文件解析实现。 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
export const runtimeRoot = resolve(process.env.ADMINSMART_DSH_ROOT || fileURLToPath(new URL('../../../deepseek-harness-runtime/', import.meta.url))) // Gateway 在真实 Runtime 中显式注入共享安装根；开发默认保持可移植。
export const runtimeRequire = createRequire(resolve(runtimeRoot, 'package.json')) // 所有第三方模块来自同一安装树。
/** @param {string} name 公开包名 @returns {Promise<object>} 对应官方或已固定依赖的导出。 */
export function loadRuntimeModule(name) {
  return import(pathToFileURL(runtimeRequire.resolve(name)).href)
}
