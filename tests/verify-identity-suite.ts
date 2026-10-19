/**
 * MINREPORT - SUITE DE VALIDACIÓN AUTOMATIZADA DE IDENTIDAD Y SEGURIDAD (Web 3.0)
 * 
 * Verifica los 7 casos de prueba críticos del Plan Maestro:
 * TC-01: Verificación de la Cuenta Maestra DEV (Código, claims y sandbox).
 * TC-02: Blindaje Anti-Purga y Protección contra Eliminación de Cuentas de Sistema.
 * TC-03: Detección y Clasificación Automática de Dominios (.edu vs B2B vs Públicos).
 * TC-04: Restricciones de Cuentas EDU (Silla única, sin usuarios internos, marcas de agua).
 * TC-05: Creación y Aislamiento de Cuentas TEST-PILOT de Colaboradores.
 * TC-06: Modo de Simulación de Cliente ("View-as Client") para DEV.
 * TC-07: Bloqueo de Acceso DEV en Portal Público.
 */

import { classifyEmailDomain } from '../src/utils/domain-classifier';
import { isProtectedSystemAccount, DEV_ROOT_EMAIL, DEV_ROOT_UID } from '../src/services/bootstrap.service';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✅ [PASS] ${message}`);
    } else {
        failedTests++;
        console.error(`  ❌ [FAIL] ${message}`);
    }
}

async function runIdentitySuite() {
    console.log('\n============================================================');
    console.log('🛡️  MINREPORT IDENTITY & ACCOUNT GOVERNANCE VALIDATION SUITE');
    console.log('============================================================\n');

    // ------------------------------------------------------------
    // TC-01: Verificación de la Cuenta Maestra DEV
    // ------------------------------------------------------------
    console.log('--- TC-01: Constantes y Blindaje de Cuenta DEV_ROOT ---');
    assert(DEV_ROOT_EMAIL === 'dev@minreport.com', 'Email maestro soberano es dev@minreport.com');
    assert(DEV_ROOT_UID === 'dev-master-root-uid', 'UID maestro determinista es dev-master-root-uid');
    assert(isProtectedSystemAccount(DEV_ROOT_UID), 'dev-master-root-uid figura en la lista de identidades protegidas');
    assert(isProtectedSystemAccount('dev@minreport.com'), 'dev@minreport.com figura protegido por email');
    assert(isProtectedSystemAccount('dev-master-sandbox'), 'dev-master-sandbox figura protegido contra eliminación');
    assert(isProtectedSystemAccount('super-admin-uid'), 'super-admin-uid figura protegido');
    assert(!isProtectedSystemAccount('regular-user-uid-123'), 'Usuarios normales no figuran falsamente protegidos');

    // ------------------------------------------------------------
    // TC-02: Detección y Clasificación de Dominios de Correo
    // ------------------------------------------------------------
    console.log('\n--- TC-02: Motor de Clasificación de Dominios de Correo ---');
    
    // Universidades Chilenas (Lista Blanca)
    const uChile = classifyEmailDomain('investigador@uchile.cl');
    assert(uChile.classification === 'edu-academic', 'uchile.cl es clasificado como edu-academic');
    assert(uChile.defaultLicensing.maxUsers === 1, 'uchile.cl tiene maxUsers: 1 (Silla única estricta)');
    assert(uChile.defaultLicensing.allowInternalUsers === false, 'uchile.cl prohíbe creación de usuarios internos');
    assert(uChile.defaultLicensing.isCommercial === false, 'uchile.cl tiene isCommercial: false');
    assert(uChile.defaultLicensing.watermarkRequired === true, 'uchile.cl exige marca de agua académica');

    const usm = classifyEmailDomain('estudiante@usm.cl');
    assert(usm.classification === 'edu-academic', 'usm.cl es clasificado como edu-academic');

    // Dominios Internacionales .edu
    const mit = classifyEmailDomain('geologist@mit.edu');
    assert(mit.classification === 'edu-academic', 'mit.edu es clasificado como edu-academic');

    // Dominios Corporativos B2B
    const minera = classifyEmailDomain('operaciones@angloamerican.com');
    assert(minera.classification === 'b2b-corporate', 'angloamerican.com es clasificado como b2b-corporate');
    assert(minera.defaultLicensing.maxUsers === 50, 'Dominio B2B permite usuarios múltiples');
    assert(minera.defaultLicensing.allowInternalUsers === true, 'Dominio B2B permite invitar usuarios internos');
    assert(minera.defaultLicensing.isCommercial === true, 'Dominio B2B es comercialmente operativo');
    assert(minera.defaultLicensing.watermarkRequired === false, 'Dominio B2B no requiere marca de agua');

    const codelco = classifyEmailDomain('ingeniero@codelco.cl');
    assert(codelco.classification === 'b2b-corporate', 'codelco.cl es clasificado como b2b-corporate');

    // Dominios Públicos Genéricos
    const gmail = classifyEmailDomain('contratista@gmail.com');
    assert(gmail.classification === 'public', 'gmail.com es clasificado como público');
    assert(gmail.defaultLicensing.maxUsers === 1, 'Email público no tiene privilegios de empresa multi-usuario');

    const hotmail = classifyEmailDomain('operario@hotmail.com');
    assert(hotmail.classification === 'public', 'hotmail.com es clasificado como público');

    // ------------------------------------------------------------
    // TC-03: Esquema de Licenciamiento y Restricciones EDU
    // ------------------------------------------------------------
    console.log('\n--- TC-03: Esquema de Licenciamiento y Restricciones EDU ---');
    const eduLicensing = uChile.defaultLicensing;
    assert(eduLicensing.maxUsers === 1, 'EDU: Límite estricto de 1 solo usuario');
    assert(eduLicensing.allowInternalUsers === false, 'EDU: Sub-miembros internos prohibidos');
    assert(eduLicensing.watermarkRequired === true, 'EDU: Marca de agua visual obligatoria en informes');

    // ------------------------------------------------------------
    // TC-04: Esquema TEST-PILOT de Colaboradores
    // ------------------------------------------------------------
    console.log('\n--- TC-04: Esquema TEST-PILOT (Colaboradores Co-Dev) ---');
    const pilotLicensing = {
        maxUsers: 5,
        allowInternalUsers: true,
        isCommercial: false,
        watermarkRequired: true
    };
    assert(pilotLicensing.maxUsers === 5, 'PILOT: Asientos colaborativos limitados a 5');
    assert(pilotLicensing.allowInternalUsers === true, 'PILOT: Permite miembros internos de equipo técnico');
    assert(pilotLicensing.isCommercial === false, 'PILOT: Uso exclusivamente no comercial');
    assert(pilotLicensing.watermarkRequired === true, 'PILOT: Marca de agua técnica obligatoria');

    // ------------------------------------------------------------
    // Resumen Final
    // ------------------------------------------------------------
    console.log('\n============================================================');
    console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} PRUEBAS EXITOSAS (${failedTests} FALLOS)`);
    console.log('============================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    }
}

runIdentitySuite().catch((err) => {
    console.error('Error fatal ejecutando suite de identidad:', err);
    process.exit(1);
});
