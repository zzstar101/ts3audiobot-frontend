<template>
  <main class="container">
    <header class="topbar">
      <h1>TS6 点歌台</h1>
      <div class="topbar-right">
        <span class="status" :class="pluginStatus === '已对齐' ? 'ok' : 'pause'">
          插件状态：{{ pluginStatus }}
        </span>
        <span class="status" :class="isPlaying ? 'ok' : 'pause'">
          机器人状态：{{ isPlaying ? '播放中' : '已暂停' }}
        </span>
      </div>
    </header>

    <LoginPanel />

    <PlayerPanel
      :current-song="currentSong"
      :is-playing="isPlaying"
      :progress-sec="progressSec"
      :volume="volume"
      :play-mode="playMode"
      :play-type="playType"
      :mode-busy="isModeBusy"
      @next="nextSong"
      @prev="prevSong"
      @toggle="togglePlay"
      @seek="seekTo"
      @volume="setVolume"
      @mode-cycle="cyclePlayMode"
    />

    <section class="grid">
      <SearchPanel @add="addToQueue" />
      <QueuePanel
        :queue="queue"
        :current-index="currentIndex"
        @play-index="playByIndex"
        @remove-index="removeByIndex"
        @clear-queue="clearQueue"
      />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import LoginPanel from './components/LoginPanel.vue'
import PlayerPanel from './components/PlayerPanel.vue'
import {
  clearQueueByPlugin,
  enqueueSongToPlugin,
  fetchVolumeFromPlugin,
  fetchQueueFromPlugin,
  nextSongByPlugin,
  pauseSongByPlugin,
  playQueueIndexByPlugin,
  removeQueueIndexByPlugin,
  playSongByPlugin,
  playSongResumeByPlugin,
  PLAY_MODE_LABELS,
  seekSongByPlugin,
  setPlayModeByPlugin,
  setVolumeByPlugin,
  previousSongByPlugin,
  type PlayMode,
  type PlayType
} from './pluginBridge'
import QueuePanel from './components/QueuePanel.vue'
import { fetchRobotSyncState } from './robotSync'
import SearchPanel from './components/SearchPanel.vue'
import type { SongItem } from './types'

const queue = ref<SongItem[]>([])
const currentIndex = ref(0)
const isPlaying = ref(false)
const progressSec = ref(0)
const volume = ref(70)
const robotSong = ref<SongItem | null>(null)
const pluginStatus = ref('待同步')
const playMode = ref<PlayMode>(1)
const playType = ref<PlayType | null>(null)
const modeName = ref(PLAY_MODE_LABELS[1])
const isModeBusy = ref(false)
const pausedProgressSnapshotSec = ref<number | null>(null)
const canCorrectPauseDrift = ref(true)
let syncTimer: number | undefined
let progressTimer: number | undefined
let lastPauseCorrectionAt = 0
const lastRobotSongKey = ref('')

function isUrlLike(text: string): boolean {
  return /^https?:\/\//i.test(String(text || '').trim())
}

function hasValidRobotMetadata(song: SongItem | null): boolean {
  if (!song) return false
  if (isUrlLike(song.title)) return false
  if (!song.title.trim()) return false
  return true
}

const currentSong = computed(() => {
  const queueSong = queue.value[currentIndex.value] ?? null
  if (!robotSong.value) return queueSong
  if (!hasValidRobotMetadata(robotSong.value) && queueSong) {
    return queueSong
  }
  return robotSong.value
})

async function refreshQueueState() {
  const state = await fetchQueueFromPlugin(100)
  queue.value = state.queue
  currentIndex.value = state.currentIndex
  if (state.playMode) {
    playMode.value = state.playMode
    modeName.value = state.modeName || PLAY_MODE_LABELS[state.playMode]
  }
  playType.value = state.playType
}

async function refreshQueueStateUntilSong(song: SongItem, prevQueueLength: number, maxRetry = 6): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    await refreshQueueState()
    if (
      queue.value.length > prevQueueLength ||
      queue.value.some((item) => item.id === song.id || item.title === song.title)
    ) {
      return true
    }
    await new Promise((resolve) => window.setTimeout(resolve, 350))
  }
  return false
}

