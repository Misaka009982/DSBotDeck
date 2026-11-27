// SPDX-License-Identifier: Apache-2.0
// 正式构建与CI回归共用UI模块解析；只定位源码，不启动界面或服务。
import path from 'node:path'
import { normalizePath } from 'vite'
import { adaptUiSource, UI_PACKAGES } from './upstream.mjs'
/**
 * @param {string} clientRoot
 * @param {string} sourceRoot
 * @returns {import('vite').Plugin}
 */
export function uiResolver(clientRoot, sourceRoot) {
  return {
    name: 'dsbotdeck-ui-resolver',
    enforce: 'pre',
    async resolveId(specifier, importer) {
      const adapted = adaptUiSource(specifier, importer, clientRoot, sourceRoot)
      // Vite的相对导入使用正斜杠；Windows别名也必须返回相同ID，避免状态模块重复。
      if (adapted !== null) return normalizePath(adapted)
      const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      if (UI_PACKAGES.has(packageName) && importer && !importer.includes('/node_modules/')) {
        return this.resolve(specifier, normalizePath(path.join(clientRoot, 'src/renderer/main.js')), { skipSelf: true })
      }
      return null
    },
    buildEnd(error) {
      if (error) return
      const modules = new Map()
      for (const id of this.getModuleIds()) {
        if (id.startsWith('\0')) continue
        const canonical = normalizePath(id)
        const previous = modules.get(canonical)
        if (previous !== undefined && previous !== id) this.error(`同一UI模块出现不同路径身份：${previous} / ${id}`)
        modules.set(canonical, id)
      }
    },
  }
}
