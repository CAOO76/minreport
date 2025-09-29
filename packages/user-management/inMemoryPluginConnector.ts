import { PluginConnector } from './interfaces';

// In-memory implementation of PluginConnector
export class InMemoryPluginConnector implements PluginConnector {
  private userPlugins: Map<string, Set<string>> = new Map();

  async connectPlugin(userId: string, pluginId: string, config: any): Promise<boolean> {
    if (!this.userPlugins.has(userId)) {
      this.userPlugins.set(userId, new Set());
    }
    this.userPlugins.get(userId)!.add(pluginId);
    return true;
  }

  async disconnectPlugin(userId: string, pluginId: string): Promise<boolean> {
    if (!this.userPlugins.has(userId)) return false;
    this.userPlugins.get(userId)!.delete(pluginId);
    return true;
  }

  async listUserPlugins(userId: string): Promise<string[]> {
    return Array.from(this.userPlugins.get(userId) || []);
  }
}
