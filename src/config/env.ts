import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
    PORT: z.string().default("8080"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    SUPER_ADMIN_EMAIL: z.string().email().default('admin@minreport.com'),
    SUPER_ADMIN_PASSWORD: z.string().min(8).default('minreport_master_2026!'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error("❌ Invalid environment variables:", parsedEnv.error.format());
    process.exit(1);
}

export const env = parsedEnv.data;
