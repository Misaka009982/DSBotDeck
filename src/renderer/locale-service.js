// SPDX-License-Identifier: Apache-2.0
// 语言由 Deck 的本机设置统一管理，原网页 localStorage 偏好不能覆盖它。
import { createLocale } from '@dsbot/ui/locale.js'
export const createDeckLocale = tag => createLocale(tag, { storage: null })