async function syncRobotState() {
  try {
    const state = await fetchRobotSyncState()
    if (!state) {
      isPlaying.value = false
      progressSec.value = 0
      pausedProgressSnapshotSec.value = null
      return
    }
    const nextSongKey = `${state.currentSong?.provider ?? ''}:${state.currentSong?.id ?? ''}`
    const songChanged = nextSongKey !== lastRobotSongKey.value
    lastRobotSongKey.value = nextSongKey

    if (songChanged) {
      pausedProgressSnapshotSec.value = null
      canCorrectPauseDrift.value = true
    }

    robotSong.value = state.currentSong
    isPlaying.value = state.isPlaying
    if (state.isPlaying) {
      pausedProgressSnapshotSec.value = null
      canCorrectPauseDrift.value = true
      progressSec.value = state.progressSec
    } else {
      // Keep the paused position stable even if backend position keeps drifting while paused.
      if (pausedProgressSnapshotSec.value == null) {
        pausedProgressSnapshotSec.value = state.progressSec
      }

      // Guard backend pause position drift to avoid resume skipping to the next song.
      const drift = state.progressSec - pausedProgressSnapshotSec.value
      const now = Date.now()
      if (drift > 2 && canCorrectPauseDrift.value && now - lastPauseCorrectionAt > 1200) {
        lastPauseCorrectionAt = now
        try {
          await seekSongByPlugin(pausedProgressSnapshotSec.value)
        } catch {
          canCorrectPauseDrift.value = false
        }
      }

      progressSec.value = pausedProgressSnapshotSec.value
    }

    if (songChanged) {
      refreshQueueState().catch(() => {
        // ignore transient queue refresh errors on song transition
      })
    }
  } catch {
    // keep previous ui state when sync failed
  }
}

async function addToQueue(song: SongItem) {
  try {
    const prevQueueLength = queue.value.length
    await enqueueSongToPlugin(song)
    const found = await refreshQueueStateUntilSong(song, prevQueueLength)
    if (!found) {
      pluginStatus.value = '已提交（队列同步中）'
      window.setTimeout(() => {
        refreshQueueState().catch(() => {
          // ignore delayed queue sync failures
        })
      }, 1200)
    } else {
      pluginStatus.value = '已对齐'
    }
    await syncRobotState()
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatus.value = `同步失败：${msg}`
  }
}

async function playByIndex(index: number) {
  if (!queue.value[index]) return
  const targetSong = queue.value[index]

  async function stepJumpToIndex(targetIndex: number) {
    const total = queue.value.length
    if (total <= 1) return

    const from = ((currentIndex.value % total) + total) % total
    const to = ((targetIndex % total) + total) % total
    const forwardSteps = (to - from + total) % total
    const backwardSteps = (from - to + total) % total
    const useForward = forwardSteps <= backwardSteps
    const steps = useForward ? forwardSteps : backwardSteps

    for (let i = 0; i < steps; i++) {
      if (useForward) {
        await nextSongByPlugin()
      } else {
        await previousSongByPlugin()
      }
    }
  }

  try {
    let usedStepFallback = false

    try {
      await playQueueIndexByPlugin(index)
      await refreshQueueState()

      const current = queue.value[currentIndex.value]
      const goWorked = Boolean(current && current.id === targetSong.id)
      if (!goWorked) {
        usedStepFallback = true
        await stepJumpToIndex(index)
      }
    } catch {
      usedStepFallback = true
      await stepJumpToIndex(index)
    }

    await refreshQueueState()
    await syncRobotState()
    pluginStatus.value = usedStepFallback ? '已对齐（步进跳转）' : '已对齐'
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatus.value = `同步失败：${msg}`
  }
}

async function removeByIndex(index: number) {
  if (!queue.value[index]) return
  try {
    await removeQueueIndexByPlugin(index)
    await refreshQueueState()
    await syncRobotState()
    pluginStatus.value = '已对齐'
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatus.value = `同步失败：${msg}`
  }
}

async function clearQueue() {
  if (!queue.value.length) return
  try {
    await clearQueueByPlugin()
    await refreshQueueState()
    await syncRobotState()
    pluginStatus.value = '已清空播放列表'
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatus.value = `同步失败：${msg}`
  }
}

