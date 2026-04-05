'use client';

import { Sparkline } from './Sparkline';

interface DepartmentData {
  name: string;
  total_users: number;
  active_users: number;
  forms_submitted_7d: number;
  sparkline_14d: number[];
}

interface DepartmentHeatmapProps {
  departments?: DepartmentData[];
  loading?: boolean;
}

const deptDisplayNames: Record<string, string> = {
  nursing: 'Nursing',
  billing: 'Billing',
  pharmacy: 'Pharmacy',
  radiology: 'Radiology',
  laboratory: 'Laboratory',
  ot_schedule: 'OT Schedule',
  front_office: 'Front Office',
  housekeeping: 'Housekeeping',
  dietary: 'Dietary',
  maintenance: 'Maintenance',
  marketing: 'Marketing',
  customer_care: 'Customer Care',
  sales: 'Sales',
  human_resources: 'HR',
  it: 'IT',
  administration: 'Administration',
  security: 'Security',
};

function getAdoptionStatus(active: number, total: number): { dot: string; label: string } {
  if (total === 0) return { dot: 'bg-gray-300', label: 'No users' };
  const pct = active / total;
  if (pct > 0.5) return { dot: 'bg-green-500', label: 'Good' };
  if (pct > 0) return { dot: 'bg-amber-500', label: 'Low' };
  return { dot: 'bg-red-500', label: 'Inactive' };
}

export function DepartmentHeatmap({ departments, loading }: DepartmentHeatmapProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="h-4 w-52 bg-gray-200 rounded animate-pulse mb-4" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Sort: worst adoption first (red → amber → green)
  const sorted = [...(departments || [])].sort((a, b) => {
    const ratioA = a.total_users > 0 ? a.active_users / a.total_users : -1;
    const ratioB = b.total_users > 0 ? b.active_users / b.total_users : -1;
    return ratioA - ratioB;
  });

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-even-navy mb-4">Department Adoption</h3>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {sorted.map(dept => {
          const status = getAdoptionStatus(dept.active_users, dept.total_users);
          const displayName = deptDisplayNames[dept.name] || dept.name;
          const sparkColor = status.dot === 'bg-green-500' ? '#22C55E' : status.dot === 'bg-amber-500' ? '#F59E0B' : '#EF4444';

          return (
            <div
              key={dept.name}
              className="border border-gray-100 rounded-lg p-3 hover:shadow-sm hover:border-gray-200 transition-all cursor-pointer"
              title={`${displayName}: ${dept.active_users}/${dept.total_users} active, ${dept.forms_submitted_7d} forms (7d)`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${status.dot}`} />
                  <span className="text-xs font-medium text-even-navy truncate">{displayName}</span>
                </div>
                <span className="text-xs text-gray-500 tabular-nums">
                  {dept.active_users}/{dept.total_users}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <Sparkline
                  data={dept.sparkline_14d?.length ? dept.sparkline_14d : [0]}
                  width={80}
                  height={18}
                  color={sparkColor}
                />
                <span className="text-xs text-gray-400">
                  {dept.forms_submitted_7d} forms
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {(!departments || departments.length === 0) && (
        <div className="text-center text-gray-400 text-sm py-8">No department data available</div>
      )}
    </div>
  );
}
