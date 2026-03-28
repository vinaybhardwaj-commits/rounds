'use client';

import { useState } from 'react';
import { DepartmentList } from '@/components/admin/DepartmentList';

export default function DepartmentsPage() {
  return (
    <div className="p-6">
      <DepartmentList />
    </div>
  );
}
