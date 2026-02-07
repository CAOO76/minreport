import { JobProfileManager } from '../components/admin/JobProfileManager';

export const JobProfilesPage = () => {
    console.log('[E2E-NAV] Montando JobProfilesPage');
    return (
        <div className="animate-in fade-in duration-500">
            <JobProfileManager />
        </div>
    );
};
