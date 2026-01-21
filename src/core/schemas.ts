import { z } from 'zod';
import { validateRut } from '../utils/rut';

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

// Profile specific schemas
const enterpriseProfile = z.object({
    type: z.literal('ENTERPRISE'),
    applicant_name: z.string().min(2, "Applicant name is required"),
    company_name: z.string().min(2, "Company name is required"),
    industry: z.string().min(2, "Industry is required"),
    rut: z.string(), // Validated in superRefine
    website: z.string().url("Invalid website URL").optional().or(z.literal('')),
});

const educationalProfile = z.object({
    type: z.literal('EDUCATIONAL'),
    applicant_name: z.string().min(2, "Applicant name is required"),
    institution_name: z.string().min(2, "Institution name is required"),
    institution_type: z.enum(['UNIVERSITY', 'INSTITUTE', 'SCHOOL']),
    rut: z.string(), // Validated in superRefine
});

const personalProfile = z.object({
    type: z.literal('PERSONAL'),
    full_name: z.string().min(2, "Full name is required"),
    run: z.string(), // Validated in superRefine
    usage_profile: z.enum(['PERSONAL', 'PROFESSIONAL']),
});

// Discriminated Union with refinement for dynamic tax ID validation
export const registerSchema = baseSchema.and(
    z.discriminatedUnion('type', [
        enterpriseProfile,
        educationalProfile,
        personalProfile,
    ])
).superRefine((data, ctx) => {
    const taxIdField = data.type === 'PERSONAL' ? 'run' : 'rut';
    const taxIdValue = (data as any)[taxIdField];

    if (!validateTaxId(taxIdValue, data.country)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid Tax ID for ${data.country}`,
            path: [taxIdField],
        });
    }
});

export type RegisterInput = z.infer<typeof registerSchema>;
