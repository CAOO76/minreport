import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import {
    parseDevModulesCsv,
    isDevModuleEnabled,
    isGeolappOnlyDevStage,
} from '../config/releaseStage';
import { FUTURE_MODULE_IDS } from '../core/modules/module-registry';
import { HitlConfirmModal } from '../components/common/HitlConfirmModal';

describe('V3-E00 Release Stage Gating, Future HR Slot & WCAG AAA Contrast', () => {
    it('1. parseDevModulesCsv y isDevModuleEnabled desacoplan supply de opermaq y preservan compatibilidad geolapp', () => {
        expect(parseDevModulesCsv('geolapp')).toEqual(['geolapp']);
        expect(isGeolappOnlyDevStage('geolapp')).toBe(true);
        expect(isGeolappOnlyDevStage('stockpile')).toBe(true);
        expect(isDevModuleEnabled('stockpile', 'geolapp')).toBe(true);
        expect(isDevModuleEnabled('supply', 'geolapp')).toBe(false);
        expect(isDevModuleEnabled('opermaq', 'geolapp')).toBe(false);
        expect(isDevModuleEnabled('hr', 'geolapp')).toBe(false);

        expect(parseDevModulesCsv('geolapp,supply')).toEqual(['geolapp', 'supply']);
        expect(isGeolappOnlyDevStage('geolapp,supply')).toBe(false);
        expect(isDevModuleEnabled('stockpile', 'geolapp,supply')).toBe(true);
        expect(isDevModuleEnabled('supply', 'geolapp,supply')).toBe(true);
        expect(isDevModuleEnabled('opermaq', 'geolapp,supply')).toBe(false);
        expect(isDevModuleEnabled('hr', 'geolapp,supply')).toBe(false);

        expect(isDevModuleEnabled('stockpile', 'stockpile,supply,hr')).toBe(true);
        expect(isDevModuleEnabled('supply', 'stockpile,supply,hr')).toBe(true);
        expect(isDevModuleEnabled('hr', 'stockpile,supply,hr')).toBe(true);
        expect(isDevModuleEnabled('opermaq', 'stockpile,supply,hr')).toBe(false);

        // Sin CSV explícito: módulos núcleo activos, 'hr' reservado salvo opt-in
        expect(isDevModuleEnabled('opermaq', '')).toBe(true);
        expect(isDevModuleEnabled('supply', '')).toBe(true);
        expect(isDevModuleEnabled('hr', '')).toBe(false);
    });

    it('2. FUTURE_MODULE_IDS reserva el slot hr junto a marketplace', () => {
        expect(FUTURE_MODULE_IDS).toEqual(['hr', 'marketplace']);
    });

    it('3. HitlConfirmModal usa text-[#000000] sobre bg-[#C68346] (WCAG AAA)', () => {
        render(
            <I18nextProvider i18n={i18n}>
                <HitlConfirmModal
                    open={true}
                    title="CONFIRMACIÓN HITL"
                    description="Confirmar operación crítica."
                    onConfirm={vi.fn()}
                    onCancel={vi.fn()}
                />
            </I18nextProvider>
        );

        const input = screen.getByPlaceholderText('ACTUALIZAR');
        fireEvent.change(input, { target: { value: 'ACTUALIZAR' } });

        const confirmBtn = screen.getByRole('button', { name: /^CONFIRM(AR)?$/i });
        expect(confirmBtn).not.toBeDisabled();
        expect(confirmBtn.className).toContain('bg-[#C68346]');
        expect(confirmBtn.className).toContain('text-[#000000]');
        expect(confirmBtn.className).not.toContain('text-[#FFFFFF]');
        expect(confirmBtn.className).not.toContain('text-white');
    });
});
