import { z } from 'zod';
import { validateRut } from '../utils/rut';
import { PUBLIC_EMAIL_DOMAINS } from './constants';

// Base schema for shared fields
const baseSchema = z.object({
    email: z.string().email("Invalid email format"),
    country: z.string().min(2, "Country is required"),
});

// Validation helpers
const validateTaxId = (val: string, country: string) => {
    if (country === 'CL') return validateRut(val);
    if (country === 'BR') {
        const digits = val.replace(/\D/g, '');
        return digits.length === 11 || digits.length === 14;
    }
    if (country === 'PE') {
        return /^\d{11}$/.test(val);
    }
    return val.length >= 5; // Default for others
};

const ensureProtocol = (url: string) => {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
};

// Profile specific schemas
const enterpriseProfile = z.object({
    type: z.literal('ENTERPRISE'),
    applicant_name: z.string().min(2, "Applicant name is required"),
    company_name: z.string().min(2, "Company name is required"),
    industry: z.string().min(2, "Industry is required"),
    rut: z.string(), // Company TAX ID
    website: z.string().transform(ensureProtocol).refine(val => {
        if (!val) return true;
        try {
            new URL(val);
            return true;
        } catch {
            return false;
        }
    }, { message: "Invalid website URL" }).optional().or(z.literal('')),
});

const educationalProfile = z.object({
    type: z.literal('EDUCATIONAL'),
    profile: z.enum(['ALUMNO', 'ACADEMICO']), // New Profile Requirement
    applicant_name: z.string().min(2, "Applicant name is required"),
    run: z.string(), // Identity Document (Natural Person)
    institution_name: z.string().min(2, "Institution name is required"),
    institution_website: z.string().transform(ensureProtocol).refine(val => {
        try {
            new URL(val);
            return true;
        } catch {
            return false;
        }
    }, { message: "Valid institution website is required" }),
    program_name: z.string().min(2, "Program name (Major) is required"),
    graduation_date: z.string().refine(val => new Date(val) > new Date(), {
        message: "Graduation date must be in the future"
    }),
});

const personalProfile = z.object({
    type: z.literal('PERSONAL'),
    full_name: z.string().min(2, "Full name is required"),
    run: z.string(), // Identity Document (Natural Person)
    usage_profile: z.enum(['PERSONAL', 'PROFESSIONAL']),
});

// Discriminated Union with refinement for dynamic validation
export const registerSchema = baseSchema.and(
    z.discriminatedUnion('type', [
        enterpriseProfile,
        educationalProfile,
        personalProfile,
    ])
).superRefine((data, ctx) => {
    // 1. Strict Email Validation for EDUCATIONAL (MinReport Edu-Gatekeeper Layer 1)
    if (data.type === 'EDUCATIONAL') {
        const domain = data.email.split('@')[1]?.toLowerCase();
        if (domain && PUBLIC_EMAIL_DOMAINS.includes(domain)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Institutional email required (.edu, .cl, etc)",
                path: ['email'],
            });
        }
    }

    // 2. Tax ID Validation (Mandatory for ALL types in the new ID-centric architecture)
    const taxIdField = (data.type === 'ENTERPRISE') ? 'rut' : 'run';
    const taxIdValue = (data as any)[taxIdField];

    if (!validateTaxId(taxIdValue, data.country)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid ID Document (${taxIdField.toUpperCase()}) for ${data.country}`,
            path: [taxIdField],
        });
    }
});

export type RegisterInput = z.infer<typeof registerSchema>;
