<template>
  <section class="card">
    <div class="queue-header">
      <h2>播放队列</h2>
      <span>共 {{ queue.length }} 首</span>
    </div>

    <div ref="listRef" v-if="queue.length" class="queue-list scroll-list" @scroll="onListScroll">
      <article
        v-for="(song, index) in visibleQueue"
        :key="song.provider + '-' + song.id + '-' + index"
        class="queue-item"
        :class="{ active: index === currentIndex }"
      >
        <div class="queue-left">
          <span class="index">{{ index + 1 }}</span>
          <img :src="song.cover" alt="cover" class="mini-cover" />
          <div>
            <div class="song-title">{{ song.title }}</div>
            <div class="song-sub">{{ song.artist }} · {{ song.album }}</div>
          </div>
        </div>
        <div class="queue-action">
          <button
            class="queue-remove-btn"
            :class="{ disabled: index === currentIndex }"
            :title="index === currentIndex ? '当前播放中，禁止移除' : '从播放队列移除'"
            :aria-label="index === currentIndex ? '当前播放中，禁止移除' : '从播放队列移除'"
            :disabled="index === currentIndex"
            @click="$emit('remove-index', index)"
          >
            ×
          </button>
          <div v-if="index === currentIndex" class="queue-playing" aria-label="播放中">
            <span class="playing-text">播放中</span>
            <span class="playing-bars" aria-hidden="true">
              <i></i>
              <i></i>
              <i></i>
              <i></i>
            </span>
          </div>
          <button v-else class="btn queue-play-btn" @click="$emit('play-index', index)">播放此曲</button>
        </div>
      </article>
      <div v-if="visibleQueue.length < queue.length" class="list-footnote">下滑加载更多（{{ visibleQueue.length }}/{{ queue.length }}）</div>
    </div>
    <div v-else class="empty">还没有歌曲，去搜索并加入队列吧</div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SongItem } from '../types'

const props = defineProps<{
  queue: SongItem[]
  currentIndex: number
}>()

defineEmits<{
  'play-index': [number]
  'remove-index': [number]
}>()

const listRef = ref<HTMLElement | null>(null)
const visibleCount = ref(15)
const STEP = 15

const visibleQueue = computed(() => props.queue.slice(0, visibleCount.value))

function ensureVisibleCount() {
  const queueLength = props.queue.length
  if (queueLength <= 0) {
    visibleCount.value = STEP
    return
  }

  const base = Math.min(queueLength, Math.max(STEP, visibleCount.value))
  const mustInclude = props.currentIndex + 1
  visibleCount.value = Math.min(queueLength, Math.max(base, mustInclude))
}

function onListScroll() {
  const el = listRef.value
  if (!el || visibleCount.value >= props.queue.length) return
  const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24
  if (nearBottom) {
    visibleCount.value = Math.min(props.queue.length, visibleCount.value + STEP)
  }
}

watch(() => props.queue.length, () => {
  ensureVisibleCount()
}, { immediate: true })

watch(() => props.currentIndex, () => {
  ensureVisibleCount()
}, { immediate: true })
</script>
