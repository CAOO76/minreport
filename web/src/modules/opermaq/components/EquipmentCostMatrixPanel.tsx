import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AssetPhysicalTraits,
  CanonicalSpecSlot,
  CostMatrixTaxonomyMeta,
  EnergyConsumptionProfile,
  OperationalCostMatrix,
} from '../../../contracts';
import type { PillarDocument, PillarId } from '../types/vault';
import { classifyFrontendEnergyKind } from '../utils/opermaqDomainProjection';
import { M3LinearProgress } from './M3ProgressIndicator';

const MISSING_SPEC_TEXT = '[Información técnica no declarada en ficha]';

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

const DEFAULT_TAXONOMY_META: CostMatrixTaxonomyMeta = {
  family_key: 'INDUSTRIAL_GENERAL',
  family_label_es: 'Activo Industrial',
  material_icon: 'precision_manufacturing',
  wear_section_visible: true,
  wear_section_title_es: 'Elementos de Desgaste Operacional y Trabajo',
  wear_col_1_label_es: 'Elemento / Repuesto de Desgaste',
  wear_col_2_label_es: 'Subsistema / Zona de Trabajo',
  wear_empty_hint_es:
    '[Información técnica no declarada en ficha] — Sin elementos de desgaste cazados en Pauta de Mantención.',
  support_section_visible: true,
  support_section_title_es: 'Sistema de Rodado, Apoyo o Sujeción',
  support_col_spec_label_es: 'Medida / Especificación OEM',
  support_col_pressure_label_es: 'Presión / Tensión / Precarga Nominal',
  support_empty_hint_es:
    '[Información técnica no declarada en ficha] — Sin componentes de rodado o apoyo cazados en Pauta de Mantención.',
  supports_road_km_efficiency: false,
  supports_hourly_load_table: true,
  primary_tco_unit: '$ / h',
};

function valOrMissing(raw: string | null | undefined): { text: string; isMissing: boolean } {
  const trimmed = String(raw ?? '').trim();
  if (
    !trimmed ||
    trimmed === '-' ||
    trimmed === '—' ||
    trimmed.toLowerCase().includes('no declarada en ficha') ||
    trimmed.toLowerCase().includes('no declarado en ficha') ||
    trimmed.toLowerCase().includes('pendiente de registro')
  ) {
    return { text: MISSING_SPEC_TEXT, isMissing: true };
  }
  return { text: trimmed, isMissing: false };
}

const DataValueCell: React.FC<{ value: string | null | undefined; mono?: boolean }> = ({
  value,
  mono = true,
}) => {
  const { text, isMissing } = valOrMissing(value);
  if (isMissing) {
    return <span className="text-[12px] text-[#94A3B8] dark:text-[#5A6072]">{text}</span>;
  }
  return (
    <span
      className={`text-[13px] text-[#0F172A] dark:text-[#F3F4F6] ${
        mono ? 'font-mono tabular-nums select-text' : ''
      }`}
    >
      {text}
    </span>
  );
};

