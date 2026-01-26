import React from 'react';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

/**
 * OfflineIndicator component that displays a warning bar when the application is offline.
 * Follows strict design system requirements for MinReport.
 */
const OfflineIndicator: React.FC = () => {
    const { isOnline } = useNetworkStatus();

    if (isOnline) return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            width: '100%',
            height: '40px',
            backgroundColor: '#111827',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            fontFamily: '"Atkinson Hyperlegible", sans-serif',
            fontSize: '0.85rem',
            textAlign: 'center'
        }}>
            OFFLINE MODE / MODO SIN CONEXIÓN - TRABAJANDO EN LOCAL 💾
        </div>
    );
};

export default OfflineIndicator;