async function nextSong() {
  try {
    await nextSongByPlugin()
    await refreshQueueState()
    await syncRobotState()
    pluginStatus.value = '已对齐'
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatus.value = `同步失败：${msg}`
  }
}

async function prevSong() {
  try {
    await previousSongByPlugin()
    await refreshQueueState()
    await syncRobotState()
    pluginStatus.value = '已对齐'
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatus.value = `同步失败：${msg}`
  }
}

async function togglePlay() {
  if (!currentSong.value) return
  try {
    if (isPlaying.value) {
      const snapshotSec = Math.max(0, progressSec.value)
      pausedProgressSnapshotSec.value = snapshotSec
      await pauseSongByPlugin()
      if (snapshotSec > 0) {
        try {
          await seekSongByPlugin(snapshotSec)
        } catch {
          // Some sources may not support seek while paused.
        }
      }
    } else {
      const resumeSec = pausedProgressSnapshotSec.value ?? progressSec.value
      let preSeekWorked = false
      if (resumeSec > 0) {
        try {
          await seekSongByPlugin(resumeSec)
          preSeekWorked = true
        } catch {
          // Fallback to post-resume seek if paused seek is unsupported.
        }
      }
      await playSongResumeByPlugin()
      if (resumeSec > 0 && !preSeekWorked) {
        try {
          await seekSongByPlugin(resumeSec)
        } catch {
          // Resume should still proceed even if seek is unsupported for this source.
        }
      }
    }
    await syncRobotState()
    pluginStatus.value = '已对齐'
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatus.value = `同步失败：${msg}`
  }
}

async function seekTo(target: number) {
  if (!currentSong.value) return
  const normalized = Math.max(0, Math.min(target, currentSong.value.durationSec))
  progressSec.value = normalized
  if (!isPlaying.value) {
    pausedProgressSnapshotSec.value = normalized
  }
  try {
    await seekSongByPlugin(normalized)
    await syncRobotState()
    pluginStatus.value = '已对齐'
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatus.value = `同步失败：${msg}`
  }
}

async function setVolume(target: number) {
  const normalized = Math.max(0, Math.min(100, Math.round(target)))
  volume.value = normalized
  try {
    await setVolumeByPlugin(normalized)
    pluginStatus.value = '已对齐'
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatus.value = `同步失败：${msg}`
  }
}

function getNextPlayMode(mode: PlayMode): PlayMode {
  return mode === 4 ? 1 : ((mode + 1) as PlayMode)
}

async function cyclePlayMode() {
  if (isModeBusy.value) return
  if (playType.value === 1) {
    pluginStatus.value = 'FM模式下不可切换播放模式'
    return
  }

  const prevMode = playMode.value
  const nextMode = getNextPlayMode(prevMode)

  isModeBusy.value = true
  playMode.value = nextMode
  modeName.value = PLAY_MODE_LABELS[nextMode]

  try {
    await setPlayModeByPlugin(nextMode)
    await refreshQueueState()
    pluginStatus.value = `已切换：${modeName.value}`
  } catch (error) {
    playMode.value = prevMode
    modeName.value = PLAY_MODE_LABELS[prevMode]
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatus.value = `同步失败：${msg}`
  } finally {
    isModeBusy.value = false
  }
}

onMounted(() => {
  syncRobotState()
  fetchVolumeFromPlugin().then((value) => {
    volume.value = value
  }).catch(() => {
    // keep default volume value
  })
  refreshQueueState().catch((error) => {
    const msg = error instanceof Error ? error.message : '未知错误'
    pluginStatus.value = `同步失败：${msg}`
  })
  syncTimer = window.setInterval(syncRobotState, 1000)
  progressTimer = window.setInterval(() => {
    if (!isPlaying.value || !currentSong.value) return
    progressSec.value = Math.min(progressSec.value + 0.25, currentSong.value.durationSec)
  }, 250)
})

onBeforeUnmount(() => {
  if (syncTimer) window.clearInterval(syncTimer)
  if (progressTimer) window.clearInterval(progressTimer)
})
</script>
