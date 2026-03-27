'use client';

import { useState, useEffect } from 'react';
import { Building2, Users } from 'lucide-react';

interface Department {
  id: string;
  name: string;
  slug: string;
  head_name: string | null;
  head_email: string | null;
  member_count: number;
  is_active: boolean;
}

export function DepartmentList() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/departments')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setDepartments(d.data);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-gray-400">Loading departments...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-even-navy">Departments</h1>
          <p className="text-sm text-gray-500">{departments.length} active departments</p>
        </div>
      </div>

      {departments.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <Building2 size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-2">No departments found</p>
          <p className="text-xs text-gray-400">
            Run the seed script to populate the 17 EHRC departments:
            <code className="ml-1 bg-gray-100 px-2 py-0.5 rounded">npm run db:seed</code>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map((dept) => (
            <div key={dept.id} className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-even-blue/10 rounded-lg flex items-center justify-center">
                  <Building2 size={20} className="text-even-blue" />
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Users size={12} />
                  <span>{dept.member_count}</span>
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{dept.name}</h3>
              <p className="text-xs text-gray-400 mb-2">/{dept.slug}</p>
              {dept.head_name ? (
                <p className="text-xs text-gray-500">
                  Head: <span className="font-medium text-gray-700">{dept.head_name}</span>
                </p>
              ) : (
                <p className="text-xs text-gray-400 italic">No head assigned</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
