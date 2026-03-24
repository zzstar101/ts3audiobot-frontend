import { reactive } from 'vue'

interface AuthState {
  neteaseCookie: string
}

const STORAGE_KEY = 'ts6-jukebox-auth'

function loadAuth(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { neteaseCookie: '' }
    }
    const parsed = JSON.parse(raw) as Partial<AuthState>
    return {
      neteaseCookie: String(parsed.neteaseCookie ?? '')
    }
  } catch {
    return { neteaseCookie: '' }
  }
}

function saveAuth(state: AuthState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export const authState = reactive<AuthState>(loadAuth())

export function isLoggedIn(): boolean {
  return authState.neteaseCookie.trim().length > 0
}

export function setCookie(cookie: string) {
  authState.neteaseCookie = cookie.trim()
  saveAuth(authState)
}

export function clearCookie() {
  authState.neteaseCookie = ''
  saveAuth(authState)
}

export function getCookie(): string {
  return authState.neteaseCookie
}

export function withAuthUrl(url: string): string {
  const cookie = getCookie()
  if (!cookie) return url
  const connector = url.includes('?') ? '&' : '?'
  return `${url}${connector}cookie=${encodeURIComponent(cookie)}`
}
