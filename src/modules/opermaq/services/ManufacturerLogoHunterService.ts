import { convertBuffer, convertPixels } from '@visioncortex/vtracer';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { CasStorageService } from '../../../core/media/CasStorageService';
import { MediaDigestorServer } from '../../../core/media/MediaDigestorServer';
import { assertSafeExternalUrl, safeFetchExternal } from '../../../utils/ssrfGuard';
import {
    LogoCandidateSourceKind,
    ManufacturerLogoCandidate,
} from '../../../contracts/manufacturers.contracts';

/**
 * CAZADOR Y DIGESTOR VECTORIAL DE LOGOTIPOS OEM (`MINREPORT-MEDIA-DIGESTOR-CAS`)
 *
 * - Prioridad 1: Sitio web oficial HTTPS verificado (JSON-LD logo, SVG/IMG de marca, inline `<svg>` en cabecera).
 * - Prioridad 2: Wikimedia Commons con desambiguación corporativa/industrial y bloqueo estricto anti-ficción.
 * - Sanitiza SVG (`svgo` AST sin `<script>`/`on*`) o vectoriza PNG/WebP/JPEG (`@visioncortex/vtracer`).
 * - Persiste únicamente SVG optimizado en `CasStorageService` (`GLOBAL_OEM`) con telemetría
 *   `originalBytes -> optimizedBytes (savingsPct)` y dedup por `sha256` + `dHash` (`<= 4`).
 */

const WIKI_HEADERS = {
    'User-Agent': 'MINREPORT-OPERMAQ-Manufacturers/4.1 (https://minreport-access.web.app)',
};

const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const EXTERNAL_TIMEOUT_MS = 8_000;
const MAX_CANDIDATES_PER_BRAND = 5;

const ENTERTAINMENT_LOGO_BLOCKLIST_RX =
    /(?:hanna[-_\s]?barbera|top[-_\s]?cat|cartoon|comic|anime|manga|television|tv[-_\s]?series|film|movie|soundtrack|album|band|musical|fictional|character|disney|warner|nickelodeon|looney|garfield|felix[-_\s]?the[-_\s]?cat|esports|gaming|video[-_\s]?game)/i;

export function isBlockedNonIndustrialLogoRef(text: string): boolean {
    if (!text) return false;
    return ENTERTAINMENT_LOGO_BLOCKLIST_RX.test(text);
}

