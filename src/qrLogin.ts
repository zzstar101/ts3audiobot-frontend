import { MUSIC_API_BASE } from './apiConfig'

const API_BASE = MUSIC_API_BASE

export interface QrStartResult {
  key: string
  qrImage: string
  qrText: string
}

export type QrPollStatus = 'pending' | 'scanned' | 'confirmed' | 'expired' | 'success' | 'failed'

export interface QrPollResult {
  status: QrPollStatus
  message: string
  cookie?: string
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`)
  }
  return response.json()
}

async function tryFetch(urls: string[]): Promise<any> {
  let lastError: unknown
  for (const url of urls) {
    try {
      return await fetchJson(url)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('接口不可用')
}

function parseKey(raw: any): string {
  return String(raw?.data?.unikey ?? raw?.unikey ?? raw?.data?.key ?? raw?.key ?? '').trim()
}

function parseQrImage(raw: any): string {
  return String(raw?.data?.qrimg ?? raw?.qrimg ?? raw?.data?.qrcode ?? raw?.qrcode ?? '').trim()
}

function parseQrText(raw: any): string {
  return String(raw?.data?.qrurl ?? raw?.qrurl ?? raw?.data?.url ?? raw?.url ?? '').trim()
}

function parseCookie(raw: any): string {
  return String(raw?.cookie ?? raw?.data?.cookie ?? raw?.data?.data?.cookie ?? '').trim()
}

export async function startQrLogin(): Promise<QrStartResult> {
  const base = API_BASE
  const timestamp = Date.now()

  const keyRaw = await tryFetch([
    `${base}/login/qr/key?timestamp=${timestamp}`,
    `${base}/login/qr/key`
  ])

  const key = parseKey(keyRaw)
  if (!key) {
    throw new Error('未获取到二维码 key，请确认后端支持扫码登录')
  }

  const createRaw = await tryFetch([
    `${base}/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true&timestamp=${Date.now()}`,
    `${base}/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true`,
    `${base}/login/qr/create?unikey=${encodeURIComponent(key)}&qrimg=true`
  ])

  const qrImage = parseQrImage(createRaw)
  const qrText = parseQrText(createRaw)

  if (!qrImage && !qrText) {
    throw new Error('后端未返回二维码内容，请确认接口返回格式')
  }

  return {
    key,
    qrImage,
    qrText
  }
}

export async function pollQrLogin(key: string): Promise<QrPollResult> {
  const base = API_BASE
  const checkRaw = await tryFetch([
    `${base}/login/qr/check?key=${encodeURIComponent(key)}&timestamp=${Date.now()}`,
    `${base}/login/qr/check?key=${encodeURIComponent(key)}`
  ])

  const code = Number(checkRaw?.code ?? checkRaw?.data?.code ?? checkRaw?.status ?? checkRaw?.retcode ?? -1)
  const cookie = parseCookie(checkRaw)

  if (cookie) {
    return { status: 'success', message: '登录成功', cookie }
  }

  if (code === 800) return { status: 'expired', message: '二维码已过期，请重新获取' }
  if (code === 801) return { status: 'pending', message: '等待扫码' }
  if (code === 802) return { status: 'scanned', message: '已扫码，请在手机确认' }
  if (code === 803) return { status: 'confirmed', message: '已确认，等待返回登录信息' }

  const msg = String(checkRaw?.message ?? checkRaw?.msg ?? '').trim()
  return { status: 'failed', message: msg || `状态未知（code=${code}）` }
}
