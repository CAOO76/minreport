import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function readRepoFile(relPath: string): string {
    return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

function walkFiles(dirRel: string, ext: string, excludeDirFragments: string[]): string[] {
    const start = path.join(REPO_ROOT, dirRel);
    const out: string[] = [];
    const visit = (absDir: string) => {
        for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
            const absPath = path.join(absDir, entry.name);
            const relPath = path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
            if (entry.isDirectory()) {
                if (excludeDirFragments.some((frag) => relPath === frag || relPath.startsWith(`${frag}/`))) {
                    continue;
                }
                visit(absPath);
            } else if (entry.isFile() && entry.name.endsWith(ext)) {
                out.push(relPath);
            }
        }
    };
    visit(start);
    return out.sort();
}

const tsModuleCache = new Map<string, any>();

function loadWebTsModuleCjs(relPath: string): any {
    const absPath = path.join(REPO_ROOT, relPath);
    if (tsModuleCache.has(absPath)) {
        return tsModuleCache.get(absPath);
    }

    const code = fs.readFileSync(absPath, 'utf8');
    const transpiled = ts.transpileModule(code, {
        fileName: absPath,
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
            allowSyntheticDefaultImports: true,
        },
    }).outputText;

    const mod: { exports: any } = { exports: {} };
    tsModuleCache.set(absPath, mod.exports);

    const fileRequire = createRequire(absPath);
    const customRequire = (specifier: string) => {
        if (specifier.startsWith('.')) {
            const base = path.resolve(path.dirname(absPath), specifier);
            for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                    const candidateRel = path.relative(REPO_ROOT, candidate);
                    return loadWebTsModuleCjs(candidateRel);
                }
            }
        }
        return fileRequire(specifier);
    };

    const wrapper = new Function('require', 'module', 'exports', '__filename', '__dirname', transpiled);
    wrapper(customRequire, mod, mod.exports, absPath, path.dirname(absPath));
    tsModuleCache.set(absPath, mod.exports);
    return mod.exports;
}

function flattenLocaleObject(obj: unknown, prefix = ''): Map<string, string> {
    const map = new Map<string, string>();
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return map;
    }
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const nextKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const [childKey, childVal] of flattenLocaleObject(value, nextKey)) {
                map.set(childKey, childVal);
            }
        } else {
            assert.equal(
                typeof value,
                'string',
                `Locale key "${nextKey}" must be a string leaf, got ${typeof value}`
            );
            map.set(nextKey, value as string);
        }
    }
    return map;
}

function assertLocaleParity(label: string, langs: { es: unknown; en: unknown; pt: unknown }) {
    const esMap = flattenLocaleObject(langs.es);
    const enMap = flattenLocaleObject(langs.en);
    const ptMap = flattenLocaleObject(langs.pt);

    assert.ok(esMap.size > 0, `${label}: ES locale must not be empty`);

    const missingInEn = [...esMap.keys()].filter((k) => !enMap.has(k));
    const missingInPt = [...esMap.keys()].filter((k) => !ptMap.has(k));
    const extraInEn = [...enMap.keys()].filter((k) => !esMap.has(k));
    const extraInPt = [...ptMap.keys()].filter((k) => !esMap.has(k));

    assert.deepEqual(missingInEn, [], `${label}: missing keys in EN: ${missingInEn.slice(0, 10).join(', ')}`);
    assert.deepEqual(missingInPt, [], `${label}: missing keys in PT: ${missingInPt.slice(0, 10).join(', ')}`);
    assert.deepEqual(extraInEn, [], `${label}: extra keys in EN: ${extraInEn.slice(0, 10).join(', ')}`);
    assert.deepEqual(extraInPt, [], `${label}: extra keys in PT: ${extraInPt.slice(0, 10).join(', ')}`);

    for (const [langCode, map] of [
        ['es', esMap],
        ['en', enMap],
        ['pt', ptMap],
    ] as const) {
        for (const [k, v] of map.entries()) {
            assert.ok(v.trim().length > 0, `${label} (${langCode}): empty value for "${k}"`);
            assert.ok(
                !/\b(TODO|FIXME|PENDING_TRANSLATION|TBD)\b|\?\?\?/i.test(v),
                `${label} (${langCode}): pending translation marker in "${k}": ${v}`
            );
        }
    }

    return { esMap, enMap, ptMap };
}

