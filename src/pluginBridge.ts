import type { SongItem } from './types'
import { MUSIC_API_BASE } from './apiConfig'
import { withAuthUrl } from './auth'

const API_BASE = '/api'
const BOT_ID = '0'
const NETEASE_CMD = 'wyy'
const NETEASE_ADD_SUBCMD = 'add'
const NETEASE_PLAY_SUBCMD = 'play'

interface BotQueueItem {
  Link?: string
  Title?: string
  AudioType?: string
}

interface BotQueueInfo {
  Items?: BotQueueItem[]
  PlaybackIndex?: number
  DisplayOffset?: number
  SongCount?: number
}

interface NeteaseSongDetail {
  id: string
  title: string
  artist: string
  album: string
  cover: string
  durationSec: number
}

export type PlayMode = 1 | 2 | 3 | 4
export type PlayType = 0 | 1

export interface PluginQueueState {
  queue: SongItem[]
  currentIndex: number
  playMode: PlayMode | null
  playType: PlayType | null
  modeName: string
}

export const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  1: '顺序播放',
  2: '单曲循环',
  3: '顺序循环',
  4: '随机播放'
}

interface WqQueuePayload {
  playbackIndex?: number
  play_index?: number
  play_mode?: number
  play_type?: number
  mode_name?: string
  items?: Array<{
    index?: number
    id?: string
    music_type?: string
    name?: string
    author?: string
    title?: string
    artist?: string
    link?: string
    provider?: string
  }>
}

const enqueueHintByLink = new Map<string, SongItem>()
const ENQUEUE_HINT_STORAGE_KEY = 'jukebox.enqueueHints.v1'

function loadEnqueueHintsFromStorage() {
  try {
    const raw = window.localStorage.getItem(ENQUEUE_HINT_STORAGE_KEY)
    if (!raw) return
    const list = JSON.parse(raw) as Array<{ link: string; song: SongItem }>
    if (!Array.isArray(list)) return
    for (const item of list) {
      const link = String(item?.link ?? '').trim()
      const song = item?.song
      if (!link || !song) continue
      enqueueHintByLink.set(link, song)
    }
  } catch {
    // ignore storage read errors
  }
}

function saveEnqueueHintsToStorage() {
  try {
    const serialized = JSON.stringify(
      [...enqueueHintByLink.entries()].slice(-300).map(([link, song]) => ({ link, song }))
    )
    window.localStorage.setItem(ENQUEUE_HINT_STORAGE_KEY, serialized)
  } catch {
    // ignore storage write errors
  }
}

loadEnqueueHintsFromStorage()

function attachTs3MetaToUrl(url: string, song: SongItem): string {
  if (!url) return url
  const payload = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    cover: song.cover,
    durationSec: song.durationSec
  }
  const encoded = encodeURIComponent(JSON.stringify(payload))
  return `${url}#ts3ab=${encoded}`
}

function extractTs3MetaFromLink(link: string): Partial<SongItem> | null {
  const marker = '#ts3ab='
  const pos = link.indexOf(marker)
  if (pos < 0) return null
  const encoded = link.slice(pos + marker.length).trim()
  if (!encoded) return null
  try {
    const raw = JSON.parse(decodeURIComponent(encoded)) as any
    return {
      id: String(raw?.id ?? '').trim(),
      title: String(raw?.title ?? '').trim(),
      artist: String(raw?.artist ?? '').trim(),
      album: String(raw?.album ?? '').trim(),
      cover: String(raw?.cover ?? '').trim(),
      durationSec: Number(raw?.durationSec ?? 0)
    }
  } catch {
    return null
  }
}

