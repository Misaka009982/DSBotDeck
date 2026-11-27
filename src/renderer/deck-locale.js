// SPDX-License-Identifier: Apache-2.0
// 复用原词典，在本机语言变更后重新渲染；不设置服务器 prefs 或翻译会话正文。
import { useLayoutEffect, useState } from 'react'
import { installLocale } from '@dsbot/client/i18n.js'
import { createDeckLocale } from './locale-service.js'
export function useDeckLocale(language = 'system') {
  const tag = language === 'system' ? navigator.language : language
  const [installed, setInstalled] = useState(null)
  useLayoutEffect(() => {
    const locale = createDeckLocale(tag)
    const dispose = installLocale(locale)
    document.documentElement.lang = locale.getLocale().active
    setInstalled(tag)
    return dispose
  }, [tag])
  // 切换语言只重绘原组件，不卸载聊天，以免清掉草稿、滚动位置或打开的参数页。
  return installed !== null
}
