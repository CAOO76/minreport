// UserRepository interface: defines the contract for user management
export interface UserRepository {
  createUser(user: User): Promise<User>;
  findUserByEmail(email: string): Promise<User | null>;
  updateUser(user: User): Promise<User>;
  deleteUser(userId: string): Promise<void>;
}

// PluginConnector interface: defines the contract for plugin connections
export interface PluginConnector {
  connectPlugin(userId: string, pluginId: string, config: any): Promise<boolean>;
  disconnectPlugin(userId: string, pluginId: string): Promise<boolean>;
  listUserPlugins(userId: string): Promise<string[]>;
}

// User entity (minimal)
export interface User {
  id: string;
  email: string;
  name?: string;
  plugins?: string[];
}
