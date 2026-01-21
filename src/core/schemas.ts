import { z } from 'zod';
import { validateRut } from '../utils/rut';

// Base schema for shared fields
const baseSchema = z.object({
    email: z.string().email("Invalid email format"),
});

// Profile specific schemas
const enterpriseProfile = z.object({
    type: z.literal('ENTERPRISE'),
    applicant_name: z.string().min(2, "Applicant name is required"),
    company_name: z.string().min(2, "Company name is required"),
    industry: z.string().min(2, "Industry is required"),
    rut: z.string().refine(validateRut, { message: "Invalid Company RUT" }),
    website: z.string().url("Invalid website URL").optional().or(z.literal('')),
    city: z.string().min(2, "City is required"),
});

const educationalProfile = z.object({
    type: z.literal('EDUCATIONAL'),
    applicant_name: z.string().min(2, "Applicant name is required"),
    institution_name: z.string().min(2, "Institution name is required"),
    institution_type: z.enum(['UNIVERSITY', 'INSTITUTE', 'SCHOOL']),
    rut: z.string().refine(validateRut, { message: "Invalid Institution RUT" }),
    city: z.string().min(2, "City is required"),
});

const personalProfile = z.object({
    type: z.literal('PERSONAL'),
    full_name: z.string().min(2, "Full name is required"),
    run: z.string().refine(validateRut, { message: "Invalid RUN" }),
    usage_profile: z.enum(['PERSONAL', 'PROFESSIONAL']),
});

// Discriminated Union
export const registerSchema = baseSchema.and(
    z.discriminatedUnion('type', [
        enterpriseProfile,
        educationalProfile,
        personalProfile,
    ])
);

export type RegisterInput = z.infer<typeof registerSchema>;
