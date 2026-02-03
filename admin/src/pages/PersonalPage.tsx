import React from 'react';
import { TenantList } from '../components/admin/TenantList';

export const PersonalPage = () => {
    return <TenantList type="PERSONAL" title="Cuentas Personales" subtitle="Usuarios individuales y profesionales independientes." />;
};
