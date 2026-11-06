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
import '@fontsource/material-symbols-outlined/index.css';
import '@fontsource/material-symbols-outlined/500.css';
import '@fontsource/material-symbols-outlined/600.css';
import '@fontsource/material-symbols-outlined/700.css';
import App from './App.tsx'
import './index.css'
import './i18n';
import { registerSW } from 'virtual:pwa-register'
import { db } from './config/firebase';
import * as firestore from 'firebase/firestore';

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

// @ts-ignore - Expose db and firestore only on local host for E2E verification
if (import.meta.env.DEV && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    (window as any).db = db;
    (window as any).firestore = firestore;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
