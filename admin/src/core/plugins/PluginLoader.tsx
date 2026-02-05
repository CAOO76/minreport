import React, { useEffect, useState, useMemo } from 'react';
import { getPluginById } from '../PluginRegistry';
// @ts-ignore - Mock context or use auth
import { auth } from '../../config/firebase';

interface PluginLoaderProps {
    pluginId: string;
}

export const PluginLoader: React.FC<PluginLoaderProps> = ({ pluginId }) => {
    const [isInitialized, setIsInitialized] = useState(false);
    const pluginEntry = useMemo(() => getPluginById(pluginId), [pluginId]);

    useEffect(() => {
        const initPlugin = async () => {
            if (pluginEntry && !isInitialized) {
                try {
                    const context = {
                        projectId: 'minreport-8f2a8',
                        userId: auth.currentUser?.uid || 'admin-system',
                        isOffline: false,
                        accountId: 'system-admin',
                        theme: 'light'
                    };
                    await pluginEntry.instance.onInit(context as any);
                    setIsInitialized(true);
                } catch (error) {
                    console.error(`[PluginLoader] Error inicializando plugin "${pluginId}":`, error);
                }
            }
        };
        initPlugin();
    }, [pluginEntry, isInitialized, pluginId]);

    if (!pluginEntry) {
        return <div className="p-10 text-center text-slate-400">Plugin "{pluginId}" no registrado en el Admin.</div>;
    }

    return (
        <div className="w-full h-full">
            {pluginEntry.instance.renderWidget()}
        </div>
    );
};
