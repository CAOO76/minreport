import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { sendOTP, completeSetup } from '../services/auth';
import { AddressAutocomplete } from '../components/ui/AddressAutocomplete';
import { CustomPhoneInput } from '../components/ui/PhoneInput';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { auth } from '../firebase';

export const SetupWizard = () => {
    const { t } = useTranslation();
    const { user, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Form State
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        phone: '',
        address_object: null as any,
        otp_code: '',
        cargo: ''
    });

    const nextStep = () => setStep(prev => prev + 1);
    const prevStep = () => setStep(prev => prev - 1);

    const handleSendOTP = async () => {
        if (!user?.email) return;
        setLoading(true);
        setError('');
        try {
            await sendOTP(user.email);
            nextStep();
        } catch (err: any) {
            setError(err.message || 'Error al enviar código');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!user) return;
        setLoading(true);
        setError('');
        try {
            const token = await user.getIdToken();
            await completeSetup(token, formData);
            await refreshUser();
            navigate('/dashboard');
        } catch (err: any) {
            setError(err.message || 'Error al completar el perfil');
        } finally {
            setLoading(false);
        }
    };

    const renderStep = () => {
        switch (step) {
            case 1:
                return (
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                    >
                        <div className="text-center mb-6">
                            <span className="material-symbols-rounded text-4xl text-primary mb-2">person_outline</span>
                            <h2 className="text-xl font-bold">{t('setup.identity_title', 'Identidad')}</h2>
                            <p className="text-slate-500 text-sm">{t('setup.identity_desc', 'Cuéntanos un poco sobre ti.')}</p>
                        </div>
                        <div className="space-y-4">
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">{t('form.first_name', 'Nombre')}</label>
                                <input
                                    type="text"
                                    value={formData.first_name}
                                    onChange={e => setFormData({ ...formData, first_name: e.target.value })}
                                    className="w-full px-4 py-2 rounded-md bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                    placeholder="Juan"
                                    autoComplete="off"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-xs font-semibold text-slate-500 uppercase">{t('form.last_name', 'Apellido')}</label>
                                <input
                                    type="text"
                                    value={formData.last_name}
                                    onChange={e => setFormData({ ...formData, last_name: e.target.value })}
                                    className="w-full px-4 py-2 rounded-md bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                    placeholder="Pérez"
                                    autoComplete="off"
                                />
                            </div>
                            {user?.type === 'ENTERPRISE' && (
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-slate-500 uppercase">{t('form.cargo', 'Cargo / Posición')}</label>
                                    <input
                                        type="text"
                                        value={formData.cargo}
                                        onChange={e => setFormData({ ...formData, cargo: e.target.value })}
                                        className="w-full px-4 py-2 rounded-md bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                        placeholder="Gerente de Operaciones"
                                        autoComplete="off"
                                    />
                                </div>
                            )}
                        </div>
                        <Button
                            className="w-full"
                            onClick={nextStep}
                            disabled={!formData.first_name || !formData.last_name}
                        >
                            {t('form.next', 'Siguiente')}
                        </Button>
                    </motion.div>
                );
            case 2:
                return (
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                    >
                        <div className="text-center mb-6">
                            <span className="material-symbols-rounded text-4xl text-primary mb-2">location_on</span>
                            <h2 className="text-xl font-bold">
                                {user?.type === 'ENTERPRISE' ? t('setup.location_b2b', 'Dirección Comercial') :
                                    user?.type === 'EDUCATIONAL' ? t('setup.location_edu', 'Dirección Sede') :
                                        t('setup.location_personal', 'Dirección Domicilio')}
                            </h2>
                            <p className="text-slate-500 text-sm">{t('setup.location_desc', 'Ingresa tu dirección para geolocalización.')}</p>
                        </div>
                        <AddressAutocomplete
                            onAddressSelect={(data) => setFormData({ ...formData, address_object: data })}
                            placeholder={t('setup.address_placeholder', 'Escribe tu dirección...')}
                        />
                        <div className="flex gap-3">
                            <Button variant="secondary" className="flex-1" onClick={prevStep}>
                                {t('form.back', 'Atrás')}
                            </Button>
                            <Button
                                className="flex-1"
                                onClick={nextStep}
                                disabled={!formData.address_object}
                            >
                                {t('form.next', 'Siguiente')}
                            </Button>
                        </div>
                    </motion.div>
                );
            case 3:
                return (
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                    >
                        <div className="text-center mb-6">
                            <span className="material-symbols-rounded text-4xl text-primary mb-2">phone_android</span>
                            <h2 className="text-xl font-bold">{t('setup.contact_title', 'Contacto')}</h2>
                            <p className="text-slate-500 text-sm">{t('setup.contact_desc', 'Verificaremos tu número vía SMS/Email.')}</p>
                        </div>
                        <CustomPhoneInput
                            value={formData.phone}
                            onChange={(val) => setFormData({ ...formData, phone: val })}
                        />
                        <div className="flex gap-3">
                            <Button variant="secondary" className="flex-1" onClick={prevStep}>
                                {t('form.back', 'Atrás')}
                            </Button>
                            <Button
                                className="flex-1"
                                onClick={handleSendOTP}
                                disabled={!formData.phone || loading}
                            >
                                {loading ? t('form.sending', 'Enviando...') : t('setup.verify_btn', 'Verificar Ahora')}
                            </Button>
                        </div>
                    </motion.div>
                );
            case 4:
                return (
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="space-y-6"
                    >
                        <div className="text-center mb-6">
                            <span className="material-symbols-rounded text-4xl text-primary mb-2">lock_open</span>
                            <h2 className="text-xl font-bold">{t('setup.otp_title', 'Código de Seguridad')}</h2>
                            <p className="text-slate-500 text-sm">{t('setup.otp_desc', `Ingresa el código enviado a ${user?.email}`)}</p>
                        </div>
                        <div className="flex flex-col gap-4">
                            <input
                                type="text"
                                maxLength={6}
                                value={formData.otp_code}
                                onChange={e => setFormData({ ...formData, otp_code: e.target.value.replace(/\D/g, '') })}
                                className="w-full text-center text-3xl font-bold tracking-[10px] py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-primary/30 focus:outline-none focus:border-primary transition-all"
                                placeholder="000000"
                            />
                            {error && <p className="text-red-500 text-xs text-center">{error}</p>}
                        </div>
                        <div className="flex gap-3">
                            <Button variant="secondary" className="flex-1" onClick={prevStep} disabled={loading}>
                                {t('form.back', 'Atrás')}
                            </Button>
                            <Button
                                className="flex-1"
                                onClick={handleSubmit}
                                disabled={formData.otp_code.length !== 6 || loading}
                            >
                                {loading ? t('form.activating', 'Activando...') : t('setup.activate_btn', 'Activar Cuenta')}
                            </Button>
                        </div>
                    </motion.div>
                );
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-surface-light dark:bg-surface-dark font-atkinson">
            <Card className="w-full max-w-md shadow-2xl relative overflow-hidden">
                {/* Progress Bar */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gray-100 dark:bg-white/5">
                    <motion.div
                        className="h-full bg-primary"
                        animate={{ width: `${(step / 4) * 100}%` }}
                        transition={{ duration: 0.3 }}
                    />
                </div>

                <div className="pt-4 px-2">
                    <AnimatePresence mode="wait">
                        {renderStep()}
                    </AnimatePresence>
                </div>

                <div className="mt-8 text-center">
                    <button
                        onClick={() => auth.signOut()}
                        className="text-slate-400 hover:text-red-500 text-xs transition-colors"
                    >
                        {t('auth.logout', 'Cerrar sesión y salir')}
                    </button>
                </div>
            </Card>
        </div>
    );
};
