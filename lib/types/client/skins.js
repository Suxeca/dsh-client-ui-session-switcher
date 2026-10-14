/**
 * Palette skins (深色/浅色/高对比). The color values live as CSS custom
 * properties in switcher.module.css (one `[data-skin=…]` block each); this
 * module only owns the name order, the display labels, and the localStorage
 * persistence. Flipping the `data-skin` attribute restyles the whole palette.
 * @module @suxeca/dsh-client-ui-session-switcher/client/skins
 */
/** Skin cycle order (the header button steps through it). */
export const SKIN_ORDER = ['dark', 'light', 'highcontrast'];
/** Display labels for the header skin button. */
export const SKIN_LABELS = {
    dark: '深色',
    light: '浅色',
    highcontrast: '高对比',
};
/** localStorage key backing the persisted skin choice. */
const SKIN_KEY = 'dsh.sessionSwitcher.skin';
/** Type guard: is this a known skin name? */
export function isSkinName(value) {
    return typeof value === 'string' && SKIN_ORDER.includes(value);
}
/** Read the persisted skin, defaulting to dark on absence/corruption. */
export function loadSkin() {
    try {
        const value = localStorage.getItem(SKIN_KEY);
        return isSkinName(value) ? value : 'dark';
    }
    catch {
        return 'dark';
    }
}
/** Persist the skin choice (storage failures are ignored). */
export function saveSkin(name) {
    try {
        localStorage.setItem(SKIN_KEY, name);
    }
    catch {
        /* storage unavailable */
    }
}
/** The next skin in the cycle order. */
export function nextSkin(name) {
    return SKIN_ORDER[(SKIN_ORDER.indexOf(name) + 1) % SKIN_ORDER.length];
}
