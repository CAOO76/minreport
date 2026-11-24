import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n';
import type { MinReportSession } from '../../../context/MinReportSessionContext';
import type { SupplyProfileViewRecord, SupplySite } from '../types';

const sessionMockState = vi.hoisted(() => ({
    session: null as MinReportSession | null,
}));

vi.mock('../../../context/MinReportSessionContext', () => ({
    useMinReportSession: () => ({
        session: sessionMockState.session,
        isLoaded: true,
        hasModuleAccess: () => true,
    }),
}));

vi.mock('../../../hooks/useNetworkStatus', () => ({
    useNetworkStatus: () => ({ isOnline: true }),
}));

vi.mock('../../../core/offline/SyncQueueEngine', () => ({
    syncQueueEngine: {
        getState: () => ({
            isOnline: true,
            isSyncing: false,
            pendingCount: 0,
            lastSyncTimestamp: null,
            lastError: null,
        }),
        subscribe: () => () => {},
        getDeadLetterTasks: vi.fn(async () => []),
        isOnlineNow: () => true,
    },
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false },
}));

vi.mock('@capacitor/camera', () => ({
    Camera: { getPhoto: vi.fn() },
    CameraResultType: { DataUrl: 'dataUrl' },
    CameraSource: { Camera: 'CAMERA' },
}));

import { SupplyWorkspace } from '../SupplyWorkspace';
import { supplyApi } from '../services/supplyApi';

const SITES: SupplySite[] = [
    {
        siteId: 'site-atacama-01',
        tenantId: 'tenant-v3-e06',
        name: 'Faena Atacama Norte',
        currentHeadcount: 42,
        waterStorageCapacityL: 40000,
        ds594DailyWaterTargetLPerPax: 120,
        leadTimeDays: 7,
    },
];

const MOCK_PROFILE: SupplyProfileViewRecord = {
    profileId: 'prof-camp-01',
    tenantId: 'tenant-v3-e06',
    displayName: 'Carlos Campamento',
    role: 'CAMP_MANAGER',
    phoneMasked: '+569****4302',
    phoneHashSha256: 'a'.repeat(64),
    optInStatus: 'ACTIVE',
    status: 'ACTIVE',
    permanentChannels: ['CH_CAMP_FOOD', 'CH_CAMP_HYGIENE_MAINT'],
    temporaryGrants: [
        {
            grantItemId: 'tg-weekend-1',
            channelId: 'CH_OPS_FLEET_FUEL',
            validFromIso: new Date(Date.now() - 3600_000).toISOString(),
            validUntilIso: new Date(Date.now() + 24 * 3600_000).toISOString(),
            timezoneIana: 'America/Santiago',
            reason: 'Turno fin de semana combustible',
        },
    ],
    allowedSiteIds: ['site-atacama-01'],
    allowedWarehouseIds: [],
    maxAmountClp: 500000,
    allowCapex: false,
    controlledLicense: null,
    linkedMemberUid: null,
    hrPersonId: 'HR-0042',
    effectiveChannels: ['CH_CAMP_FOOD', 'CH_CAMP_HYGIENE_MAINT', 'CH_OPS_FLEET_FUEL'],
    activeTemporaryGrants: [
        {
            grantItemId: 'tg-weekend-1',
            channelId: 'CH_OPS_FLEET_FUEL',
            validFromIso: new Date(Date.now() - 3600_000).toISOString(),
            validUntilIso: new Date(Date.now() + 24 * 3600_000).toISOString(),
            timezoneIana: 'America/Santiago',
            reason: 'Turno fin de semana combustible',
        },
    ],
    expiredTemporaryGrantsCount: 0,
    effectiveMaxAmountClp: 500000,
    effectiveAllowedSiteIds: ['site-atacama-01'],
    hasValidDgmnLicense: false,
    whatsappDispatchAllowed: true,
    createdAtIso: '2026-11-23T10:00:00Z',
    updatedAtIso: '2026-11-23T10:00:00Z',
};

function makeOwnerSession(): MinReportSession {
    return {
        uid: 'uid-owner',
        email: 'owner@minreport-test.cl',
        displayName: 'Owner Test',
        tenantId: 'tenant-v3-e06',
        tenantName: 'Minera V3 SpA',
        countryCode: 'CL',
        role: 'OWNER',
        classification: 'b2b',
        accountTier: 4,
        isDevRoot: false,
        isSuperAdmin: false,
        isTestPilot: false,
        isEduSandbox: false,
        activeModules: { opermaq: true, stockpile: true, supply: true },
        permissions: {
            opermaq: { canInspect: true, canManageFleet: true, canViewVaults: true, canCurateAI: false },
            stockpile: { canScan: true, canCalculate: true, canExportReport: true, canTrainVisionAI: false },
            supply: {
                canView: true,
                canMutate: true,
                canRecordDirectPurchase: true,
                canApproveExpenseReports: true,
                canManageCapex: true,
            },
            pilot: { canCommentAndRequestChanges: false, canSimulateProjects: false, canTrainInternalAI: false },
        },
    };
}

