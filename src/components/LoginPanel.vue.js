import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MUSIC_API_BASE } from '../apiConfig';
import { authState, clearCookie, isLoggedIn, setCookie, withAuthUrl } from '../auth';
import { fetchPluginLoginStatus, syncNeteaseCookieToPlugin } from '../pluginBridge';
import { pollQrLogin, startQrLogin } from '../qrLogin';
const API_BASE = MUSIC_API_BASE;
const PLUGIN_STATUS_POLL_MS = 24 * 60 * 60 * 1000;
const loading = ref(false);
const qrVisible = ref(false);
const qrImage = ref('');
const qrText = ref('');
const qrKey = ref('');
const qrStatus = ref('');
const qrError = ref('');
const profileLoading = ref(false);
const profileError = ref('');
const accountName = ref('');
const memberLevel = ref('');
const pluginStatusText = ref('未知');
const pluginStatusUser = ref('');
const pluginSyncLoading = ref(false);
const pluginSyncError = ref('');
let timer;
let pluginStatusTimer;
async function refreshPluginStatus() {
    try {
        const status = await fetchPluginLoginStatus();
        if (!status) {
            pluginStatusText.value = '未知';
            pluginStatusUser.value = '';
            return;
        }
        pluginStatusText.value = status.neteaseLoggedIn ? '已登录' : '未登录/已掉线';
        pluginStatusUser.value = status.neteaseUser;
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        pluginStatusText.value = `读取失败：${msg}`;
        pluginStatusUser.value = '';
    }
}
async function syncCookieIntoPlugin(cookie) {
    pluginSyncLoading.value = true;
    pluginSyncError.value = '';
    try {
        await syncNeteaseCookieToPlugin(cookie);
        await refreshPluginStatus();
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        pluginSyncError.value = `写入插件失败：${msg}`;
    }
    finally {
        pluginSyncLoading.value = false;
    }
}
async function fetchAccountInfo() {
    if (!isLoggedIn()) {
        accountName.value = '';
        memberLevel.value = '';
        profileError.value = '';
        return;
    }
    profileLoading.value = true;
    profileError.value = '';
    try {
        const statusRes = await fetch(withAuthUrl(`${API_BASE}/login/status?timestamp=${Date.now()}`));
        if (!statusRes.ok) {
            throw new Error(`账户状态请求失败：${statusRes.status}`);
        }
        const statusData = await statusRes.json();
        accountName.value = String(statusData?.data?.profile?.nickname ?? '');
        const vipRes = await fetch(withAuthUrl(`${API_BASE}/vip/info?timestamp=${Date.now()}`));
        if (vipRes.ok) {
            const vipData = await vipRes.json();
            const level = Number(vipData?.data?.musicPackage?.vipLevel ?? vipData?.data?.associator?.vipLevel ?? statusData?.data?.profile?.vipType ?? 0);
            memberLevel.value = level > 0 ? `VIP${level}` : '普通用户';
        }
        else {
            const fallbackLevel = Number(statusData?.data?.profile?.vipType ?? 0);
            memberLevel.value = fallbackLevel > 0 ? `VIP${fallbackLevel}` : '普通用户';
        }
        if (!accountName.value) {
            accountName.value = '未知用户';
        }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        profileError.value = `账户信息获取失败：${msg}`;
    }
    finally {
        profileLoading.value = false;
    }
}
function logout() {
    clearCookie();
    accountName.value = '';
    memberLevel.value = '';
    profileError.value = '';
    pluginSyncError.value = '';
    refreshPluginStatus();
}
function openManualLogin() {
    const cookie = window.prompt('请输入网易云 Cookie（将仅保存在当前浏览器本地）', '');
    if (cookie === null)
        return;
    const next = cookie.trim();
    if (!next)
        return;
    setCookie(next);
    fetchAccountInfo();
}
function stopPolling() {
    if (timer) {
        window.clearInterval(timer);
        timer = undefined;
    }
}
function stopPluginStatusPolling() {
    if (pluginStatusTimer) {
        window.clearInterval(pluginStatusTimer);
        pluginStatusTimer = undefined;
    }
}
function closeQr() {
    stopPolling();
    qrVisible.value = false;
}
async function pollOnce() {
    if (!qrKey.value)
        return;
    try {
        const result = await pollQrLogin(qrKey.value);
        qrStatus.value = result.message;
        if (result.status === 'success' && result.cookie) {
            setCookie(result.cookie);
            qrError.value = '';
            qrStatus.value = '登录成功，已写入凭据';
            fetchAccountInfo();
            stopPolling();
            return;
        }
        if (result.status === 'expired' || result.status === 'failed') {
            qrError.value = result.message;
            stopPolling();
        }
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        qrError.value = `轮询失败：${msg}`;
        stopPolling();
    }
}
async function openQrLogin() {
    loading.value = true;
    qrError.value = '';
    qrStatus.value = '正在获取二维码...';
    stopPolling();
    try {
        const start = await startQrLogin();
        qrVisible.value = true;
        qrKey.value = start.key;
        qrImage.value = start.qrImage;
        qrText.value = start.qrText;
        qrStatus.value = '请使用手机扫码，系统将自动检测状态';
        timer = window.setInterval(() => {
            pollOnce();
        }, 2500);
        await pollOnce();
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        qrVisible.value = true;
        qrImage.value = '';
        qrText.value = '';
        qrKey.value = '';
        qrStatus.value = '无法开启扫码登录';
        qrError.value = `${msg}。你可以先使用“手动凭据”登录。`;
    }
    finally {
        loading.value = false;
    }
}
onBeforeUnmount(() => {
    stopPolling();
    stopPluginStatusPolling();
});
watch(() => authState.neteaseCookie, (cookie) => {
    fetchAccountInfo();
    if (cookie) {
        syncCookieIntoPlugin(cookie);
    }
});
onMounted(() => {
    fetchAccountInfo();
    refreshPluginStatus();
    pluginStatusTimer = window.setInterval(refreshPluginStatus, PLUGIN_STATUS_POLL_MS);
});
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
__VLS_asFunctionalElement(__VLS_intrinsicElements.section, __VLS_intrinsicElements.section)({
    ...{ class: "card login-panel" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "login-list" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.article, __VLS_intrinsicElements.article)({
    ...{ class: "login-item" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "login-meta" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "login-title" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "login-sub" },
});
(__VLS_ctx.isLoggedIn() ? '已登录' : '未登录');
if (__VLS_ctx.isLoggedIn() && __VLS_ctx.accountName) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "login-sub" },
    });
    (__VLS_ctx.accountName);
}
if (__VLS_ctx.isLoggedIn() && __VLS_ctx.memberLevel) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "login-sub" },
    });
    (__VLS_ctx.memberLevel);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "login-sub" },
});
(__VLS_ctx.pluginStatusText);
if (__VLS_ctx.pluginStatusUser) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "login-sub" },
    });
    (__VLS_ctx.pluginStatusUser);
}
if (__VLS_ctx.pluginSyncLoading) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "login-sub" },
    });
}
if (__VLS_ctx.pluginSyncError) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "login-sub" },
    });
    (__VLS_ctx.pluginSyncError);
}
if (__VLS_ctx.isLoggedIn() && __VLS_ctx.profileLoading) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "login-sub" },
    });
}
if (__VLS_ctx.isLoggedIn() && __VLS_ctx.profileError) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "login-sub" },
    });
    (__VLS_ctx.profileError);
}
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "login-actions" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.openQrLogin) },
    ...{ class: "btn" },
    disabled: (__VLS_ctx.loading),
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.openManualLogin) },
    ...{ class: "btn" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
    ...{ onClick: (__VLS_ctx.logout) },
    ...{ class: "btn" },
    disabled: (!__VLS_ctx.isLoggedIn()),
});
if (__VLS_ctx.qrVisible) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "qr-panel" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "qr-head" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "qr-title" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.button, __VLS_intrinsicElements.button)({
        ...{ onClick: (__VLS_ctx.closeQr) },
        ...{ class: "btn" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "qr-body" },
    });
    if (__VLS_ctx.qrImage) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.img)({
            src: (__VLS_ctx.qrImage),
            alt: "登录二维码",
            ...{ class: "qr-image" },
        });
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "qr-fallback" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.a, __VLS_intrinsicElements.a)({
            href: (__VLS_ctx.qrText),
            target: "_blank",
            rel: "noreferrer",
        });
    }
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "qr-status" },
    });
    (__VLS_ctx.qrStatus);
    if (__VLS_ctx.qrError) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "qr-error" },
        });
        (__VLS_ctx.qrError);
    }
}
/** @type {__VLS_StyleScopedClasses['card']} */ ;
/** @type {__VLS_StyleScopedClasses['login-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['login-list']} */ ;
/** @type {__VLS_StyleScopedClasses['login-item']} */ ;
/** @type {__VLS_StyleScopedClasses['login-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['login-title']} */ ;
/** @type {__VLS_StyleScopedClasses['login-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['login-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['login-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['login-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['login-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['login-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['login-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['login-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['login-sub']} */ ;
/** @type {__VLS_StyleScopedClasses['login-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['qr-panel']} */ ;
/** @type {__VLS_StyleScopedClasses['qr-head']} */ ;
/** @type {__VLS_StyleScopedClasses['qr-title']} */ ;
/** @type {__VLS_StyleScopedClasses['btn']} */ ;
/** @type {__VLS_StyleScopedClasses['qr-body']} */ ;
/** @type {__VLS_StyleScopedClasses['qr-image']} */ ;
/** @type {__VLS_StyleScopedClasses['qr-fallback']} */ ;
/** @type {__VLS_StyleScopedClasses['qr-status']} */ ;
/** @type {__VLS_StyleScopedClasses['qr-error']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            isLoggedIn: isLoggedIn,
            loading: loading,
            qrVisible: qrVisible,
            qrImage: qrImage,
            qrText: qrText,
            qrStatus: qrStatus,
            qrError: qrError,
            profileLoading: profileLoading,
            profileError: profileError,
            accountName: accountName,
            memberLevel: memberLevel,
            pluginStatusText: pluginStatusText,
            pluginStatusUser: pluginStatusUser,
            pluginSyncLoading: pluginSyncLoading,
            pluginSyncError: pluginSyncError,
            logout: logout,
            openManualLogin: openManualLogin,
            closeQr: closeQr,
            openQrLogin: openQrLogin,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
