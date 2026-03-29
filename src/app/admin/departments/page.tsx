'use client';

import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { DepartmentList } from '@/components/admin/DepartmentList';

export default function DepartmentsPage() {
  return (
    <AdminLayout breadcrumbs={[{label:'Admin', href:'/admin'}, {label:'Departments'}]}>
      <div className="p-6">
        <DepartmentList />
      </div>
    </AdminLayout>
  );
}
