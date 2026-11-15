import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina clases Tailwind de forma segura evitando colisiones.
 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
