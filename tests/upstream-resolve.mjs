// SPDX-License-Identifier: Apache-2.0
// 测试只读使用同一个上游源码；不安装 harness 或加载真实用户数据。
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const source = path.resolve(root, process.env.DSBOT_SOURCE || '../DS-Bot')
const aliases = {
  '@dsbot/link': 'link/src/index.ts', '@dsbot/notices': 'mobile/src/team/notices.ts',
  '@dsbot/characters': 'ds-bot/src/client/characters.js', '@dsbot/themes': 'ds-bot/src/client/themes.js',
  '@dsbot/gated': 'mobile/src/team/gated.ts', '@dsbot/browser-policy': 'ds-bot/src/shared/browser-endpoints.js',
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(aliases, specifier)) return nextResolve(pathToFileURL(path.join(source, aliases[specifier])).href, context)
    if (context.parentURL?.startsWith(pathToFileURL(source + path.sep).href) && (specifier.startsWith('@noble/') || specifier.startsWith('@lukeburns/'))) {
      return nextResolve(specifier, { ...context, parentURL: pathToFileURL(path.join(root, 'package.json')).href })
    }
    return nextResolve(specifier, context)
  },
})
