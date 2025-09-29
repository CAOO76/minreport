import { InMemoryUserRepository } from './inMemoryUserRepository.js';
import { InMemoryPluginConnector } from './inMemoryPluginConnector.js';

// Export the in-memory implementations for use in services and tests
export const userRepository = new InMemoryUserRepository();
export const pluginConnector = new InMemoryPluginConnector();

export * from './interfaces.js';
