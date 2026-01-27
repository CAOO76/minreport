import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './i18n'; // Initialize i18n
import { registerSW } from 'virtual:pwa-register'

// Manual registration for reliability and offline support
registerSW({
    immediate: true,
    onRegistered(r) {
        console.log('✅ [PWA] Service Worker registrado', r);
    },
    onRegisterError(error) {
        console.error('❌ [PWA] Error al registrar SW', error);
    }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
