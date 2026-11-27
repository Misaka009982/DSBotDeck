// SPDX-License-Identifier: Apache-2.0
// 主进程仅接收合并后的存活标志，文件与编辑内容留在隔离视图。
const pending = new Map()
export function draftPresence(source, active) {
  pending.set(source, active === true)
  window.dsbotContent?.drafts?.([...pending.values()].some(Boolean))
}