function encodePart(part: string): string {
  return encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function buildBotCommandUrl(parts: string[]): string {
  const safeParts = parts.filter(Boolean).map(encodePart)
  const cmdPath = safeParts.join('/')
  return `${API_BASE}/bot/use/${encodePart(BOT_ID)}/(/${cmdPath})`
}

async function execBotCommand(parts: string[]): Promise<any> {
  const url = buildBotCommandUrl(parts)
  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    cache: 'no-cache',
    credentials: 'same-origin'
  })

  const text = await response.text()

  if (!response.ok) {
    let detail = ''
    try {
      const payload = JSON.parse(text) as { ErrorMessage?: string; ErrorName?: string }
      const parts = [payload.ErrorName, payload.ErrorMessage].filter(Boolean)
      if (parts.length) {
        detail = `：${parts.join(' - ')}`
      }
    } catch {
      detail = ''
    }
    throw new Error(`插件命令执行失败：HTTP ${response.status}${detail}`)
  }

  if (!text) return null
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    return { Value: text }
  }

  if (payload && typeof payload === 'object' && 'ErrorCode' in payload) {
    const errorCode = Number((payload as any).ErrorCode ?? 0)
    if (errorCode !== 0) {
      const errorName = String((payload as any).ErrorName ?? '命令错误')
      const errorMessage = String((payload as any).ErrorMessage ?? '未知错误')
      throw new Error(`${errorName}：${errorMessage}`)
    }
  }
  return payload
}

