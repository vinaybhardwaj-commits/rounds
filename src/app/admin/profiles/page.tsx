'use client';

import { AdminLayout } from '@/components/admin/AdminLayout';
import { ProfilesTable } from '@/components/admin/ProfilesTable';

export default function ProfilesPage() {
  return (
    <AdminLayout breadcrumbs={[{label:'Admin', href:'/admin'}, {label:'Profiles'}]}>
      <div className="p-6">
        <ProfilesTable />
      </div>
    </AdminLayout>
  );
}
