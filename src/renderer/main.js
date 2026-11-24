// SPDX-License-Identifier: Apache-2.0
import '@dsbot/bootstrap'
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { installLocale } from '@dsbot/client/i18n.js'
import { createLocale } from '@dsbot/ui/locale.js'
import { App } from './app.js'
import './shell.css'
installLocale(createLocale('zh-CN'))
document.documentElement.lang = 'zh-CN'
createRoot(document.getElementById('root')).render(h(App))
