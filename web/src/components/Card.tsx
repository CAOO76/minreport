import clsx from 'clsx';
import { ReactNode } from 'react';

interface CardProps {
    children: ReactNode;
    className?: string;
}

export const Card = ({ children, className }: CardProps) => {
    return (
        <div className={clsx(
            "bg-[#F8FAFC] dark:bg-[#07090D]",
            "border border-[#E2E8F0] dark:border-[#12151C]",
            "rounded-none shadow-none p-fib-21",
            className
        )}>
            {children}
        </div>
    );
};
