import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/500.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/atkinson-hyperlegible-mono/400.css';
import '@fontsource/atkinson-hyperlegible-mono/500.css';
import '@fontsource/atkinson-hyperlegible-mono/600.css';
import '@fontsource/atkinson-hyperlegible-mono/700.css';
import App from './App.tsx'
import './index.css'
import './i18n';
import { registerSW } from 'virtual:pwa-register'

const markMaterialSymbolsReady = () => {
    if (typeof document !== 'undefined') {
        document.documentElement.classList.add('ms-ready');
    }
};

if (typeof document !== 'undefined' && 'fonts' in document) {
    Promise.race([
        document.fonts.load('400 24px "Material Symbols Outlined"'),
        new Promise<void>((resolve) => window.setTimeout(resolve, 600)),
    ]).finally(markMaterialSymbolsReady);
} else {
    markMaterialSymbolsReady();
}

if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    registerSW({
        immediate: true,
        onRegistered(r) {
            console.log('[PWA] Service Worker registrado', r);
        },
        onRegisterError(error) {
            console.error('[PWA] Error al registrar Service Worker', error);
        }
    })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