interface ParsedTag {
    tag: string;
    raw: string;
    line: number;
}

/**
 * Balanced JSX opening-tag scanner supporting nested `{...}`, quotes, template literals `${...}`,
 * JSX `{/* ... *\/}` comments, and JS line/block comments.
 */
function scanJsxOpeningTags(source: string, targetTags: Set<string>): ParsedTag[] {
    const out: ParsedTag[] = [];
    const n = source.length;
    let i = 0;
    let line = 1;

    while (i < n) {
        const ch = source[i];
        if (ch === '\n') {
            line++;
            i++;
            continue;
        }
        // Line comment
        if (ch === '/' && source[i + 1] === '/') {
            while (i < n && source[i] !== '\n') i++;
            continue;
        }
        // Block comment
        if (ch === '/' && source[i + 1] === '*') {
            i += 2;
            while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
                if (source[i] === '\n') line++;
                i++;
            }
            i += 2;
            continue;
        }
        // Skip string literals in TS code so '<input' inside strings is not treated as JSX
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            i++;
            while (i < n) {
                const c = source[i];
                if (c === '\n') line++;
                if (c === '\\') {
                    i += 2;
                    continue;
                }
                if (c === quote) {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }

        if (ch === '<') {
            const prevChar = i > 0 ? source[i - 1] : '';
            const rest = source.slice(i + 1);
            const match = /^([A-Za-z_][A-Za-z0-9_]*)(?=[\s/>])/.exec(rest);
            // Exclude TypeScript generics like querySelector<HTMLInputElement>(...)
            const validStart = !/[A-Za-z0-9_$]/.test(prevChar);
            if (match && validStart && targetTags.has(match[1])) {
                const start = i;
                const startLine = line;
                const tagName = match[1];
                i += 1 + tagName.length;

                let braceDepth = 0;
                const quoteStack: Array<{ quote: string; resumeBraceDepth: number }> = [];

                while (i < n) {
                    const c = source[i];
                    if (c === '\n') line++;

                    const activeQuote = quoteStack[quoteStack.length - 1];
                    if (activeQuote) {
                        if (c === '\\') {
                            i += 2;
                            continue;
                        }
                        if (activeQuote.quote === '`' && c === '$' && source[i + 1] === '{') {
                            braceDepth++;
                            i += 2;
                            continue;
                        }
                        if (c === activeQuote.quote && braceDepth === activeQuote.resumeBraceDepth) {
                            quoteStack.pop();
                            i++;
                            continue;
                        }
                        if (c === '{' && braceDepth > activeQuote.resumeBraceDepth) {
                            braceDepth++;
                            i++;
                            continue;
                        }
                        if (c === '}' && braceDepth > activeQuote.resumeBraceDepth) {
                            braceDepth--;
                            i++;
                            continue;
                        }
                        i++;
                        continue;
                    }

                    if (c === '"' || c === "'" || c === '`') {
                        quoteStack.push({ quote: c, resumeBraceDepth: braceDepth });
                        i++;
                        continue;
                    }
                    if (c === '{') {
                        braceDepth++;
                        i++;
                        continue;
                    }
                    if (c === '}') {
                        if (braceDepth > 0) braceDepth--;
                        i++;
                        continue;
                    }
                    if (c === '/' && source[i + 1] === '*') {
                        i += 2;
                        while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
                            if (source[i] === '\n') line++;
                            i++;
                        }
                        i += 2;
                        continue;
                    }
                    if (c === '/' && source[i + 1] === '/') {
                        while (i < n && source[i] !== '\n') i++;
                        continue;
                    }
                    if (c === '>' && braceDepth === 0) {
                        out.push({ tag: tagName, raw: source.slice(start, i + 1), line: startLine });
                        i++;
                        break;
                    }
                    i++;
                }
                continue;
            }
        }
        i++;
    }

    return out;
}

