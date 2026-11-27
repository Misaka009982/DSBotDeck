// SPDX-License-Identifier: Apache-2.0
import '@dsbot/bootstrap'
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { installLocale } from '@dsbot/client/i18n.js'
import { createDeckLocale } from './locale-service.js'
import { App } from './app.js'
import './shell.css'
installLocale(createDeckLocale('zh-CN'))
document.documentElement.lang = 'zh-CN'
createRoot(document.getElementById('root')).render(h(App))
