import 'react-phone-number-input/style.css'
import PhoneInput from 'react-phone-number-input'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'

interface PhoneInputProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    error?: string;
}

export const CustomPhoneInput = ({ value, onChange, className, error }: PhoneInputProps) => {
    const { t } = useTranslation();

    return (
        <div className={clsx("flex flex-col gap-1", className)}>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('form.phone', 'Teléfono / Celular')}
            </label>
            <div className="phone-input-container">
                <PhoneInput
                    international
                    defaultCountry="CL"
                    value={value}
                    onChange={(val) => onChange(val || '')}
                    className={clsx(
                        "w-full px-4 py-2 rounded-md bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700",
                        "focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all",
                        "text-slate-900 dark:text-slate-100 placeholder-slate-400 font-atkinson"
                    )}
                    autoComplete="off"
                />
            </div>
            {error && (
                <span className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <span className="material-symbols-rounded text-sm">error</span>
                    {error}
                </span>
            )}

            {/* Custom styles to match the Design System */}
            <style>{`
        .phone-input-container .PhoneInputInput {
          background: transparent;
          border: none;
          outline: none;
          color: inherit;
          font-family: inherit;
          width: 100%;
          padding: 0;
          margin-left: 10px;
        }
        .phone-input-container .PhoneInputCountry {
          margin-right: 10px;
          display: flex;
          align-items: center;
        }
        .phone-input-container .PhoneInputCountrySelectArrow {
          color: #94a3b8; /* slate-400 */
        }
      `}</style>
        </div>
    )
}
