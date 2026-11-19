import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CopyButton from '../../../components/common/CopyButton';
import type {
  AssetPhysicalTraits,
  CanonicalSpecSlot,
  EnergyConsumptionProfile,
  EquipmentSupplyLineItem,
  OperationalCostMatrix,
  SupplyItemFamily,
} from '../../../contracts';
import type { PillarDocument, PillarId } from '../types/vault';

export interface EquipmentCostMatrixPanelProps {
  makeModel: string;
  tipoEquipo?: string;
  categoriaEquipo?: string;
  physicalTraits?: AssetPhysicalTraits;
  operationalCostMatrix?: OperationalCostMatrix;
  energyConsumptionProfile?: EnergyConsumptionProfile;
  canonicalSpecs?: CanonicalSpecSlot[] | Record<string, any>;
  knowledgeVault?: Partial<Record<PillarId, PillarDocument>>;
}

const SUPPLY_FAMILY_ORDER: SupplyItemFamily[] = [
  'COMBUSTIBLE',
  'POSTRATAMIENTO',
  'LUBRICANTE',
  'REFRIGERANTE',
  'GRASA',
  'FILTRO',
  'RESPIRADERO',
  'SELLO_CORREA_MANGUERA',
  'NEUMATICO',
  'RODAJE',
  'DESGASTE',
];

function valOrMissing(
  raw: string | null | undefined,
  missingText: string
): { text: string; isMissing: boolean } {
  const trimmed = String(raw ?? '').trim();
  const lower = trimmed.toLowerCase();
  if (
    !trimmed ||
    trimmed === '-' ||
    trimmed === '—' ||
    lower.includes('no declarada en ficha') ||
    lower.includes('no declarado en ficha') ||
    lower.includes('pendiente de registro') ||
    lower.includes('not declared in sheet') ||
    lower.includes('pending registration') ||
    lower.includes('não declarada na ficha') ||
    lower.includes('pendente de registro')
  ) {
    return { text: missingText, isMissing: true };
  }
  return { text: trimmed, isMissing: false };
}

