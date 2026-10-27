import React, { useState } from 'react';
import { M3TextField } from './M3TextField';
import { M3Button } from './M3Button';
import { API_BASE_URL } from '../firebase/config';
import { useTranslation } from 'react-i18next';
import { M3Select } from './M3Select';
import { authFetch } from '../utils/authFetch';

export const AdminRoleManager: React.FC = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'TEST_PILOT' | 'OPERMAQ' | 'USER'>('TEST_PILOT');
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const handleUpdate = async () => {
    setStatus(t('roles.status_processing'));
    try {
      const res = await authFetch(`${API_BASE_URL}/admin/set-user-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, email, role })
      });
      const data = await res.json();
      if (res.ok) setStatus(`[OK] ${t('roles.status_success')}`);
      else setStatus(`[ERROR] ${data.error}`);
    } catch { 
      setStatus(`[ERROR] ${t('roles.status_conn_error')}`); 
    }
  };

  return (
    <div className="p-12 min-h-full flex items-center justify-center bg-[#fcfcfc] dark:bg-[#080808] font-atkinson transition-colors duration-500">
      <div className="w-full max-w-lg bg-white dark:bg-white/[0.02] border border-black/5 dark:border-white/5 p-10 shadow-none hover:border-copper/20 transition-all duration-700 animate-in fade-in zoom-in-95 duration-1000 relative overflow-hidden group rounded-none">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-copper/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
        
        <header className="mb-10 flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-copper/10 rounded-none flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-700">
            <span className="material-symbols-outlined text-copper !text-[24px]">manage_accounts</span>
          </div>
          <h2 className="text-[10px] font-black uppercase tracking-[0.5em] text-black/40 dark:text-white/30">
            {t('roles.title')}
          </h2>
          <div className="w-8 h-[2px] bg-copper mt-4 opacity-30"></div>
        </header>
        
        <div className="space-y-8">
          <div className="space-y-2">
            <M3TextField 
              label={t('roles.email_label')} 
              value={email} 
              onChange={setEmail} 
              autoComplete="off"
              className="!bg-transparent"
            />
          </div>
          
          <div className="grid grid-cols-1 gap-6">
            <M3Select 
              label={t('roles.role_id')}
              value={role}
              onChange={(e) => setRole(e.target.value as 'TEST_PILOT' | 'OPERMAQ' | 'USER')}
              options={[
                { value: 'TEST_PILOT', label: t('roles.test_pilot') },
                { value: 'OPERMAQ', label: 'CLIENTE (Acceso a Catálogos, Reportes y Analíticas)' },
                { value: 'USER', label: t('roles.standard_user') }
              ]}
            />

            <M3TextField 
              label={t('roles.secret_label')} 
              value={secret} 
              onChange={setSecret} 
              type="password" 
              autoComplete="off"
              className="!bg-transparent"
            />
          </div>

          <div className="pt-6">
            <M3Button 
              variant="primary" 
              onClick={handleUpdate} 
              className="w-full !py-8 !rounded-none shadow-none transition-all duration-500 text-[10px] font-black tracking-widest"
              icon="security"
            >
              {t('roles.btn_assign')}
            </M3Button>
          </div>

          {status && (
            <div className="mt-8 p-4 bg-black/[0.02] dark:bg-white/[0.01] border border-black/5 dark:border-white/5 animate-in slide-in-from-top-4 duration-500 rounded-none">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-center text-copper">
                {status}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
