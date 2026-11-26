// SPDX-License-Identifier: Apache-2.0
// 模块支持与设备授权分别判断；名称和自报开关不能提升服务器权限。
import { record } from './validation.ts'
export type ExtraReadMode = 'legacy' | 'ready' | 'incompatible'
export function remoteReadMode(value: unknown): { state: ExtraReadMode; fullMessages: boolean } {
  const extras = record(record(value)?.extras)
  const state = !extras || extras.schema === undefined ? 'legacy' : extras.schema === 1 ? 'ready' : 'incompatible'
  return { state, fullMessages: state === 'ready' && extras?.fullMessages === true }
}
