import React from 'react';
import { GeolappModule, type GeolappModuleProps } from './GeolappModule';

export const GeolappModuleView: React.FC<GeolappModuleProps> = (props) => {
    return <GeolappModule {...props} />;
};

export default GeolappModuleView;