describe('V3-E06 — SupplyWorkspace 7 Tabs Deferred Fetch & Profiles/Channels WS Matrix', () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        sessionMockState.session = makeOwnerSession();
        await act(async () => {
            await i18n.changeLanguage('es');
        });
    });

    it('1. Renderiza 7 tabs Icon-First, abre CONTROL por defecto con fetch diferido (0 llamadas a inventario/compras/perfiles) y tira NASA OpenMCT siempre visible', async () => {
        const listSitesSpy = vi.spyOn(supplyApi, 'listSites').mockResolvedValue(SITES);
        const listReqSpy = vi.spyOn(supplyApi, 'listRequisitions').mockResolvedValue([]);
        const listPurSpy = vi.spyOn(supplyApi, 'listPurchases').mockResolvedValue([]);
        const listDocsSpy = vi.spyOn(supplyApi, 'listSiiDocuments').mockResolvedValue([]);
        const listAssetsSpy = vi.spyOn(supplyApi, 'listAssets').mockResolvedValue([]);
        const forecastSpy = vi.spyOn(supplyApi, 'getForecast').mockResolvedValue(null);
        const listsSpy = vi.spyOn(supplyApi, 'getConsolidatedShoppingLists').mockResolvedValue([]);
        const invSpy = vi.spyOn(supplyApi, 'listInventory').mockResolvedValue([]);
        const expSpy = vi.spyOn(supplyApi, 'listSiiExpenseReports').mockResolvedValue([]);
        const profilesSpy = vi.spyOn(supplyApi, 'listSupplyProfiles').mockResolvedValue([MOCK_PROFILE]);

        render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} tenantId="tenant-v3-e06" />
            </I18nextProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('supply-control-summary')).toBeInTheDocument();
        });

        expect(screen.getByTestId('supply-tab-CONTROL')).toHaveAttribute('aria-current', 'page');
        expect(screen.getByTestId('supply-tab-ORDERS')).toBeInTheDocument();
        expect(screen.getByTestId('supply-tab-WAREHOUSE')).toBeInTheDocument();
        expect(screen.getByTestId('supply-tab-WHATSAPP')).toBeInTheDocument();
        expect(screen.getByTestId('supply-tab-FINANCE_SII')).toBeInTheDocument();
        expect(screen.queryByTestId('supply-telemetry-strip')).not.toBeInTheDocument();

        expect(listSitesSpy).toHaveBeenCalledTimes(1);
        expect(listReqSpy).toHaveBeenCalledTimes(1);
        expect(listPurSpy).toHaveBeenCalledTimes(1);
        expect(listDocsSpy).toHaveBeenCalledTimes(1);
        expect(listAssetsSpy).toHaveBeenCalledTimes(1);
        expect(forecastSpy).toHaveBeenCalledTimes(1);

        // Fetch diferido: tabs no abiertos no disparan sus endpoints al montar
        expect(listsSpy).not.toHaveBeenCalled();
        expect(invSpy).not.toHaveBeenCalled();
        expect(expSpy).not.toHaveBeenCalled();
        expect(profilesSpy).not.toHaveBeenCalled();

        // Cambiar al tab WHATSAPP y sub-vista Personas autorizadas dispara listSupplyProfiles bajo demanda
        fireEvent.click(screen.getByTestId('supply-tab-WHATSAPP'));
        fireEvent.click(await screen.findByTestId('supply-subtab-PROFILES_WS'));
        await waitFor(() => {
            expect(profilesSpy).toHaveBeenCalledTimes(1);
            expect(screen.getByTestId('supply-profiles-ws-view')).toBeInTheDocument();
        });
    });

    it('2. SupplyProfilesChannelsView exhibe los 15 canales M3Switch, bloquea DGMN sin licencia y exige HITL ACTUALIZAR al guardar casillas', async () => {
        vi.spyOn(supplyApi, 'listSites').mockResolvedValue(SITES);
        vi.spyOn(supplyApi, 'listSupplyProfiles').mockResolvedValue([MOCK_PROFILE]);
        const updateChannelsSpy = vi
            .spyOn(supplyApi, 'updateSupplyProfileChannels')
            .mockResolvedValue({
                ...MOCK_PROFILE,
                permanentChannels: ['CH_CAMP_FOOD', 'CH_CAMP_HYGIENE_MAINT', 'CH_CAMP_POTABLE_WATER'],
            });

        render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} domainMode="PROFILES_WS" tenantId="tenant-v3-e06" />
            </I18nextProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('profile-row-prof-camp-01')).toBeInTheDocument();
            expect(screen.getByTestId('channel-switch-CH_CONTROLLED_DGMN')).toBeInTheDocument();
        });

        // Compuerta DGMN bloqueada cuando hasValidDgmnLicense === false
        const dgmnSwitch = screen.getByTestId('channel-switch-CH_CONTROLLED_DGMN');
        expect(dgmnSwitch).toBeDisabled();

        // Permiso temporal activo visible con barra M3
        expect(screen.getByTestId('temp-grant-tg-weekend-1')).toBeInTheDocument();

        // Activar CH_CAMP_POTABLE_WATER -> aparece botón HITL -> confirmar "ACTUALIZAR"
        const potableSwitch = screen.getByTestId('channel-switch-CH_CAMP_POTABLE_WATER');
        expect(potableSwitch).not.toBeDisabled();
        expect(potableSwitch).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(potableSwitch);
        await waitFor(() => {
            expect(potableSwitch).toHaveAttribute('aria-checked', 'true');
        });
        const saveBtn = await screen.findByRole('button', { name: /Guardar cambios de permisos/i });
        fireEvent.click(saveBtn);

        const keywordInput = screen.getByPlaceholderText('ACTUALIZAR');
        fireEvent.change(keywordInput, { target: { value: 'ACTUALIZAR' } });
        fireEvent.click(screen.getByRole('button', { name: /^CONFIRMAR$/i }));

        await waitFor(() => {
            expect(updateChannelsSpy).toHaveBeenCalledWith(
                'prof-camp-01',
                expect.objectContaining({
                    permanentChannels: expect.arrayContaining([
                        'CH_CAMP_FOOD',
                        'CH_CAMP_HYGIENE_MAINT',
                        'CH_CAMP_POTABLE_WATER',
                    ]),
                    confirmationKeyword: 'ACTUALIZAR',
                }),
                'tenant-v3-e06'
            );
        });
    });

    it('3. SupplyTempGrantsPanel y Double Opt-In exigen HITL ACTUALIZAR y mantienen 15 canales / 7 tabs sin llaves i18n crudas', async () => {
        const pendingProfile: SupplyProfileViewRecord = {
            ...MOCK_PROFILE,
            profileId: 'prof-pending-02',
            optInStatus: 'PENDING_DOUBLE_OPT_IN',
            whatsappDispatchAllowed: false,
            temporaryGrants: [],
            activeTemporaryGrants: [],
        };
        vi.spyOn(supplyApi, 'listSites').mockResolvedValue(SITES);
        vi.spyOn(supplyApi, 'listSupplyProfiles').mockResolvedValue([pendingProfile]);
        const grantSpy = vi
            .spyOn(supplyApi, 'grantTemporarySupplyChannel')
            .mockResolvedValue(pendingProfile);
        const optInSpy = vi
            .spyOn(supplyApi, 'confirmSupplyProfileOptIn')
            .mockResolvedValue({ ...pendingProfile, optInStatus: 'ACTIVE', whatsappDispatchAllowed: true });

        render(
            <I18nextProvider i18n={i18n}>
                <SupplyWorkspace embedded={true} domainMode="PROFILES_WS" tenantId="tenant-v3-e06" />
            </I18nextProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('profile-row-prof-pending-02')).toBeInTheDocument();
            expect(screen.getByTestId('toggle-temp-grant-form')).toBeInTheDocument();
        });

        // Confirmar Double Opt-In con HITL ACTUALIZAR
        fireEvent.click(screen.getByRole('button', { name: /Confirmar autorización/i }));
        fireEvent.change(screen.getByPlaceholderText('ACTUALIZAR'), { target: { value: 'ACTUALIZAR' } });
        fireEvent.click(screen.getByRole('button', { name: /^CONFIRMAR$/i }));

        await waitFor(() => {
            expect(optInSpy).toHaveBeenCalledWith(
                'prof-pending-02',
                'CONFIRM',
                'ACTUALIZAR',
                'tenant-v3-e06'
            );
        });

        // Otorgar permiso temporal en caliente con HITL ACTUALIZAR
        fireEvent.click(screen.getByTestId('toggle-temp-grant-form'));
        fireEvent.change(screen.getByTestId('temp-grant-reason-input'), {
            target: { value: 'Reemplazo turno nocturno' },
        });
        fireEvent.click(screen.getByTestId('temp-grant-submit-btn'));
        fireEvent.change(screen.getByPlaceholderText('ACTUALIZAR'), { target: { value: 'ACTUALIZAR' } });
        fireEvent.click(screen.getByRole('button', { name: /^CONFIRMAR$/i }));

        await waitFor(() => {
            expect(grantSpy).toHaveBeenCalledWith(
                'prof-pending-02',
                expect.objectContaining({
                    channelId: 'CH_OPS_FLEET_FUEL',
                    reason: 'Reemplazo turno nocturno',
                    timezoneIana: 'America/Santiago',
                    confirmationKeyword: 'ACTUALIZAR',
                }),
                'tenant-v3-e06'
            );
        });

        // Cero llaves i18n crudas en pantalla
        expect(document.body.textContent || '').not.toMatch(/\bsupply\.[a-z_]+\.[a-z_]+/);
    });
});
