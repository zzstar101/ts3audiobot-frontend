const props = defineProps();
const __VLS_emit = defineEmits();
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "card panel-card queue-card" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "queue-header" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
(__VLS_ctx.queue.length);
if (__VLS_ctx.queue.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "queue-list scroll-list queue-scroll-list" },
    });
    for (const [song, index] of __VLS_getVForSourceType((__VLS_ctx.queue))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.article, __VLS_intrinsicElements.article)({
            key: (song.provider + '-' + song.id + '-' + index),
            ...{ class: "queue-item" },
            ...{ class: ({ active: index === __VLS_ctx.currentIndex }) },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "queue-left" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "index" },
        });
        (index + 1);
        __VLS_asFunctionalElement(__VLS_intrinsicElements.img)({
            src: (song.cover),
            alt: "cover",
            ...{ class: "mini-cover" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "queue-meta" },
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
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "queue-action" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
            ...{ onClick: (...[$event]) => {
                    if (!(__VLS_ctx.queue.length))
                        return;
                    __VLS_ctx.$emit('remove-index', index);
                } },
            ...{ class: "queue-remove-btn" },
            ...{ class: ({ disabled: index === __VLS_ctx.currentIndex }) },
            title: (index === __VLS_ctx.currentIndex ? '当前播放中，禁止移除' : '从播放队列移除'),
            'aria-label': (index === __VLS_ctx.currentIndex ? '当前播放中，禁止移除' : '从播放队列移除'),
            disabled: (index === __VLS_ctx.currentIndex),
        });
        if (index === __VLS_ctx.currentIndex) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "queue-playing" },
                'aria-label': "播放中",
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "playing-text" },
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
                ...{ class: "playing-bars" },
                'aria-hidden': "true",
            });
            __VLS_asFunctionalElement(__VLS_intrinsicElements.i, __VLS_intrinsicElements.i)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.i, __VLS_intrinsicElements.i)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.i, __VLS_intrinsicElements.i)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.i, __VLS_intrinsicElements.i)({});
        }
        else {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
                ...{ onClick: (...[$event]) => {
                        if (!(__VLS_ctx.queue.length))
                            return;
                        if (!!(index === __VLS_ctx.currentIndex))
                            return;
                        __VLS_ctx.$emit('play-index', index);
                    } },
                ...{ class: "btn queue-play-btn" },
            });
        }
    }
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty" },
    });
}
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['panel-card']} */ ;
/** @type {__VLS_StyleScopedClasses['queue-card']} */ ;
/** @type {__VLS_StyleScopedClasses['queue-header']} */ ;
/** @type {__VLS_StyleScopedClasses['queue-list']} */ ;
/** @type {__VLS_StyleScopedClasses['scroll-list']} */ ;
/** @type {__VLS_StyleScopedClasses['queue-scroll-list']} */ ;
/** @type {__VLS_StyleScopedClasses['queue-item']} */ ;
/** @type {__VLS_StyleScopedClasses['queue-left']} */ ;
/** @type {__VLS_StyleScopedClasses['index']} */ ;
/** @type {__VLS_StyleScopedClasses['mini-cover']} */ ;
/** @type {__VLS_StyleScopedClasses['queue-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['song-title']} */ ;
/** @type {__VLS_StyleScopedClasses['song-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['queue-action']} */ ;
/** @type {__VLS_StyleScopedClasses['queue-remove-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['queue-playing']} */ ;
/** @type {__VLS_StyleScopedClasses['playing-text']} */ ;
/** @type {__VLS_StyleScopedClasses['playing-bars']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['queue-play-btn']} */ ;
/** @type {__VLS_StyleScopedClasses['empty']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {};
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
