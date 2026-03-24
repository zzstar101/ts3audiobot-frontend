<template>
  <section class="card player-panel player-theme-netease" :style="panelBgStyle">
    <div v-if="currentSong" class="player-main">
      <div class="player-stage">
        <div class="cover-wrap">
          <div class="cover-ring">
            <img :src="currentSong.cover" alt="cover" class="cover" />
          </div>
        </div>

        <div class="meta">
          <div class="title-row player-song-title">
            <strong>{{ currentSong.title }}</strong>
            <span class="provider-tag">{{ providerText() }}</span>
          </div>
          <div class="sub">{{ currentSong.artist }} · {{ currentSong.album }}</div>

          <div class="lyric-toolbar">
            <label class="lyric-switch">
              <input v-model="showTranslation" type="checkbox" />
              <span>翻译</span>
            </label>
            <label class="lyric-switch">
              <input v-model="showRomanization" type="checkbox" :disabled="!hasRomanization" />
              <span>音译</span>
            </label>
            <span class="lyric-hint" v-if="lyricLoading">歌词加载中...</span>
            <span class="lyric-hint" v-else-if="lyricError">{{ lyricError }}</span>
          </div>

          <div class="lyric-box" ref="lyricBoxRef" v-if="lyricLines.length">
            <div class="lyric-list" ref="lyricListRef" @wheel.passive="onLyricWheel" @scroll.passive="onLyricScroll">
              <div
                v-for="(line, index) in lyricLines"
                :key="line.time + '-' + index"
                :ref="(element) => setLyricLineRef(element as HTMLElement | null, index)"
                class="lyric-line"
                :class="{ active: index === highlightedLyricIndex }"
              >
                <div class="lyric-main">{{ line.main }}</div>
                <div class="lyric-extra" v-if="showTranslation && line.trans">{{ line.trans }}</div>
                <div class="lyric-extra" v-if="showRomanization && line.roma">{{ line.roma }}</div>
              </div>
            </div>
            <div v-if="isLyricManualScrollActive" class="lyric-position-overlay" aria-hidden="true">
              <div class="lyric-position-dash"></div>
              <div class="lyric-position-actions">
                <span class="lyric-position-time">{{ manualLyricTimeLabel }}</span>
                <button
                  type="button"
                  class="lyric-position-play"
                  :disabled="manualLyricIndex < 0"
                  @click="onManualLyricPlay"
                  aria-label="定位到当前歌词时间并播放"
                >
                  <Play class="icon-svg" :size="14" :stroke-width="2.4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="player-bottom">
        <div class="progress-row">
          <span>{{ formatSec(displayProgressSec) }}</span>
          <input
            class="slider music-slider"
            type="range"
            :min="0"
            :max="currentSong.durationSec"
            :value="displayProgressSec"
            @input="onSeekInput"
            @change="onSeekCommit"
          />
          <span>{{ formatSec(currentSong.durationSec) }}</span>
        </div>

        <div class="bottom-controls">
          <div class="controls controls-center">
            <button
              class="icon-btn mode-btn"
              :class="{ 'is-disabled': modeDisabled, 'is-active': !modeDisabled }"
              :disabled="modeDisabled"
              @click="emit('modeCycle')"
              :title="modeHint"
              aria-label="切换播放模式"
            >
              <component :is="modeIcon" class="icon-svg" :size="18" :stroke-width="2.2" aria-hidden="true" />
            </button>
            <button class="icon-btn" @click="$emit('prev')" aria-label="上一首">
              <SkipBack class="icon-svg" :size="18" :stroke-width="2.2" aria-hidden="true" />
            </button>
            <button class="icon-btn play-main" @click="$emit('toggle')" aria-label="播放或暂停">
              <Pause v-if="isPlaying" class="icon-svg" :size="20" :stroke-width="2.4" aria-hidden="true" />
              <Play v-else class="icon-svg" :size="20" :stroke-width="2.4" aria-hidden="true" />
            </button>
            <button class="icon-btn" @click="$emit('next')" aria-label="下一首">
              <SkipForward class="icon-svg" :size="18" :stroke-width="2.2" aria-hidden="true" />
            </button>
          </div>

          <div class="volume-row">
            <span class="volume-icon"><Volume2 class="icon-svg" :size="16" :stroke-width="2.1" aria-hidden="true" /></span>
            <input
              class="slider music-slider volume-slider"
              type="range"
              min="0"
              max="100"
              :value="volume"
              @input="onVolumeChange"
            />
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty">队列为空，先去搜索歌曲并加入队列</div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  ListOrdered,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2
} from 'lucide-vue-next'
import { MUSIC_API_BASE } from '../apiConfig'
import { withAuthUrl } from '../auth'
import type { SongItem } from '../types'

