import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { signOut } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import SecureImage from '../../components/common/SecureImage';
import CopyButton from '../../components/common/CopyButton';

const MISSING_FIELD = '[Información técnica no declarada en ficha]';

const MobileProfile: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { user, profile, currentAccount } = useAuth();
    const missingText = t('core_common.undeclared_tech_value', MISSING_FIELD);

    const handleLogout = async () => {
        try {
            await signOut(auth);
            navigate('/mobile/login');
        } catch (error) {
            console.error("Error al cerrar sesion:", error);
        }
    };

    const getRoleLabel = () => {
        const type = currentAccount?.type;
        if (type === 'EDUCATIONAL') return t('core_mobile.role_edu_student');
        const membership = profile?.memberships?.find((m: any) => m.accountId === currentAccount?.id);
        return membership?.role || t('core_mobile.role_operator');
    };

    return (
        <div className="bg-[#FFFFFF] dark:bg-[#000000] px-fib-21 pt-fib-21 pb-fib-55 font-atkinson select-none rounded-none shadow-none">
            <div className="flex flex-col items-center text-center pt-fib-8 pb-fib-21 border-b border-[#E2E8F0] dark:border-[#12151C]">
                {user?.photoURL ? (
                    <SecureImage
                        src={user.photoURL}
                        alt={t('core_mobile.profile_avatar_alt')}
                        className="w-16 h-16 object-cover mb-fib-13 pointer-events-none"
                    />
                ) : (
                    <span className="material-symbols-outlined text-[40px] text-[#C68346] mb-fib-8">
                        person
                    </span>
                )}

                <h1 className="text-h2-section uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                    {user?.displayName || missingText}
                </h1>

                <div className="flex items-center gap-fib-8 mt-2">
                    <span className="material-symbols-outlined text-[#00AEEF] text-[16px]">verified_user</span>
                    <span className="text-microcopy text-[#C68346] uppercase font-mono">
                        {getRoleLabel()}
                    </span>
                </div>
            </div>

            <dl className="divide-y divide-[#E2E8F0] dark:divide-[#12151C] border-b border-[#E2E8F0] dark:border-[#12151C]">
                <div className="py-fib-13 flex items-center justify-between gap-fib-13">
                    <dt className="text-microcopy text-[#475569] dark:text-[#8A93A6] uppercase font-mono shrink-0">
                        {t('form.email')}
                    </dt>
                    <dd className="min-w-0 flex items-center justify-end gap-fib-8">
                        {user?.email ? (
                            <div className="inline-flex items-center gap-1 min-w-0 select-text">
                                <span className="text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                    {user.email}
                                </span>
                                <CopyButton value={user.email} title={t('core_mobile.copy_email')} />
                            </div>
                        ) : (
                            <span className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                {missingText}
                            </span>
                        )}
                    </dd>
                </div>

                <div className="py-fib-13 flex items-center justify-between gap-fib-13">
                    <dt className="text-microcopy text-[#475569] dark:text-[#8A93A6] uppercase font-mono shrink-0">
                        {t('core_mobile.organization_label')}
                    </dt>
                    <dd className="min-w-0 text-right">
                        <span className="text-data-dense font-mono text-[#0F172A] dark:text-[#F3F4F6] truncate block">
                            {currentAccount?.name || missingText}
                        </span>
                    </dd>
                </div>
            </dl>

            <div className="pt-fib-21 flex justify-center">
                <button
                    type="button"
                    onClick={handleLogout}
                    title={t('auth.logout')}
                    aria-label={t('auth.logout')}
                    className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-[#475569] dark:text-[#8A93A6] hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center rounded-none"
                >
                    <span className="material-symbols-outlined text-[24px]">logout</span>
                </button>
            </div>
        </div>
    );
};

export default MobileProfile;
