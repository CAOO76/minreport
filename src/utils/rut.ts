/**
 * Validates a Chilean RUT/RUN using the Modulo 11 algorithm.
 * @param rut string | number The RUT to validate (can include dots and dash)
 * @returns boolean
 */
export const validateRut = (rut: string | number): boolean => {
    if (!rut) return false;

    // Clean input: remove dots and dash, convert to string
    const cleanRut = String(rut).replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();

    // Check minimum length (at least 2 chars: 1 digit + dv)
    if (cleanRut.length < 2) return false;

    // Split body and verifier digit
    const body = cleanRut.slice(0, -1);
    const dv = cleanRut.slice(-1);

    // Body must be a number
    if (!/^\d+$/.test(body)) return false;

    let sum = 0;
    let multiplier = 2;

    // Modulo 11 Algorithm
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

/**
 * Formats a RUT string to standard format (XX.XXX.XXX-X)
 * @param rut string
 * @returns string
 */
export const formatRut = (rut: string): string => {
    if (!rut) return '';
    const cleanRut = rut.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
    if (cleanRut.length < 2) return cleanRut;

    const body = cleanRut.slice(0, -1);
    const dv = cleanRut.slice(-1);

    return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
};
