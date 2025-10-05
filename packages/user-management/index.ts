// Empty: subscriptions logic only will be added if needed
// Export only user repository for subscriptions logic
import { InMemoryUserRepository } from './inMemoryUserRepository.js';
export const userRepository = new InMemoryUserRepository();
