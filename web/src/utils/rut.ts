export const formatRut = (rut: string): string => {
    if (!rut) return '';
    const cleanRut = rut.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    if (cleanRut.length < 2) return cleanRut;

    const body = cleanRut.slice(0, -1);
    const dv = cleanRut.slice(-1);

    return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
};

export const validateRut = (rut: string): boolean => {
    if (!rut) return false;
    const cleanRut = rut.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    if (cleanRut.length < 2) return false;

    const body = cleanRut.slice(0, -1);
    const dv = cleanRut.slice(-1);

    if (!/^\d+$/.test(body)) return false;

    let sum = 0;
    let multiplier = 2;

    for (let i = body.length - 1; i >= 0; i--) {
        sum += parseInt(body.charAt(i)) * multiplier;
        multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }

    const expectedDvResult = 11 - (sum % 11);
    let expectedDv = '';

    if (expectedDvResult === 11) expectedDv = '0';
    else if (expectedDvResult === 10) expectedDv = 'K';
    else expectedDv = expectedDvResult.toString();

    return dv === expectedDv;
};
export type EntityType = 'PERSONAL' | 'EXTRANJERO_PROVISORIO' | 'B2B_TRADICIONAL' | 'B2B_GOBIERNO' | 'B2B_MODERNO' | 'SECTORIAL_INVALIDO';

export const getEntityTypeByRut = (rut: string | number): EntityType => {
    const cleanRut = String(rut).replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    const body = cleanRut.slice(0, -1);
    const rutNumber = parseInt(body, 10);

    if (isNaN(rutNumber)) return 'SECTORIAL_INVALIDO';

    if (rutNumber < 40000000) return 'PERSONAL';
    if (rutNumber < 50000000) return 'EXTRANJERO_PROVISORIO';
    if (rutNumber < 60000000) return 'B2B_TRADICIONAL';
    if (rutNumber < 70000000) return 'B2B_GOBIERNO';
    if (rutNumber < 100000000) return 'B2B_MODERNO';

    return 'SECTORIAL_INVALIDO'; // +100 millones (IPE, IPA, etc.)
};
