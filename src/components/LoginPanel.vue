<template>
  <section class="card login-panel">
    <h2>网易云登录</h2>
    <div class="login-list">
      <article class="login-item">
        <div class="login-meta">
          <div class="login-title">网易云音乐</div>
          <div class="login-sub">状态：{{ isLoggedIn() ? '已登录' : '未登录' }}</div>
          <div class="login-sub" v-if="isLoggedIn() && accountName">账户名：{{ accountName }}</div>
          <div class="login-sub" v-if="isLoggedIn() && memberLevel">会员等级：{{ memberLevel }}</div>
          <div class="login-sub">插件登录：{{ pluginStatusText }}</div>
          <div class="login-sub" v-if="pluginStatusUser">插件账户：{{ pluginStatusUser }}</div>
          <div class="login-sub" v-if="pluginSyncLoading">正在同步登录到插件...</div>
          <div class="login-sub" v-if="pluginSyncError">{{ pluginSyncError }}</div>
          <div class="login-sub" v-if="isLoggedIn() && profileLoading">账户信息加载中...</div>
          <div class="login-sub" v-if="isLoggedIn() && profileError">{{ profileError }}</div>
        </div>
        <div class="login-actions">
          <button class="btn" :disabled="loading" @click="openQrLogin">扫码登录</button>
          <button class="btn" @click="openManualLogin">手动凭据</button>
          <button class="btn" :disabled="!isLoggedIn()" @click="logout">退出</button>
        </div>
      </article>
    </div>

    <div class="qr-panel" v-if="qrVisible">
      <div class="qr-head">
        <div class="qr-title">网易云音乐 扫码登录</div>
        <button class="btn" @click="closeQr">关闭</button>
      </div>

      <div class="qr-body">
        <img v-if="qrImage" :src="qrImage" alt="登录二维码" class="qr-image" />
        <div class="qr-fallback" v-else>
          <a :href="qrText" target="_blank" rel="noreferrer">打开二维码链接</a>
        </div>
      </div>

      <div class="qr-status">{{ qrStatus }}</div>
      <div class="qr-error" v-if="qrError">{{ qrError }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MUSIC_API_BASE } from '../apiConfig'
import { authState, clearCookie, isLoggedIn, setCookie, withAuthUrl } from '../auth'
import { fetchPluginLoginStatus, syncNeteaseCookieToPlugin } from '../pluginBridge'
import { pollQrLogin, startQrLogin } from '../qrLogin'

const API_BASE = MUSIC_API_BASE
const PLUGIN_STATUS_POLL_MS = 24 * 60 * 60 * 1000
const loading = ref(false)
const qrVisible = ref(false)
const qrImage = ref('')
const qrText = ref('')
const qrKey = ref('')
const qrStatus = ref('')
const qrError = ref('')
const profileLoading = ref(false)
const profileError = ref('')
const accountName = ref('')
const memberLevel = ref('')
const pluginStatusText = ref('未知')
const pluginStatusUser = ref('')
const pluginSyncLoading = ref(false)
const pluginSyncError = ref('')
let timer: number | undefined
let pluginStatusTimer: number | undefined

async function refreshPluginStatus() {
  try {
    const status = await fetchPluginLoginStatus()
    if (!status) {
      pluginStatusText.value = '未知'
      pluginStatusUser.value = ''
      return
    }
    pluginStatusText.value = status.neteaseLoggedIn ? '已登录' : '未登录/已掉线'
    pluginStatusUser.value = status.neteaseUser
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatusText.value = `读取失败：${msg}`
    pluginStatusUser.value = ''
  }
}

async function syncCookieIntoPlugin(cookie: string) {
  pluginSyncLoading.value = true
  pluginSyncError.value = ''
  try {
    await syncNeteaseCookieToPlugin(cookie)
    await refreshPluginStatus()
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginSyncError.value = `写入插件失败：${msg}`
  } finally {
    pluginSyncLoading.value = false
  }
}

