import React from 'react';
import { TenantList } from '../components/admin/TenantList';

export const B2BPage = () => {
    return <TenantList type="ENTERPRISE" title="Empresas B2B" subtitle="Gestión de cuentas corporativas y delegación de servicios." />;
};
