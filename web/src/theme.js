/* 主题管理：localStorage 'lc-theme' = 'light' | 'dark' | 'system'（默认跟随系统）。
   data-theme 始终解析为具体的 'light'/'dark' 写在 <html> 上；system 由 matchMedia 实时跟随。 */
const KEY = 'lc-theme';
let media = null;

export function getThemePref() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export function applyTheme() {
  const pref = getThemePref();
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (!media) {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    // 跟随系统时，OS 切换深浅色实时生效
    media.addEventListener('change', () => { if (getThemePref() === 'system') applyTheme(); });
  }
}

export function setThemePref(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* 隐私模式忽略 */ }
  applyTheme();
}
