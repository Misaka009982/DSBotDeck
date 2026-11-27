// SPDX-License-Identifier: Apache-2.0
// 复用上游所有样式、语言与动效安装，再挂载独立远程入口。
import '@dsbot/bootstrap'
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { installLocale } from '@dsbot/client/i18n.js'
import { createDeckLocale } from '../renderer/locale-service.js'
import { App } from './app.js'
import './remote.css'
installLocale(createDeckLocale('zh-CN'))
document.documentElement.lang = 'zh-CN'
createRoot(document.getElementById('root')).render(h(App))
