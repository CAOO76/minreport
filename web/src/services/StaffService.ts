import { z } from 'zod';
import { auth } from '../config/firebase';
import { getApiUrl } from '../utils/network';
import {
    RemoveB2BMemberPayloadSchema,
    UpdateB2BMemberPayloadSchema,
    UpsertB2BMemberPayloadSchema,
    type B2BSeatRole,
} from '../contracts';

export interface B2BMemberRecord {
    uid: string;
    userId: string;
    email: string;
    fullName: string;
    taxId?: string;
    countryCode?: string;
    role: B2BSeatRole;
    jobTitle?: string;
    allowedModules: {
        opermaq: boolean;
        stockpile: boolean;
    };
    canViewBilling: boolean;
    status: string;
    invitedAt?: number | string | null;
    updatedAt?: number | string | null;
}

export type UpsertMemberInput = z.input<typeof UpsertB2BMemberPayloadSchema>;
export type UpdateMemberInput = Omit<z.input<typeof UpdateB2BMemberPayloadSchema>, 'accountId'> & {
    accountId?: string;
};

export interface UpsertMemberResponse {
    uid: string;
    isNewUser: boolean;
    status: string;
    message?: string;
}

export interface MutateMemberResponse {
    success: boolean;
    uid: string;
}

export class StaffService {
    private static async getAuthHeaders(accountId?: string): Promise<Record<string, string>> {
        let idToken = '';
        if (auth.currentUser) {
            idToken = await auth.currentUser.getIdToken();
        } else if (typeof window !== 'undefined') {
            idToken = localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token') || '';
        }

        if (!idToken) {
            throw new Error('Sesión autenticada requerida para gestionar equipo corporativo.');
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
        };

        if (accountId) {
            headers['X-Active-Account-Id'] = accountId;
        }

        return headers;
    }

    static async listMembers(accountId: string): Promise<B2BMemberRecord[]> {
        if (!accountId) return [];
        const headers = await this.getAuthHeaders(accountId);
        const url = getApiUrl(`/api/staff/members?accountId=${encodeURIComponent(accountId)}`);
        const response = await fetch(url, {
            method: 'GET',
            headers,
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(body?.error || `Error HTTP ${response.status} al listar integrantes.`);
        }

        return Array.isArray(body?.members) ? (body.members as B2BMemberRecord[]) : [];
    }

    static async upsertMember(payload: UpsertMemberInput): Promise<UpsertMemberResponse> {
        const parsed = UpsertB2BMemberPayloadSchema.parse(payload);
        const headers = await this.getAuthHeaders(parsed.accountId);
        const url = getApiUrl('/api/staff/members');
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(parsed),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(body?.error || `Error HTTP ${response.status} al registrar integrante.`);
        }

        return body as UpsertMemberResponse;
    }

    static async updateMember(
        accountId: string,
        memberUid: string,
        payload: UpdateMemberInput
    ): Promise<MutateMemberResponse> {
        const parsed = UpdateB2BMemberPayloadSchema.parse({
            ...payload,
            accountId,
        });
        const headers = await this.getAuthHeaders(accountId);
        const url = getApiUrl(`/api/staff/members/${encodeURIComponent(memberUid)}`);
        const response = await fetch(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(parsed),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(body?.error || `Error HTTP ${response.status} al actualizar integrante.`);
        }

        return body as MutateMemberResponse;
    }

    static async removeMember(
        accountId: string,
        memberUid: string,
        confirmationKeyword: 'ACTUALIZAR' = 'ACTUALIZAR'
    ): Promise<MutateMemberResponse> {
        const parsed = RemoveB2BMemberPayloadSchema.parse({
            accountId,
            confirmationKeyword,
        });
        const headers = await this.getAuthHeaders(accountId);
        const url = getApiUrl(`/api/staff/members/${encodeURIComponent(memberUid)}`);
        const response = await fetch(url, {
            method: 'DELETE',
            headers,
            body: JSON.stringify(parsed),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(body?.error || `Error HTTP ${response.status} al desvincular integrante.`);
        }

        return body as MutateMemberResponse;
    }
}
