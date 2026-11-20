import React, { Suspense } from 'react';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import type { StockpileTwin3DProps } from './StockpileTwin3D';

const LazyStockpileTwin3D = React.lazy(() => import('./StockpileTwin3D'));

export const StockpileTwin3DLazy: React.FC<StockpileTwin3DProps> = (props) => {
    const fallbackHeight = props.heightPx ?? (props.compact ? 236 : 340);

    return (
        <Suspense
            fallback={
                props.compact ? (
                    <div
                        style={{ height: `${fallbackHeight}px` }}
                        className="w-full flex flex-col justify-start bg-[#F8FAFC] dark:bg-[#030508] border-0 rounded-none shadow-none"
                    >
                        <M3LinearProgress indeterminate />
                    </div>
                ) : (
                    <div className="w-full p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none shadow-none">
                        <M3LinearProgress indeterminate />
                    </div>
                )
            }
        >
            <LazyStockpileTwin3D {...props} />
        </Suspense>
    );
};

export default StockpileTwin3DLazy;
