import { useState, useEffect } from 'react';

/**
 * Hook to detect if the current viewport is mobile (width < 768px)
 */
export function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => {
        const mobile = window.innerWidth < 768;
        console.log(`[DEBUG-DEVICE] innerWidth: ${window.innerWidth}, isMobile: ${mobile}`);
        return mobile;
    });

    useEffect(() => {
        const handleResize = () => {
            const mobile = window.innerWidth < 768;
            console.log(`[DEBUG-DEVICE] Resize -> innerWidth: ${window.innerWidth}, isMobile: ${mobile}`);
            setIsMobile(mobile);
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return isMobile;
}