function testFirebasePerimeterAndBackendHelmet() {
    const firebaseRaw = readRepoFile('firebase.json');
    const firebaseConfig = JSON.parse(firebaseRaw);
    assert.ok(Array.isArray(firebaseConfig.hosting) && firebaseConfig.hosting.length > 0, 'firebase.json hosting[0] missing');

    const headersList: Array<{ source: string; headers: Array<{ key: string; value: string }> }> =
        firebaseConfig.hosting[0].headers;
    assert.ok(Array.isArray(headersList), 'firebase.json hosting[0].headers missing');

    const wildcardRule = headersList.find((h) => h.source === '**');
    assert.ok(wildcardRule, 'firebase.json missing "**" header block');
    const headerMap = new Map(wildcardRule.headers.map((h) => [h.key, h.value]));

    assert.equal(
        headerMap.get('Strict-Transport-Security'),
        'max-age=63072000; includeSubDomains; preload'
    );
    assert.equal(headerMap.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(headerMap.get('X-Frame-Options'), 'DENY');
    assert.equal(headerMap.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
    assert.equal(
        headerMap.get('Permissions-Policy'),
        'camera=(self), geolocation=(self), microphone=(self), payment=(), usb=()'
    );
    assert.equal(headerMap.get('Cross-Origin-Opener-Policy'), 'same-origin-allow-popups');
    assert.equal(headerMap.get('X-Permitted-Cross-Domain-Policies'), 'none');

    const csp = headerMap.get('Content-Security-Policy') || '';
    assert.ok(csp.length > 0, 'Content-Security-Policy missing');
    const directives = new Map<string, string>();
    for (const part of csp.split(';').map((p) => p.trim()).filter(Boolean)) {
        const [name, ...vals] = part.split(/\s+/);
        directives.set(name, vals.join(' '));
    }

    assert.equal(directives.get('default-src'), "'self'");
    assert.equal(directives.get('script-src'), "'self'");
    assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(directives.get('script-src') || ''), 'script-src must be strictly self');
    assert.equal(directives.get('worker-src'), "'self' blob:");
    assert.equal(directives.get('manifest-src'), "'self'");
    assert.equal(directives.get('object-src'), "'none'");
    assert.equal(directives.get('base-uri'), "'self'");
    assert.equal(directives.get('form-action'), "'self'");
    assert.equal(directives.get('frame-ancestors'), "'none'");
    assert.ok(directives.has('upgrade-insecure-requests'), 'CSP missing upgrade-insecure-requests');
    assert.ok((directives.get('img-src') || '').includes('blob:'), 'CSP img-src missing blob:');
    assert.ok((directives.get('connect-src') || '').includes('wss://*.firebaseio.com'), 'CSP connect-src missing wss');
    assert.ok((directives.get('connect-src') || '').includes('https://*.run.app'), 'CSP connect-src missing run.app');
    assert.ok(
        !/maps\.googleapis\.com|maps\.google\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|notebooklm\.google/i.test(csp),
        'CSP must not allow Google Maps/Fonts/NotebookLM hosts'
    );

    // Cache-Control rules and order
    const immutableIdx = headersList.findIndex(
        (h) => h.source === '**/*.@(js|css|woff|woff2|svg|webp|png|pmtiles)'
    );
    const indexHtmlIdx = headersList.findIndex((h) => h.source === '/index.html');
    const swAssetsIdx = headersList.findIndex(
        (h) => h.source === '/@(sw.js|registerSW.js|manifest.webmanifest|theme-init.js)'
    );
    assert.ok(immutableIdx >= 0, 'Missing static immutable Cache-Control rule in firebase.json');
    assert.ok(indexHtmlIdx > immutableIdx, '/index.html no-cache rule must follow static immutable rule');
    assert.ok(swAssetsIdx > immutableIdx, 'SW/theme-init no-cache rule must follow static immutable rule');

    const immutableCache = headersList[immutableIdx].headers.find((h) => h.key === 'Cache-Control')?.value;
    const indexCache = headersList[indexHtmlIdx].headers.find((h) => h.key === 'Cache-Control')?.value;
    const swCache = headersList[swAssetsIdx].headers.find((h) => h.key === 'Cache-Control')?.value;
    assert.equal(immutableCache, 'public, max-age=31536000, immutable');
    assert.equal(indexCache, 'no-cache');
    assert.equal(swCache, 'no-cache');

    // Backend Helmet alignment in src/index.ts
    const backendIndex = readRepoFile('src/index.ts');
    assert.ok(backendIndex.includes('maxAge: 63072000'), 'src/index.ts helmet missing maxAge: 63072000');
    assert.ok(backendIndex.includes('includeSubDomains: true'), 'src/index.ts helmet missing includeSubDomains');
    assert.ok(backendIndex.includes('preload: true'), 'src/index.ts helmet missing preload');
    assert.ok(backendIndex.includes('workerSrc:') && backendIndex.includes("'blob:'"), 'src/index.ts helmet missing workerSrc blob:');
    assert.ok(backendIndex.includes('wss://*.firebaseio.com'), 'src/index.ts helmet missing wss://*.firebaseio.com');
    assert.ok(backendIndex.includes('https://*.run.app'), 'src/index.ts helmet missing https://*.run.app');
}

function testHtmlThemeInitAndVitePwa() {
    const indexHtml = readRepoFile('web/index.html');
    const viewportMatch = /<meta\s+name="viewport"\s+content="([^"]+)"\s*\/?>/i.exec(indexHtml);
    assert.ok(viewportMatch, 'web/index.html missing viewport meta tag');
    assert.ok(!/user-scalable\s*=\s*no/i.test(viewportMatch[1]), 'viewport must not disable user-scalable (WCAG 2.2 AAA)');
    assert.ok(!/maximum-scale/i.test(viewportMatch[1]), 'viewport must not lock maximum-scale (WCAG 2.2 AAA)');
    assert.equal(viewportMatch[1], 'width=device-width, initial-scale=1.0, viewport-fit=cover');

    assert.ok(
        indexHtml.includes('<script src="/theme-init.js"></script>'),
        'web/index.html must load external /theme-init.js'
    );

    const scriptTags = [...indexHtml.matchAll(/<script(\s+[^>]*)?>([\s\S]*?)<\/script>/gi)];
    assert.ok(scriptTags.length > 0, 'Expected script tags in web/index.html');
    for (const match of scriptTags) {
        const attrs = match[1] || '';
        const body = (match[2] || '').trim();
        assert.ok(/\bsrc\s*=/i.test(attrs), `Inline <script> without src is forbidden by strict CSP: ${match[0]}`);
        assert.equal(body, '', `Inline script body must be empty under strict CSP: ${match[0]}`);
    }

    assert.ok(
        !/fonts\.googleapis\.com|fonts\.gstatic\.com|maps\.googleapis\.com/i.test(indexHtml),
        'web/index.html must not reference external Google Fonts or Maps'
    );

    const themeInitPath = path.join(REPO_ROOT, 'web/public/theme-init.js');
    assert.ok(fs.existsSync(themeInitPath), 'web/public/theme-init.js does not exist');
    const themeInit = fs.readFileSync(themeInitPath, 'utf8');
    assert.ok(themeInit.includes("localStorage.getItem('i18nextLng')"), 'theme-init.js must sync lang from i18nextLng');
    assert.ok(themeInit.includes("localStorage.getItem('theme')"), 'theme-init.js must read theme from localStorage');
    assert.ok(themeInit.includes('document.documentElement.lang'), 'theme-init.js must set document.documentElement.lang');
    assert.ok(themeInit.includes("classList.add('dark')"), 'theme-init.js must apply dark class');

    const viteConfig = readRepoFile('web/vite.config.ts');
    assert.ok(viteConfig.includes("'theme-init.js'"), 'web/vite.config.ts VitePWA.includeAssets must include theme-init.js');
}

