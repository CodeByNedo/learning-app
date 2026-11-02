function applyTheme(theme) {
    const value = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = value;
    document.documentElement.style.colorScheme = value;
    try { localStorage.setItem('ajde.theme', value); } catch {}
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.themeChoice === value));
    });
}
try { applyTheme(localStorage.getItem('ajde.theme')); } catch { applyTheme('light'); }
