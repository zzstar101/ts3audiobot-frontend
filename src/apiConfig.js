const envBase = import.meta?.env?.VITE_MUSIC_API_BASE;
export const MUSIC_API_BASE = (envBase && envBase.trim()) || '/music-api';
