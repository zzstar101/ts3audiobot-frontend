import { computed, nextTick, ref, watch } from 'vue';
import { MUSIC_API_BASE } from '../apiConfig';
import { withAuthUrl } from '../auth';
const props = defineProps();
const emit = defineEmits();
const showTranslation = ref(true);
const showRomanization = ref(false);
const lyricLoading = ref(false);
const lyricError = ref('');
const lyricLines = ref([]);
const lyricListRef = ref(null);
const lyricLineRefs = ref([]);
const lastScrolledLyricIndex = ref(-1);
let lyricScrollRaf = null;
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
const currentLyricLine = computed(() => {
    const idx = activeLyricIndex.value;
    if (idx < 0)
        return null;
    return lyricLines.value[idx];
});
watch(activeLyricIndex, async (index) => {
    if (index < 0)
        return;
    if (index === lastScrolledLyricIndex.value)
        return;
    await nextTick();
    const container = lyricListRef.value;
    const lineEl = lyricLineRefs.value[index];
    if (!container || !lineEl)
        return;
    lastScrolledLyricIndex.value = index;
    if (lyricScrollRaf !== null) {
        window.cancelAnimationFrame(lyricScrollRaf);
        lyricScrollRaf = null;
    }
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
}, { flush: 'post' });
watch(() => `${props.currentSong?.provider ?? ''}:${props.currentSong?.id ?? ''}`, () => {
    const song = props.currentSong;
    lastScrolledLyricIndex.value = -1;
    if (lyricScrollRaf !== null) {
        window.cancelAnimationFrame(lyricScrollRaf);
        lyricScrollRaf = null;
    }
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
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "lyric-list" },
            ref: "lyricListRef",
        });
        /** @type {typeof __VLS_ctx.lyricListRef} */ ;
        for (const [line, index] of __VLS_getVForSourceType((__VLS_ctx.lyricLines))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                key: (line.time + '-' + index),
                ref: ((element) => __VLS_ctx.setLyricLineRef(element, index)),
                ...{ class: "lyric-line" },
                ...{ class: ({ active: index === __VLS_ctx.activeLyricIndex }) },
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
                __VLS_ctx.$emit('prev');
            } },
        ...{ class: "icon-btn" },
        'aria-label': "上一首",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.currentSong))
                    return;
                __VLS_ctx.$emit('toggle');
            } },
        ...{ class: "icon-btn play-main" },
        'aria-label': "播放或暂停",
    });
    (__VLS_ctx.isPlaying ? '⏸' : '▶');
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.currentSong))
                    return;
                __VLS_ctx.$emit('next');
            } },
        ...{ class: "icon-btn" },
        'aria-label': "下一首",
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "volume-row" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "volume-icon" },
    });
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
/** @type {__VLS_StyleScopedClasses['player-bottom']} */ ;
/** @type {__VLS_StyleScopedClasses['progress-row']} */ ;
/** @type {__VLS_StyleScopedClasses['slider']} */ ;
/** @type {__VLS_StyleScopedClasses['music-slider']} */ ;
/** @type {__VLS_StyleScopedClasses['bottom-controls']} */ ;
/** @type {__VLS_StyleScopedClasses['controls']} */ ;
/** @type {__VLS_StyleScopedClasses['controls-center']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['play-main']} */ ;
/** @type {__VLS_StyleScopedClasses['icon-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['volume-row']} */ ;
/** @type {__VLS_StyleScopedClasses['volume-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['slider']} */ ;
/** @type {__VLS_StyleScopedClasses['music-slider']} */ ;
/** @type {__VLS_StyleScopedClasses['volume-slider']} */ ;
/** @type {__VLS_StyleScopedClasses['empty']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            showTranslation: showTranslation,
            showRomanization: showRomanization,
            lyricLoading: lyricLoading,
            lyricError: lyricError,
            lyricLines: lyricLines,
            lyricListRef: lyricListRef,
            panelBgStyle: panelBgStyle,
            formatSec: formatSec,
            providerText: providerText,
            displayProgressSec: displayProgressSec,
            onSeekInput: onSeekInput,
            onSeekCommit: onSeekCommit,
            onVolumeChange: onVolumeChange,
            setLyricLineRef: setLyricLineRef,
            hasRomanization: hasRomanization,
            activeLyricIndex: activeLyricIndex,
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
