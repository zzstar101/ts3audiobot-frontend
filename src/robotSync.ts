import { withAuthUrl } from './auth'
import { MUSIC_API_BASE } from './apiConfig'
import type { SongItem } from './types'

const BOT_API_BASE = '/api/bot/use/0'
const NETEASE_API_BASE = MUSIC_API_BASE

interface RobotSongResponse {
  Position: number
  Length: number
  Paused: boolean
  Link: string
  Title: string
  AudioType: string
}

export interface RobotSyncState {
  currentSong: SongItem | null
  progressSec: number
  isPlaying: boolean
}

const songCache = new Map<string, SongItem>()

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
      title: parts[0].trim(),
      artist: parts.slice(1).join(' - ').trim() || '未知歌手'
    }
  }
  return { title: raw.trim() || '未知歌曲', artist: '未知歌手' }
}

async function fetchRobotSongRaw(): Promise<RobotSongResponse | null> {
  const res = await fetch(`${BOT_API_BASE}/(/song)`, {
    method: 'GET',
    mode: 'cors',
    cache: 'no-cache',
    credentials: 'same-origin'
  })
  if (!res.ok) return null
  const data = await res.json() as any
  if (data && typeof data === 'object' && 'ErrorCode' in data) return null
  return data as RobotSongResponse
}

async function fetchNeteaseSongDetail(songId: string): Promise<Partial<SongItem> | null> {
  if (!songId) return null
  const detailUrl = withAuthUrl(`${NETEASE_API_BASE}/song/detail?ids=${encodeURIComponent(songId)}`)
  try {
    const res = await fetch(detailUrl)
    if (!res.ok) return null
    const data = await res.json()
    const song = data?.songs?.[0]
    if (!song) return null
    return {
      id: String(song?.id ?? songId),
      provider: 'netease',
      title: String(song?.name ?? ''),
      artist: Array.isArray(song?.ar) ? song.ar.map((item: any) => item?.name).filter(Boolean).join(' / ') : '未知歌手',
      album: String(song?.al?.name ?? '未知专辑'),
      cover: String(song?.al?.picUrl ?? 'https://dummyimage.com/300x300/1f2937/9ca3af&text=WY'),
      durationSec: Math.max(1, Math.floor((song?.dt ?? 0) / 1000))
    }
  } catch {
    return null
  }
}

async function buildSong(raw: RobotSongResponse): Promise<SongItem | null> {
  if (!raw?.Title && !raw?.Link) return null

  const songId = parseSongId(String(raw.Link ?? ''))
  const cacheKey = songId || `${raw.Title}|${raw.Link}`
  const cached = songCache.get(cacheKey)
  if (cached) return cached

  const fallback = splitTitleAndArtist(String(raw.Title ?? ''))
  const detail = await fetchNeteaseSongDetail(songId)

  const song: SongItem = {
    id: songId || cacheKey,
    provider: 'netease',
    title: detail?.title || fallback.title,
    artist: detail?.artist || fallback.artist,
    album: detail?.album || '未知专辑',
    cover: detail?.cover || 'https://dummyimage.com/300x300/1f2937/9ca3af&text=WY',
    durationSec: detail?.durationSec || Math.max(1, Number(raw.Length ?? 1))
  }

  songCache.set(cacheKey, song)
  return song
}

export async function fetchRobotSyncState(): Promise<RobotSyncState | null> {
  const raw = await fetchRobotSongRaw()
  if (!raw) return null

  const hasSong = Boolean(raw.Title || raw.Link)
  if (!hasSong) {
    return {
      currentSong: null,
      progressSec: 0,
      isPlaying: false
    }
  }

  const currentSong = await buildSong(raw)
  const progressSec = Math.max(0, Number(raw.Position ?? 0))
  const isPlaying = !Boolean(raw.Paused)

  return {
    currentSong,
    progressSec,
    isPlaying
  }
}
