import React from 'react';
import App, { type OpermaqAppProps } from './App';
import './locales/i18n';
import './index.css';

export const OpermaqModuleView: React.FC<OpermaqAppProps> = (props) => {
    return <App {...props} embedded={true} />;
};

export default OpermaqModuleView;
