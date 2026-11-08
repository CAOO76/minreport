import React from 'react';

export interface M3LinearProgressProps {
  /** Valor de 0 a 100 para modo determinado. Omitir cuando indeterminate=true. */
  value?: number;
  /** Modo indeterminado M3 (animación continua sobre el track). */
  indeterminate?: boolean;
  /** Color semántico M3 MINREPORT: 'copper' (#C68346 en curso) o 'cyan' (#00AEEF completado). */
  tone?: 'copper' | 'cyan' | 'auto';
  /** Mostrar el Stop Indicator de 4x4px al final del track (estándar M3). Por defecto true. */
  showStopIndicator?: boolean;
  /** Clases adicionales de ancho/margen para el contenedor. */
  className?: string;
  /** Etiqueta accesible ARIA. */
  ariaLabel?: string;
}

/**
 * M3LinearProgress — Material Design 3 Linear Progress Indicator
 * Especificación oficial: https://m3.material.io/components/progress-indicators/overview
 * Adaptación Minimalismo Industrial Puro MINREPORT:
 * - Altura de pista: 4px (h-[4px]), geometría 0px (rounded-none).
 * - Separación activa/inactiva: 4px (gap-[4px]) entre Active Indicator y Track.
 * - Stop Indicator: 4px x 4px al extremo derecho del Track en modo determinado.
 */
export const M3LinearProgress: React.FC<M3LinearProgressProps> = ({
  value = 0,
  indeterminate = false,
  tone = 'auto',
  showStopIndicator = true,
  className = 'w-full',
  ariaLabel = 'Indicador de progreso lineal',
}) => {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const resolvedTone =
    tone === 'auto' ? (clamped >= 100 ? 'cyan' : 'copper') : tone;
  const activeColorClass =
    resolvedTone === 'cyan' ? 'bg-[#00AEEF]' : 'bg-[#C68346]';
  const stopColorClass =
    resolvedTone === 'cyan' ? 'bg-[#00AEEF]' : 'bg-[#C68346]';

  if (indeterminate) {
    return (
      <div
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        className={`relative h-[4px] overflow-hidden bg-[#E2E8F0] dark:bg-[#12151C] rounded-none shadow-none select-none ${className}`}
      >
        <div
          className={`absolute inset-y-0 left-0 w-[42%] ${activeColorClass} rounded-none animate-pulse`}
        />
      </div>
    );
  }

  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`flex items-center h-[4px] rounded-none shadow-none select-none ${
        clamped > 0 && clamped < 100 ? 'gap-[4px]' : ''
      } ${className}`}
    >
      {/* Active Indicator */}
      {clamped > 0 && (
        <div
          className={`h-full ${activeColorClass} rounded-none transition-all duration-300 shrink-0`}
          style={{ width: `${clamped}%` }}
        />
      )}

      {/* Inactive Track + M3 4x4px Stop Indicator */}
      {clamped < 100 && (
        <div className="relative flex-1 h-full bg-[#E2E8F0] dark:bg-[#12151C] rounded-none overflow-hidden">
          {showStopIndicator && (
            <span
              className={`absolute right-0 top-0 w-[4px] h-[4px] ${stopColorClass} rounded-none`}
            />
          )}
        </div>
      )}
    </div>
  );
};

export interface M3CircularProgressProps {
  /** Valor de 0 a 100 para modo determinado. Omitir cuando indeterminate=true. */
  value?: number;
  /** Modo indeterminado M3. */
  indeterminate?: boolean;
  /** Tamaño en píxeles (por defecto 20px compacto o 40px estándar M3). */
  size?: number;
  /** Espesor de trazo en píxeles (por defecto 3px). */
  strokeWidth?: number;
  /** Color semántico M3 MINREPORT: 'copper' (#C68346) o 'cyan' (#00AEEF). */
  tone?: 'copper' | 'cyan';
  /** Clases adicionales. */
  className?: string;
  /** Etiqueta accesible ARIA. */
  ariaLabel?: string;
}

/**
 * M3CircularProgress — Material Design 3 Circular Progress Indicator
 * Especificación oficial: https://m3.material.io/components/progress-indicators/overview
 */
export const M3CircularProgress: React.FC<M3CircularProgressProps> = ({
  value = 25,
  indeterminate = true,
  size = 18,
  strokeWidth = 2.5,
  tone = 'copper',
  className = '',
  ariaLabel = 'Indicador de progreso circular',
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const effectivePct = indeterminate ? 70 : clamped;
  const dashOffset = circumference - (effectivePct / 100) * circumference;
  const activeStroke = tone === 'cyan' ? '#00AEEF' : '#C68346';

  return (
    <svg
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`inline-block shrink-0 select-none ${
        indeterminate ? 'animate-spin' : ''
      } ${className}`}
    >
      {/* Inactive Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-[#E2E8F0] dark:text-[#12151C]"
      />
      {/* Active Indicator */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={activeStroke}
        strokeWidth={strokeWidth}
        strokeLinecap="butt"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
};

export default M3LinearProgress;

