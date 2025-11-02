// Minimal mock for useAuth to unblock build. Replace with real logic as needed.
// Accepts an optional argument for compatibility with frontend usage (e.g., useAuth(auth))

export type AuthUser = {
	uid: string;
	email: string;
	displayName?: string;
	getIdToken?: () => Promise<string>;
};

export type AuthClaims = {
	// admin?: boolean; // Eliminado para limpieza
	[key: string]: any;
};

export function useAuth(_auth?: any): {
	user: AuthUser | null;
	loading: boolean;
		// activePlugins removed
	claims: AuthClaims;
} {
	return {
		user: null,
		loading: false,
	claims: {}, // admin eliminado para limpieza
	};
}

export default useAuth;