export const EquipmentCostMatrixPanel: React.FC<EquipmentCostMatrixPanelProps> = ({
  makeModel,
  tipoEquipo,
  categoriaEquipo,
  physicalTraits,
  operationalCostMatrix,
  energyConsumptionProfile,
}) => {
  const { t } = useTranslation();
  const matrix = operationalCostMatrix;
  const effectiveTraits = physicalTraits;
  const taxonomy: CostMatrixTaxonomyMeta = {
    ...DEFAULT_TAXONOMY_META,
    ...(effectiveTraits
      ? {
          material_icon: effectiveTraits.material_symbol_icon || DEFAULT_TAXONOMY_META.material_icon,
          support_section_visible:
            effectiveTraits.mobility === 'SELF_PROPELLED_WHEELED' ||
            effectiveTraits.mobility === 'SELF_PROPELLED_TRACKED' ||
            effectiveTraits.mobility === 'TOWED_TRAILER' ||
            effectiveTraits.mobility === 'AERIAL_OR_MARINE',
          supports_road_km_efficiency:
            effectiveTraits.duty_travel_regime === 'ON_HIGHWAY' ||
            effectiveTraits.duty_travel_regime === 'DUAL_ROAD_AND_SITE',
        }
      : {}),
    ...(matrix?.taxonomy_meta || {}),
  };

  const energy = matrix?.energy_consumption || energyConsumptionProfile;
  const capex = matrix?.capex_and_depreciation;
  const periodicFluids = matrix?.periodic_fluids || [];
  const periodicFilters = matrix?.periodic_filters_and_seals || [];
  const wearParts = matrix?.wear_parts_get || [];
  const supportParts = matrix?.tires_and_undercarriage || [];
  const pmKits = matrix?.scheduled_pm_kits_summary || [];

  const completenessStatus = matrix?.completeness_status || 'EMPTY';
  const progressPct =
    completenessStatus === 'COMPLETE' ? 100 : completenessStatus === 'PARTIAL' ? 60 : 0;

  const hasRoadData = Boolean(
    taxonomy.supports_road_km_efficiency ||
      energy?.road_haul_efficiency?.km_per_liter ||
      energy?.road_haul_efficiency?.liters_per_100km ||
      energy?.road_haul_efficiency?.highway_km_per_liter ||
      energy?.road_haul_efficiency?.offroad_km_per_liter ||
      energy?.road_haul_efficiency?.kwh_per_100km
  );

  const requiresDef = Boolean(
    energy?.def_adblue_consumption?.requires_def ||
      energy?.def_adblue_consumption?.consumption_pct_of_fuel ||
      energy?.def_adblue_consumption?.tank_capacity_liters
  );

  const energyKind = classifyFrontendEnergyKind({
    primaryEnergy: energy?.energy_source || effectiveTraits?.primary_energy || null,
    energyValueText: energy?.energy_spec_label || null,
    typeContextText: `${tipoEquipo || ''} ${categoriaEquipo || ''}`,
  });

  const showEnergySection =
    energyKind !== 'MANUAL_MECHANICAL' && energyKind !== 'TOWED_PASSIVE';

  const showStorageCapacityCard =
    energyKind === 'THERMAL_FUEL' ||
    energyKind === 'BATTERY_BEV' ||
    energyKind === 'HYBRID';

  const storageCardTitle =
    energyKind === 'BATTERY_BEV'
      ? t('cost_matrix_energy.storage_battery_bank')
      : energyKind === 'HYBRID'
      ? t('cost_matrix_energy.storage_hybrid')
      : t('cost_matrix_energy.storage_fuel_tank');

  const autonomyOrDemandCardTitle =
    energyKind === 'GRID_AC'
      ? t('cost_matrix_energy.demand_grid_ac')
      : energyKind === 'PNEUMATIC_AIR'
      ? t('cost_matrix_energy.demand_pneumatic')
      : energyKind === 'HYDRAULIC_AUX'
      ? t('cost_matrix_energy.demand_hydraulic')
      : energyKind === 'BATTERY_BEV'
      ? t('cost_matrix_energy.autonomy_battery')
      : t('cost_matrix_energy.autonomy_thermal');

  const visibleEnergyCardsCount =
    (showStorageCapacityCard ? 1 : 0) + 1 + (requiresDef ? 1 : 0);
  const energyGridColsClass =
    visibleEnergyCardsCount >= 3
      ? 'md:grid-cols-3'
      : visibleEnergyCardsCount === 2
      ? 'md:grid-cols-2'
      : 'md:grid-cols-1';

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] select-none">
      {/* Cabecera Técnica Paramétrica */}
      <header className="shrink-0 px-[21px] py-[13px] border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D]">
        <div className="flex flex-wrap items-center justify-between gap-[13px]">
          <div className="flex items-center gap-[13px] min-w-0">
            <span className="material-symbols-outlined text-[20px] text-[#C68346]">
              {taxonomy.material_icon || 'precision_manufacturing'}
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                MATRIZ DETERMINISTA DE CONSUMOS, DESGASTE Y COSTOS DIRECTOS · {taxonomy.family_label_es}
              </div>
              <h1 className="text-[17px] font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                {makeModel} {tipoEquipo ? `· ${tipoEquipo}` : ''}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-[21px]">
            <div className="text-right">
              <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                UNIDAD BASE TCO
              </div>
              <div className="text-[15px] font-bold font-mono tabular-nums text-[#C68346]">
                {taxonomy.primary_tco_unit}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                 VECTOR ENERGÉTICO
              </div>
              <div className="text-[13px] font-mono tabular-nums text-[#0F172A] dark:text-[#F3F4F6]">
                {energy?.energy_source && energy.energy_source !== 'NO_DECLARADO'
                  ? `${energy.energy_source} · ${energy.cost_driver_unit}`
                  : MISSING_SPEC_TEXT}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-[13px] flex items-center gap-[13px]">
          <M3LinearProgress
            value={progressPct}
            tone={progressPct >= 100 ? 'cyan' : 'copper'}
            className="flex-1"
            ariaLabel="Cobertura verificada de matriz de costos"
          />
          <span className="text-[11px] font-bold uppercase tracking-[0.05em] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
            {completenessStatus === 'COMPLETE'
              ? 'COBERTURA VERIFICADA'
              : completenessStatus === 'PARTIAL'
              ? 'DATOS PARCIALES EN BÓVEDA'
              : 'PENDIENTE DE CAZA EN PILARES 01 Y 03'}
          </span>
        </div>
      </header>

      <div className="p-[21px] flex flex-col gap-[34px]">
        {/* I. ENERGÍA, RENDIMIENTO Y AUTONOMÍA (PRESENCIA POSITIVA ESTRICTA) */}
        {showEnergySection && (
          <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] rounded-none shadow-none">
            <div className="flex items-center justify-between gap-[13px] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6]">
                {requiresDef
                  ? t('cost_matrix_energy.section_title_with_scr')
                  : t('cost_matrix_energy.section_title_base')}
              </h2>
              <span className="text-[11px] font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                {t('cost_matrix_energy.driver_unit_label')}: {energy?.cost_driver_unit || 'L/h'}
              </span>
            </div>

            <div className={`mt-[13px] grid grid-cols-1 ${energyGridColsClass} gap-[13px]`}>
              {showStorageCapacityCard && (
                <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] p-[13px] rounded-none shadow-none">
                  <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                    {storageCardTitle}
                  </div>
                  <div className="mt-[8px]">
                    <DataValueCell value={energy?.storage_and_autonomy?.tank_or_battery_capacity} />
                  </div>
                </div>
              )}

              <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] p-[13px] rounded-none shadow-none">
                <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                  {autonomyOrDemandCardTitle}
                </div>
                <div className="mt-[8px]">
                  <DataValueCell
                    value={
                      energy?.storage_and_autonomy?.estimated_autonomy ||
                      energy?.pneumatic_or_hydraulic_flow ||
                      energy?.specific_consumption_bsfc_gkwh
                    }
                  />
                </div>
              </div>

              {requiresDef && (
                <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] p-[13px] rounded-none shadow-none">
                  <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                    {t('cost_matrix_energy.scr_card_title')}
                  </div>
                  <div className="mt-[8px] flex flex-col gap-[4px] font-mono tabular-nums text-[13px] text-[#0F172A] dark:text-[#F3F4F6]">
                    <span>
                      {t('cost_matrix_energy.scr_proportion')}:{' '}
                      {energy?.def_adblue_consumption?.consumption_pct_of_fuel || MISSING_SPEC_TEXT}
                    </span>
                    <span className="text-[12px] text-[#475569] dark:text-[#8A93A6]">
                      {t('cost_matrix_energy.scr_tank')}:{' '}
                      {energy?.def_adblue_consumption?.tank_capacity_liters || MISSING_SPEC_TEXT}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Tabla Horaria por Régimen de Carga */}
            {taxonomy.supports_hourly_load_table && (
              <div className="mt-[21px] overflow-x-auto">
                <table className="w-full border-collapse text-left font-mono tabular-nums text-[13px]">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[11px] uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                      <th className="py-[8px] pr-[13px]">RALENTÍ / PTO AUXILIAR</th>
                      <th className="py-[8px] px-[13px]">CARGA BAJA (25–35%)</th>
                      <th className="py-[8px] px-[13px]">CARGA MEDIA (50–65%)</th>
                      <th className="py-[8px] pl-[13px]">CARGA ALTA (80–100%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-[#E2E8F0] dark:border-[#12151C]">
                      <td className="py-[13px] pr-[13px]">
                        <DataValueCell value={energy?.hourly_consumption_by_load?.idle_or_pto} />
                      </td>
                      <td className="py-[13px] px-[13px]">
                        <DataValueCell value={energy?.hourly_consumption_by_load?.low_load_25_35pct} />
                      </td>
                      <td className="py-[13px] px-[13px]">
                        <DataValueCell value={energy?.hourly_consumption_by_load?.medium_load_50_65pct} />
                      </td>
                      <td className="py-[13px] pl-[13px]">
                        <DataValueCell value={energy?.hourly_consumption_by_load?.high_load_80_100pct} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Tabla de Rendimiento por Kilómetro (Ruta / Faena) */}
            {hasRoadData && (
              <div className="mt-[21px] pt-[13px] border-t border-[#E2E8F0] dark:border-[#12151C] overflow-x-auto">
                <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#00AEEF] mb-[8px]">
                  RENDIMIENTO VIAL EN CARRETERA Y TRÁNSITO FUERA DE CARRETERA (ENTRE PUNTOS DE ENTREGA)
                </div>
              <table className="w-full border-collapse text-left font-mono tabular-nums text-[13px]">
                <thead>
                  <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[11px] uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                    <th className="py-[8px] pr-[13px]">CARRETERA / RUTA PAVIMENTADA</th>
                    <th className="py-[8px] px-[13px]">FAENA / FUERA DE CARRETERA</th>
                    <th className="py-[8px] px-[13px]">PROMEDIO COMBINADO</th>
                    <th className="py-[8px] pl-[13px]">AUTONOMÍA VIAL ESTIMADA</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[#E2E8F0] dark:border-[#12151C]">
                    <td className="py-[13px] pr-[13px]">
                      <DataValueCell
                        value={
                          energy?.road_haul_efficiency?.highway_km_per_liter ||
                          energy?.road_haul_efficiency?.highway_liters_per_100km
                        }
                      />
                    </td>
                    <td className="py-[13px] px-[13px]">
                      <DataValueCell
                        value={
                          energy?.road_haul_efficiency?.offroad_km_per_liter ||
                          energy?.road_haul_efficiency?.offroad_liters_per_100km
                        }
                      />
                    </td>
                    <td className="py-[13px] px-[13px]">
                      <DataValueCell
                        value={
                          energy?.road_haul_efficiency?.km_per_liter ||
                          energy?.road_haul_efficiency?.liters_per_100km ||
                          energy?.road_haul_efficiency?.kwh_per_100km
                        }
                      />
                    </td>
                    <td className="py-[13px] pl-[13px]">
                      <DataValueCell value={energy?.road_haul_efficiency?.estimated_range_km} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          </section>
        )}

        {/* II. BASE CAPEX Y VIDA ECONÓMICA */}
        <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] rounded-none shadow-none">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
            II. PARÁMETROS BASE DE INVERSIÓN (CAPEX), VIDA ÚTIL Y DOTACIÓN DE FÁBRICA
          </h2>
          <div className="mt-[13px] grid grid-cols-1 md:grid-cols-4 gap-[13px]">
            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] p-[13px]">
              <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                VALOR REFERENCIAL NUEVO
              </div>
              <div className="mt-[8px]">
                <DataValueCell
                  value={capex?.reference_new_price_usd || capex?.reference_new_price_clp}
                />
              </div>
            </div>
            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] p-[13px]">
              <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                VIDA ÚTIL ECONÓMICA OEM
              </div>
              <div className="mt-[8px]">
                <DataValueCell
                  value={
                    capex?.economic_life_hours ||
                    capex?.economic_life_km ||
                    capex?.economic_life_years
                  }
                />
              </div>
            </div>
            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] p-[13px]">
              <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                VALOR RESIDUAL / DEPRECIACIÓN BASE
              </div>
              <div className="mt-[8px]">
                <DataValueCell
                  value={capex?.hourly_depreciation_base || capex?.residual_value_pct}
                />
              </div>
            </div>
            <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] p-[13px]">
              <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                DOTACIÓN ESTÁNDAR OEM
              </div>
              <div className="mt-[8px]">
                <DataValueCell
                  value={capex?.factory_work_tool_equip || capex?.factory_tire_or_track_equip}
                  mono={false}
                />
              </div>
            </div>
          </div>
        </section>

        {/* III. LUBRICANTES, FLUIDOS Y REFRIGERANTES */}
        <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] rounded-none shadow-none">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
            III. FLUIDOS, LUBRICANTES Y CAPACIDADES DE RECAMBIO PERIÓDICO
          </h2>
          {periodicFluids.length === 0 ? (
            <div className="pt-[13px] text-[12px] text-[#94A3B8] dark:text-[#5A6072]">
              {MISSING_SPEC_TEXT} — Sin tabla de capacidades y lubricantes verificada en Pilares 01 / 03.
            </div>
          ) : (
            <div className="mt-[13px] overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                    <th className="py-[8px] pr-[13px]">COMPARTIMENTO / SISTEMA</th>
                    <th className="py-[8px] px-[13px]">ESPECIFICACIÓN / VISCOSIDAD</th>
                    <th className="py-[8px] px-[13px]">CAPACIDAD</th>
                    <th className="py-[8px] pl-[13px]">INTERVALO CAMBIO</th>
                  </tr>
                </thead>
                <tbody>
                  {periodicFluids.map((fl, idx) => (
                    <tr
                      key={`${fl.compartment}-${idx}`}
                      className="border-b border-[#E2E8F0] dark:border-[#12151C]"
                    >
                      <td className="py-[13px] pr-[13px] font-medium">{fl.compartment}</td>
                      <td className="py-[13px] px-[13px]">
                        <DataValueCell
                          value={
                            [fl.fluid_spec, fl.viscosity]
                              .filter((part) => part && !part.startsWith('['))
                              .join(' · ') || fl.fluid_spec
                          }
                        />
                      </td>
                      <td className="py-[13px] px-[13px]">
                        <DataValueCell value={fl.capacity_per_change} />
                      </td>
                      <td className="py-[13px] pl-[13px]">
                        <DataValueCell value={fl.interval} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* IV. FILTROS, KITS Y SELLOS PERIÓDICOS */}
        <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] rounded-none shadow-none">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
            IV. FILTROS, ELEMENTOS SELLANTES Y KITS DE MANTENCIÓN PREVENTIVA
          </h2>
          {periodicFilters.length === 0 ? (
            <div className="pt-[13px] text-[12px] text-[#94A3B8] dark:text-[#5A6072]">
              {MISSING_SPEC_TEXT} — Sin filtros ni kits periódicos verificados en Pilar 03.
            </div>
          ) : (
            <div className="mt-[13px] overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                    <th className="py-[8px] pr-[13px]">ELEMENTO / FILTRO</th>
                    <th className="py-[8px] px-[13px]">N° PARTE OEM</th>
                    <th className="py-[8px] px-[13px]">CANT.</th>
                    <th className="py-[8px] px-[13px]">INTERVALO</th>
                    <th className="py-[8px] pl-[13px]">PAUTA PM</th>
                  </tr>
                </thead>
                <tbody>
                  {periodicFilters.map((flt, idx) => (
                    <tr
                      key={`${flt.component_name}-${idx}`}
                      className="border-b border-[#E2E8F0] dark:border-[#12151C]"
                    >
                      <td className="py-[13px] pr-[13px] font-medium">{flt.component_name}</td>
                      <td className="py-[13px] px-[13px]">
                        <DataValueCell value={flt.oem_part_number} />
                      </td>
                      <td className="py-[13px] px-[13px]">
                        <DataValueCell value={flt.quantity_per_change} />
                      </td>
                      <td className="py-[13px] px-[13px]">
                        <DataValueCell value={flt.interval} />
                      </td>
                      <td className="py-[13px] pl-[13px]">
                        <DataValueCell value={flt.pm_stage} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* V. ELEMENTOS DE DESGASTE ESPECÍFICOS POR TAXONOMÍA DEL ACTIVO */}
        {taxonomy.wear_section_visible && (
          <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] rounded-none shadow-none">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
              V. {taxonomy.wear_section_title_es.toUpperCase()}
            </h2>
            {wearParts.length === 0 ? (
              <div className="pt-[13px] text-[12px] text-[#94A3B8] dark:text-[#5A6072]">
                {taxonomy.wear_empty_hint_es}
              </div>
            ) : (
              <div className="mt-[13px] overflow-x-auto">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                      <th className="py-[8px] pr-[13px]">{taxonomy.wear_col_1_label_es}</th>
                      <th className="py-[8px] px-[13px]">{taxonomy.wear_col_2_label_es}</th>
                      <th className="py-[8px] px-[13px]">CÓDIGO / ESPECIFICACIÓN OEM</th>
                      <th className="py-[8px] px-[13px]">CANT.</th>
                      <th className="py-[8px] px-[13px]">VIDA ESTIMADA</th>
                      <th className="py-[8px] pl-[13px]">LÍMITE DE CONDENA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wearParts.map((wp, idx) => (
                      <tr
                        key={`${wp.part_name}-${idx}`}
                        className="border-b border-[#E2E8F0] dark:border-[#12151C]"
                      >
                        <td className="py-[13px] pr-[13px] font-medium">{wp.part_name}</td>
                        <td className="py-[13px] px-[13px]">
                          <DataValueCell value={wp.work_tool_zone} mono={false} />
                        </td>
                        <td className="py-[13px] px-[13px]">
                          <DataValueCell value={wp.oem_spec_or_code} />
                        </td>
                        <td className="py-[13px] px-[13px]">
                          <DataValueCell value={wp.installed_qty} />
                        </td>
                        <td className="py-[13px] px-[13px]">
                          <DataValueCell value={wp.estimated_life} />
                        </td>
                        <td className="py-[13px] pl-[13px]">
                          <DataValueCell value={wp.condemnation_limit} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* VI. SISTEMA DE RODADO, APOYO, IZADO O SUJECIÓN */}
        {taxonomy.support_section_visible && (
          <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] rounded-none shadow-none">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
              VI. {taxonomy.support_section_title_es.toUpperCase()}
            </h2>
            {supportParts.length === 0 ? (
              <div className="pt-[13px] text-[12px] text-[#94A3B8] dark:text-[#5A6072]">
                {taxonomy.support_empty_hint_es}
              </div>
            ) : (
              <div className="mt-[13px] overflow-x-auto">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                      <th className="py-[8px] pr-[13px]">COMPONENTE</th>
                      <th className="py-[8px] px-[13px]">{taxonomy.support_col_spec_label_es}</th>
                      <th className="py-[8px] px-[13px]">CANT.</th>
                      <th className="py-[8px] px-[13px]">{taxonomy.support_col_pressure_label_es}</th>
                      <th className="py-[8px] px-[13px]">VIDA ESTIMADA</th>
                      <th className="py-[8px] pl-[13px]">LÍMITE DE CONDENA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supportParts.map((sp, idx) => (
                      <tr
                        key={`${sp.component_name}-${idx}`}
                        className="border-b border-[#E2E8F0] dark:border-[#12151C]"
                      >
                        <td className="py-[13px] pr-[13px] font-medium">{sp.component_name}</td>
                        <td className="py-[13px] px-[13px]">
                          <DataValueCell value={sp.size_or_compound_spec} />
                        </td>
                        <td className="py-[13px] px-[13px]">
                          <DataValueCell value={sp.installed_qty} />
                        </td>
                        <td className="py-[13px] px-[13px]">
                          <DataValueCell value={sp.nominal_pressure_or_tension} />
                        </td>
                        <td className="py-[13px] px-[13px]">
                          <DataValueCell value={sp.estimated_life} />
                        </td>
                        <td className="py-[13px] pl-[13px]">
                          <DataValueCell value={sp.condemnation_limit} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* VII. SÍNTESIS DE PAUTAS PROGRAMADAS PM */}
        {pmKits.length > 0 && (
          <section className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-[21px] rounded-none shadow-none">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.05em] text-[#0F172A] dark:text-[#F3F4F6] pb-[13px] border-b border-[#E2E8F0] dark:border-[#12151C]">
              VII. CONSOLIDADO DE KITS POR ESCALÓN DE MANTENCIÓN PROGRAMADA (PM)
            </h2>
            <div className="mt-[13px] overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[#E2E8F0] dark:border-[#12151C] text-[11px] font-mono uppercase tracking-[0.05em] text-[#475569] dark:text-[#8A93A6]">
                    <th className="py-[8px] pr-[13px]">PAUTA</th>
                    <th className="py-[8px] px-[13px]">FRECUENCIA</th>
                    <th className="py-[8px] px-[13px]">FLUIDOS ASOCIADOS</th>
                    <th className="py-[8px] px-[13px]">FILTROS / SELLOS</th>
                    <th className="py-[8px] pl-[13px]">DESGASTE / APOYO</th>
                  </tr>
                </thead>
                <tbody>
                  {pmKits.map((kit, idx) => (
                    <tr
                      key={`${kit.pm_code}-${idx}`}
                      className="border-b border-[#E2E8F0] dark:border-[#12151C]"
                    >
                      <td className="py-[13px] pr-[13px] font-mono font-bold text-[#C68346]">
                        {kit.pm_code}
                      </td>
                      <td className="py-[13px] px-[13px]">
                        <DataValueCell value={kit.interval} />
                      </td>
                      <td className="py-[13px] px-[13px]">
                        <DataValueCell value={kit.fluids_summary} mono={false} />
                      </td>
                      <td className="py-[13px] px-[13px]">
                        <DataValueCell value={kit.filters_and_seals_summary} mono={false} />
                      </td>
                      <td className="py-[13px] pl-[13px]">
                        <DataValueCell value={kit.wear_and_rodado_checks} mono={false} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default EquipmentCostMatrixPanel;