export async function enqueueSongToPlugin(song: SongItem): Promise<void> {
  const playableUrl = await fetchPlayableNeteaseUrl(song.id)
  const playableWithMeta = playableUrl ? attachTs3MetaToUrl(playableUrl, song) : ''
  const neteaseUrl = `https://music.163.com/#/song?id=${song.id}`
  const tries: string[][] = [
    ['wq', 'add', song.id],
    ...(playableWithMeta ? [['add', playableWithMeta]] : []),
    ['add', `https://music.163.com/song?id=${song.id}`],
    [NETEASE_CMD, NETEASE_ADD_SUBCMD, song.id],
    [NETEASE_CMD, NETEASE_ADD_SUBCMD, neteaseUrl],
    [NETEASE_CMD, NETEASE_ADD_SUBCMD, `https://music.163.com/song?id=${song.id}`]
  ]

  let lastError: unknown
  for (const parts of tries) {
    try {
      await execBotCommand(parts)
      if (playableUrl) {
        enqueueHintByLink.set(playableUrl, song)
        if (playableWithMeta) {
          enqueueHintByLink.set(playableWithMeta, song)
        }
        saveEnqueueHintsToStorage()
      }
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('入队失败')
}

export async function playSongByPlugin(song: SongItem): Promise<void> {
  await execBotCommand([NETEASE_CMD, NETEASE_PLAY_SUBCMD, song.id])
}

export async function playQueueIndexByPlugin(index: number): Promise<void> {
  const oneBased = Math.max(1, Math.floor(index) + 1)
  await execBotCommand(['wq', 'go', String(oneBased)])
}

export async function removeQueueIndexByPlugin(index: number): Promise<void> {
  const normalized = Math.max(0, Math.floor(index))
  const oneBased = normalized + 1
  const tries: string[][] = [
    ['wq', 'rm', String(oneBased)],
    ['wq', 'remove', String(oneBased)],
    ['wq', 'del', String(oneBased)],
    ['list', 'item', 'delete', '.mix', String(normalized)]
  ]

  let lastError: unknown
  for (const parts of tries) {
    try {
      await execBotCommand(parts)
      await execBotCommand(['wq', 'queue'])
      return
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('移除队列项失败')
}

export async function clearQueueByPlugin(): Promise<void> {
  await execBotCommand(['wq', 'clear'])

  for (let attempt = 0; attempt < 6; attempt++) {
    const state = await fetchQueueFromPlugin(20)
    if (!state.queue.length) return
    await new Promise((resolve) => window.setTimeout(resolve, 120))
  }

  throw new Error('清空播放队列失败')
}

function parseSongId(link: string): string {
  const match = link.match(/[?&]id=(\d+)/)
  if (match?.[1]) return match[1]
  const plain = link.match(/\/(\d+)(?:\D|$)/)
  return plain?.[1] ?? ''
}

function splitTitleAndArtist(raw: string): { title: string; artist: string } {
  const parts = raw.split(' - ')
  if (parts.length >= 2) {
    return {
      title: parts[0].trim() || '未知歌曲',
      artist: parts.slice(1).join(' - ').trim() || '未知歌手'
    }
  }
  return { title: raw.trim() || '未知歌曲', artist: '未知歌手' }
}

function looksLikeUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim())
}

function mapQueueItemToSong(item: BotQueueItem, index: number): SongItem {
  const link = String(item?.Link ?? '').trim()
  const rawTitle = String(item?.Title ?? '').trim()
  const linkMeta = extractTs3MetaFromLink(link)
  if (linkMeta && (looksLikeUrl(rawTitle) || !rawTitle)) {
    return {
      id: String(linkMeta.id || `queue-${index}`),
      provider: 'netease',
      cover: String(linkMeta.cover || 'https://dummyimage.com/300x300/1f2937/9ca3af&text=WY'),
      title: String(linkMeta.title || `队列歌曲 ${index + 1}`),
      artist: String(linkMeta.artist || '未知歌手'),
      album: String(linkMeta.album || '未知专辑'),
      durationSec: Math.max(1, Number(linkMeta.durationSec || 1))
    }
  }
  const hinted = enqueueHintByLink.get(link)
  if (hinted && (looksLikeUrl(rawTitle) || !rawTitle)) {
    return {
      ...hinted,
      durationSec: Math.max(1, hinted.durationSec || 1)
    }
  }
  const parsed = splitTitleAndArtist(rawTitle)
  const songId = parseSongId(link)
  return {
    id: songId || `queue-${index}`,
    provider: 'netease',
    cover: 'https://dummyimage.com/300x300/1f2937/9ca3af&text=WY',
    title: parsed.title,
    artist: parsed.artist,
    album: '队列歌曲',
    durationSec: 1
  }
}

function mapWqQueueItemToSong(item: NonNullable<WqQueuePayload['items']>[number], index: number): SongItem {
  const title = String(item?.title ?? item?.name ?? '').trim()
  const artist = String(item?.artist ?? item?.author ?? '').trim()
  const id = String(item?.id ?? '').trim()
  const link = String(item?.link ?? '').trim()
  const songId = id || parseSongId(link)
  return {
    id: songId || `wq-queue-${index}`,
    provider: 'netease',
    cover: 'https://dummyimage.com/300x300/1f2937/9ca3af&text=WY',
    title: title || `队列歌曲 ${index + 1}`,
    artist: artist || '未知歌手',
    album: '队列歌曲',
    durationSec: 1
  }
}

function normalizePlayMode(raw: unknown): PlayMode | null {
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  const mode = Math.floor(value)
  if (mode < 1 || mode > 4) return 1
  return mode as PlayMode
}

function normalizePlayType(raw: unknown): PlayType | null {
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  const kind = Math.floor(value)
  if (kind !== 0 && kind !== 1) return null
  return kind as PlayType
}

function getPlayModeLabel(mode: PlayMode | null): string {
  if (!mode) return ''
  return PLAY_MODE_LABELS[mode]
}

async function fetchNeteaseSongDetails(songIds: string[]): Promise<Map<string, NeteaseSongDetail>> {
  const uniqIds = [...new Set(songIds.filter(Boolean))]
  const detailMap = new Map<string, NeteaseSongDetail>()
  if (!uniqIds.length) return detailMap

  try {
    const url = withAuthUrl(`${MUSIC_API_BASE}/song/detail?ids=${encodeURIComponent(uniqIds.join(','))}`)
    const res = await fetch(url)
    if (!res.ok) return detailMap
    const data = await res.json() as any
    const songs = Array.isArray(data?.songs) ? data.songs : []

    for (const song of songs) {
      const id = String(song?.id ?? '').trim()
      if (!id) continue
      detailMap.set(id, {
        id,
        title: String(song?.name ?? '未知歌曲'),
        artist: Array.isArray(song?.ar) ? song.ar.map((item: any) => item?.name).filter(Boolean).join(' / ') || '未知歌手' : '未知歌手',
        album: String(song?.al?.name ?? '未知专辑'),
        cover: String(song?.al?.picUrl ?? 'https://dummyimage.com/300x300/1f2937/9ca3af&text=WY'),
        durationSec: Math.max(1, Math.floor(Number(song?.dt ?? 0) / 1000))
      })
    }
  } catch {
    return detailMap
  }

  return detailMap
}

async function fetchPlayableNeteaseUrl(songId: string): Promise<string> {
  const endpoints = [
    `${MUSIC_API_BASE}/song/url/v1?id=${encodeURIComponent(songId)}&level=exhigh`,
    `${MUSIC_API_BASE}/song/url?id=${encodeURIComponent(songId)}`
  ]

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(withAuthUrl(endpoint))
      if (!res.ok) continue
      const data = await res.json() as any
      const url = String(data?.data?.[0]?.url ?? '').trim()
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url
      }
    } catch {
      // try next endpoint
    }
  }

  return ''
}

