// SPDX-License-Identifier: Apache-2.0
// 正式构建与CI回归共用UI模块解析；只定位源码，不启动界面或服务。
import path from 'node:path'
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
      if (adapted !== null) return adapted
      const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
      if (UI_PACKAGES.has(packageName) && importer && !importer.includes('/node_modules/')) {
        return this.resolve(specifier, path.join(clientRoot, 'src/renderer/main.js'), { skipSelf: true })
      }
      return null
    },
  }
}
