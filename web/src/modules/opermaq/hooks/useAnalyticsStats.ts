import { useState, useEffect } from 'react';
import { authFetch } from '../utils/authFetch';
import { API_BASE_URL as API_BASE } from '../firebase/config';

export interface AnalyticsStats {
  totalInspections: number;
  criticalFailures: number;
  complianceRate: number;
  riskDistribution: Record<string, number>;
  dailyActivity: Array<{ date: string; count: number }>;
}

const EMPTY_STATS: AnalyticsStats = {
  totalInspections: 0,
  criticalFailures: 0,
  complianceRate: 100,
  riskDistribution: { 'CRITICAL': 0, 'FAIL': 0, 'PASS': 0 },
  dailyActivity: [],
};

export function useAnalyticsStats() {
  const [stats, setStats]     = useState<AnalyticsStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await authFetch(`${API_BASE}/reports/stats`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setStats({
            totalInspections: data.totalInspections || 0,
            criticalFailures: data.criticalFailures || 0,
            complianceRate: data.complianceRate || 100,
            riskDistribution: data.riskDistribution || { 'CRITICAL': 0, 'FAIL': 0, 'PASS': 0 },
            dailyActivity: data.dailyActivity || [],
          });
        }
      }
    } catch (err) {
      console.warn('[useAnalyticsStats] No se pudo obtener stats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return { stats, loading, refresh: fetchStats };
}
