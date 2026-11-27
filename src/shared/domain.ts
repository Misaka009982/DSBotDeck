// SPDX-License-Identifier: Apache-2.0
// 私密配置仅主进程使用；Snapshot 不包含身份、令牌或配对码。
export type TaskColor = 'green' | 'yellow' | 'red' | 'blue'
export type EntityKind = 'bot' | 'room'
export type LinkState = 'unpaired' | 'connecting' | 'ready' | 'reconnecting' | 'disconnected' | 'needs-pairing' | 'incompatible'
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type BotResult<T = unknown> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
export interface Point { x: number; y: number }
export interface Bounds extends Point { width: number; height: number }
export interface WindowState extends Bounds { maximized: boolean }
export interface Identity { deviceId: string; publicKey: string; privateKey: string; accessToken: string }
export interface SavedServer {
  id: string
  alias: string
  relayUrl: string
  hostDeviceId: string
  hostKey: string
  mode: 'phone' | 'browser'
  identity: Identity
  paired: boolean
  autoConnect: boolean
  unfollowed: string[]
}
export interface RelayChangeResult { relay: string; connected: boolean; message: string | null }
export interface Selection { serverId: string; kind: EntityKind; id: string }
export interface LocalMark { shape: string; color: string }
export interface BuiltinIcon { look: LocalMark; png: string }
export interface PetSettings { enabled: boolean; locked: boolean; alwaysOnTop: boolean; position: Point | null; skin: string | null; size: number; mark: LocalMark | null }
export type UiLanguage = 'zh' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'es' | 'fr' | 'de' | 'system'
export type ThemeMode = 'system' | 'light' | 'dark'
export interface ThemeSettings { theme: string; themeMode: ThemeMode }
export interface BackgroundCrop { cx: number; cy: number; zoom: number }
export interface AppearanceSettings extends ThemeSettings {
  language: UiLanguage
  iconPath: string | null
  builtinIcon: BuiltinIcon | null
  backgroundPath: string | null
  backgroundCrop: BackgroundCrop | null
  petLibraryPath: string | null
  opacity: number
  blur: number
  fit: 'cover' | 'contain'
}
export type AppearanceView = Omit<AppearanceSettings, 'builtinIcon'> & { builtinIcon: { look: LocalMark } | null }
export interface PetSkinView { key: string; name: string; rows: number; url: string }
export interface LocalAssetsView {
  revision: string
  icon: string | null
  iconNeedsRaster: boolean
  background: string | null
  libraryPath: string
  pets: { key: string; name: string; available: boolean; error: string | null }[]
  selected: PetSkinView | null
  warnings: string[]
}
export const defaultAppearance = (): AppearanceSettings => ({ theme: 'deepseek', themeMode: 'system', language: 'system', iconPath: null, builtinIcon: null, backgroundPath: null, backgroundCrop: null, petLibraryPath: null, opacity: 0.25, blur: 0, fit: 'cover' })
export interface SavedClient {
  version: 1
  servers: SavedServer[]
  selected: Selection | null
  pet: PetSettings
  appearance: AppearanceSettings
  window: WindowState | null
}
export interface Counts { green: number; yellow: number; red: number; blue: number }
export interface Avatar { shape?: string; image?: string }
export interface Entity {
  key: string
  id: string
  kind: EntityKind
  name: string
  sessionId: string
  sectionId: string | null
  main: boolean
  private: boolean
  hidden: boolean
  color?: string
  avatar?: Avatar
  members: string[]
  task: TaskColor | null
  detail: string
  followed: boolean
}
export interface Section { id: string; name: string }
export interface TeamView {
  revision: number
  version: string | null
  entities: Entity[]
  sections: Section[]
  prefs: Record<string, unknown>
  truncated: boolean
}
export interface ServerView {
  id: string
  alias: string
  relay: string
  mode: 'phone' | 'browser'
  state: LinkState
  error: string | null
  generation: number
  retryAt: number | null
  lastSyncAt: number | null
  cached: boolean
  team: TeamView | null
  counts: Counts
}
export interface PetTask extends Selection {
  key: string
  title: string
  serverAlias: string
  color: TaskColor
  detail: string
  cached: boolean
}
export interface Snapshot {
  revision: number
  servers: ServerView[]
  activeServerId: string | null
  selected: Selection | null
  pet: PetSettings
  appearance: AppearanceView
  tasks: PetTask[]
  counts: Counts
  startupError: string | null
}
export type ContentCommand = { action: 'chat'; kind: EntityKind; id: string } | { action: 'settings'; page?: string; id?: string } | { action: 'new-bot' | 'new-room' }
export interface ContentStatus { mode?: 'phone' | 'browser'; cached: boolean; state: LinkState; alias: string; error: string | null; lastSyncAt: number | null; localBackground?: boolean; uiLanguage?: UiLanguage; uiTheme?: ThemeSettings }
export const emptyCounts = (): Counts => ({ green: 0, yellow: 0, red: 0, blue: 0 })
export const entityKey = (kind: EntityKind, id: string): string => `${kind}:${id}`
export const defaultClient = (): SavedClient => ({
  version: 1, servers: [], selected: null,
  pet: { enabled: false, locked: false, alwaysOnTop: true, position: null, skin: null, size: 112, mark: null }, appearance: defaultAppearance(), window: null,
})
