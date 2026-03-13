import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import LoginPanel from './components/LoginPanel.vue';
import PlayerPanel from './components/PlayerPanel.vue';
import { enqueueSongToPlugin, fetchVolumeFromPlugin, fetchQueueFromPlugin, nextSongByPlugin, pauseSongByPlugin, playQueueIndexByPlugin, removeQueueIndexByPlugin, playSongResumeByPlugin, seekSongByPlugin, setVolumeByPlugin, previousSongByPlugin } from './pluginBridge';
import QueuePanel from './components/QueuePanel.vue';
import { fetchRobotSyncState } from './robotSync';
import SearchPanel from './components/SearchPanel.vue';
const queue = ref([]);
const currentIndex = ref(0);
const isPlaying = ref(false);
const progressSec = ref(0);
const volume = ref(70);
const robotSong = ref(null);
const pluginStatus = ref('待同步');
const pausedProgressSnapshotSec = ref(null);
let syncTimer;
let progressTimer;
const lastRobotSongKey = ref('');
function isUrlLike(text) {
    return /^https?:\/\//i.test(String(text || '').trim());
}
function hasValidRobotMetadata(song) {
    if (!song)
        return false;
    if (isUrlLike(song.title))
        return false;
    if (!song.title.trim())
        return false;
    return true;
}
const currentSong = computed(() => {
    const queueSong = queue.value[currentIndex.value] ?? null;
    if (!robotSong.value)
        return queueSong;
    if (!hasValidRobotMetadata(robotSong.value) && queueSong) {
        return queueSong;
    }
    return robotSong.value;
});
async function refreshQueueState() {
    const state = await fetchQueueFromPlugin(100);
    queue.value = state.queue;
    currentIndex.value = state.currentIndex;
}
async function refreshQueueStateUntilSong(song, prevQueueLength, maxRetry = 6) {
    for (let attempt = 0; attempt < maxRetry; attempt++) {
        await refreshQueueState();
        if (queue.value.length > prevQueueLength ||
            queue.value.some((item) => item.id === song.id || item.title === song.title)) {
            return true;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
    return false;
}
async function syncRobotState() {
    try {
        const state = await fetchRobotSyncState();
        if (!state) {
            isPlaying.value = false;
            progressSec.value = 0;
            pausedProgressSnapshotSec.value = null;
            return;
        }
        const nextSongKey = `${state.currentSong?.provider ?? ''}:${state.currentSong?.id ?? ''}`;
        const songChanged = nextSongKey !== lastRobotSongKey.value;
        lastRobotSongKey.value = nextSongKey;
        robotSong.value = state.currentSong;
        isPlaying.value = state.isPlaying;
        if (state.isPlaying) {
            pausedProgressSnapshotSec.value = null;
            progressSec.value = state.progressSec;
        }
        else {
            // Keep the paused position stable even if backend position keeps drifting while paused.
            if (pausedProgressSnapshotSec.value == null) {
                pausedProgressSnapshotSec.value = state.progressSec;
            }
            progressSec.value = pausedProgressSnapshotSec.value;
        }
        if (songChanged) {
            refreshQueueState().catch(() => {
                // ignore transient queue refresh errors on song transition
            });
        }
    }
    catch {
        // keep previous ui state when sync failed
    }
}
async function addToQueue(song) {
    try {
        const prevQueueLength = queue.value.length;
        await enqueueSongToPlugin(song);
        const found = await refreshQueueStateUntilSong(song, prevQueueLength);
        if (!found) {
            pluginStatus.value = '已提交（队列同步中）';
            window.setTimeout(() => {
                refreshQueueState().catch(() => {
                    // ignore delayed queue sync failures
                });
            }, 1200);
        }
        else {
            pluginStatus.value = '已对齐';
        }
        await syncRobotState();
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        pluginStatus.value = `同步失败：${msg}`;
    }
}
async function playByIndex(index) {
    if (!queue.value[index])
        return;
    const targetSong = queue.value[index];
    async function stepJumpToIndex(targetIndex) {
        const total = queue.value.length;
        if (total <= 1)
            return;
        const from = ((currentIndex.value % total) + total) % total;
        const to = ((targetIndex % total) + total) % total;
        const forwardSteps = (to - from + total) % total;
        const backwardSteps = (from - to + total) % total;
        const useForward = forwardSteps <= backwardSteps;
        const steps = useForward ? forwardSteps : backwardSteps;
        for (let i = 0; i < steps; i++) {
            if (useForward) {
                await nextSongByPlugin();
            }
            else {
                await previousSongByPlugin();
            }
        }
    }
    try {
        let usedStepFallback = false;
        try {
            await playQueueIndexByPlugin(index);
            await refreshQueueState();
            const current = queue.value[currentIndex.value];
            const goWorked = Boolean(current && current.id === targetSong.id);
            if (!goWorked) {
                usedStepFallback = true;
                await stepJumpToIndex(index);
            }
        }
        catch {
            usedStepFallback = true;
            await stepJumpToIndex(index);
        }
        await refreshQueueState();
        await syncRobotState();
        pluginStatus.value = usedStepFallback ? '已对齐（步进跳转）' : '已对齐';
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        pluginStatus.value = `同步失败：${msg}`;
    }
}
async function removeByIndex(index) {
    if (!queue.value[index])
        return;
    try {
        await removeQueueIndexByPlugin(index);
        await refreshQueueState();
        await syncRobotState();
        pluginStatus.value = '已对齐';
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        pluginStatus.value = `同步失败：${msg}`;
    }
}
async function nextSong() {
    try {
        await nextSongByPlugin();
        await refreshQueueState();
        await syncRobotState();
        pluginStatus.value = '已对齐';
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        pluginStatus.value = `同步失败：${msg}`;
    }
}
async function prevSong() {
    try {
        await previousSongByPlugin();
        await refreshQueueState();
        await syncRobotState();
        pluginStatus.value = '已对齐';
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        pluginStatus.value = `同步失败：${msg}`;
    }
}
async function togglePlay() {
    if (!currentSong.value)
        return;
    try {
        if (isPlaying.value) {
            await pauseSongByPlugin();
        }
        else {
            const resumeSec = pausedProgressSnapshotSec.value ?? progressSec.value;
            await playSongResumeByPlugin();
            if (resumeSec > 0) {
                try {
                    await seekSongByPlugin(resumeSec);
                }
                catch {
                    // Resume should still proceed even if seek is unsupported for this source.
                }
            }
        }
        await syncRobotState();
        pluginStatus.value = '已对齐';
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        pluginStatus.value = `同步失败：${msg}`;
    }
}
async function seekTo(target) {
    if (!currentSong.value)
        return;
    const normalized = Math.max(0, Math.min(target, currentSong.value.durationSec));
    progressSec.value = normalized;
    if (!isPlaying.value) {
        pausedProgressSnapshotSec.value = normalized;
    }
    try {
        await seekSongByPlugin(normalized);
        await syncRobotState();
        pluginStatus.value = '已对齐';
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        pluginStatus.value = `同步失败：${msg}`;
    }
}
async function setVolume(target) {
    const normalized = Math.max(0, Math.min(100, Math.round(target)));
    volume.value = normalized;
    try {
        await setVolumeByPlugin(normalized);
        pluginStatus.value = '已对齐';
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        pluginStatus.value = `同步失败：${msg}`;
    }
}
onMounted(() => {
    syncRobotState();
    fetchVolumeFromPlugin().then((value) => {
        volume.value = value;
    }).catch(() => {
        // keep default volume value
    });
    refreshQueueState().catch((error) => {
        const msg = error instanceof Error ? error.message : '未知错误';
        pluginStatus.value = `同步失败：${msg}`;
    });
    syncTimer = window.setInterval(syncRobotState, 1000);
    progressTimer = window.setInterval(() => {
        if (!isPlaying.value || !currentSong.value)
            return;
        progressSec.value = Math.min(progressSec.value + 0.25, currentSong.value.durationSec);
    }, 250);
});
onBeforeUnmount(() => {
    if (syncTimer)
        window.clearInterval(syncTimer);
    if (progressTimer)
        window.clearInterval(progressTimer);
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.main, __VLS_intrinsicElements.main)({
    ...{ class: "container" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.header, __VLS_intrinsicElements.header)({
    ...{ class: "topbar" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h1, __VLS_intrinsicElements.h1)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "topbar-right" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "status" },
    ...{ class: (__VLS_ctx.pluginStatus === '已对齐' ? 'ok' : 'pause') },
});
(__VLS_ctx.pluginStatus);
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
    ...{ class: "status" },
    ...{ class: (__VLS_ctx.isPlaying ? 'ok' : 'pause') },
});
(__VLS_ctx.isPlaying ? '播放中' : '已暂停');
/** @type {[typeof LoginPanel, ]} */ ;
// @ts-ignore
const __VLS_0 = __VLS_asFunctionalComponent(LoginPanel, new LoginPanel({}));
const __VLS_1 = __VLS_0({}, ...__VLS_functionalComponentArgsRest(__VLS_0));
/** @type {[typeof PlayerPanel, ]} */ ;
// @ts-ignore
const __VLS_3 = __VLS_asFunctionalComponent(PlayerPanel, new PlayerPanel({
    ...{ 'onNext': {} },
    ...{ 'onPrev': {} },
    ...{ 'onToggle': {} },
    ...{ 'onSeek': {} },
    ...{ 'onVolume': {} },
    currentSong: (__VLS_ctx.currentSong),
    isPlaying: (__VLS_ctx.isPlaying),
    progressSec: (__VLS_ctx.progressSec),
    volume: (__VLS_ctx.volume),
}));
const __VLS_4 = __VLS_3({
    ...{ 'onNext': {} },
    ...{ 'onPrev': {} },
    ...{ 'onToggle': {} },
    ...{ 'onSeek': {} },
    ...{ 'onVolume': {} },
    currentSong: (__VLS_ctx.currentSong),
    isPlaying: (__VLS_ctx.isPlaying),
    progressSec: (__VLS_ctx.progressSec),
    volume: (__VLS_ctx.volume),
}, ...__VLS_functionalComponentArgsRest(__VLS_3));
let __VLS_6;
let __VLS_7;
let __VLS_8;
const __VLS_9 = {
    onNext: (__VLS_ctx.nextSong)
};
const __VLS_10 = {
    onPrev: (__VLS_ctx.prevSong)
};
const __VLS_11 = {
    onToggle: (__VLS_ctx.togglePlay)
};
const __VLS_12 = {
    onSeek: (__VLS_ctx.seekTo)
};
const __VLS_13 = {
    onVolume: (__VLS_ctx.setVolume)
};
var __VLS_5;
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "grid" },
});
/** @type {[typeof SearchPanel, ]} */ ;
// @ts-ignore
const __VLS_14 = __VLS_asFunctionalComponent(SearchPanel, new SearchPanel({
    ...{ 'onAdd': {} },
}));
const __VLS_15 = __VLS_14({
    ...{ 'onAdd': {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_14));
let __VLS_17;
let __VLS_18;
let __VLS_19;
const __VLS_20 = {
    onAdd: (__VLS_ctx.addToQueue)
};
var __VLS_16;
/** @type {[typeof QueuePanel, ]} */ ;
// @ts-ignore
const __VLS_21 = __VLS_asFunctionalComponent(QueuePanel, new QueuePanel({
    ...{ 'onPlayIndex': {} },
    ...{ 'onRemoveIndex': {} },
    queue: (__VLS_ctx.queue),
    currentIndex: (__VLS_ctx.currentIndex),
}));
const __VLS_22 = __VLS_21({
    ...{ 'onPlayIndex': {} },
    ...{ 'onRemoveIndex': {} },
    queue: (__VLS_ctx.queue),
    currentIndex: (__VLS_ctx.currentIndex),
}, ...__VLS_functionalComponentArgsRest(__VLS_21));
let __VLS_24;
let __VLS_25;
let __VLS_26;
const __VLS_27 = {
    onPlayIndex: (__VLS_ctx.playByIndex)
};
const __VLS_28 = {
    onRemoveIndex: (__VLS_ctx.removeByIndex)
};
var __VLS_23;
/** @type {__VLS_StyleScopedClasses['container']} */ ;
/** @type {__VLS_StyleScopedClasses['topbar']} */ ;
/** @type {__VLS_StyleScopedClasses['topbar-right']} */ ;
/** @type {__VLS_StyleScopedClasses['status']} */ ;
/** @type {__VLS_StyleScopedClasses['status']} */ ;
/** @type {__VLS_StyleScopedClasses['grid']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            LoginPanel: LoginPanel,
            PlayerPanel: PlayerPanel,
            QueuePanel: QueuePanel,
            SearchPanel: SearchPanel,
            queue: queue,
            currentIndex: currentIndex,
            isPlaying: isPlaying,
            progressSec: progressSec,
            volume: volume,
            pluginStatus: pluginStatus,
            currentSong: currentSong,
            addToQueue: addToQueue,
            playByIndex: playByIndex,
            removeByIndex: removeByIndex,
            nextSong: nextSong,
            prevSong: prevSong,
            togglePlay: togglePlay,
            seekTo: seekTo,
            setVolume: setVolume,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
