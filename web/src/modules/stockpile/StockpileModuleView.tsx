import React from 'react';
import App, { type StockpileAppProps } from './App';

export const StockpileModuleView: React.FC<StockpileAppProps> = (props) => {
    return <App {...props} embedded={true} />;
};

export default StockpileModuleView;
