/**
 * Cargador dinámico nativo para paquetes ESM/WASM puros (`mupdf`, `svgo`)
 * dentro del entorno backend CommonJS (`module: commonjs` en `tsconfig.json`),
 * evitando que TypeScript transpile `import()` a `require()`.
 */
const nativeDynamicImport = new Function('specifier', 'return import(specifier);') as <T = any>(
    specifier: string
) => Promise<T>;

const moduleCache = new Map<string, Promise<any>>();

export function importEsm<T = any>(specifier: string): Promise<T> {
    let cached = moduleCache.get(specifier);
    if (!cached) {
        cached = nativeDynamicImport<T>(specifier);
        moduleCache.set(specifier, cached);
    }
    return cached as Promise<T>;
}

