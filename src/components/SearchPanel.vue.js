import { MUSIC_API_BASE } from '../apiConfig';
import { computed, nextTick, ref } from 'vue';
import { isLoggedIn, withAuthUrl } from '../auth';
const keyword = ref('');
const results = ref([]);
const totalCount = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const errorText = ref('');
const canLoadMore = ref(false);
const listRef = ref(null);
const PAGE_SIZE = 20;
let searchToken = 0;
const API_BASE = MUSIC_API_BASE;
const __VLS_emit = defineEmits();
const emptyText = computed(() => (keyword.value ? '没有匹配结果，换个关键词试试' : '输入关键词开始搜索'));
const loginHint = computed(() => (isLoggedIn() ? '网易云音乐：已登录' : '网易云音乐：未登录（部分歌曲可能无法搜索或播放）'));
const resultCountText = computed(() => {
    if (!results.value.length)
        return '';
    return totalCount.value > 0 ? `已加载 ${results.value.length}/${totalCount.value} 条结果` : `已加载 ${results.value.length} 条结果`;
});
function toArtistName(artists) {
    if (Array.isArray(artists)) {
        return artists.map((item) => item?.name ?? item?.title ?? '').filter(Boolean).join(' / ') || '未知歌手';
    }
    return String(artists ?? '未知歌手');
}
function parseNeteaseSongs(raw) {
    const songs = raw?.result?.songs ?? raw?.songs ?? [];
    return songs.map((song) => ({
        id: String(song?.id ?? ''),
        provider: 'netease',
        cover: song?.al?.picUrl ?? song?.album?.picUrl ?? 'https://dummyimage.com/300x300/1f2937/9ca3af&text=WY',
        title: song?.name ?? '未知歌曲',
        artist: toArtistName(song?.ar ?? song?.artists),
        album: song?.al?.name ?? song?.album?.name ?? '未知专辑',
        durationSec: Math.max(1, Math.floor((song?.dt ?? song?.duration ?? 0) / 1000))
    })).filter((item) => item.id);
}
function mergeUniqueSongs(base, incoming) {
    if (!incoming.length)
        return base;
    const seen = new Set(base.map((item) => `${item.provider}:${item.id}`));
    const merged = [...base];
    for (const song of incoming) {
        const key = `${song.provider}:${song.id}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        merged.push(song);
    }
    return merged;
}
async function fetchJson(url) {
    const response = await fetch(withAuthUrl(url));
    if (!response.ok) {
        throw new Error(`请求失败：${response.status}`);
    }
    return response.json();
}
async function searchNeteasePage(base, kw, offset, limit) {
    const encoded = encodeURIComponent(kw);
    const tries = [
        `${base}/cloudsearch?keywords=${encoded}&type=1&limit=${limit}&offset=${offset}`,
        `${base}/search?keywords=${encoded}&type=1&limit=${limit}&offset=${offset}`
    ];
    for (const url of tries) {
        try {
            const data = await fetchJson(url);
            const parsed = parseNeteaseSongs(data);
            const total = Number(data?.result?.songCount ?? data?.songCount ?? 0);
            return { songs: parsed, total: Number.isFinite(total) ? total : 0 };
        }
        catch {
            continue;
        }
    }
    return { songs: [], total: 0 };
}
async function loadMore(force = false) {
    if ((!force && !canLoadMore.value) || loadingMore.value || loading.value)
        return;
    loadingMore.value = true;
    const token = searchToken;
    try {
        const nextOffset = results.value.length;
        const { songs, total } = await searchNeteasePage(API_BASE, keyword.value, nextOffset, PAGE_SIZE);
        if (token !== searchToken)
            return;
        if (total > 0) {
            totalCount.value = total;
        }
        if (songs.length) {
            results.value = mergeUniqueSongs(results.value, songs);
        }
        const reachedTotal = totalCount.value > 0 && results.value.length >= totalCount.value;
        canLoadMore.value = !reachedTotal && songs.length === PAGE_SIZE;
    }
    finally {
        if (token === searchToken) {
            loadingMore.value = false;
        }
    }
}
function onListScroll() {
    const el = listRef.value;
    if (!el || !canLoadMore.value || loadingMore.value || loading.value)
        return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (nearBottom) {
        loadMore();
    }
}
async function doSearch() {
    if (!keyword.value) {
        searchToken += 1;
        results.value = [];
        totalCount.value = 0;
        canLoadMore.value = false;
        errorText.value = '';
        return;
    }
    const token = searchToken + 1;
    searchToken = token;
    loading.value = true;
    loadingMore.value = false;
    errorText.value = '';
    results.value = [];
    totalCount.value = 0;
    canLoadMore.value = false;
    try {
        const { songs, total } = await searchNeteasePage(API_BASE, keyword.value, 0, PAGE_SIZE);
        if (token !== searchToken)
            return;
        results.value = mergeUniqueSongs([], songs);
        totalCount.value = total;
        canLoadMore.value = songs.length === PAGE_SIZE && (total <= 0 || songs.length < total);
        if (!songs.length) {
            errorText.value = '未从网易云接口获取到结果，请检查接口地址与返回格式';
            return;
        }
        await nextTick();
        const el = listRef.value;
        if (el && el.scrollHeight <= el.clientHeight && canLoadMore.value) {
            await loadMore(true);
        }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        errorText.value = `搜索失败：${msg}（可能是跨域或接口不可达）`;
    }
    finally {
        if (token === searchToken) {
            loading.value = false;
        }
    }
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "card panel-card search-card" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "result-header" },
});
(__VLS_ctx.loginHint);
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "search-row" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.input)({
    ...{ onKeyup: (__VLS_ctx.doSearch) },
    value: (__VLS_ctx.keyword),
    type: "text",
    placeholder: "输入歌曲名 / 歌手 / 专辑",
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.doSearch) },
    ...{ class: "btn btn-primary" },
    disabled: (__VLS_ctx.loading),
});
(__VLS_ctx.loading ? '搜索中...' : '搜索');
if (__VLS_ctx.errorText) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "result-header" },
    });
    (__VLS_ctx.errorText);
}
if (__VLS_ctx.results.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "result-header" },
    });
    (__VLS_ctx.resultCountText);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ onScroll: (__VLS_ctx.onListScroll) },
    ref: "listRef",
    ...{ class: "result-list scroll-list result-scroll-list" },
});
/** @type {typeof __VLS_ctx.listRef} */ ;
for (const [song, index] of __VLS_getVForSourceType((__VLS_ctx.results))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.article, __VLS_intrinsicElements.article)({
        key: (song.provider + '-' + song.id + '-' + index),
        ...{ class: "song-card" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.img)({
        src: (song.cover),
        alt: "cover",
        ...{ class: "song-cover" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "song-meta" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "song-title" },
    });
    (song.title);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "song-sub" },
    });
    (song.artist);
    (song.album);
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.$emit('add', song);
            } },
        ...{ class: "btn" },
    });
}
if (__VLS_ctx.canLoadMore) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "list-footnote" },
    });
    (__VLS_ctx.results.length);
    (__VLS_ctx.totalCount ? `/${__VLS_ctx.totalCount}` : '');
}
if (!__VLS_ctx.results.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty" },
    });
    (__VLS_ctx.emptyText);
}
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['search-card']} */ ;
/** @type {__VLS_StyleScopedClasses['result-header']} */ ;
/** @type {__VLS_StyleScopedClasses['search-row']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn-primary']} */ ;
/** @type {__VLS_StyleScopedClasses['result-header']} */ ;
/** @type {__VLS_StyleScopedClasses['result-header']} */ ;
/** @type {__VLS_StyleScopedClasses['result-list']} */ ;
/** @type {__VLS_StyleScopedClasses['scroll-list']} */ ;
/** @type {__VLS_StyleScopedClasses['result-scroll-list']} */ ;
/** @type {__VLS_StyleScopedClasses['song-card']} */ ;
/** @type {__VLS_StyleScopedClasses['song-cover']} */ ;
/** @type {__VLS_StyleScopedClasses['song-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['song-title']} */ ;
/** @type {__VLS_StyleScopedClasses['song-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['list-footnote']} */ ;
/** @type {__VLS_StyleScopedClasses['empty']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            keyword: keyword,
            results: results,
            totalCount: totalCount,
            loading: loading,
            errorText: errorText,
            canLoadMore: canLoadMore,
            listRef: listRef,
            emptyText: emptyText,
            loginHint: loginHint,
            resultCountText: resultCountText,
            onListScroll: onListScroll,
            doSearch: doSearch,
        };
    },
    __typeEmits: {},
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
    __typeEmits: {},
});
; /* PartiallyEnd: #4569/main.vue */
