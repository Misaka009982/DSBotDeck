// SPDX-License-Identifier: Apache-2.0
// 灯与气泡边界单独记录，主体悬停不能展开面板。
import type { TaskColor } from './domain.ts'
export const PET_HIDE_DELAY_MS = 10000
export class PetHover {
  private expanded: TaskColor | null = null
  private inside = false
  private deadline: number | null = null
  color(): TaskColor | null { return this.expanded }
  closeAt(): number | null { return this.deadline }
  pointer(lamp: TaskColor | null, inPanel: boolean, now: number): void {
    if (lamp !== null) this.expanded = lamp
    this.inside = lamp !== null || inPanel
    if (this.expanded === null || this.inside) this.deadline = null
    else if (this.deadline === null) this.deadline = now + PET_HIDE_DELAY_MS
  }
  close(): void { this.expanded = null; this.deadline = null }
  expire(now: number): boolean {
    if (this.deadline === null || now < this.deadline) return false
    this.close(); return true
  }
}
