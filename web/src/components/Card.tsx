import clsx from 'clsx';
import { ReactNode } from 'react';

interface CardProps {
    children: ReactNode;
    className?: string;
}

export const Card = ({ children, className }: CardProps) => {
    return (
        <div className={clsx(
            "bg-surface-card-light dark:bg-surface-card-dark",
            "border border-gray-200 dark:border-gray-800",
            "rounded-lg p-6",
            className
        )}>
            {children}
        </div>
    );
};
