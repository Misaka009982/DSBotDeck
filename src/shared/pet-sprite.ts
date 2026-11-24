// SPDX-License-Identifier: Apache-2.0
// Codex 原生精灵为每格 192×208、每行八格；只取远程任务事实对应的姿态。
import type { TaskColor } from './domain.ts'
export type PetPose = 'idle' | 'working' | 'waiting' | 'error' | 'success'
const POSES: Record<PetPose, { row: number; frames: number }> = {
  idle: { row: 0, frames: 6 }, working: { row: 7, frames: 6 }, waiting: { row: 6, frames: 6 }, error: { row: 5, frames: 8 }, success: { row: 8, frames: 6 },
}
export function petPose(tasks: readonly { color: TaskColor; cached: boolean }[]): PetPose {
  const live = new Set(tasks.filter(task => !task.cached).map(task => task.color))
  if (live.has('yellow')) return 'waiting'
  if (live.has('red')) return 'error'
  if (live.has('green')) return 'working'
  return live.has('blue') ? 'success' : 'idle'
}
export function spriteFrame(pose: PetPose, tick: number): { row: number; frame: number } {
  const state = POSES[pose]
  return { row: state.row, frame: Math.max(0, Math.floor(tick)) % state.frames }
}