const props = defineProps<{
  currentSong: SongItem | null
  isPlaying: boolean
  progressSec: number
  volume: number
  playMode: 1 | 2 | 3 | 4
  playType: 0 | 1 | null
  modeBusy: boolean
}>()

const emit = defineEmits<{
  seek: [number]
  next: []
  prev: []
  toggle: []
  volume: [number]
  modeCycle: []
}>()

interface LyricLine {
  time: number
  main: string
  trans: string
  roma: string
}

const showTranslation = ref(true)
const showRomanization = ref(false)
const lyricLoading = ref(false)
const lyricError = ref('')
const lyricLines = ref<LyricLine[]>([])
const lyricBoxRef = ref<HTMLElement | null>(null)
const lyricListRef = ref<HTMLElement | null>(null)
const lyricLineRefs = ref<HTMLElement[]>([])
const lastScrolledLyricIndex = ref(-1)
const isLyricManualScrollActive = ref(false)
const manualLyricIndex = ref(-1)
const isAutoLyricFollowEnabled = ref(true)
let lyricScrollRaf: number | null = null
let manualLyricRaf: number | null = null
let manualHideTimer: number | null = null
const seekPreviewSec = ref<number | null>(null)
const isSeeking = ref(false)

const API_BASE = MUSIC_API_BASE

