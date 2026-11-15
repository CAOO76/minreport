import React, { Suspense } from 'react';
import { M3LinearProgress } from '../../../components/common/M3LinearProgress';
import type { StockpileTwin3DProps } from './StockpileTwin3D';

const LazyStockpileTwin3D = React.lazy(() => import('./StockpileTwin3D'));

export const StockpileTwin3DLazy: React.FC<StockpileTwin3DProps> = (props) => {
    return (
        <Suspense
            fallback={
                <div className="w-full p-fib-21 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] rounded-none">
                    <M3LinearProgress indeterminate />
                </div>
            }
        >
            <LazyStockpileTwin3D {...props} />
        </Suspense>
    );
};

export default StockpileTwin3DLazy;
