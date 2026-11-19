import React from 'react';
import { DesktopShell, type DesktopShellProps } from './desktop/DesktopShell';

export const DesktopAnalytics: React.FC<DesktopShellProps> = (props) => {
    return <DesktopShell {...props} />;
};
