import { User, UserRepository } from './interfaces';

// In-memory implementation of UserRepository
export class InMemoryUserRepository implements UserRepository {
  private users: Map<string, User> = new Map();

  async createUser(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async updateUser(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }

  async deleteUser(userId: string): Promise<void> {
    this.users.delete(userId);
  }
}
