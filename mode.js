// Detects whether the classroom API exists. Static hosts (for example GitHub Pages) return 404 for /api/classroom,
// so the cloud-only links and the submit button are hidden. The offline practice features keep working either way.
(async () => {
  let cloud = false;
  try {
    const r = await fetch('api/classroom?op=me', { cache: 'no-store' });
    cloud = r.status !== 404;
  } catch {
    cloud = false;
  }
  document.documentElement.dataset.cloud = cloud ? 'on' : 'off';
})();

(() => {
  const saved = localStorage.getItem('pace-theme');
  const dark = saved ? saved === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const root = document.documentElement;
  const button = () => document.getElementById('themeToggle');
  function render() {
    const enabled = root.dataset.theme === 'dark';
    root.dataset.theme = enabled ? 'dark' : 'light';
    const toggle = button();
    if (toggle) { toggle.textContent = enabled ? '☀ 日間模式' : '☾ 夜間模式'; toggle.setAttribute('aria-pressed', String(enabled)); }
  }
  root.dataset.theme = dark ? 'dark' : 'light';
  document.addEventListener('DOMContentLoaded', () => { render(); button()?.addEventListener('click', () => { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('pace-theme', root.dataset.theme); render(); }); }, {once:true});
})();