export async function fetchQueueFromPlugin(limit = 100): Promise<PluginQueueState> {
  try {
    const rawPayload = await execBotCommand(['wq', 'queue']) as WqQueuePayload | { Value?: string } | string | null
    let payload: WqQueuePayload | null = null

    if (rawPayload && typeof rawPayload === 'object' && Array.isArray((rawPayload as any).items)) {
      payload = rawPayload as WqQueuePayload
    } else if (typeof rawPayload === 'string') {
      try {
        payload = JSON.parse(rawPayload) as WqQueuePayload
      } catch {
        payload = null
      }
    } else {
      const valueText = String((rawPayload as any)?.Value ?? '').trim()
      if (valueText) {
        try {
          payload = JSON.parse(valueText) as WqQueuePayload
        } catch {
          payload = null
        }
      }
    }

    const items = Array.isArray(payload?.items) ? payload.items : []
    if (items.length) {
      const baseQueue = items.map(mapWqQueueItemToSong)
      const detailMap = await fetchNeteaseSongDetails(baseQueue.map((song) => song.id).filter((id) => /^\d+$/.test(id)))
      const queue = baseQueue.map((song) => {
        const detail = detailMap.get(song.id)
        if (!detail) return song
        return {
          ...song,
          title: detail.title,
          artist: detail.artist,
          album: detail.album,
          cover: detail.cover,
          durationSec: detail.durationSec
        }
      })
      const oneBased = Number(payload?.play_index ?? payload?.playbackIndex ?? 1)
      const currentIndex = Number.isFinite(oneBased)
        ? Math.min(Math.max(0, oneBased - 1), Math.max(0, queue.length - 1))
        : 0
      const playMode = normalizePlayMode(payload?.play_mode)
      const playType = normalizePlayType(payload?.play_type)
      return {
        queue,
        currentIndex,
        playMode,
        playType,
        modeName: String(payload?.mode_name ?? getPlayModeLabel(playMode))
      }
    }
  } catch {
    // fallback to legacy info endpoints
  }

  const [windowData, fullData] = await Promise.all([
    execBotCommand(['info', '@-1', String(limit)]) as Promise<BotQueueInfo | null>,
    execBotCommand(['info', '@-999', String(limit)]) as Promise<BotQueueInfo | null>
  ])

  const fullItems = Array.isArray(fullData?.Items) ? fullData.Items : []
  const windowItems = Array.isArray(windowData?.Items) ? windowData.Items : []
  const sourceItems = fullItems.length ? fullItems : windowItems
  const baseQueue = sourceItems.map(mapQueueItemToSong)
  const detailMap = await fetchNeteaseSongDetails(baseQueue.map((song) => song.id).filter((id) => /^\d+$/.test(id)))
  const queue = baseQueue.map((song) => {
    const detail = detailMap.get(song.id)
    if (!detail) return song
    return {
      ...song,
      title: detail.title,
      artist: detail.artist,
      album: detail.album,
      cover: detail.cover,
      durationSec: detail.durationSec
    }
  })

  const playbackIndex = Number(windowData?.PlaybackIndex ?? fullData?.PlaybackIndex ?? 0)
  const currentIndex = Number.isFinite(playbackIndex)
    ? Math.min(Math.max(0, playbackIndex), Math.max(0, queue.length - 1))
    : 0
  return {
    queue,
    currentIndex,
    playMode: null,
    playType: null,
    modeName: ''
  }
}

