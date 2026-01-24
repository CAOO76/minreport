/**
 * Manifest definition for external plugins
 */
export interface PluginManifest {
    id: string;
    name: string;
    entryUrl: string;
    version: string;
}

/**
 * Props passed from the Admin host to the plugin
 */
export interface PluginProps {
    user: any;
    theme: 'light' | 'dark';
    platform: 'desktop' | 'mobile';
    api: any;
}