function testI18nLocalesAndRuntimeBehavior() {
    // Verify individual locale modules first
    const localeSpecs = [
        ['web/src/locales/coreShellLocales.ts', 'coreShellLocales'],
        ['web/src/locales/coreAccessB2bLocales.ts', 'coreAccessB2bLocales'],
        ['web/src/locales/coreAdminLocales.ts', 'coreAdminLocales'],
        ['web/src/locales/coreDevPilotLocales.ts', 'coreDevPilotLocales'],
    ] as const;

    for (const [relPath, exportName] of localeSpecs) {
        const mod = loadWebTsModuleCjs(relPath);
        const dict = mod[exportName];
        assert.ok(dict && dict.es && dict.en && dict.pt, `${relPath} must export ${exportName} with es/en/pt`);
        assertLocaleParity(relPath, dict);
    }

    // Stub minimal DOM/browser globals safely for web/src/i18n.ts execution in Node
    const g = globalThis as any;
    const prevDocument = g.document;
    const prevLocalStorage = g.localStorage;
    const prevWindow = g.window;

    const storageMap = new Map<string, string>([['i18nextLng', 'es']]);
    const fakeDocEl = { lang: '' };
    g.document = { documentElement: fakeDocEl };
    g.localStorage = {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => storageMap.set(k, String(v)),
    };
    g.window = { localStorage: g.localStorage };

    try {
        const i18nMod = loadWebTsModuleCjs('web/src/i18n.ts');
        const i18n = i18nMod.default;
        const resolveNormalizedLang: (raw?: string | null) => string = i18nMod.resolveNormalizedLang;

        assert.equal(typeof resolveNormalizedLang, 'function', 'web/src/i18n.ts must export resolveNormalizedLang');
        assert.equal(resolveNormalizedLang('es-CL'), 'es');
        assert.equal(resolveNormalizedLang('en-US'), 'en');
        assert.equal(resolveNormalizedLang('pt-BR'), 'pt');
        assert.equal(resolveNormalizedLang('fr'), 'es');
        assert.equal(resolveNormalizedLang(null), 'es');

        const opts = i18n.options;
        assert.equal(opts.detection?.lookupLocalStorage, 'i18nextLng');
        assert.ok(opts.detection?.caches?.includes('localStorage'));

        const res = opts.resources;
        assert.ok(res?.es?.translation && res?.en?.translation && res?.pt?.translation, 'i18n resources missing es/en/pt');

        // Preserve all legacy F3 base namespaces consumed by OPERMAQ & STOCKPILE
        for (const baseKey of ['auth', 'status', 'pwa', 'pilot', 'admin_console', 'tabs', 'form', 'errors', 'dashboard']) {
            for (const lang of ['es', 'en', 'pt'] as const) {
                assert.ok(
                    res[lang].translation[baseKey] && typeof res[lang].translation[baseKey] === 'object',
                    `Merged i18n (${lang}) lost base namespace "${baseKey}"`
                );
            }
        }

        const mergedMaps = assertLocaleParity('web/src/i18n.ts (merged)', {
            es: res.es.translation,
            en: res.en.translation,
            pt: res.pt.translation,
        });

        // Runtime <html lang> sync via changeLanguage
        i18n.changeLanguage('en');
        assert.equal(fakeDocEl.lang, 'en', 'document.documentElement.lang must sync to "en"');
        i18n.changeLanguage('pt');
        assert.equal(fakeDocEl.lang, 'pt', 'document.documentElement.lang must sync to "pt"');
        i18n.changeLanguage('es');
        assert.equal(fakeDocEl.lang, 'es', 'document.documentElement.lang must sync to "es"');

        // Verify all literal t('...') / i18n.t('...') keys in non-module TSX resolve in es/en/pt
        const tsxFiles = walkFiles('web/src', '.tsx', ['web/src/modules/opermaq', 'web/src/modules/geolapp']);
        const missingKeys: string[] = [];
        const literalCallRegex = /\b(?:t|i18n\.t)\(\s*['"]([a-zA-Z0-9_]+\.[a-zA-Z0-9_.-]+)['"]/g;
        for (const rel of tsxFiles) {
            const src = readRepoFile(rel);
            let m: RegExpExecArray | null;
            while ((m = literalCallRegex.exec(src)) !== null) {
                const key = m[1];
                if (!mergedMaps.esMap.has(key) || !mergedMaps.enMap.has(key) || !mergedMaps.ptMap.has(key)) {
                    missingKeys.push(`${rel}: ${key}`);
                }
            }
        }
        assert.deepEqual(missingKeys, [], `Unresolved i18n keys found:\n${missingKeys.join('\n')}`);
    } finally {
        if (prevDocument === undefined) delete g.document;
        else g.document = prevDocument;
        if (prevLocalStorage === undefined) delete g.localStorage;
        else g.localStorage = prevLocalStorage;
        if (prevWindow === undefined) delete g.window;
        else g.window = prevWindow;
    }
}

function testBalancedJsxFormsI18nPortalsAndGuardrails() {
    const tsxFiles = walkFiles('web/src', '.tsx', ['web/src/modules/opermaq']);
    const tsAndTsxFiles = [
        ...walkFiles('web/src', '.ts', ['web/src/modules/opermaq']),
        ...tsxFiles,
    ];

    const missingFormAttrs: string[] = [];
    for (const relPath of tsxFiles) {
        const src = readRepoFile(relPath);
        const tags = scanJsxOpeningTags(src, new Set(['form', 'input', 'textarea']));
        for (const tag of tags) {
            const hasAutoCompleteOff = /\bautoComplete\s*=\s*(?:"off"|'off'|\{\s*['"]off['"]\s*\})/.test(tag.raw);
            const hasSpellCheckFalse = /\bspellCheck\s*=\s*(?:\{\s*false\s*\}|"false"|'false')/.test(tag.raw);
            if (!hasAutoCompleteOff || !hasSpellCheckFalse) {
                missingFormAttrs.push(
                    `${relPath}:${tag.line} <${tag.tag}> autoComplete="off":${hasAutoCompleteOff} spellCheck={false}:${hasSpellCheckFalse}`
                );
            }
        }
    }
    assert.deepEqual(
        missingFormAttrs,
        [],
        `100% of <form>/<input>/<textarea> must declare autoComplete="off" and spellCheck={false}:\n${missingFormAttrs.join('\n')}`
    );

    // Interactive views/components requiring i18n
    const requiredI18nViews = [
        'web/src/App.tsx',
        'web/src/layouts/ClientLayout.tsx',
        'web/src/layouts/MobileLayout.tsx',
        'web/src/core/modules/ModuleHost.tsx',
        'web/src/components/LanguageSwitch.tsx',
        'web/src/components/ThemeSwitch.tsx',
        'web/src/components/admin/BrandingManager.tsx',
        'web/src/components/ai/MiningAICopilot.tsx',
        'web/src/components/auth/AccountSelector.tsx',
        'web/src/components/common/CoBrandedReportHeader.tsx',
        'web/src/components/common/CopyButton.tsx',
        'web/src/components/common/ErrorBoundary.tsx',
        'web/src/components/common/HitlConfirmModal.tsx',
        'web/src/components/common/M3CircularProgress.tsx',
        'web/src/components/common/M3LinearProgress.tsx',
        'web/src/components/common/PWAInstallPrompt.tsx',
        'web/src/components/common/ReportBlockEditable.tsx',
        'web/src/components/dev/DevEquipmentOnboardingInbox.tsx',
        'web/src/components/geo/SovereignGeoMap.tsx',
        'web/src/pages/AccessPage.tsx',
        'web/src/pages/OperationalDashboard.tsx',
        'web/src/pages/SetPassword.tsx',
        'web/src/pages/SetupAccess.tsx',
        'web/src/pages/admin/SuperAdminConsole.tsx',
        'web/src/pages/b2b/EmpresaPage.tsx',
        'web/src/pages/b2b/EquipmentOnboardingPage.tsx',
        'web/src/pages/b2b/EquipoPage.tsx',
        'web/src/pages/b2b/MetricasPage.tsx',
        'web/src/pages/b2b/SuscripcionPage.tsx',
        'web/src/pages/dev/DevVaultGateway.tsx',
        'web/src/pages/mobile/DevFieldTestLaunchpad.tsx',
        'web/src/pages/mobile/DevFieldTestLogin.tsx',
        'web/src/pages/mobile/DevFieldTestModuleShell.tsx',
        'web/src/pages/mobile/MobileDashboard.tsx',
        'web/src/pages/mobile/MobileLogin.tsx',
        'web/src/pages/mobile/MobileProfile.tsx',
        'web/src/pages/mobile/MobileTools.tsx',
        'web/src/pages/pilot/TestPilotWorkspace.tsx',
    ];
    for (const viewPath of requiredI18nViews) {
        const src = readRepoFile(viewPath);
        assert.ok(
            /\b(useTranslation|i18n\.t)\b/.test(src),
            `${viewPath} must use useTranslation or i18n.t (zero orphan views without i18n)`
        );
    }

    // Portals mounting <LanguageSwitch
    const portalFiles = [
        'web/src/layouts/ClientLayout.tsx',
        'web/src/pages/AccessPage.tsx',
        'web/src/pages/SetupAccess.tsx',
        'web/src/pages/SetPassword.tsx',
        'web/src/pages/admin/SuperAdminConsole.tsx',
        'web/src/pages/pilot/TestPilotWorkspace.tsx',
        'web/src/pages/dev/DevVaultGateway.tsx',
        'web/src/pages/mobile/DevFieldTestLogin.tsx',
        'web/src/pages/mobile/DevFieldTestLaunchpad.tsx',
        'web/src/pages/mobile/DevFieldTestModuleShell.tsx',
        'web/src/pages/mobile/MobileLogin.tsx',
        'web/src/pages/mobile/MobileProfile.tsx',
    ];
    for (const portalPath of portalFiles) {
        const src = readRepoFile(portalPath);
        assert.ok(src.includes('<LanguageSwitch'), `${portalPath} must mount <LanguageSwitch />`);
    }

    // UI/UX & security guardrails across non-module web/src files
    const guardrailHits: string[] = [];
    for (const relPath of tsAndTsxFiles) {
        if (relPath.startsWith('web/src/locales/')) continue;
        const src = readRepoFile(relPath);
        if (/#FFCD00/i.test(src)) guardrailHits.push(`${relPath}: banned color #FFCD00`);
        if (/\b(Google Sans|Roboto)\b/i.test(src)) guardrailHits.push(`${relPath}: banned font Google Sans/Roboto`);
        if (/\bprogress_activity\b/.test(src)) guardrailHits.push(`${relPath}: banned progress_activity`);
        if (/\banimate-spin\b/.test(src)) guardrailHits.push(`${relPath}: banned animate-spin`);
        if (/\brounded-(sm|md|lg|xl|2xl|full)\b/.test(src)) guardrailHits.push(`${relPath}: banned rounded-* border`);
        if (/\bshadow-(sm|md|lg|xl|2xl)\b/.test(src)) guardrailHits.push(`${relPath}: banned shadow-*`);
        if (/notebooklm\.google|fonts\.googleapis\.com|maps\.googleapis\.com/i.test(src)) {
            guardrailHits.push(`${relPath}: banned external URL`);
        }
    }
    assert.deepEqual(guardrailHits, [], `Guardrail violations detected:\n${guardrailHits.join('\n')}`);

    // LanguageSwitch pure ISO invariant
    const langSwitchSrc = readRepoFile('web/src/components/LanguageSwitch.tsx');
    assert.ok(langSwitchSrc.includes("['es', 'en', 'pt']") || langSwitchSrc.includes("'es'") && langSwitchSrc.includes("'en'") && langSwitchSrc.includes("'pt'"));
    assert.ok(!/[\u{1F1E6}-\u{1F1FF}]/u.test(langSwitchSrc), 'LanguageSwitch must not contain flag emojis');

    // Invariants: HITL 'ACTUALIZAR' and UNDECLARED_TECH_VALUE
    const hitlModal = readRepoFile('web/src/components/common/HitlConfirmModal.tsx');
    assert.ok(hitlModal.includes("keyword = 'ACTUALIZAR'"), "HitlConfirmModal must preserve default keyword = 'ACTUALIZAR'");

    const reportBlock = readRepoFile('web/src/components/common/ReportBlockEditable.tsx');
    assert.ok(
        reportBlock.includes("export const UNDECLARED_TECH_VALUE = '[Información técnica no declarada en ficha]';"),
        'ReportBlockEditable must preserve export const UNDECLARED_TECH_VALUE'
    );
}

function run() {
    testFirebasePerimeterAndBackendHelmet();
    testHtmlThemeInitAndVitePwa();
    testI18nLocalesAndRuntimeBehavior();
    testBalancedJsxFormsI18nPortalsAndGuardrails();
    console.log('✅ Bloque 4.2 CSP, WCAG, Balanced JSX & Runtime i18n (ES/EN/PT) Suite PASSED');
}

run();
