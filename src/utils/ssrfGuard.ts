import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * GUARDIA SOBERANA ANTI-SSRF (Capa 1 / Capa 3 — ISO 27001 MINREPORT)
 *
 * Protege todas las descargas salientes del backend contra Server-Side Request Forgery:
 * - Solo permite `https:` (o `http:` exclusivamente en entorno `test` con `ALLOW_DEV_CLEARTEXT_SSRF === 'true'`).
 * - Resuelve DNS real (`dns.promises.lookup(hostname, { all: true })`) y bloquea:
 *   loopback (`127.0.0.0/8`, `::1`), RFC1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`),
 *   link-local / metadata Cloud Run (`169.254.0.0/16`, `fe80::/10`), ULA (`fc00::/7`),
 *   CGNAT (`100.64.0.0/10`), multicast/reservadas, IPv4-mapped IPv6 (`::ffff:...`),
 *   `0.0.0.0`, `localhost` y `metadata.google.internal`.
 * - Valida cada salto de redirección manualmente (máx 3 saltos) o ejecuta con `redirect: 'error'`.
 */

export class SSRFBlockedError extends Error {
    public readonly statusCode: number = 403;
    public readonly code: string = 'SSRF_BLOCKED';

    constructor(message: string) {
        super(message);
        this.name = 'SSRFBlockedError';
    }
}

const BLOCKED_HOSTNAMES = new Set<string>([
    'localhost',
    'localhost.localdomain',
    'metadata.google.internal',
    'metadata',
    'metadata.goog',
    '0.0.0.0',
    '169.254.169.254',
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
    '.localhost',
    '.local',
    '.internal',
    '.home.arpa',
    '.corp',
    '.lan',
];

function isBlockedIpv4(ip: string): boolean {
    const octets = ip.split('.');
    if (octets.length !== 4) return true;
    const nums = octets.map((part) => {
        if (!/^\d{1,3}$/.test(part)) return NaN;
        return Number(part);
    });
    if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;

    const [a, b, c] = nums;

    if (a === 0) return true; // 0.0.0.0/8 ("this" network)
    if (a === 10) return true; // 10.0.0.0/8 RFC1918
    if (a === 127) return true; // 127.0.0.0/8 Loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 Link-local / Cloud Metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 Benchmark
    if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // 224.0.0.0/4 Multicast & 240.0.0.0/4 Reserved

    return false;
}

function extractMappedIpv4FromIpv6(lowerIpv6: string): string | null {
    // Forma decimal: ::ffff:169.254.169.254 o 0:0:0:0:0:ffff:169.254.169.254
    const dottedMatch = lowerIpv6.match(/(?:^|:)ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (dottedMatch) {
        return dottedMatch[1];
    }

    // Forma hexadecimal: ::ffff:a9fe:a9fe
    const hexMatch = lowerIpv6.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMatch) {
        const hi = parseInt(hexMatch[1], 16);
        const lo = parseInt(hexMatch[2], 16);
        const o1 = (hi >> 8) & 0xff;
        const o2 = hi & 0xff;
        const o3 = (lo >> 8) & 0xff;
        const o4 = lo & 0xff;
        return `${o1}.${o2}.${o3}.${o4}`;
    }

    return null;
}

export function isBlockedIpAddress(rawIp: string): boolean {
    const trimmed = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0]; // Remover zone index IPv6 (%eth0)
    const family = isIP(trimmed);

    if (family === 4) {
        return isBlockedIpv4(trimmed);
    }

    if (family === 6) {
        const lower = trimmed.toLowerCase();
        if (
            lower === '::1' ||
            lower === '::' ||
            lower === '0:0:0:0:0:0:0:1' ||
            lower === '0:0:0:0:0:0:0:0'
        ) {
            return true;
        }

        // IPv4-mapped IPv6 (::ffff:0:0/96)
        const mappedV4 = extractMappedIpv4FromIpv6(lower);
        if (mappedV4) {
            return isBlockedIpv4(mappedV4);
        }

        // Unique Local Address fc00::/7 (fc00..fdff)
        if (/^f[cd][0-9a-f]{0,2}:/i.test(lower)) {
            return true;
        }

        // Link-local fe80::/10 (fe80..febf)
        if (/^fe[89ab][0-9a-f]?:/i.test(lower)) {
            return true;
        }

        // Multicast ff00::/8
        if (lower.startsWith('ff')) {
            return true;
        }

        // Documentation 2001:db8::/32 & NAT64 64:ff9b::/96
        if (lower.startsWith('2001:db8:') || lower.startsWith('64:ff9b:')) {
            return true;
        }

        return false;
    }

    return true;
}

function isAllowedProtocol(protocol: string): boolean {
    if (protocol === 'https:') return true;
    if (
        protocol === 'http:' &&
        process.env.NODE_ENV === 'test' &&
        process.env.ALLOW_DEV_CLEARTEXT_SSRF === 'true'
    ) {
        return true;
    }
    return false;
}

/**
 * Valida que una URL externa sea estrictamente pública, segura y libre de resolución DNS hacia rangos privados.
 */
export async function assertSafeExternalUrl(rawUrl: string): Promise<URL> {
    if (!rawUrl || typeof rawUrl !== 'string') {
        throw new SSRFBlockedError('URL externa vacía o inválida.');
    }

    let parsed: URL;
    try {
        parsed = new URL(rawUrl.trim());
    } catch {
        throw new SSRFBlockedError('Formato de URL externa inválido.');
    }

    if (!isAllowedProtocol(parsed.protocol)) {
        throw new SSRFBlockedError(`Protocolo no permitido por política SSRF: ${parsed.protocol}`);
    }

    if (parsed.username || parsed.password) {
        throw new SSRFBlockedError('No se permiten credenciales embebidas en URLs externas.');
    }

    const hostname = parsed.hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostname) {
        throw new SSRFBlockedError('Hostname vacío en URL externa.');
    }

    if (
        BLOCKED_HOSTNAMES.has(hostname) ||
        BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    ) {
        throw new SSRFBlockedError(`Hostname interno o reservado bloqueado: ${hostname}`);
    }

    // Bloquear representaciones IP octales/decimales sin puntos (ej. http://2130706433)
    if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
        throw new SSRFBlockedError(`Representación numérica de host bloqueada: ${hostname}`);
    }

    if (isIP(hostname)) {
        if (isBlockedIpAddress(hostname)) {
            throw new SSRFBlockedError(`Dirección IP privada o reservada bloqueada: ${hostname}`);
        }
        return parsed;
    }

    let records: Array<{ address: string; family: number }>;
    try {
        records = await lookup(hostname, { all: true, verbatim: true });
    } catch (dnsErr: any) {
        throw new SSRFBlockedError(
            `No fue posible resolver DNS público para ${hostname}: ${dnsErr?.code || 'DNS_FAILURE'}`
        );
    }

    if (!Array.isArray(records) || records.length === 0) {
        throw new SSRFBlockedError(`Sin registros DNS válidos para ${hostname}.`);
    }

    for (const rec of records) {
        if (!rec?.address || isBlockedIpAddress(rec.address)) {
            throw new SSRFBlockedError(
                `Resolución DNS de ${hostname} apunta a dirección interna o reservada (${rec?.address || 'desconocida'}).`
            );
        }
    }

    return parsed;
}

export interface SafeFetchOptions extends RequestInit {
    maxBytes?: number;
    maxRedirects?: number;
    timeoutMs?: number;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Ejecuta `fetch` hacia un recurso externo validando DNS anti-SSRF antes de cada salto
 * (máximo 3 redirecciones manuales verificadas o `redirect: 'error'` si `maxRedirects === 0`)
 * y aplicando cota estricta de memoria si se especifica `maxBytes`.
 */
export async function safeFetchExternal(
    rawUrl: string,
    init: SafeFetchOptions = {}
): Promise<Response> {
    const {
        maxBytes = 25 * 1024 * 1024,
        maxRedirects = init.redirect === 'error' ? 0 : 3,
        timeoutMs = 15_000,
        ...fetchInit
    } = init;

    let currentUrl = await assertSafeExternalUrl(rawUrl);
    let currentMethod = (fetchInit.method || 'GET').toUpperCase();
    let currentBody = fetchInit.body;

    for (let hop = 0; hop <= maxRedirects; hop++) {
        const signal = fetchInit.signal ?? AbortSignal.timeout(timeoutMs);
        const response = await fetch(currentUrl.toString(), {
            ...fetchInit,
            method: currentMethod,
            body: currentBody,
            redirect: maxRedirects === 0 ? 'error' : 'manual',
            signal,
        });

        if (REDIRECT_STATUSES.has(response.status)) {
            try {
                await response.body?.cancel();
            } catch {
                // Ignorar cierre de body en redirección
            }

            if (hop >= maxRedirects) {
                throw new SSRFBlockedError(
                    `Excedido el límite máximo de redirecciones externas (${maxRedirects}).`
                );
            }

            const locationHeader = response.headers.get('location');
            if (!locationHeader) {
                throw new SSRFBlockedError('Respuesta de redirección sin cabecera Location.');
            }

            let nextCandidate: string;
            try {
                nextCandidate = new URL(locationHeader, currentUrl).toString();
            } catch {
                throw new SSRFBlockedError('Cabecera Location de redirección malformada.');
            }

            currentUrl = await assertSafeExternalUrl(nextCandidate);

            if (
                response.status === 303 ||
                ((response.status === 301 || response.status === 302) && currentMethod === 'POST')
            ) {
                currentMethod = 'GET';
                currentBody = undefined;
            }
            continue;
        }

        if (typeof maxBytes === 'number' && maxBytes > 0) {
            const declaredLength = Number(response.headers.get('content-length') || 0);
            if (declaredLength > maxBytes) {
                try {
                    await response.body?.cancel();
                } catch {
                    // Ignorar
                }
                throw new SSRFBlockedError(
                    `El tamaño declarado del recurso externo (${declaredLength} bytes) excede el máximo permitido (${maxBytes} bytes).`
                );
            }

            if (response.body) {
                const reader = response.body.getReader();
                const chunks: Buffer[] = [];
                let receivedBytes = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                        receivedBytes += value.byteLength;
                        if (receivedBytes > maxBytes) {
                            await reader.cancel().catch(() => {});
                            throw new SSRFBlockedError(
                                `El flujo descargado superó el límite de seguridad (${maxBytes} bytes).`
                            );
                        }
                        chunks.push(Buffer.from(value));
                    }
                }

                const fullBuffer = Buffer.concat(chunks);
                const outHeaders = new Headers(response.headers);
                outHeaders.set('x-final-url', currentUrl.toString());
                const synthesized = new Response(fullBuffer, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: outHeaders,
                });
                try {
                    Object.defineProperty(synthesized, 'url', {
                        value: currentUrl.toString(),
                        configurable: true,
                    });
                } catch {
                    // `x-final-url` sigue disponible en cabeceras
                }
                return synthesized;
            }
        }

        try {
            Object.defineProperty(response, 'url', {
                value: currentUrl.toString(),
                configurable: true,
            });
        } catch {
            // Ignorar si es de solo lectura
        }
        return response;
    }

    throw new SSRFBlockedError('No fue posible completar la petición externa segura.');
}
