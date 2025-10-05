// Minimal mock for useAuth to unblock build. Replace with real logic as needed.
// Accepts an optional argument for compatibility with frontend usage (e.g., useAuth(auth))

export type AuthUser = {
	uid: string;
	email: string;
	displayName?: string;
	getIdToken?: () => Promise<string>;
};

export type AuthClaims = {
	admin?: boolean;
	[key: string]: any;
};

export function useAuth(_auth?: any): {
	user: AuthUser | null;
	loading: boolean;
	activePlugins: string[];
	claims: AuthClaims;
} {
	return {
		user: null,
		loading: false,
		activePlugins: [],
		claims: { admin: false },
	};
}

export default useAuth;