const panelBgStyle = computed(() => {
  if (!props.currentSong) return {}
  return {
    backgroundImage: `linear-gradient(90deg, rgba(15,23,42,.86), rgba(15,23,42,.74)), url(${props.currentSong.cover})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center'
  }
})

const modeIconMap: Record<1 | 2 | 3 | 4, any> = {
  1: ListOrdered,
  2: Repeat1,
  3: Repeat,
  4: Shuffle
}

const modeFullTextMap: Record<1 | 2 | 3 | 4, string> = {
  1: '顺序播放',
  2: '单曲循环',
  3: '顺序循环',
  4: '随机播放'
}

const modeDisabled = computed(() => props.modeBusy || props.playType === 1)

const modeIcon = computed(() => modeIconMap[props.playMode] ?? ListOrdered)

const modeHint = computed(() => {
  if (props.playType === 1) return 'FM 模式不可切换播放模式'
  if (props.modeBusy) return '播放模式切换中...'
  return `当前：${modeFullTextMap[props.playMode]}`
})

function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function providerText(): string {
  return '网易云'
}

const displayProgressSec = computed(() => {
  if (isSeeking.value && seekPreviewSec.value != null) {
    return seekPreviewSec.value
  }
  return props.progressSec
})

function onSeekInput(event: Event) {
  const target = event.target as HTMLInputElement
  isSeeking.value = true
  seekPreviewSec.value = Number(target.value)
}

function onSeekCommit(event: Event) {
  const target = event.target as HTMLInputElement
  const value = Number(target.value)
  isSeeking.value = false
  seekPreviewSec.value = null
  emit('seek', value)
}

function onVolumeChange(event: Event) {
  const target = event.target as HTMLInputElement
  emit('volume', Number(target.value))
}

function parseTimestampToSec(raw: string): number | null {
  const match = raw.match(/\[(\d+):(\d+(?:\.\d+)?)\]/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function setLyricLineRef(element: HTMLElement | null, index: number) {
  if (!element) return
  lyricLineRefs.value[index] = element
}

function parseLrc(raw: string): Map<number, string> {
  const map = new Map<number, string>()
  if (!raw) return map
  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const ts = parseTimestampToSec(line)
    if (ts == null) continue
    const text = line.replace(/\[[^\]]+\]/g, '').trim()
    if (!text) continue
    map.set(Number(ts.toFixed(2)), text)
  }
  return map
}

function buildLyricLines(mainRaw: string, transRaw: string, romaRaw: string): LyricLine[] {
  const main = parseLrc(mainRaw)
  const trans = parseLrc(transRaw)
  const roma = parseLrc(romaRaw)
  return [...main.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, text]) => ({
      time,
      main: text,
      trans: trans.get(time) ?? '',
      roma: roma.get(time) ?? ''
    }))
}

async function fetchLyrics(song: SongItem) {
  lyricLoading.value = true
  lyricError.value = ''
  lyricLines.value = []

  try {
    const url = `${API_BASE}/lyric?id=${encodeURIComponent(song.id)}`

    const res = await fetch(withAuthUrl(url))
    if (!res.ok) throw new Error(`歌词请求失败：${res.status}`)

    const data = await res.json()
    const mainRaw = String(data?.lrc?.lyric ?? '')
    const transRaw = String(data?.tlyric?.lyric ?? '')
    const romaRaw = String(data?.romalrc?.lyric ?? data?.roma?.lyric ?? '')

    lyricLines.value = buildLyricLines(mainRaw, transRaw, romaRaw)
    if (!lyricLines.value.length) {
      lyricError.value = '该歌曲暂无可用歌词'
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    lyricError.value = msg
  } finally {
    lyricLoading.value = false
  }
}

const hasRomanization = computed(() => lyricLines.value.some((line) => Boolean(line.roma)))

const activeLyricIndex = computed(() => {
  if (!lyricLines.value.length) return -1
  let index = -1
  for (let i = 0; i < lyricLines.value.length; i++) {
    if (lyricLines.value[i].time <= props.progressSec + 0.05) {
      index = i
    } else {
      break
    }
  }
  return index
})

const highlightedLyricIndex = computed(() => {
  if (isLyricManualScrollActive.value) {
    return manualLyricIndex.value
  }
  return activeLyricIndex.value
})

const manualLyricTimeLabel = computed(() => {
  if (manualLyricIndex.value < 0) return '--:--'
  const line = lyricLines.value[manualLyricIndex.value]
  if (!line) return '--:--'
  return formatSec(line.time)
})

const currentLyricLine = computed(() => {
  const idx = activeLyricIndex.value
  if (idx < 0) return null
  return lyricLines.value[idx]
})

function cancelLyricScrollRaf() {
  if (lyricScrollRaf !== null) {
    window.cancelAnimationFrame(lyricScrollRaf)
    lyricScrollRaf = null
  }
}

function cancelManualLyricRaf() {
  if (manualLyricRaf !== null) {
    window.cancelAnimationFrame(manualLyricRaf)
    manualLyricRaf = null
  }
}

function clearManualHideTimer() {
  if (manualHideTimer !== null) {
    window.clearTimeout(manualHideTimer)
    manualHideTimer = null
  }
}

function findClosestLyricIndexToCenter(): number {
  const container = lyricListRef.value
  if (!container || !lyricLineRefs.value.length) return -1

  // Always align manual target calculation with the visual baseline host.
  const baselineHost = lyricBoxRef.value ?? container
  const hostRect = baselineHost.getBoundingClientRect()
  const centerY = hostRect.top + hostRect.height / 2
  let closestIndex = -1
  let minDistance = Number.POSITIVE_INFINITY

  for (let i = 0; i < lyricLineRefs.value.length; i++) {
    const lineEl = lyricLineRefs.value[i]
    if (!lineEl) continue
    const rect = lineEl.getBoundingClientRect()
    const lineCenterY = rect.top + rect.height / 2
    const distance = Math.abs(lineCenterY - centerY)
    if (distance < minDistance) {
      minDistance = distance
      closestIndex = i
    }
  }

  return closestIndex
}

function updateManualLyricTarget() {
  if (!isLyricManualScrollActive.value) return
  const index = findClosestLyricIndexToCenter()
  if (index >= 0) {
    manualLyricIndex.value = index
  }
}

function scheduleManualLyricTargetUpdate() {
  cancelManualLyricRaf()
  manualLyricRaf = window.requestAnimationFrame(() => {
    manualLyricRaf = null
    updateManualLyricTarget()
  })
}

async function scrollLyricToIndex(index: number, force = false) {
  if (index < 0) return
  if (!force && index === lastScrolledLyricIndex.value) return
  await nextTick()
  const container = lyricListRef.value
  const lineEl = lyricLineRefs.value[index]
  if (!container || !lineEl) return

  lastScrolledLyricIndex.value = index
  cancelLyricScrollRaf()

  lyricScrollRaf = window.requestAnimationFrame(() => {
    lyricScrollRaf = null
    const containerRect = container.getBoundingClientRect()
    const lineRect = lineEl.getBoundingClientRect()
    const delta = lineRect.top - containerRect.top - (container.clientHeight / 2 - lineEl.clientHeight / 2)
    const target = Math.max(0, container.scrollTop + delta)
    const distance = Math.abs(target - container.scrollTop)

    if (distance < 8) return
    container.scrollTo({
      top: target,
      behavior: distance > 72 ? 'smooth' : 'auto'
    })
  })
}

function exitManualLyricScroll(opts?: { resumeAuto?: boolean; syncAutoLine?: boolean }) {
  const resumeAuto = opts?.resumeAuto ?? true
  const syncAutoLine = opts?.syncAutoLine ?? true

  isLyricManualScrollActive.value = false
  manualLyricIndex.value = -1
  clearManualHideTimer()
  cancelManualLyricRaf()

  if (!resumeAuto) return

  isAutoLyricFollowEnabled.value = true
  lastScrolledLyricIndex.value = -1

  if (!syncAutoLine) return
  const index = activeLyricIndex.value
  if (index >= 0) {
    void scrollLyricToIndex(index, true)
  }
}

function armManualHideTimer() {
  clearManualHideTimer()
  manualHideTimer = window.setTimeout(() => {
    exitManualLyricScroll({ resumeAuto: true, syncAutoLine: true })
  }, 2000)
}

function enterManualLyricScroll() {
  if (!lyricLines.value.length) return
  if (!isLyricManualScrollActive.value) {
    isLyricManualScrollActive.value = true
    isAutoLyricFollowEnabled.value = false
    const fallback = activeLyricIndex.value >= 0 ? activeLyricIndex.value : 0
    manualLyricIndex.value = fallback
  }
  scheduleManualLyricTargetUpdate()
  armManualHideTimer()
}

function onLyricWheel() {
  enterManualLyricScroll()
}

function onLyricScroll() {
  if (!isLyricManualScrollActive.value) return
  scheduleManualLyricTargetUpdate()
}

function onManualLyricPlay() {
  if (manualLyricIndex.value < 0) return
  const line = lyricLines.value[manualLyricIndex.value]
  if (!line) return
  emit('seek', Math.floor(line.time))
  exitManualLyricScroll({ resumeAuto: true, syncAutoLine: false })
}

async function syncLyricViewportAfterLayoutChange() {
  await nextTick()

  if (isLyricManualScrollActive.value) {
    scheduleManualLyricTargetUpdate()
    armManualHideTimer()
    return
  }

  const index = activeLyricIndex.value
  if (index >= 0) {
    lastScrolledLyricIndex.value = -1
    void scrollLyricToIndex(index, true)
  }
}

function resetLyricInteractionState() {
  isLyricManualScrollActive.value = false
  manualLyricIndex.value = -1
  isAutoLyricFollowEnabled.value = true
  clearManualHideTimer()
  cancelManualLyricRaf()
}

watch(
  activeLyricIndex,
  async (index) => {
    if (!isAutoLyricFollowEnabled.value) return
    await scrollLyricToIndex(index)
  },
  { flush: 'post' }
)

watch(
  () => `${props.currentSong?.provider ?? ''}:${props.currentSong?.id ?? ''}`,
  () => {
    const song = props.currentSong
    resetLyricInteractionState()
    lastScrolledLyricIndex.value = -1
    cancelLyricScrollRaf()
    if (!song) {
      lyricLines.value = []
      lyricError.value = ''
      lyricLineRefs.value = []
      return
    }
    lyricLineRefs.value = []
    fetchLyrics(song)
  },
  { immediate: true }
)

watch(hasRomanization, (enabled) => {
  if (!enabled) {
    showRomanization.value = false
  }
})

watch([showTranslation, showRomanization], () => {
  void syncLyricViewportAfterLayoutChange()
})

onBeforeUnmount(() => {
  resetLyricInteractionState()
  cancelLyricScrollRaf()
})
</script>
