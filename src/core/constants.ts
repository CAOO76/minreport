export interface Country {
    code: string;
    name: string;
    taxLabel: string;
    placeholder: string;
}

export const SUPPORTED_COUNTRIES: Country[] = [
    { code: 'CL', name: 'Chile', taxLabel: 'RUT / RUN', placeholder: '12.345.678-9' },
    { code: 'BR', name: 'Brasil', taxLabel: 'CNPJ / CPF', placeholder: '00.000.000/0001-91' },
    { code: 'PE', name: 'Perú', taxLabel: 'RUC', placeholder: '20123456789' },
    { code: 'CO', name: 'Colombia', taxLabel: 'NIT', placeholder: '800.123.456-1' },
    { code: 'MX', name: 'México', taxLabel: 'RFC', placeholder: 'XAXX010101000' },
    { code: 'AU', name: 'Australia', taxLabel: 'ABN', placeholder: '51 824 753 556' },
    { code: 'CA', name: 'Canadá', taxLabel: 'BN', placeholder: '123456789' },
    { code: 'US', name: 'USA', taxLabel: 'EIN', placeholder: '12-3456789' },
    { code: 'XX', name: 'Otro / Other', taxLabel: 'Tax ID / ID Fiscal', placeholder: 'ID Number' }
];
