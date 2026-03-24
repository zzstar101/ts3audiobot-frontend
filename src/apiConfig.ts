const envBase = (import.meta as any)?.env?.VITE_MUSIC_API_BASE as string | undefined

export const MUSIC_API_BASE = (envBase && envBase.trim()) || '/music-api'
