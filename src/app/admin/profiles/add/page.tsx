'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';

interface Department {
  id: string;
  name: string;
}

const ROLE_OPTIONS = [
  'staff',
  'nurse',
  'department_head',
  'ip_coordinator',
  'anesthesiologist',
  'ot_coordinator',
  'billing_executive',
  'insurance_coordinator',
  'pharmacist',
  'physiotherapist',
  'marketing_executive',
  'clinical_care',
  'pac_coordinator',
];

export default function AddStaffPage() {
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    designation: '',
    department_id: '',
    role: 'staff',
    initial_pin: '1234',
  });

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [deptLoading, setDeptLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch departments on mount
  useEffect(() => {
    const fetchDepartments = async () => {
      try {
        const res = await fetch('/api/departments');
        const data = await res.json();
        if (data.success) {
          setDepartments(data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch departments:', err);
      } finally {
        setDeptLoading(false);
      }
    };

    fetchDepartments();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: formData.full_name,
          email: formData.email,
          phone: formData.phone || null,
          designation: formData.designation || null,
          department_id: formData.department_id || null,
          role: formData.role,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(true);
        // Reset form
        setFormData({
          full_name: '',
          email: '',
          phone: '',
          designation: '',
          department_id: '',
          role: 'staff',
          initial_pin: '1234',
        });
        // Auto-hide success after 3 seconds
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(data.error || 'Failed to create profile');
      }
    } catch (err) {
      setError('Network error. Please try again.');
      console.error('Submit error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AdminLayout breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Add Staff' }]}>
      <div className="p-6">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold text-even-navy mb-1">Add Staff Member</h1>
          <p className="text-sm text-gray-500 mb-6">
            Create a new staff profile in the system.
          </p>

          {/* Success message */}
          {success && (
            <div className="mb-6 bg-green-50 rounded-xl p-4 flex items-start gap-3">
              <CheckCircle size={18} className="text-green-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-green-800">Staff member added successfully</p>
                <p className="text-sm text-green-700 mt-1">
                  {formData.full_name} has been added to the system.
                </p>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mb-6 bg-red-50 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle size={18} className="text-red-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-red-800">Error</p>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5 bg-white rounded-xl p-6 border border-gray-200">
            {/* Full Name */}
            <div>
              <label htmlFor="full_name" className="block text-sm font-medium text-gray-900 mb-1.5">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                value={formData.full_name}
                onChange={handleChange}
                required
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-even-blue focus:border-transparent"
                placeholder="John Doe"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-900 mb-1.5">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                required
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-even-blue focus:border-transparent"
                placeholder="john.doe@even.in"
              />
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-900 mb-1.5">
                Phone
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleChange}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-even-blue focus:border-transparent"
                placeholder="+919876543210"
              />
            </div>

            {/* Designation */}
            <div>
              <label htmlFor="designation" className="block text-sm font-medium text-gray-900 mb-1.5">
                Designation
              </label>
              <input
                id="designation"
                name="designation"
                type="text"
                value={formData.designation}
                onChange={handleChange}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-even-blue focus:border-transparent"
                placeholder="Senior Nurse"
              />
            </div>

            {/* Department */}
            <div>
              <label htmlFor="department_id" className="block text-sm font-medium text-gray-900 mb-1.5">
                Department
              </label>
              {deptLoading ? (
                <div className="px-3.5 py-2.5 text-gray-400 text-sm">Loading departments...</div>
              ) : (
                <select
                  id="department_id"
                  name="department_id"
                  value={formData.department_id}
                  onChange={handleChange}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-even-blue focus:border-transparent"
                >
                  <option value="">-- Select Department --</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Role */}
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-900 mb-1.5">
                Role
              </label>
              <select
                id="role"
                name="role"
                value={formData.role}
                onChange={handleChange}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-even-blue focus:border-transparent"
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>

            {/* Initial PIN */}
            <div>
              <label htmlFor="initial_pin" className="block text-sm font-medium text-gray-900 mb-1.5">
                Initial PIN (4 digits)
              </label>
              <input
                id="initial_pin"
                name="initial_pin"
                type="text"
                value={formData.initial_pin}
                readOnly
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-600"
              />
              <p className="text-xs text-gray-500 mt-1">Default PIN (user can change after login)</p>
            </div>

            {/* Form actions */}
            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 bg-even-blue text-white rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Creating...' : 'Create Staff Member'}
              </button>
              <Link
                href="/admin"
                className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </Link>
            </div>
          </form>

          {/* Quick actions */}
          {success && (
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  setSuccess(false);
                  setFormData({
                    full_name: '',
                    email: '',
                    phone: '',
                    designation: '',
                    department_id: '',
                    role: 'staff',
                    initial_pin: '1234',
                  });
                }}
                className="px-4 py-2 text-sm font-medium text-even-blue hover:bg-even-blue/5 rounded-lg transition-colors"
              >
                Add Another
              </button>
              <Link
                href="/admin"
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Back to Admin
              </Link>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