function detectInvertInDark(svgStr: string): boolean {
    const colorTokens = Array.from(
        new Set(
            (svgStr.match(/(?:#[0-9a-fA-F]{3,8}|currentColor|\b(?:black|white|red|blue|yellow|orange)\b)/gi) || [])
                .map((c) => c.toLowerCase())
                .filter((c) => c !== 'none' && c !== '#fff' && c !== '#ffffff' && c !== 'white')
        )
    );
    return (
        colorTokens.length <= 1 &&
        (colorTokens.length === 0 ||
            colorTokens.every(
                (c) => c === '#000' || c === '#000000' || c === 'black' || c === 'currentcolor' || /^#0[0-2]{5}$/.test(c)
            ))
    );
}

function resolveSafeHttpsAssetUrl(rawHref: string, baseUrl: string): string | null {
    const clean = (rawHref || '').trim();
    if (!clean || clean.startsWith('data:') || clean.startsWith('blob:')) return null;
    try {
        const resolved = new URL(clean, baseUrl).toString();
        if (!resolved.startsWith('https://')) return null;
        if (!/\.(svg|png|webp|jpe?g)(?:[?#].*)?$/i.test(resolved)) return null;
        return resolved;
    } catch {
        return null;
    }
}

function extractJsonLdLogoUrls(html: string, baseUrl: string): string[] {
    const urls: string[] = [];
    const scriptRx = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (const m of html.matchAll(scriptRx)) {
        const rawJson = (m[1] || '').trim();
        if (!rawJson) continue;
        try {
            const parsed = JSON.parse(rawJson);
            const nodes = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed];
            for (const node of nodes) {
                const logoField = node?.logo;
                const rawLogoUrl =
                    typeof logoField === 'string'
                        ? logoField
                        : typeof logoField?.url === 'string'
                          ? logoField.url
                          : null;
                if (rawLogoUrl) {
                    const resolved = resolveSafeHttpsAssetUrl(rawLogoUrl, baseUrl);
                    if (resolved) urls.push(resolved);
                }
            }
        } catch {
            // Ignorar JSON-LD malformado
        }
    }
    return urls;
}

function extractHtmlLogoUrls(html: string, baseUrl: string): string[] {
    const urls = new Set<string>(extractJsonLdLogoUrls(html, baseUrl));
    const patterns = [
        /<img[^>]+(?:alt|class|id|aria-label)\s*=\s*["'][^"']*(?:logo|brand|wordmark)[^"']*["'][^>]+src\s*=\s*["']([^"']+)["']/gi,
        /<img[^>]+src\s*=\s*["']([^"']+)["'][^>]+(?:alt|class|id|aria-label)\s*=\s*["'][^"']*(?:logo|brand|wordmark)[^"']*["']/gi,
        /<img[^>]+src\s*=\s*["']([^"']*logo[^"']*\.(?:svg|png|webp))["']/gi,
        /<link[^>]+rel\s*=\s*["'][^"']*(?:icon|apple-touch-icon|mask-icon)[^"']*["'][^>]+href\s*=\s*["']([^"']+)["']/gi,
        /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["'][^"']*(?:icon|apple-touch-icon|mask-icon)[^"']*["']/gi,
    ];

    for (const rx of patterns) {
        for (const m of html.matchAll(rx)) {
            const resolved = resolveSafeHttpsAssetUrl(m[1] || '', baseUrl);
            if (resolved) urls.add(resolved);
        }
    }

    const scoreUrl = (u: string): number => {
        const lower = u.toLowerCase();
        let score = 0;
        if (lower.includes('.svg')) score += 20;
        if (lower.includes('logo') || lower.includes('brand') || lower.includes('wordmark')) score += 10;
        if (lower.includes('favicon')) score -= 5;
        return -score;
    };

    return Array.from(urls)
        .sort((a, b) => scoreUrl(a) - scoreUrl(b))
        .slice(0, 5);
}

function extractInlineHeaderBrandSvgs(html: string): string[] {
    const svgs: string[] = [];
    const headerOrNavScope = html.match(/<(?:header|nav)\b[\s\S]{0,60000}?<\/(?:header|nav)>/gi) || [html.slice(0, 45000)];
    const svgRx = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
    const brandHintRx = /(?:logo|brand|wordmark|emblem|navbar-brand|site-logo)/i;

    for (const block of headerOrNavScope.slice(0, 3)) {
        for (const match of block.matchAll(svgRx)) {
            const svg = match[0];
            if (svg.length < 180 || svg.length > 200_000) continue;
            if (isBlockedNonIndustrialLogoRef(svg)) continue;
            const idx = match.index ?? 0;
            const surrounding = block.slice(Math.max(0, idx - 180), Math.min(block.length, idx + 220));
            if (brandHintRx.test(svg) || brandHintRx.test(surrounding)) {
                svgs.push(svg);
                if (svgs.length >= 2) return svgs;
            }
        }
    }
    return svgs;
}

function buildWikimediaSearchQueries(params: { officialName: string; legalCorporateName?: string | null }): string[] {
    const cleanName = (params.officialName || '').trim();
    const legal = (params.legalCorporateName || '').trim();
    const queries: string[] = [];

    if (legal && legal.toLowerCase() !== cleanName.toLowerCase()) {
        queries.push(`"${legal}" logo svg`);
    }

    if (cleanName.length <= 4) {
        queries.push(`"${legal || cleanName}" company manufacturer logo svg`);
        queries.push(`${cleanName} heavy machinery trucks logo svg`);
    } else {
        queries.push(`${cleanName} corporate logo svg`);
    }

    return Array.from(new Set(queries)).slice(0, 2);
}

export class ManufacturerLogoHunterService {
    public static deduplicateCandidates(
        existing: ManufacturerLogoCandidate[],
        incoming: ManufacturerLogoCandidate[]
    ): ManufacturerLogoCandidate[] {
        const result: ManufacturerLogoCandidate[] = [];
        const seenSha = new Set<string>();

        for (const item of [...existing, ...incoming]) {
            if (!item?.sha256 || seenSha.has(item.sha256)) continue;
            if (item.sourceUrl && isBlockedNonIndustrialLogoRef(item.sourceUrl)) continue;

            let nearDuplicate = false;
            if (item.phashHex && item.phashHex.length === 16) {
                for (const accepted of result) {
                    if (
                        accepted.phashHex &&
                        accepted.phashHex.length === 16 &&
                        MediaDigestorServer.hammingDistanceHex64(accepted.phashHex, item.phashHex) <= 4
                    ) {
                        nearDuplicate = true;
                        break;
                    }
                }
            }

            if (nearDuplicate) continue;
            seenSha.add(item.sha256);
            result.push(item);
            if (result.length >= MAX_CANDIDATES_PER_BRAND) break;
        }

        return result;
    }

    public static async ingestLogoBufferToCas(
        rawBuffer: Buffer,
        params: {
            filename: string;
            actorUid: string;
            sourceKind: LogoCandidateSourceKind;
            sourceUrl?: string | null;
        }
    ): Promise<ManufacturerLogoCandidate> {
        if (!Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) {
            throw new Error('Buffer de logotipo vacío.');
        }
        if (rawBuffer.length > MAX_DOWNLOAD_BYTES) {
            throw new Error(`El logotipo excede el límite máximo permitido (${MAX_DOWNLOAD_BYTES} bytes).`);
        }

        const clientOriginalBytes = rawBuffer.length;
        const cleanBase =
            (params.filename || 'oem_logo')
                .replace(/\.[a-z0-9]+$/i, '')
                .replace(/[^a-zA-Z0-9_-]+/g, '_')
                .slice(0, 80) || 'oem_logo';

        const headStr = rawBuffer.subarray(0, 1024).toString('utf8');
        const isSvgInput = /<svg\b/i.test(headStr);

        let svgStrForCas: string;
        let wasVectorized = false;
        let phashHex: string | undefined;

        if (isSvgInput) {
            const digested = await MediaDigestorServer.digestSvg(rawBuffer);
            svgStrForCas = digested.buffer.toString('utf8');
            try {
                const pngForHash = await sharp(digested.buffer)
                    .resize(128, 128, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
                    .png()
                    .toBuffer();
                phashHex = await MediaDigestorServer.computePerceptualHash64(pngForHash);
            } catch {
                // Opcional si SVG usa características omitidas por librsvg
            }
        } else {
            const normalizedPng = await sharp(rawBuffer, { failOn: 'none' })
                .rotate()
                .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                .ensureAlpha()
                .png()
                .toBuffer();

            phashHex = await MediaDigestorServer.computePerceptualHash64(normalizedPng);

            let vectorizedRawSvg: string;
            try {
                vectorizedRawSvg = convertBuffer(new Uint8Array(normalizedPng), {
                    preset: 'poster',
                    clustering: 'color-cluster',
                    mode: 'spline',
                    filterSpeckle: 6,
                    cornerThreshold: 55,
                    simplify: 1.4,
                    maxColors: 6,
                    optimize: 2,
                });
            } catch {
                const { data: rgbaBuf, info } = await sharp(normalizedPng)
                    .ensureAlpha()
                    .raw()
                    .toBuffer({ resolveWithObject: true });
                vectorizedRawSvg = convertPixels(new Uint8Array(rgbaBuf), info.width, info.height, {
                    preset: 'poster',
                    clustering: 'color-cluster',
                    mode: 'spline',
                    maxColors: 6,
                    optimize: 2,
                });
            }

            if (!/<svg\b/i.test(vectorizedRawSvg)) {
                throw new Error('No fue posible vectorizar el logotipo raster hacia SVG.');
            }
            svgStrForCas = vectorizedRawSvg;
            wasVectorized = true;
        }

        const digestedSvg = await MediaDigestorServer.digestSvg(svgStrForCas);
        const cas = await CasStorageService.persistDigestedBinary(
            { ...digestedSvg, ...(phashHex ? { phashHex } : {}) },
            {
                scope: 'GLOBAL_OEM',
                actorUid: params.actorUid,
                originalFilename: `${cleanBase}.svg`,
                clientOriginalBytes,
            }
        );

        const originalBytes = Math.max(clientOriginalBytes, cas.originalBytes || 0);
        const optimizedBytes = cas.optimizedBytes || digestedSvg.optimizedBytes;
        const savingsPct =
            typeof cas.savingsPct === 'number'
                ? cas.savingsPct
                : originalBytes > 0
                  ? Number((Math.max(0, (originalBytes - optimizedBytes) / originalBytes) * 100).toFixed(1))
                  : 0;

        const effectiveSourceKind: LogoCandidateSourceKind =
            params.sourceKind === 'MANUAL_UPLOAD'
                ? 'MANUAL_UPLOAD'
                : wasVectorized
                  ? 'RASTER_VECTORIZED_VTRACER'
                  : 'OFFICIAL_SVG';

        const candidateId = `cand_${createHash('sha256')
            .update(`${cas.sha256}:${effectiveSourceKind}`)
            .digest('hex')
            .slice(0, 12)}`;

        return {
            candidateId,
            sha256: cas.sha256,
            ...(phashHex || cas.phashHex ? { phashHex: phashHex || cas.phashHex } : {}),
            storagePath: cas.storagePath ?? null,
            downloadUrl: cas.downloadUrl,
            originalBytes,
            optimizedBytes,
            savingsPct,
            invertInDark: detectInvertInDark(digestedSvg.buffer.toString('utf8')),
            wasVectorized,
            sourceKind: effectiveSourceKind,
            sourceUrl: params.sourceUrl || null,
        };
    }

    public static async huntLogosFromWebsite(params: {
        officialName: string;
        legalCorporateName?: string | null;
        officialWebsiteUrl?: string | null;
        actorUid?: string;
    }): Promise<ManufacturerLogoCandidate[]> {
        const cleanName = (params.officialName || '').trim();
        if (!cleanName || cleanName.length < 2) return [];
        const actorUid = params.actorUid || 'system-logo-hunter';
        const candidates: ManufacturerLogoCandidate[] = [];

        // Prioridad 1: Sitio web oficial HTTPS (validado Anti-SSRF)
        if (params.officialWebsiteUrl && params.officialWebsiteUrl.startsWith('https://')) {
            try {
                await assertSafeExternalUrl(params.officialWebsiteUrl);
                const htmlRes = await safeFetchExternal(params.officialWebsiteUrl, {
                    headers: WIKI_HEADERS,
                    maxBytes: 1_500_000,
                    timeoutMs: 6_000,
                });
                if (htmlRes.ok) {
                    const ct = (htmlRes.headers.get('content-type') || '').toLowerCase();
                    if (ct.includes('text/html') || ct.includes('xhtml')) {
                        const html = await htmlRes.text();
                        const webAssetUrls = extractHtmlLogoUrls(html, params.officialWebsiteUrl);
                        for (const assetUrl of webAssetUrls.slice(0, 3)) {
                            try {
                                if (isBlockedNonIndustrialLogoRef(assetUrl)) continue;
                                await assertSafeExternalUrl(assetUrl);
                                const imgRes = await safeFetchExternal(assetUrl, {
                                    headers: WIKI_HEADERS,
                                    maxBytes: MAX_DOWNLOAD_BYTES,
                                    timeoutMs: 6_000,
                                });
                                if (!imgRes.ok) continue;
                                const buf = Buffer.from(await imgRes.arrayBuffer());
                                const urlName = new URL(assetUrl).pathname.split('/').pop() || `${cleanName}_web.svg`;
                                candidates.push(
                                    await this.ingestLogoBufferToCas(buf, {
                                        filename: urlName,
                                        actorUid,
                                        sourceKind: /\.svg(?:[?#]|$)/i.test(assetUrl)
                                            ? 'OFFICIAL_SVG'
                                            : 'RASTER_VECTORIZED_VTRACER',
                                        sourceUrl: assetUrl,
                                    })
                                );
                            } catch {
                                // Ignorar activo web individual inaccesible
                            }
                        }

                        if (candidates.length === 0) {
                            const inlineSvgs = extractInlineHeaderBrandSvgs(html);
                            for (const [idx, inlineSvg] of inlineSvgs.entries()) {
                                try {
                                    candidates.push(
                                        await this.ingestLogoBufferToCas(Buffer.from(inlineSvg, 'utf8'), {
                                            filename: `${cleanName}_inline_${idx + 1}.svg`,
                                            actorUid,
                                            sourceKind: 'OFFICIAL_SVG',
                                            sourceUrl: params.officialWebsiteUrl,
                                        })
                                    );
                                } catch {
                                    // Ignorar SVG inline malformado
                                }
                            }
                        }
                    }
                }
            } catch {
                // URL bloqueada por SSRF o inaccesible
            }
        }

        // Prioridad 2: Wikimedia Commons con desambiguación corporativa y filtro anti-ficción
        const wikiQueries = buildWikimediaSearchQueries({
            officialName: cleanName,
            legalCorporateName: params.legalCorporateName,
        });

        for (const searchQuery of wikiQueries) {
            if (candidates.length >= MAX_CANDIDATES_PER_BRAND) break;
            try {
                const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
                    searchQuery
                )}&srnamespace=6&srlimit=8&format=json`;
                const searchRes = await safeFetchExternal(searchUrl, {
                    headers: WIKI_HEADERS,
                    maxBytes: 2 * 1024 * 1024,
                    timeoutMs: EXTERNAL_TIMEOUT_MS,
                });
                if (!searchRes.ok) continue;

                const searchData = (await searchRes.json()) as any;
                const filenames: string[] = (searchData?.query?.search || [])
                    .filter((item: any) => {
                        const title = String(item?.title || '');
                        const snippet = String(item?.snippet || '');
                        return (
                            title.startsWith('File:') &&
                            /\.(svg|png|webp)$/i.test(title) &&
                            !isBlockedNonIndustrialLogoRef(`${title} ${snippet}`)
                        );
                    })
                    .map((item: any) => String(item.title).substring(5))
                    .sort((a: string, b: string) => {
                        const aSvg = a.toLowerCase().endsWith('.svg') ? 0 : 1;
                        const bSvg = b.toLowerCase().endsWith('.svg') ? 0 : 1;
                        return aSvg - bSvg;
                    });

                for (const filename of filenames.slice(0, 3)) {
                    if (candidates.length >= MAX_CANDIDATES_PER_BRAND) break;
                    try {
                        const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
                            `File:${filename}`
                        )}&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=512&format=json`;
                        const infoRes = await safeFetchExternal(infoUrl, {
                            headers: WIKI_HEADERS,
                            maxBytes: 1024 * 1024,
                            timeoutMs: EXTERNAL_TIMEOUT_MS,
                        });
                        if (!infoRes.ok) continue;
                        const infoData = (await infoRes.json()) as any;
                        const page = Object.values(infoData?.query?.pages || {})[0] as any;
                        const imgInfo = page?.imageinfo?.[0];
                        if (!imgInfo) continue;

                        const metaDesc = String(imgInfo?.extmetadata?.ImageDescription?.value || '');
                        const metaCategories = String(imgInfo?.extmetadata?.Categories?.value || '');
                        if (isBlockedNonIndustrialLogoRef(`${filename} ${metaDesc} ${metaCategories} ${imgInfo.url || ''}`)) {
                            continue;
                        }

                        const isSvg = String(imgInfo.mime || '').includes('svg') || filename.toLowerCase().endsWith('.svg');
                        const targetUrl = isSvg ? imgInfo.url : imgInfo.thumburl || imgInfo.url;
                        if (!targetUrl) continue;

                        const binRes = await safeFetchExternal(targetUrl, {
                            headers: WIKI_HEADERS,
                            maxBytes: MAX_DOWNLOAD_BYTES,
                            timeoutMs: EXTERNAL_TIMEOUT_MS,
                        });
                        if (!binRes.ok) continue;
                        const buf = Buffer.from(await binRes.arrayBuffer());
                        candidates.push(
                            await this.ingestLogoBufferToCas(buf, {
                                filename,
                                actorUid,
                                sourceKind: isSvg ? 'OFFICIAL_SVG' : 'RASTER_VECTORIZED_VTRACER',
                                sourceUrl: targetUrl,
                            })
                        );
                    } catch {
                        // Continuar con siguiente archivo
                    }
                }
            } catch {
                // Entorno sin red o bloqueo externo: degradación limpia
            }
        }

        return this.deduplicateCandidates([], candidates);
    }
}
