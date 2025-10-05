// Deleted: not needed for subscriptions
// UserRepository interface: defines the contract for user management
export interface UserRepository {
  createUser(user: User): Promise<User>;
  findUserByEmail(email: string): Promise<User | null>;
  updateUser(user: User): Promise<User>;
  deleteUser(userId: string): Promise<void>;
}


// User entity (minimal)
export interface User {
  id: string;
  email: string;
  name?: string;
  // plugins eliminado
}