export async function nextSongByPlugin(): Promise<void> {
  try {
    await execBotCommand(['wq', 'next'])
  } catch {
    await execBotCommand(['next'])
  }
}

export async function previousSongByPlugin(): Promise<void> {
  try {
    await execBotCommand(['wq', 'pre'])
  } catch {
    await execBotCommand(['previous'])
  }
}

export async function setPlayModeByPlugin(mode: PlayMode): Promise<void> {
  await execBotCommand(['wq', 'mode', String(mode)])
}

export async function setVolumeByPlugin(volume: number): Promise<void> {
  const normalized = Math.max(0, Math.min(100, Math.round(volume)))
  await execBotCommand(['volume', String(normalized)])
}

export async function fetchVolumeFromPlugin(): Promise<number> {
  const data = await execBotCommand(['volume']) as number | { Value?: number | string } | null
  const raw = typeof data === 'number' ? data : Number((data as any)?.Value ?? data)
  if (!Number.isFinite(raw)) return 70
  return Math.max(0, Math.min(100, Math.round(raw)))
}

export async function resumeSongByPlugin(seconds: number): Promise<void> {
  const target = Math.max(0, Math.floor(seconds))
  try {
    await execBotCommand(['wq', 'resume', String(target)])
  } catch {
    await execBotCommand(['play'])
    if (target > 0) {
      try {
        await seekSongByPlugin(target)
      } catch {
        // Keep resumed state even when seek fallback is unsupported.
      }
    }
  }
}

export async function playSongResumeByPlugin(): Promise<void> {
  await resumeSongByPlugin(0)
}

export async function pauseSongByPlugin(): Promise<void> {
  await execBotCommand(['pause'])
}

export async function seekSongByPlugin(seconds: number): Promise<void> {
  const target = Math.max(0, Math.floor(seconds))
  try {
    await execBotCommand(['wq', 'seek', String(target)])
  } catch {
    await execBotCommand(['seek', String(target)])
  }
}

export interface PluginLoginStatus {
  rawText: string
  neteaseLoggedIn: boolean
  neteaseUser: string
}

export async function fetchPluginLoginStatus(): Promise<PluginLoginStatus | null> {
  const data = await execBotCommand(['wq', 'status']) as { Value?: string } | null
  const rawText = String(data?.Value ?? '').trim()
  if (!rawText) return null

  const neteaseSection = rawText.match(/\[网易云音乐\][\s\S]*?(?=\n\[|$)/)?.[0] ?? rawText
  const neteaseLoggedIn = !/未登录/.test(neteaseSection)
  const userMatch = neteaseSection.match(/当前用户[：:]\s*([^\n\[]+)/)
  const neteaseUser = userMatch?.[1]?.trim() ?? ''

  return {
    rawText,
    neteaseLoggedIn,
    neteaseUser
  }
}

export async function syncNeteaseCookieToPlugin(cookie: string): Promise<void> {
  const clean = cookie.trim()
  if (!clean) return
  await execBotCommand([NETEASE_CMD, 'login', clean])
}
