import { reactive } from 'vue';
const STORAGE_KEY = 'ts6-jukebox-auth';
function loadAuth() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return { neteaseCookie: '' };
        }
        const parsed = JSON.parse(raw);
        return {
            neteaseCookie: String(parsed.neteaseCookie ?? '')
        };
    }
    catch {
        return { neteaseCookie: '' };
    }
}
function saveAuth(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
export const authState = reactive(loadAuth());
export function isLoggedIn() {
    return authState.neteaseCookie.trim().length > 0;
}
export function setCookie(cookie) {
    authState.neteaseCookie = cookie.trim();
    saveAuth(authState);
}
export function clearCookie() {
    authState.neteaseCookie = '';
    saveAuth(authState);
}
export function getCookie() {
    return authState.neteaseCookie;
}
export function withAuthUrl(url) {
    const cookie = getCookie();
    if (!cookie)
        return url;
    const connector = url.includes('?') ? '&' : '?';
    return `${url}${connector}cookie=${encodeURIComponent(cookie)}`;
}
