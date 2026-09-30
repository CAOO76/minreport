import { z } from 'zod';
import { validateRut, getEntityTypeByRut } from '../utils/rut';
import { PUBLIC_EMAIL_DOMAINS } from './constants';

/**
 * ESTÁNDAR LEGAL CHILENO B2B (Ley 19.628 y Reforma de Protección de Datos Personales)
 * Registro Oficial de Cuentas Titulares (Empresas / Organizaciones)
 */
export const RegisterTitularAccountSchema = z.object({
    // 1. Identificación del Mandatario / Administrador Titular
    fullName: z.string().min(3, 'El nombre del mandatario es obligatorio'),
    email: z.string().email('Formato de correo corporativo inválido'),
    personalTaxId: z.string().refine(validateRut, { message: 'RUT del mandatario inválido (formato 12.345.678-9)' }),
    jobTitle: z.string().min(2, 'El cargo del mandatario es obligatorio').optional().or(z.literal('')),

    // 2. Identificación Legal de la Persona Jurídica (Empresa Mandante / Contratista)
    businessName: z.string().min(3, 'La Razón Social de la empresa es obligatoria'),
    companyTaxId: z.string().refine(validateRut, { message: 'RUT de empresa inválido (formato 12.345.678-9)' }),
    billingEmail: z.string().email('Correo de facturación electrónica DTE inválido'),
    legalAddress: z.string().min(4, 'Dirección legal de la empresa obligatoria'),
    commune: z.string().min(2, 'Comuna obligatoria'),
    region: z.string().min(2, 'Región obligatoria'),

    // 3. Consentimiento Legal Explícito (Obligatorio Ley 19.628)
    acceptTermsAndPrivacy: z.literal(true, {
        errorMap: () => ({ message: 'Debe aceptar formalmente los términos y política de privacidad conforme a la Ley 19.628' })
    }),
});

export type RegisterTitularAccountInput = z.infer<typeof RegisterTitularAccountSchema>;

/**
 * Autogestión Interna de Usuarios por la Cuenta Titular (Zero-Intervention MINREPORT)
 */
export const CreateInternalUserSchema = z.object({
    email: z.string().email('Correo de usuario inválido'),
    fullName: z.string().min(3, 'Nombre completo obligatorio'),
    role: z.enum(['ADMIN', 'SUPERVISOR', 'OPERATOR', 'VIEWER']),
    faenaId: z.string().min(1, 'Faena o área asignada obligatoria').default('general'),
    assignedModules: z.array(z.enum(['opermaq', 'stockpile', 'miningFlow'])).min(1, 'Debe asignar al menos un módulo'),
});

export type CreateInternalUserInput = z.infer<typeof CreateInternalUserSchema>;

/**
 * Módulos de la Plataforma (Cobro por uso / Todos habilitados en fase de desarrollo)
 */
export const ContractModulesSchema = z.object({
    opermaq: z.boolean().default(true),
    stockpile: z.boolean().default(true),
    miningFlow: z.boolean().default(true),
});

export type ContractModulesInput = z.infer<typeof ContractModulesSchema>;

// --- COMPATIBILIDAD CON WIZARD LEGACY ---
const baseSchema = z.object({
    email: z.string().email('Invalid email format'),
    country: z.string().min(2, 'Country is required'),
    entity_type: z.enum(['PERSONAL', 'EXTRANJERO_PROVISORIO', 'B2B_TRADICIONAL', 'B2B_GOBIERNO', 'B2B_MODERNO', 'SECTORIAL_INVALIDO']).optional(),
});

const enterpriseProfile = z.object({
    type: z.literal('ENTERPRISE'),
    applicant_name: z.string().min(2, 'Applicant name is required'),
    company_name: z.string().min(2, 'Company name is required'),
    industry: z.string().min(2, 'Industry is required'),
    rut: z.string(),
    address: z.string().min(5, 'Address is required'),
    postal_code: z.string().optional().or(z.literal('')),
    city: z.string().min(2, 'City is required').optional().or(z.literal('')),
    commune: z.string().min(2, 'Commune is required').optional().or(z.literal('')),
    region: z.string().min(2, 'Region is required').optional().or(z.literal('')),
    billing_email: z.string().email('Invalid billing email format'),
    email_domain: z.string().optional().or(z.literal('')),
    job_title: z.string().min(2, 'Job title is required').optional().or(z.literal('')),
    website: z.string().optional().or(z.literal('')),
});

const educationalProfile = z.object({
    type: z.literal('EDUCATIONAL'),
    profile: z.enum(['ALUMNO', 'ACADEMICO']),
    applicant_name: z.string().min(2, 'Applicant name is required'),
    run: z.string(),
    institution_name: z.string().min(2, 'Institution name is required'),
    institution_website: z.string().optional().or(z.literal('')),
    program_name: z.string().min(2, 'Program name is required'),
    graduation_date: z.string().optional().or(z.literal('')),
});

const personalProfile = z.object({
    type: z.literal('PERSONAL'),
    full_name: z.string().min(2, 'Full name is required'),
    run: z.string(),
    usage_profile: z.enum(['PERSONAL', 'PROFESSIONAL']),
});

export const registerSchema = baseSchema.and(
    z.discriminatedUnion('type', [
        enterpriseProfile,
        educationalProfile,
        personalProfile,
    ])
);

export type RegisterInput = z.infer<typeof registerSchema>;
