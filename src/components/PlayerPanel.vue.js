import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ListOrdered, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2 } from 'lucide-vue-next';
import { MUSIC_API_BASE } from '../apiConfig';
import { withAuthUrl } from '../auth';
const props = defineProps();
const emit = defineEmits();
const showTranslation = ref(true);
const showRomanization = ref(false);
const lyricLoading = ref(false);
const lyricError = ref('');
const lyricLines = ref([]);
const lyricBoxRef = ref(null);
const lyricListRef = ref(null);
const lyricLineRefs = ref([]);
const lastScrolledLyricIndex = ref(-1);
const isLyricManualScrollActive = ref(false);
const manualLyricIndex = ref(-1);
const isAutoLyricFollowEnabled = ref(true);
let lyricScrollRaf = null;
let manualLyricRaf = null;
let manualHideTimer = null;
const seekPreviewSec = ref(null);
const isSeeking = ref(false);
const API_BASE = MUSIC_API_BASE;
const panelBgStyle = computed(() => {
    if (!props.currentSong)
        return {};
    return {
        backgroundImage: `linear-gradient(90deg, rgba(15,23,42,.86), rgba(15,23,42,.74)), url(${props.currentSong.cover})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
    };
});
const modeIconMap = {
    1: ListOrdered,
    2: Repeat1,
    3: Repeat,
    4: Shuffle
};
const modeFullTextMap = {
    1: '顺序播放',
    2: '单曲循环',
    3: '顺序循环',
    4: '随机播放'
};
const modeDisabled = computed(() => props.modeBusy || props.playType === 1);
const modeIcon = computed(() => modeIconMap[props.playMode] ?? ListOrdered);
const modeHint = computed(() => {
    if (props.playType === 1)
        return 'FM 模式不可切换播放模式';
    if (props.modeBusy)
        return '播放模式切换中...';
    return `当前：${modeFullTextMap[props.playMode]}`;
});
function formatSec(sec) {
    const s = Math.max(0, Math.floor(sec));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}
function providerText() {
    return '网易云';
}
const displayProgressSec = computed(() => {
    if (isSeeking.value && seekPreviewSec.value != null) {
        return seekPreviewSec.value;
    }
    return props.progressSec;
});
function onSeekInput(event) {
    const target = event.target;
    isSeeking.value = true;
    seekPreviewSec.value = Number(target.value);
}
function onSeekCommit(event) {
    const target = event.target;
    const value = Number(target.value);
    isSeeking.value = false;
    seekPreviewSec.value = null;
    emit('seek', value);
}
function onVolumeChange(event) {
    const target = event.target;
    emit('volume', Number(target.value));
}
function parseTimestampToSec(raw) {
    const match = raw.match(/\[(\d+):(\d+(?:\.\d+)?)\]/);
    if (!match)
        return null;
    return Number(match[1]) * 60 + Number(match[2]);
}
function setLyricLineRef(element, index) {
    if (!element)
        return;
    lyricLineRefs.value[index] = element;
}
function parseLrc(raw) {
    const map = new Map();
    if (!raw)
        return map;
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
        const ts = parseTimestampToSec(line);
        if (ts == null)
            continue;
        const text = line.replace(/\[[^\]]+\]/g, '').trim();
        if (!text)
            continue;
        map.set(Number(ts.toFixed(2)), text);
    }
    return map;
}
function buildLyricLines(mainRaw, transRaw, romaRaw) {
    const main = parseLrc(mainRaw);
    const trans = parseLrc(transRaw);
    const roma = parseLrc(romaRaw);
    return [...main.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([time, text]) => ({
        time,
        main: text,
        trans: trans.get(time) ?? '',
        roma: roma.get(time) ?? ''
    }));
}
async function fetchLyrics(song) {
    lyricLoading.value = true;
    lyricError.value = '';
    lyricLines.value = [];
    try {
        const url = `${API_BASE}/lyric?id=${encodeURIComponent(song.id)}`;
        const res = await fetch(withAuthUrl(url));
        if (!res.ok)
            throw new Error(`歌词请求失败：${res.status}`);
        const data = await res.json();
        const mainRaw = String(data?.lrc?.lyric ?? '');
        const transRaw = String(data?.tlyric?.lyric ?? '');
        const romaRaw = String(data?.romalrc?.lyric ?? data?.roma?.lyric ?? '');
        lyricLines.value = buildLyricLines(mainRaw, transRaw, romaRaw);
        if (!lyricLines.value.length) {
            lyricError.value = '该歌曲暂无可用歌词';
        }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        lyricError.value = msg;
    }
    finally {
        lyricLoading.value = false;
    }
}
const hasRomanization = computed(() => lyricLines.value.some((line) => Boolean(line.roma)));
const activeLyricIndex = computed(() => {
    if (!lyricLines.value.length)
        return -1;
    let index = -1;
    for (let i = 0; i < lyricLines.value.length; i++) {
        if (lyricLines.value[i].time <= props.progressSec + 0.05) {
            index = i;
        }
        else {
            break;
        }
    }
    return index;
});
const highlightedLyricIndex = computed(() => {
    if (isLyricManualScrollActive.value) {
        return manualLyricIndex.value;
    }
    return activeLyricIndex.value;
});
const manualLyricTimeLabel = computed(() => {
    if (manualLyricIndex.value < 0)
        return '--:--';
    const line = lyricLines.value[manualLyricIndex.value];
    if (!line)
        return '--:--';
    return formatSec(line.time);
});
const currentLyricLine = computed(() => {
    const idx = activeLyricIndex.value;
    if (idx < 0)
        return null;
    return lyricLines.value[idx];
});
function cancelLyricScrollRaf() {
    if (lyricScrollRaf !== null) {
        window.cancelAnimationFrame(lyricScrollRaf);
        lyricScrollRaf = null;
    }
}
function cancelManualLyricRaf() {
    if (manualLyricRaf !== null) {
        window.cancelAnimationFrame(manualLyricRaf);
        manualLyricRaf = null;
    }
}
function clearManualHideTimer() {
    if (manualHideTimer !== null) {
        window.clearTimeout(manualHideTimer);
        manualHideTimer = null;
    }
}
function findClosestLyricIndexToCenter() {
    const container = lyricListRef.value;
    if (!container || !lyricLineRefs.value.length)
        return -1;
    // Always align manual target calculation with the visual baseline host.
    const baselineHost = lyricBoxRef.value ?? container;
    const hostRect = baselineHost.getBoundingClientRect();
    const centerY = hostRect.top + hostRect.height / 2;
    let closestIndex = -1;
    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < lyricLineRefs.value.length; i++) {
        const lineEl = lyricLineRefs.value[i];
        if (!lineEl)
            continue;
        const rect = lineEl.getBoundingClientRect();
        const lineCenterY = rect.top + rect.height / 2;
        const distance = Math.abs(lineCenterY - centerY);
        if (distance < minDistance) {
            minDistance = distance;
            closestIndex = i;
        }
    }
    return closestIndex;
}
function updateManualLyricTarget() {
    if (!isLyricManualScrollActive.value)
        return;
    const index = findClosestLyricIndexToCenter();
    if (index >= 0) {
        manualLyricIndex.value = index;
    }
}
function scheduleManualLyricTargetUpdate() {
    cancelManualLyricRaf();
    manualLyricRaf = window.requestAnimationFrame(() => {
        manualLyricRaf = null;
        updateManualLyricTarget();
    });
}
async function scrollLyricToIndex(index, force = false) {
    if (index < 0)
        return;
    if (!force && index === lastScrolledLyricIndex.value)
        return;
    await nextTick();
    const container = lyricListRef.value;
    const lineEl = lyricLineRefs.value[index];
    if (!container || !lineEl)
        return;
    lastScrolledLyricIndex.value = index;
    cancelLyricScrollRaf();
    lyricScrollRaf = window.requestAnimationFrame(() => {
        lyricScrollRaf = null;
        const containerRect = container.getBoundingClientRect();
        const lineRect = lineEl.getBoundingClientRect();
        const delta = lineRect.top - containerRect.top - (container.clientHeight / 2 - lineEl.clientHeight / 2);
        const target = Math.max(0, container.scrollTop + delta);
        const distance = Math.abs(target - container.scrollTop);
        if (distance < 8)
            return;
        container.scrollTo({
            top: target,
            behavior: distance > 72 ? 'smooth' : 'auto'
        });
    });
}
function exitManualLyricScroll(opts) {
    const resumeAuto = opts?.resumeAuto ?? true;
    const syncAutoLine = opts?.syncAutoLine ?? true;
    isLyricManualScrollActive.value = false;
    manualLyricIndex.value = -1;
    clearManualHideTimer();
    cancelManualLyricRaf();
    if (!resumeAuto)
        return;
    isAutoLyricFollowEnabled.value = true;
    lastScrolledLyricIndex.value = -1;
    if (!syncAutoLine)
        return;
    const index = activeLyricIndex.value;
    if (index >= 0) {
        void scrollLyricToIndex(index, true);
    }
}
function armManualHideTimer() {
    clearManualHideTimer();
    manualHideTimer = window.setTimeout(() => {
        exitManualLyricScroll({ resumeAuto: true, syncAutoLine: true });
    }, 2000);
}
function enterManualLyricScroll() {
    if (!lyricLines.value.length)
        return;
    if (!isLyricManualScrollActive.value) {
        isLyricManualScrollActive.value = true;
        isAutoLyricFollowEnabled.value = false;
        const fallback = activeLyricIndex.value >= 0 ? activeLyricIndex.value : 0;
        manualLyricIndex.value = fallback;
    }
    scheduleManualLyricTargetUpdate();
    armManualHideTimer();
}
function onLyricWheel() {
    enterManualLyricScroll();
}
function onLyricScroll() {
    if (!isLyricManualScrollActive.value)
        return;
    scheduleManualLyricTargetUpdate();
}
function onManualLyricPlay() {
    if (manualLyricIndex.value < 0)
        return;
    const line = lyricLines.value[manualLyricIndex.value];
    if (!line)
        return;
    emit('seek', Math.floor(line.time));
    exitManualLyricScroll({ resumeAuto: true, syncAutoLine: false });
}
async function syncLyricViewportAfterLayoutChange() {
    await nextTick();
    if (isLyricManualScrollActive.value) {
        scheduleManualLyricTargetUpdate();
        armManualHideTimer();
        return;
    }
    const index = activeLyricIndex.value;
    if (index >= 0) {
        lastScrolledLyricIndex.value = -1;
        void scrollLyricToIndex(index, true);
    }
}
function resetLyricInteractionState() {
    isLyricManualScrollActive.value = false;
    manualLyricIndex.value = -1;
    isAutoLyricFollowEnabled.value = true;
    clearManualHideTimer();
    cancelManualLyricRaf();
}
watch(activeLyricIndex, async (index) => {
    if (!isAutoLyricFollowEnabled.value)
        return;
    await scrollLyricToIndex(index);
}, { flush: 'post' });
watch(() => `${props.currentSong?.provider ?? ''}:${props.currentSong?.id ?? ''}`, () => {
    const song = props.currentSong;
    resetLyricInteractionState();
    lastScrolledLyricIndex.value = -1;
    cancelLyricScrollRaf();
    if (!song) {
        lyricLines.value = [];
        lyricError.value = '';
        lyricLineRefs.value = [];
        return;
    }
    lyricLineRefs.value = [];
    fetchLyrics(song);
}, { immediate: true });
watch(hasRomanization, (enabled) => {
    if (!enabled) {
        showRomanization.value = false;
    }
});
watch([showTranslation, showRomanization], () => {
    void syncLyricViewportAfterLayoutChange();
});
onBeforeUnmount(() => {
    resetLyricInteractionState();
    cancelLyricScrollRaf();
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "card player-panel player-theme-netease" },
    ...{ style: (__VLS_ctx.panelBgStyle) },
});
if (__VLS_ctx.currentSong) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "player-main" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "player-stage" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "cover-wrap" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "cover-ring" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.img)({
        src: (__VLS_ctx.currentSong.cover),
        alt: "cover",
        ...{ class: "cover" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "meta" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "title-row player-song-title" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.strong, __VLS_intrinsicElements.strong)({});
    (__VLS_ctx.currentSong.title);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "provider-tag" },
    });
    (__VLS_ctx.providerText());
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "sub" },
    });
    (__VLS_ctx.currentSong.artist);
    (__VLS_ctx.currentSong.album);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "lyric-toolbar" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
        ...{ class: "lyric-switch" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        type: "checkbox",
    });
    (__VLS_ctx.showTranslation);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    __VLS_asFunctionalElement(__VLS_intrinsicElements.label, __VLS_intrinsicElements.label)({
        ...{ class: "lyric-switch" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        type: "checkbox",
        disabled: (!__VLS_ctx.hasRomanization),
    });
    (__VLS_ctx.showRomanization);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    if (__VLS_ctx.lyricLoading) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "lyric-hint" },
        });
    }
    else if (__VLS_ctx.lyricError) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "lyric-hint" },
        });
        (__VLS_ctx.lyricError);
    }
    if (__VLS_ctx.lyricLines.length) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "lyric-box" },
            ref: "lyricBoxRef",
        });
        /** @type {typeof __VLS_ctx.lyricBoxRef} */ ;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ onWheel: (__VLS_ctx.onLyricWheel) },
            ...{ onScroll: (__VLS_ctx.onLyricScroll) },
            ...{ class: "lyric-list" },
            ref: "lyricListRef",
        });
        /** @type {typeof __VLS_ctx.lyricListRef} */ ;
        for (const [line, index] of __VLS_getVForSourceType((__VLS_ctx.lyricLines))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                key: (line.time + '-' + index),
                ref: ((element) => __VLS_ctx.setLyricLineRef(element, index)),
                ...{ class: "lyric-line" },
                ...{ class: ({ active: index === __VLS_ctx.highlightedLyricIndex }) },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "lyric-main" },
            });
            (line.main);
            if (__VLS_ctx.showTranslation && line.trans) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "lyric-extra" },
                });
                (line.trans);
            }
            if (__VLS_ctx.showRomanization && line.roma) {
                __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                    ...{ class: "lyric-extra" },
                });
                (line.roma);
            }
        }
        if (__VLS_ctx.isLyricManualScrollActive) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "lyric-position-overlay" },
                'aria-hidden': "true",
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "lyric-position-dash" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "lyric-position-actions" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "lyric-position-time" },
            });
            (__VLS_ctx.manualLyricTimeLabel);
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (__VLS_ctx.onManualLyricPlay) },
                type: "button",
                ...{ class: "lyric-position-play" },
                disabled: (__VLS_ctx.manualLyricIndex < 0),
                'aria-label': "定位到当前歌词时间并播放",
            });
            const __VLS_0 = {}.Play;
            /** @type {[typeof __VLS_components.Play, ]} */ ;
            // @ts-ignore
            const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
                ...{ class: "icon-svg" },
                size: (14),
                strokeWidth: (2.4),
                'aria-hidden': "true",
            }));
            const __VLS_2 = __VLS_1({
                ...{ class: "icon-svg" },
                size: (14),
                strokeWidth: (2.4),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_1));
        }
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "player-bottom" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "progress-row" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    (__VLS_ctx.formatSec(__VLS_ctx.displayProgressSec));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        ...{ onInput: (__VLS_ctx.onSeekInput) },
        ...{ onChange: (__VLS_ctx.onSeekCommit) },
        ...{ class: "slider music-slider" },
        type: "range",
        min: (0),
        max: (__VLS_ctx.currentSong.durationSec),
        value: (__VLS_ctx.displayProgressSec),
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
    (__VLS_ctx.formatSec(__VLS_ctx.currentSong.durationSec));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "bottom-controls" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "controls controls-center" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.currentSong))
                    return;
                __VLS_ctx.emit('modeCycle');
            } },
        ...{ class: "icon-btn mode-btn" },
        ...{ class: ({ 'is-disabled': __VLS_ctx.modeDisabled, 'is-active': !__VLS_ctx.modeDisabled }) },
        disabled: (__VLS_ctx.modeDisabled),
        title: (__VLS_ctx.modeHint),
        'aria-label': "切换播放模式",
    });
    const __VLS_4 = ((__VLS_ctx.modeIcon));
    // @ts-ignore
    const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
        ...{ class: "icon-svg" },
        size: (18),
        strokeWidth: (2.2),
        'aria-hidden': "true",
    }));
    const __VLS_6 = __VLS_5({
        ...{ class: "icon-svg" },
        size: (18),
        strokeWidth: (2.2),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_5));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.currentSong))
                    return;
                __VLS_ctx.$emit('prev');
            } },
        ...{ class: "icon-btn" },
        'aria-label': "上一首",
    });
    const __VLS_8 = {}.SkipBack;
    /** @type {[typeof __VLS_components.SkipBack, ]} */ ;
    // @ts-ignore
    const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
        ...{ class: "icon-svg" },
        size: (18),
        strokeWidth: (2.2),
        'aria-hidden': "true",
    }));
    const __VLS_10 = __VLS_9({
        ...{ class: "icon-svg" },
        size: (18),
        strokeWidth: (2.2),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_9));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.currentSong))
                    return;
                __VLS_ctx.$emit('toggle');
            } },
        ...{ class: "icon-btn play-main" },
        'aria-label': "播放或暂停",
    });
    if (__VLS_ctx.isPlaying) {
        const __VLS_12 = {}.Pause;
        /** @type {[typeof __VLS_components.Pause, ]} */ ;
        // @ts-ignore
        const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({
            ...{ class: "icon-svg" },
            size: (20),
            strokeWidth: (2.4),
            'aria-hidden': "true",
        }));
        const __VLS_14 = __VLS_13({
            ...{ class: "icon-svg" },
            size: (20),
            strokeWidth: (2.4),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_13));
    }
    else {
        const __VLS_16 = {}.Play;
        /** @type {[typeof __VLS_components.Play, ]} */ ;
        // @ts-ignore
        const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
            ...{ class: "icon-svg" },
            size: (20),
            strokeWidth: (2.4),
            'aria-hidden': "true",
        }));
        const __VLS_18 = __VLS_17({
            ...{ class: "icon-svg" },
            size: (20),
            strokeWidth: (2.4),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_17));
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.currentSong))
                    return;
                __VLS_ctx.$emit('next');
            } },
        ...{ class: "icon-btn" },
        'aria-label': "下一首",
    });
    const __VLS_20 = {}.SkipForward;
    /** @type {[typeof __VLS_components.SkipForward, ]} */ ;
    // @ts-ignore
    const __VLS_21 = __VLS_asFunctionalComponent(__VLS_20, new __VLS_20({
        ...{ class: "icon-svg" },
        size: (18),
        strokeWidth: (2.2),
        'aria-hidden': "true",
    }));
    const __VLS_22 = __VLS_21({
        ...{ class: "icon-svg" },
        size: (18),
        strokeWidth: (2.2),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_21));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "volume-row" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "volume-icon" },
    });
    const __VLS_24 = {}.Volume2;
    /** @type {[typeof __VLS_components.Volume2, ]} */ ;
    // @ts-ignore
    const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
        ...{ class: "icon-svg" },
        size: (16),
        strokeWidth: (2.1),
        'aria-hidden': "true",
    }));
    const __VLS_26 = __VLS_25({
        ...{ class: "icon-svg" },
        size: (16),
        strokeWidth: (2.1),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_25));
    __VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
        ...{ onInput: (__VLS_ctx.onVolumeChange) },
        ...{ class: "slider music-slider volume-slider" },
        type: "range",
        min: "0",
        max: "100",
        value: (__VLS_ctx.volume),
    });
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty" },
    });
}
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['player-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['player-theme-netease']} */ ;
/** @type {__VLS_StyleScopedClasses['player-main']} */ ;
/** @type {__VLS_StyleScopedClasses['player-stage']} */ ;
/** @type {__VLS_StyleScopedClasses['cover-wrap']} */ ;
/** @type {__VLS_StyleScopedClasses['cover-ring']} */ ;
/** @type {__VLS_StyleScopedClasses['cover']} */ ;
/** @type {__VLS_StyleScopedClasses['meta']} */ ;
/** @type {__VLS_StyleScopedClasses['title-row']} */ ;
/** @type {__VLS_StyleScopedClasses['player-song-title']} */ ;
/** @type {__VLS_StyleScopedClasses['provider-tag']} */ ;
/** @type {__VLS_StyleScopedClasses['sub']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-toolbar']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-switch']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-switch']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-hint']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-hint']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-box']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-list']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-line']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-main']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-extra']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-extra']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-position-overlay']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-position-dash']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-position-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-position-time']} */ ;
/** @type {__VLS_StyleScopedClasses['lyric-position-play']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-svg']} */ ;
/** @type {__VLS_StyleScopedClasses['player-bottom']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-row']} */ ;
/** @type {__VLS_StyleScopedClasses['slider']} */ ;
/** @type {__VLS_StyleScopedClasses['music-slider']} */ ;
/** @type {__VLS_StyleScopedClasses['bottom-controls']} */ ;
/** @type {__VLS_StyleScopedClasses['controls']} */ ;
/** @type {__VLS_StyleScopedClasses['controls-center']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['mode-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-svg']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-svg']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['play-main']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-svg']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-svg']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-svg']} */ ;
/** @type {__VLS_StyleScopedClasses['volume-row']} */ ;
/** @type {__VLS_StyleScopedClasses['volume-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-svg']} */ ;
/** @type {__VLS_StyleScopedClasses['slider']} */ ;
/** @type {__VLS_StyleScopedClasses['music-slider']} */ ;
/** @type {__VLS_StyleScopedClasses['volume-slider']} */ ;
/** @type {__VLS_StyleScopedClasses['empty']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            Pause: Pause,
            Play: Play,
            SkipBack: SkipBack,
            SkipForward: SkipForward,
            Volume2: Volume2,
            emit: emit,
            showTranslation: showTranslation,
            showRomanization: showRomanization,
            lyricLoading: lyricLoading,
            lyricError: lyricError,
            lyricLines: lyricLines,
            lyricBoxRef: lyricBoxRef,
            lyricListRef: lyricListRef,
            isLyricManualScrollActive: isLyricManualScrollActive,
            manualLyricIndex: manualLyricIndex,
            panelBgStyle: panelBgStyle,
            modeDisabled: modeDisabled,
            modeIcon: modeIcon,
            modeHint: modeHint,
            formatSec: formatSec,
            providerText: providerText,
            displayProgressSec: displayProgressSec,
            onSeekInput: onSeekInput,
            onSeekCommit: onSeekCommit,
            onVolumeChange: onVolumeChange,
            setLyricLineRef: setLyricLineRef,
            hasRomanization: hasRomanization,
            highlightedLyricIndex: highlightedLyricIndex,
            manualLyricTimeLabel: manualLyricTimeLabel,
            onLyricWheel: onLyricWheel,
            onLyricScroll: onLyricScroll,
            onManualLyricPlay: onManualLyricPlay,
        };
    },
    __typeEmits: {},
    __typeProps: {},
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
    __typeEmits: {},
    __typeProps: {},
});
; /* PartiallyEnd: #4569/main.vue */
