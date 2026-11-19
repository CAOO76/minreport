(function () {
  var isNative = false;
  try {
    isNative = Boolean(
      (typeof window !== 'undefined' &&
        window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform()) ||
      (typeof navigator !== 'undefined' &&
        typeof navigator.userAgent === 'string' &&
        navigator.userAgent.indexOf('MinReportAppId/') !== -1)
    );
  } catch (e) { }

  function normalizeLang(raw) {
    if (typeof raw !== 'string') return '';
    var code = raw.trim().slice(0, 2).toLowerCase();
    return code === 'es' || code === 'en' || code === 'pt' ? code : '';
  }

  function detectDeviceLang() {
    try {
      if (typeof window !== 'undefined' && typeof window.__MINREPORT_NATIVE_LOCALE__ === 'string') {
        var winMatch = normalizeLang(window.__MINREPORT_NATIVE_LOCALE__);
        if (winMatch) return winMatch;
      }
      if (typeof navigator !== 'undefined') {
        if (typeof navigator.userAgent === 'string') {
          var uaMatch = /MinReportLocale\/([a-zA-Z-]+)/.exec(navigator.userAgent);
          if (uaMatch && uaMatch[1]) {
            var uaLang = normalizeLang(uaMatch[1]);
            if (uaLang) return uaLang;
          }
        }
        if (Array.isArray(navigator.languages)) {
          for (var i = 0; i < navigator.languages.length; i++) {
            var candidate = normalizeLang(navigator.languages[i]);
            if (candidate) return candidate;
          }
        }
        var navLang = normalizeLang(navigator.language);
        if (navLang) return navLang;
      }
    } catch (e) { }
    return 'es';
  }

  try {
    var localTheme = localStorage.getItem('theme');
    var isDarkSystem =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (isNative) {
      try {
        localStorage.removeItem('theme');
      } catch (_e) { }
      localTheme = null;
    }

    var effectiveDark =
      localTheme === 'dark' ||
      (!localTheme &&
        (typeof window !== 'undefined' && typeof window.__MINREPORT_NATIVE_DARK__ === 'boolean'
          ? window.__MINREPORT_NATIVE_DARK__
          : isDarkSystem));

    if (effectiveDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    document.documentElement.style.colorScheme = effectiveDark ? 'dark' : 'light';
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute('content', effectiveDark ? '#000000' : '#FFFFFF');
    }
  } catch (e) { }

  try {
    var rawLang = localStorage.getItem('i18nextLng');
    if (isNative) {
      try {
        localStorage.removeItem('i18nextLng');
      } catch (_e) { }
      document.documentElement.lang = detectDeviceLang();
    } else {
      var storedLang = normalizeLang(rawLang);
      document.documentElement.lang = storedLang || detectDeviceLang();
    }
  } catch (e) {
    try {
      document.documentElement.lang = 'es';
    } catch (_err) { }
  }
})();
