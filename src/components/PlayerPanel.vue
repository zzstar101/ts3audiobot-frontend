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

          <div class="lyric-box" v-if="lyricLines.length">
            <div class="lyric-list" ref="lyricListRef">
              <div
                v-for="(line, index) in lyricLines"
                :key="line.time + '-' + index"
                :ref="(element) => setLyricLineRef(element as HTMLElement | null, index)"
                class="lyric-line"
                :class="{ active: index === activeLyricIndex }"
              >
                <div class="lyric-main">{{ line.main }}</div>
                <div class="lyric-extra" v-if="showTranslation && line.trans">{{ line.trans }}</div>
                <div class="lyric-extra" v-if="showRomanization && line.roma">{{ line.roma }}</div>
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
            <button class="icon-btn" @click="$emit('prev')" aria-label="上一首">⏮</button>
            <button class="icon-btn play-main" @click="$emit('toggle')" aria-label="播放或暂停">
              {{ isPlaying ? '⏸' : '▶' }}
            </button>
            <button class="icon-btn" @click="$emit('next')" aria-label="下一首">⏭</button>
          </div>

          <div class="volume-row">
            <span class="volume-icon">🔊</span>
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
import { computed, nextTick, ref, watch } from 'vue'
import { MUSIC_API_BASE } from '../apiConfig'
import { withAuthUrl } from '../auth'
import type { SongItem } from '../types'

const props = defineProps<{
  currentSong: SongItem | null
  isPlaying: boolean
  progressSec: number
  volume: number
}>()

const emit = defineEmits<{
  seek: [number]
  next: []
  prev: []
  toggle: []
  volume: [number]
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
const lyricListRef = ref<HTMLElement | null>(null)
const lyricLineRefs = ref<HTMLElement[]>([])
const lastScrolledLyricIndex = ref(-1)
let lyricScrollRaf: number | null = null
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

const currentLyricLine = computed(() => {
  const idx = activeLyricIndex.value
  if (idx < 0) return null
  return lyricLines.value[idx]
})

watch(
  activeLyricIndex,
  async (index) => {
    if (index < 0) return
    if (index === lastScrolledLyricIndex.value) return
    await nextTick()
    const container = lyricListRef.value
    const lineEl = lyricLineRefs.value[index]
    if (!container || !lineEl) return

    lastScrolledLyricIndex.value = index
    if (lyricScrollRaf !== null) {
      window.cancelAnimationFrame(lyricScrollRaf)
      lyricScrollRaf = null
    }

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
  },
  { flush: 'post' }
)

watch(
  () => `${props.currentSong?.provider ?? ''}:${props.currentSong?.id ?? ''}`,
  () => {
    const song = props.currentSong
    lastScrolledLyricIndex.value = -1
    if (lyricScrollRaf !== null) {
      window.cancelAnimationFrame(lyricScrollRaf)
      lyricScrollRaf = null
    }
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
</script>
