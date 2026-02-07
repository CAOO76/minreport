import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './i18n'; // Initialize i18n
import { registerSW } from 'virtual:pwa-register'
import { db } from './config/firebase';
import * as firestore from 'firebase/firestore';

// Minimal registration for reliability and offline support
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    registerSW({
        immediate: true,
        onRegistered(r) {
            console.log('✅ [PWA] Service Worker registrado', r);
        },
        onRegisterError(error) {
            console.error('❌ [PWA] Error al registrar SW', error);
        }
    })
}

// @ts-ignore - Expose db and firestore for E2E cleanup
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    (window as any).db = db;
    (window as any).firestore = firestore;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
