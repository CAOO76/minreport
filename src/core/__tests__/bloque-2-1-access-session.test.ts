import assert from 'node:assert/strict';
import {
    generateSixDigitOtp,
    hashAccessOtp,
    verifyAccessOtpConstantTime,
    evaluateOtpChallengeAttempt,
    AccessOrgApplicationSchema,
    resolveCanonicalHomePath,
} from '../../api/access.controller';
import {
    AccountClassificationSchema,
    SystemRoleSchema,
    UnifiedUserSessionSchema,
    resolveSessionHomePath,
} from '../../contracts/session.contracts';

function runTests() {
    // 1. Generacion y verificacion constante OTP 6 digitos
    const uid = 'user-b2b-test-001';
    const otp1 = generateSixDigitOtp();
    const otp2 = generateSixDigitOtp();
    assert.match(otp1, /^\d{6}$/, 'OTP debe ser exactamente 6 digitos numericos');
    assert.match(otp2, /^\d{6}$/, 'Segundo OTP debe ser exactamente 6 digitos numericos');

    const otpHash = hashAccessOtp(uid, otp1);
    assert.match(otpHash, /^[a-f0-9]{64}$/, 'Hash OTP debe ser SHA-256 hex de 64 caracteres');
    assert.equal(verifyAccessOtpConstantTime(uid, otp1, otpHash), true, 'OTP correcto debe verificar en tiempo constante');
    assert.equal(verifyAccessOtpConstantTime(uid, '000000' === otp1 ? '111111' : '000000', otpHash), false, 'OTP incorrecto debe fallar');
    assert.equal(verifyAccessOtpConstantTime('otro-uid', otp1, otpHash), false, 'OTP vinculado a otro UID debe fallar');
    assert.equal(verifyAccessOtpConstantTime(uid, '12345', otpHash), false, 'OTP menor a 6 digitos debe fallar');

    // 2. Evaluacion pura del desafio OTP (valido, consumido, expirado TTL 10m, bloqueo 5 intentos)
    const now = 1_750_000_000_000;
    const activeChallenge = {
        otpHash,
        attempts: 0,
        consumed: false,
        expiresAtMs: now + 10 * 60 * 1000,
    };

    const matchResult = evaluateOtpChallengeAttempt(activeChallenge, uid, otp1, now + 5_000);
    assert.equal(matchResult.ok, true);
    assert.equal(matchResult.shouldConsume, true);

    const consumedResult = evaluateOtpChallengeAttempt(
        { ...activeChallenge, consumed: true },
        uid,
        otp1,
        now + 6_000
    );
    assert.equal(consumedResult.ok, false);
    assert.equal(consumedResult.errorCode, 'OTP_CONSUMED');
    assert.equal(consumedResult.shouldConsume, true);

    const expiredResult = evaluateOtpChallengeAttempt(
        activeChallenge,
        uid,
        otp1,
        now + 10 * 60 * 1000 + 1
    );
    assert.equal(expiredResult.ok, false);
    assert.equal(expiredResult.errorCode, 'OTP_EXPIRED');
    assert.equal(expiredResult.shouldConsume, true);

    const wrongOtp = otp1 === '999999' ? '888888' : '999999';
    const fail1 = evaluateOtpChallengeAttempt(activeChallenge, uid, wrongOtp, now + 1_000);
    assert.equal(fail1.ok, false);
    assert.equal(fail1.errorCode, 'OTP_INVALID');
    assert.equal(fail1.nextAttempts, 1);
    assert.equal(fail1.shouldConsume, false);

    const fail5 = evaluateOtpChallengeAttempt(
        { ...activeChallenge, attempts: 4 },
        uid,
        wrongOtp,
        now + 2_000
    );
    assert.equal(fail5.ok, false);
    assert.equal(fail5.errorCode, 'OTP_LOCKED');
    assert.equal(fail5.nextAttempts, 5);
    assert.equal(fail5.shouldConsume, true);

    const missingResult = evaluateOtpChallengeAttempt(null, uid, otp1, now);
    assert.equal(missingResult.ok, false);
    assert.equal(missingResult.errorCode, 'OTP_MISSING');

    // 3. Validacion multi-pais de postulacion organizacional (PENDING_APPROVAL)
    const validCountries: Array<{ countryCode: string; companyTaxId: string; contactPhone: string }> = [
        { countryCode: 'CL', companyTaxId: '76.000.000-0', contactPhone: '+56987654321' },
        { countryCode: 'PE', companyTaxId: '20100047218', contactPhone: '+51987654321' },
        { countryCode: 'BR', companyTaxId: '11.222.333/0001-81', contactPhone: '+5511987654321' },
        { countryCode: 'AR', companyTaxId: '20-12345678-6', contactPhone: '+5491145678901' },
        { countryCode: 'US', companyTaxId: '12-3456789', contactPhone: '+14155552671' },
    ];

    for (const sample of validCountries) {
        const parsed = AccessOrgApplicationSchema.safeParse({
            segment: 'B2B',
            countryCode: sample.countryCode,
            businessName: `Minera Prueba ${sample.countryCode} S.A.`,
            companyTaxId: sample.companyTaxId,
            contactPhone: sample.contactPhone,
            fullName: 'Ing. Operacion Titular',
            email: `contacto.${sample.countryCode.toLowerCase()}@minera-ejemplo.com`,
            password: 'ClaveSegura2026!',
            acceptPrivacyPolicy: true,
        });
        assert.equal(parsed.success, true, `Postulacion B2B valida para ${sample.countryCode} debe aprobar: ${!parsed.success ? JSON.stringify(parsed.error.issues) : ''}`);
    }

    const invalidClRut = AccessOrgApplicationSchema.safeParse({
        segment: 'B2B',
        countryCode: 'CL',
        businessName: 'Minera RUT Invalido',
        companyTaxId: '76.123.456-K',
        contactPhone: '+56987654321',
        fullName: 'Titular Uno',
        email: 'titular@minera-ejemplo.cl',
        password: 'ClaveSegura2026!',
        acceptPrivacyPolicy: true,
    });
    assert.equal(invalidClRut.success, false, 'Debe rechazar RUT chileno con digito verificador invalido');

    const invalidPhone = AccessOrgApplicationSchema.safeParse({
        segment: 'B2B',
        countryCode: 'US',
        businessName: 'North Mining Corp',
        companyTaxId: '12-3456789',
        contactPhone: '987654',
        fullName: 'John Doe',
        email: 'john@northmining.com',
        password: 'ClaveSegura2026!',
        acceptPrivacyPolicy: true,
    });
    assert.equal(invalidPhone.success, false, 'Debe rechazar telefono sin formato E.164');

    const missingPrivacy = AccessOrgApplicationSchema.safeParse({
        segment: 'EDU',
        countryCode: 'CL',
        institutionName: 'Universidad Minera Austral',
        eduRole: 'PROFESSOR',
        fullName: 'Dr. Academico',
        contactPhone: '+56912345678',
        email: 'docente@universidad.cl',
        password: 'ClaveSegura2026!',
        acceptPrivacyPolicy: false,
    });
    assert.equal(missingPrivacy.success, false, 'Debe exigir aceptacion de politica Ley 21.719');

    const validEdu = AccessOrgApplicationSchema.safeParse({
        segment: 'EDU',
        countryCode: 'CL',
        institutionName: 'Universidad Minera Austral',
        eduRole: 'PROFESSOR',
        fullName: 'Dr. Academico',
        contactPhone: '+56912345678',
        email: 'docente@universidad.cl',
        password: 'ClaveSegura2026!',
        acceptPrivacyPolicy: true,
    });
    assert.equal(validEdu.success, true, 'Debe aceptar postulacion EDU con PROFESSOR y aceptacion legal');

    // 4. Contratos canonicos 5 niveles y despachadores deterministas
    assert.equal(AccountClassificationSchema.safeParse('personal').success, false, "Clasificacion 'personal' debe estar eliminada");
    for (const c of ['dev', 'admin', 'test-pilot', 'b2b', 'edu']) {
        assert.equal(AccountClassificationSchema.safeParse(c).success, true);
    }

    assert.equal(SystemRoleSchema.safeParse('PILOT_LEAD').success, false, "'PILOT_LEAD' debe estar eliminado");
    assert.equal(SystemRoleSchema.safeParse('SUPERVISOR').success, false, "'SUPERVISOR' debe estar eliminado");
    assert.equal(SystemRoleSchema.safeParse('BILLING_ONLY').success, false, "'BILLING_ONLY' debe estar eliminado");
    assert.equal(SystemRoleSchema.safeParse('PROFESSOR').success, true, "'PROFESSOR' debe existir en SystemRoleSchema");

    assert.equal(resolveCanonicalHomePath({ accountTier: 1, role: 'DEV_ROOT' }), '/dev');
    assert.equal(resolveCanonicalHomePath({ accountTier: 2, role: 'SUPER_ADMIN' }), '/admin');
    assert.equal(resolveCanonicalHomePath({ accountTier: 3, role: 'TEST_PILOT' }), '/pilot');
    assert.equal(resolveCanonicalHomePath({ accountTier: 4, role: 'OWNER' }), '/dashboard');
    assert.equal(resolveCanonicalHomePath({ accountTier: 5, role: 'STUDENT' }), '/dashboard');

    const unifiedSession = UnifiedUserSessionSchema.parse({
        uid: 'uid-edu-01',
        email: 'alumno@uni.cl',
        displayName: 'Alumno Mineria',
        tenantId: 'acc-edu-01',
        tenantName: 'Universidad Minera',
        countryCode: 'CL',
        role: 'STUDENT',
        classification: 'edu',
        accountTier: 5,
        isDevRoot: false,
        isSuperAdmin: false,
        isTestPilot: false,
        isEduSandbox: true,
        isMfaVerified: true,
        activeModules: { opermaq: true, stockpile: false },
    });
    assert.equal(resolveSessionHomePath(unifiedSession), '/dashboard');
    assert.equal(resolveSessionHomePath({ accountTier: 1, isDevRoot: true, isSuperAdmin: false, isTestPilot: false }), '/dev');
    assert.equal(resolveSessionHomePath({ accountTier: 2, isDevRoot: false, isSuperAdmin: true, isTestPilot: false }), '/admin');
    assert.equal(resolveSessionHomePath({ accountTier: 3, isDevRoot: false, isSuperAdmin: false, isTestPilot: true }), '/pilot');
    assert.equal(resolveSessionHomePath(null), '/access');

    console.log('[OK] Bloque 2.1: todas las aserciones de OTP 3 pasos, postulacion multi-pais, contratos y despacho 5 niveles pasaron.');
}

runTests();
