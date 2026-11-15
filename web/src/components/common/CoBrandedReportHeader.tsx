import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';
import BrandLogo from '../BrandLogo';
import SecureImage from './SecureImage';
import { getApiUrl } from '../../utils/network';
import { UNDECLARED_TECH_VALUE } from './ReportBlockEditable';

export interface CoBrandedReportHeaderProps {
    title: string;
    documentCode: string;
    organizationName?: string | null;
    coBrandingLogoUrl?: string | null;
    utmStamp?: string | null;
    isEduSandbox?: boolean;
    issuedAt?: string | null;
    className?: string;
}

export const CoBrandedReportHeader: React.FC<CoBrandedReportHeaderProps> = ({
    title,
    documentCode,
    organizationName,
    coBrandingLogoUrl,
    utmStamp,
    isEduSandbox = false,
    issuedAt,
    className,
}) => {
    const { t } = useTranslation();
    const trimmedUrl = (coBrandingLogoUrl || '').trim();
    const resolvedLogoSrc = trimmedUrl
        ? trimmedUrl.startsWith('/api/')
            ? getApiUrl(trimmedUrl)
            : trimmedUrl
        : '';

    const resolvedOrg =
        (organizationName || '').trim() ||
        t('core_common.undeclared_tech_value', UNDECLARED_TECH_VALUE);

    return (
        <header
            className={cn(
                'grid grid-cols-12 items-center gap-fib-21 p-fib-21 bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none select-none',
                className
            )}
        >
            {/* Área Mayor Φ (61.8% -> 8/12 columnas): Identidad MINREPORT + Documento Técnico */}
            <div className="col-span-12 md:col-span-8 flex flex-col gap-fib-13 min-w-0">
                <div className="flex flex-wrap items-center gap-fib-13">
                    <BrandLogo variant="logotype" className="h-6 w-auto object-contain" />
                    <span className="w-[1px] h-4 bg-[#E2E8F0] dark:bg-[#12151C]" aria-hidden="true" />
                    <span className="font-mono text-microcopy uppercase tabular-nums text-[#C68346] select-text">
                        {documentCode}
                    </span>
                    {issuedAt && (
                        <span className="font-mono text-microcopy tabular-nums text-[#475569] dark:text-[#8A93A6]">
                            {issuedAt}
                        </span>
                    )}
                </div>

                <h2 className="text-h1-header font-semibold text-[#0F172A] dark:text-[#F3F4F6] truncate">
                    {title}
                </h2>

                {utmStamp && (
                    <div className="flex items-center gap-fib-8 font-mono text-data-dense tabular-nums text-[#475569] dark:text-[#8A93A6]">
                        <span className="material-symbols-outlined text-[16px] text-[#00AEEF]">location_on</span>
                        <span className="select-text">{utmStamp}</span>
                    </div>
                )}
            </div>

            {/* Área Menor 1 - Φ (38.2% -> 4/12 columnas): Co-Branding Mandante + Sello EDU */}
            <div className="col-span-12 md:col-span-4 flex flex-col items-start md:items-end justify-center gap-fib-8 border-t md:border-t-0 md:border-l border-[#E2E8F0] dark:border-[#12151C] pt-fib-13 md:pt-0 md:pl-fib-21 min-w-0">
                {resolvedLogoSrc ? (
                    <SecureImage
                        src={resolvedLogoSrc}
                        alt={resolvedOrg}
                        className="h-10 max-w-[180px] object-contain"
                    />
                ) : (
                    <span className="font-mono text-data-dense tabular-nums text-[#0F172A] dark:text-[#F3F4F6] truncate max-w-full">
                        {resolvedOrg}
                    </span>
                )}

                {resolvedLogoSrc && organizationName && (
                    <span className="font-mono text-microcopy uppercase tabular-nums text-[#475569] dark:text-[#8A93A6] truncate max-w-full">
                        {organizationName}
                    </span>
                )}

                {isEduSandbox && (
                    <span className="border border-[#00AEEF] px-fib-8 py-0.5 font-mono text-microcopy uppercase tracking-wider text-[#00AEEF] rounded-none shadow-none">
                        {t('core_common.edu_non_commercial_seal', 'USO ACADÉMICO NO COMERCIAL')}
                    </span>
                )}
            </div>
        </header>
    );
};

export default CoBrandedReportHeader;