async function fetchAccountInfo() {
  if (!isLoggedIn()) {
    accountName.value = ''
    memberLevel.value = ''
    profileError.value = ''
    return
  }

  profileLoading.value = true
  profileError.value = ''

  try {
    const statusRes = await fetch(withAuthUrl(`${API_BASE}/login/status?timestamp=${Date.now()}`))
    if (!statusRes.ok) {
      throw new Error(`账户状态请求失败：${statusRes.status}`)
    }
    const statusData = await statusRes.json()
    accountName.value = String(statusData?.data?.profile?.nickname ?? '')

    const vipRes = await fetch(withAuthUrl(`${API_BASE}/vip/info?timestamp=${Date.now()}`))
    if (vipRes.ok) {
      const vipData = await vipRes.json()
      const level = Number(vipData?.data?.musicPackage?.vipLevel ?? vipData?.data?.associator?.vipLevel ?? statusData?.data?.profile?.vipType ?? 0)
      memberLevel.value = level > 0 ? `VIP${level}` : '普通用户'
    } else {
      const fallbackLevel = Number(statusData?.data?.profile?.vipType ?? 0)
      memberLevel.value = fallbackLevel > 0 ? `VIP${fallbackLevel}` : '普通用户'
    }

    if (!accountName.value) {
      accountName.value = '未知用户'
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    profileError.value = `账户信息获取失败：${msg}`
  } finally {
    profileLoading.value = false
  }
}

function logout() {
  clearCookie()
  accountName.value = ''
  memberLevel.value = ''
  profileError.value = ''
  pluginSyncError.value = ''
  refreshPluginStatus()
}

function openManualLogin() {
  const cookie = window.prompt('请输入网易云 Cookie（将仅保存在当前浏览器本地）', '')
  if (cookie === null) return
  const next = cookie.trim()
  if (!next) return
  setCookie(next)
  fetchAccountInfo()
}

function stopPolling() {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}

function stopPluginStatusPolling() {
  if (pluginStatusTimer) {
    window.clearInterval(pluginStatusTimer)
    pluginStatusTimer = undefined
  }
}

function closeQr() {
  stopPolling()
  qrVisible.value = false
}

async function pollOnce() {
  if (!qrKey.value) return
  try {
    const result = await pollQrLogin(qrKey.value)
    qrStatus.value = result.message
    if (result.status === 'success' && result.cookie) {
      setCookie(result.cookie)
      qrError.value = ''
      qrStatus.value = '登录成功，已写入凭据'
      fetchAccountInfo()
      stopPolling()
      return
    }
    if (result.status === 'expired' || result.status === 'failed') {
      qrError.value = result.message
      stopPolling()
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    qrError.value = `轮询失败：${msg}`
    stopPolling()
  }
}

async function openQrLogin() {
  loading.value = true
  qrError.value = ''
  qrStatus.value = '正在获取二维码...'
  stopPolling()

  try {
    const start = await startQrLogin()
    qrVisible.value = true
    qrKey.value = start.key
    qrImage.value = start.qrImage
    qrText.value = start.qrText
    qrStatus.value = '请使用手机扫码，系统将自动检测状态'

    timer = window.setInterval(() => {
      pollOnce()
    }, 2500)
    await pollOnce()
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    qrVisible.value = true
    qrImage.value = ''
    qrText.value = ''
    qrKey.value = ''
    qrStatus.value = '无法开启扫码登录'
    qrError.value = `${msg}。你可以先使用“手动凭据”登录。`
  } finally {
    loading.value = false
  }
}

onBeforeUnmount(() => {
  stopPolling()
  stopPluginStatusPolling()
})

watch(
  () => authState.neteaseCookie,
  (cookie) => {
    fetchAccountInfo()
    if (cookie) {
      syncCookieIntoPlugin(cookie)
    }
  }
)

onMounted(() => {
  fetchAccountInfo()
  refreshPluginStatus()
  pluginStatusTimer = window.setInterval(refreshPluginStatus, PLUGIN_STATUS_POLL_MS)
})
</script>
