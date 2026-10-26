import React from 'react';
import BrandingManager from '../../components/admin/BrandingManager';

export const BrandingPage: React.FC = () => {
    return (
        <div className="max-w-7xl mx-auto py-12 px-8 space-y-8 animate-in fade-in duration-500 font-sans">
            <BrandingManager />
        </div>
    );
};

export default BrandingPage;
