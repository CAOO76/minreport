import type { User, Auth } from 'firebase/auth';
interface AuthState {
    user: User | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
}
declare const useAuth: (authInstance: Auth) => AuthState;
export default useAuth;
