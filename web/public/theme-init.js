(function () {
  try {
    var localTheme = localStorage.getItem('theme');
    var isDarkSystem =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (localTheme === 'dark' || (!localTheme && isDarkSystem)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {}

  try {
    var rawLang = localStorage.getItem('i18nextLng');
    var baseLang = typeof rawLang === 'string' ? rawLang.split('-')[0].toLowerCase() : '';
    if (baseLang === 'es' || baseLang === 'en' || baseLang === 'pt') {
      document.documentElement.lang = baseLang;
    } else {
      document.documentElement.lang = 'es';
    }
  } catch (e) {
    try {
      document.documentElement.lang = 'es';
    } catch (_err) {}
  }
  try {
    var rawScale = localStorage.getItem('minreport_ergonomic_scale');
    var normalizedScale = (rawScale === '125' || rawScale === '150') ? rawScale : '100';
    var rootPx = normalizedScale === '150' ? '24px' : (normalizedScale === '125' ? '20px' : '16px');
    document.documentElement.dataset.ergonomicScale = normalizedScale;
    document.documentElement.style.fontSize = rootPx;
  } catch (e) {}
})();
