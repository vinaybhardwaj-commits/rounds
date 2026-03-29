'use client';

import { AdminLayout } from '@/components/admin/AdminLayout';
import { CSVImport } from '@/components/admin/CSVImport';

export default function ImportPage() {
  return (
    <AdminLayout breadcrumbs={[{label:'Admin', href:'/admin'}, {label:'Profiles', href:'/admin/profiles'}, {label:'Bulk Import'}]}>
      <div className="p-6">
        <CSVImport />
      </div>
    </AdminLayout>
  );
}
