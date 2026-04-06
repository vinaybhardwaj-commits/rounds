'use client';

// ============================================
// WhatsApp Analysis — Admin Page
// Upload WhatsApp exports, view analysis history.
// Super admin only (upload); all authenticated (view).
// Phase: WA.2
// ============================================

import { useState, useEffect } from 'react';
import { MessageSquare, FileText, Database, Shield } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import AnalysisUploadButton from '@/components/wa-analysis/AnalysisUploadButton';
import AnalysisHistory from '@/components/wa-analysis/AnalysisHistory';

interface RubricStats {
  departments: number;
  total_fields: number;
}

export default function WAAnalysisPage() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [rubricStats, setRubricStats] = useState<RubricStats | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Load user role and rubric stats
  useEffect(() => {
    (async () => {
      try {
        const profileRes = await fetch('/api/profiles/me');
        const profileData = await profileRes.json();
        if (profileData.data?.role) {
          setUserRole(profileData.data.role);
        }
      } catch { /* ignore */ }

      try {
        const rubricRes = await fetch('/api/wa-analysis/rubric-stats');
        const rubricData = await rubricRes.json();
        if (rubricData.success) {
          setRubricStats(rubricData.data);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const isSuperAdmin = userRole === 'super_admin';

  return (
    <AdminLayout
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'WhatsApp Analysis' },
      ]}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare size={24} className="text-green-600" />
            WhatsApp Analysis Engine
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload WhatsApp group exports for automated analysis, deduplication, and insight extraction.
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatsCard
            icon={<FileText size={18} className="text-green-600" />}
            label="Engine Phase"
            value="WA.2"
            sub="Parser + Dedup"
          />
          <StatsCard
            icon={<Database size={18} className="text-blue-600" />}
            label="Rubric Depts"
            value={rubricStats?.departments?.toString() || '...'}
            sub={rubricStats ? `${rubricStats.total_fields} fields` : 'Loading'}
          />
          <StatsCard
            icon={<Shield size={18} className="text-purple-600" />}
            label="Upload Access"
            value="Super Admin"
            sub="Read: all users"
          />
          <StatsCard
            icon={<MessageSquare size={18} className="text-orange-500" />}
            label="LLM Pipeline"
            value="WA.3"
            sub="Coming next"
          />
        </div>

        {/* Upload Section (super_admin only) */}
        {isSuperAdmin ? (
          <AnalysisUploadButton
            onUploadComplete={() => setRefreshTrigger(t => t + 1)}
          />
        ) : userRole ? (
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-5 text-center">
            <Shield size={24} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-500">
              Only super admins can upload WhatsApp exports. You can view analysis results below.
            </p>
          </div>
        ) : null}

        {/* Analysis History */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <AnalysisHistory refreshTrigger={refreshTrigger} />
        </div>
      </div>
    </AdminLayout>
  );
}

function StatsCard({ icon, label, value, sub }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-lg font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-400">{sub}</p>
    </div>
  );
}