function normalizeSearchText(raw: string | null | undefined): string {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildFallbackSupplyItems(
  matrix?: OperationalCostMatrix,
  energyFallback?: EnergyConsumptionProfile
): EquipmentSupplyLineItem[] {
  if (!matrix && !energyFallback) return [];
  const items: EquipmentSupplyLineItem[] = [];
  const energy = matrix?.energy_consumption || energyFallback;

  if (
    energy &&
    energy.energy_source !== 'NO_DECLARADO' &&
    energy.energy_source !== 'MANUAL_MECANICO' &&
    energy.energy_source !== 'REMOLCADO_SIN_PROPULSION_PROPIA'
  ) {
    const rate =
      energy.hourly_consumption_by_load?.medium_load_50_65pct ||
      energy.hourly_consumption_by_load?.high_load_80_100pct ||
      energy.road_haul_efficiency?.liters_per_100km ||
      energy.road_haul_efficiency?.km_per_liter ||
      null;
    items.push({
      item_key: 'fallback_energy_primary',
      family: 'COMBUSTIBLE',
      item_name: 'Combustible / Energía Primaria',
      subsystem: 'Motor / Propulsión',
      oem_spec_or_size: energy.energy_spec_label || energy.energy_source,
      oem_part_number: null,
      change_or_installed_qty: energy.storage_and_autonomy?.tank_or_battery_capacity || null,
      numeric_qty: null,
      qty_unit: null,
      change_interval_or_life: rate ? 'Continuo' : null,
      interval_value: null,
      interval_basis: rate ? 'continuo' : null,
      prorated_per_1000h: null,
      numeric_rate_per_1000h: null,
      service_note: null,
      spec_conflict: null,
      source_pillar: 'ficha_tecnica',
      source_item_title: 'Ficha Técnica',
    });
  }

  for (const [idx, f] of (matrix?.periodic_fluids || []).entries()) {
    const textLower = `${f.compartment} ${f.fluid_spec}`.toLowerCase();
    const family: SupplyItemFamily = textLower.includes('grasa') || textLower.includes('grease')
      ? 'GRASA'
      : textLower.includes('refrigerante') || textLower.includes('coolant')
      ? 'REFRIGERANTE'
      : textLower.includes('def') || textLower.includes('adblue')
      ? 'POSTRATAMIENTO'
      : 'LUBRICANTE';
    items.push({
      item_key: `fallback_fluid_${idx}`,
      family,
      item_name: f.compartment,
      subsystem: f.compartment,
      oem_spec_or_size: [f.fluid_spec, f.viscosity]
        .filter((part) => part && part !== '-' && !part.toLowerCase().includes('no declarad'))
        .join(' · ') || null,
      oem_part_number: null,
      change_or_installed_qty: f.capacity_per_change || null,
      numeric_qty: null,
      qty_unit: null,
      change_interval_or_life: f.interval || null,
      interval_value: null,
      interval_basis: null,
      prorated_per_1000h: f.prorated_per_1000h || null,
      numeric_rate_per_1000h: null,
      service_note: null,
      spec_conflict: null,
      source_pillar: 'pauta_mantencion',
      source_item_title: f.source_item_title,
    });
  }

  for (const [idx, fl] of (matrix?.periodic_filters_and_seals || []).entries()) {
    const textLower = `${fl.component_name} ${fl.system}`.toLowerCase();
    const family: SupplyItemFamily =
      fl.category === 'RESPIRADERO' || textLower.includes('respiradero') || textLower.includes('breather')
        ? 'RESPIRADERO'
        : fl.category === 'SELLO_EMPAQUETADURA' ||
          fl.category === 'CORREA_MANGUERA' ||
          textLower.includes('correa') ||
          textLower.includes('sello') ||
          textLower.includes('manguera')
        ? 'SELLO_CORREA_MANGUERA'
        : textLower.includes('dpf') || textLower.includes('scr')
        ? 'POSTRATAMIENTO'
        : 'FILTRO';
    items.push({
      item_key: `fallback_filter_${idx}`,
      family,
      item_name: fl.component_name,
      subsystem: fl.system,
      oem_spec_or_size: null,
      oem_part_number: fl.oem_part_number || null,
      change_or_installed_qty: fl.quantity_per_change || null,
      numeric_qty: null,
      qty_unit: null,
      change_interval_or_life: fl.interval || null,
      interval_value: null,
      interval_basis: null,
      prorated_per_1000h: null,
      numeric_rate_per_1000h: null,
      service_note: null,
      spec_conflict: null,
      source_pillar: 'pauta_mantencion',
      source_item_title: fl.source_item_title,
    });
  }

  for (const [idx, sp] of (matrix?.tires_and_undercarriage || []).entries()) {
    const textLower = `${sp.component_name} ${sp.size_or_compound_spec}`.toLowerCase();
    const isTire =
      sp.category === 'NEUMATICO' ||
      (/(neum[aá]tic|tire|tyre|llanta|rim|wheel)/i.test(textLower) &&
        !/(oruga|cadena|chain|track|rodaje|undercarriage|zapat)/i.test(textLower));
    items.push({
      item_key: `fallback_support_${idx}`,
      family: isTire ? 'NEUMATICO' : 'RODAJE',
      item_name: sp.component_name,
      subsystem: isTire ? 'Tracción / Rodado' : 'Tren de Rodaje',
      oem_spec_or_size: sp.size_or_compound_spec || null,
      oem_part_number: null,
      change_or_installed_qty: sp.installed_qty || null,
      numeric_qty: null,
      qty_unit: null,
      change_interval_or_life: sp.estimated_life || null,
      interval_value: null,
      interval_basis: null,
      prorated_per_1000h: null,
      numeric_rate_per_1000h: null,
      service_note: sp.nominal_pressure_or_tension || null,
      spec_conflict: null,
      source_pillar: 'ficha_tecnica',
      source_item_title: sp.source_item_title,
    });
  }

  for (const [idx, wp] of (matrix?.wear_parts_get || []).entries()) {
    items.push({
      item_key: `fallback_wear_${idx}`,
      family: 'DESGASTE',
      item_name: wp.part_name,
      subsystem: wp.work_tool_zone,
      oem_spec_or_size: wp.oem_spec_or_code || null,
      oem_part_number: null,
      change_or_installed_qty: wp.installed_qty || null,
      numeric_qty: null,
      qty_unit: null,
      change_interval_or_life: wp.estimated_life || null,
      interval_value: null,
      interval_basis: null,
      prorated_per_1000h: null,
      numeric_rate_per_1000h: null,
      service_note: wp.condemnation_limit || null,
      spec_conflict: null,
      source_pillar: 'pauta_mantencion',
      source_item_title: wp.source_item_title,
    });
  }

  return items;
}

const DataValueCell: React.FC<{
  value: string | null | undefined;
  missingText: string;
  mono?: boolean;
  nowrap?: boolean;
}> = ({ value, missingText, mono = true, nowrap = false }) => {
  const { text, isMissing } = valOrMissing(value, missingText);
  if (isMissing) {
    return (
      <span className="text-[13px] text-[#94A3B8] dark:text-[#5A6072]">
        {text}
      </span>
    );
  }
  return (
    <span
      className={`text-[13px] text-[#0F172A] dark:text-[#F3F4F6] ${
        mono ? 'font-mono tabular-nums select-text' : ''
      } ${nowrap ? 'whitespace-nowrap' : ''}`}
    >
      {text}
    </span>
  );
};

export const EquipmentCostMatrixPanel: React.FC<EquipmentCostMatrixPanelProps> = ({
  operationalCostMatrix,
  energyConsumptionProfile,
}) => {
  const { t } = useTranslation();
  const missingSpecText = t('opermaq_domains.not_declared');

  const [selectedFamily, setSelectedFamily] = useState<'ALL' | SupplyItemFamily>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const allSupplyItems = useMemo<EquipmentSupplyLineItem[]>(() => {
    const compiled = operationalCostMatrix?.supply_items;
    if (compiled && compiled.length > 0) {
      return compiled;
    }
    return buildFallbackSupplyItems(operationalCostMatrix, energyConsumptionProfile);
  }, [operationalCostMatrix, energyConsumptionProfile]);

  const availableFamilies = useMemo<SupplyItemFamily[]>(() => {
    const present = new Set<SupplyItemFamily>(allSupplyItems.map((item) => item.family));
    return SUPPLY_FAMILY_ORDER.filter((family) => present.has(family));
  }, [allSupplyItems]);

  const activeFamily: 'ALL' | SupplyItemFamily =
    selectedFamily !== 'ALL' && availableFamilies.includes(selectedFamily)
      ? selectedFamily
      : 'ALL';

  const filteredItems = useMemo<EquipmentSupplyLineItem[]>(() => {
    const normalizedQuery = normalizeSearchText(searchQuery.trim());
    return allSupplyItems.filter((item) => {
      if (activeFamily !== 'ALL' && item.family !== activeFamily) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = normalizeSearchText(
        [
          t(`cost_matrix.family_${item.family}`),
          item.item_name,
          item.subsystem,
          item.oem_spec_or_size,
          item.oem_part_number,
          item.service_note,
          item.spec_conflict,
        ]
          .filter(Boolean)
          .join(' ')
      );
      return haystack.includes(normalizedQuery);
    });
  }, [allSupplyItems, activeFamily, searchQuery, t]);

  return (
    <section className="flex flex-col h-full min-h-0 w-full select-none rounded-none shadow-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
      {/* Barra de Filtro Plana en 1 Línea */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-[13px] px-[21px] pt-[13px] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
        <div className="flex flex-wrap items-center gap-[13px]">
          <button
            type="button"
            onClick={() => setSelectedFamily('ALL')}
            className={`rounded-none shadow-none bg-transparent pb-[8px] text-[13px] font-mono uppercase tracking-[0.04em] transition-colors cursor-pointer whitespace-nowrap border-b-2 ${
              activeFamily === 'ALL'
                ? 'border-[#C68346] font-bold text-[#0F172A] dark:text-[#F3F4F6]'
                : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
            }`}
          >
            {t('cost_matrix.filter_all')}
          </button>

          {availableFamilies.map((family) => {
            const isActive = activeFamily === family;
            return (
              <button
                key={family}
                type="button"
                onClick={() => setSelectedFamily(family)}
                className={`rounded-none shadow-none bg-transparent pb-[8px] text-[13px] font-mono uppercase tracking-[0.04em] transition-colors cursor-pointer whitespace-nowrap border-b-2 ${
                  isActive
                    ? 'border-[#C68346] font-bold text-[#0F172A] dark:text-[#F3F4F6]'
                    : 'border-transparent text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6]'
                }`}
              >
                {t(`cost_matrix.family_${family}`)}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-[13px] min-w-[260px] flex-1 sm:flex-initial justify-end">
          <div className="flex items-center gap-[8px] border-b border-[#E2E8F0] dark:border-[#12151C] focus-within:border-[#00AEEF] py-[8px] min-w-[240px] flex-1 sm:w-[320px] transition-colors">
            <span className="material-symbols-outlined text-[18px] text-[#475569] dark:text-[#8A93A6] shrink-0">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('cost_matrix.search_placeholder')}
              aria-label={t('cost_matrix.search_placeholder')}
              className="w-full rounded-none shadow-none bg-transparent border-0 outline-none text-[13px] font-mono text-[#0F172A] dark:text-[#F3F4F6] placeholder:text-[#94A3B8] dark:placeholder:text-[#5A6072]"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={t('cost_matrix.clear_search_aria')}
                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shrink-0 rounded-none shadow-none"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>

          <span className="text-[13px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6] whitespace-nowrap">
            {filteredItems.length} / {allSupplyItems.length}
          </span>
        </div>
      </div>

      {/* Tabla Única Plana de Insumos y Piezas de Recambio Ad Hoc */}
      <div className="flex-1 min-h-0 w-full overflow-auto px-[21px] pb-[21px]">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="sticky top-0 z-10 bg-[#FFFFFF] dark:bg-[#000000]">
            <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[13px] font-bold uppercase tracking-[0.04em] text-[#475569] dark:text-[#8A93A6]">
              <th className="py-[13px] pr-[13px] whitespace-nowrap">
                {t('cost_matrix.col_supply_family')}
              </th>
              <th className="py-[13px] px-[13px] whitespace-nowrap">
                {t('cost_matrix.col_supply_item')}
              </th>
              <th className="py-[13px] px-[13px] whitespace-nowrap">
                {t('cost_matrix.col_subsystem')}
              </th>
              <th className="py-[13px] px-[13px] whitespace-nowrap">
                {t('cost_matrix.col_oem_spec_size')}
              </th>
              <th className="py-[13px] px-[13px] whitespace-nowrap">
                {t('cost_matrix.col_oem_part')}
              </th>
              <th className="py-[13px] px-[13px] whitespace-nowrap">
                {t('cost_matrix.col_qty_volume')}
              </th>
              <th className="py-[13px] px-[13px] whitespace-nowrap">
                {t('cost_matrix.col_interval_life')}
              </th>
              <th className="py-[13px] pl-[13px] whitespace-nowrap">
                {t('cost_matrix.col_rate_1000h')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr className="border-b border-[#E2E8F0] dark:border-[#12151C]">
                <td
                  colSpan={8}
                  className="py-[21px] text-[13px] text-[#94A3B8] dark:text-[#5A6072]"
                >
                  {t('cost_matrix.empty_list')}
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => {
                const oemPart = valOrMissing(item.oem_part_number, missingSpecText);
                return (
                  <tr
                    key={item.item_key}
                    className="border-b border-[#E2E8F0] dark:border-[#12151C] hover:bg-[#F8FAFC] dark:hover:bg-[#07090D] transition-colors align-top"
                  >
                    <td className="py-[13px] pr-[13px] font-mono tabular-nums font-bold uppercase tracking-[0.04em] text-[#475569] dark:text-[#8A93A6] whitespace-nowrap">
                      {t(`cost_matrix.family_${item.family}`)}
                    </td>

                    <td className="py-[13px] px-[13px] text-[#0F172A] dark:text-[#F3F4F6]">
                      <div className="font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                        {item.item_name}
                      </div>
                      {item.service_note && (
                        <div className="mt-[8px] font-mono tabular-nums text-[13px] text-[#475569] dark:text-[#8A93A6]">
                          {item.service_note}
                        </div>
                      )}
                    </td>

                    <td className="py-[13px] px-[13px] text-[#475569] dark:text-[#8A93A6]">
                      {item.subsystem}
                    </td>

                    <td className="py-[13px] px-[13px]">
                      <DataValueCell
                        value={item.oem_spec_or_size}
                        missingText={missingSpecText}
                        mono={true}
                      />
                      {item.spec_conflict && (
                        <div className="mt-[8px] flex items-start gap-[8px] text-[13px] text-[#C68346]">
                          <span className="material-symbols-outlined text-[16px] leading-[1.3] shrink-0">
                            warning
                          </span>
                          <span className="font-mono">
                            <span className="font-bold uppercase">
                              {t('cost_matrix.conflict_label')}:
                            </span>{' '}
                            {item.spec_conflict}
                          </span>
                        </div>
                      )}
                    </td>

                    <td className="py-[13px] px-[13px] whitespace-nowrap">
                      {oemPart.isMissing ? (
                        <span className="text-[13px] text-[#94A3B8] dark:text-[#5A6072]">
                          {oemPart.text}
                        </span>
                      ) : (
                        <div className="inline-flex items-center gap-[8px] font-mono tabular-nums text-[13px] text-[#00AEEF] select-text">
                          <span>{oemPart.text}</span>
                          <CopyButton value={oemPart.text} title={oemPart.text} />
                        </div>
                      )}
                    </td>

                    <td className="py-[13px] px-[13px]">
                      <DataValueCell
                        value={item.change_or_installed_qty}
                        missingText={missingSpecText}
                        mono={true}
                        nowrap={true}
                      />
                    </td>

                    <td className="py-[13px] px-[13px]">
                      <DataValueCell
                        value={item.change_interval_or_life}
                        missingText={missingSpecText}
                        mono={true}
                        nowrap={true}
                      />
                    </td>

                    <td className="py-[13px] pl-[13px]">
                      <DataValueCell
                        value={item.prorated_per_1000h}
                        missingText={missingSpecText}
                        mono={true}
                        nowrap={true}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default EquipmentCostMatrixPanel;
