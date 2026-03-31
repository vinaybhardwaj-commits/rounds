'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Eye, EyeOff } from 'lucide-react';

interface Department {
  id: string;
  name: string;
  slug: string;
}

const ROLE_OPTIONS = [
  { value: 'staff', label: 'Staff' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'department_head', label: 'Department Head' },
  { value: 'ip_coordinator', label: 'IP Coordinator' },
  { value: 'anesthesiologist', label: 'Anesthesiologist' },
  { value: 'ot_coordinator', label: 'OT Coordinator' },
  { value: 'billing_executive', label: 'Billing Executive' },
  { value: 'insurance_coordinator', label: 'Insurance Coordinator' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'physiotherapist', label: 'Physiotherapist' },
  { value: 'marketing_executive', label: 'Marketing Executive' },
  { value: 'clinical_care', label: 'Clinical Care' },
  { value: 'pac_coordinator', label: 'PAC Coordinator' },
  { value: 'administrator', label: 'Administrator' },
  { value: 'medical_administrator', label: 'Medical Administrator' },
  { value: 'operations_manager', label: 'Operations Manager' },
  { value: 'unit_head', label: 'Unit Head' },
];

export default function SignupPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [showPin, setShowPin] = useState(false);

  const [form, setForm] = useState({
    email: '',
    full_name: '',
    pin: '',
    confirmPin: '',
    department_id: '',
    designation: '',
    phone: '',
    role: 'staff',
  });

  // Fetch departments for dropdown
  useEffect(() => {
    fetch('/api/departments')
      .then(r => r.json())
      .then(data => {
        if (data.success) setDepartments(data.data);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate
    if (!form.email || !form.full_name || !form.pin || !form.designation) {
      setError('Please fill in all required fields');
      return;
    }

    if (!form.email.endsWith('@even.in')) {
      setError('Only @even.in email addresses are allowed');
      return;
    }

    if (!/^\d{4}$/.test(form.pin)) {
      setError('PIN must be exactly 4 digits');
      return;
    }

    if (form.pin !== form.confirmPin) {
      setError('PINs do not match');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          full_name: form.full_name,
          pin: form.pin,
          department_id: form.department_id || null,
          designation: form.designation,
          phone: form.phone || null,
          role: form.role,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error);
        setLoading(false);
        return;
      }

      // Superuser auto-login
      if (data.data?.autoLogin) {
        router.push('/');
        return;
      }

      setSuccess(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-even-navy flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 bg-green-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl text-white">&#10003;</span>
          </div>
          <h1 className="text-2xl font-bold text-even-white mb-2">Account Created</h1>
          <p className="text-white/60 mb-6">
            Your account is pending admin approval. You&apos;ll be able to log in once approved.
          </p>
          <a
            href="/auth/login"
            className="inline-block px-6 py-3 bg-even-blue text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-even-navy flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-even-blue rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg">
            <span className="text-2xl font-bold text-white">R</span>
          </div>
          <h1 className="text-xl font-bold text-even-white">Join Rounds</h1>
          <p className="text-white/50 text-sm mt-1">Even Hospital Staff Registration</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <UserPlus size={20} className="text-even-blue" />
            <h2 className="text-lg font-semibold text-even-navy">Create Account</h2>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.full_name}
              onChange={e => setForm({ ...form, full_name: e.target.value })}
              placeholder="Dr. Priya Sharma"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none"
              required
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="priya.sharma@even.in"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none"
              required
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
            <input
              type="tel"
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
              placeholder="+91 98765 43210"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none"
            />
          </div>

          {/* Designation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Designation / Job Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.designation}
              onChange={e => setForm({ ...form, designation: e.target.value })}
              placeholder="e.g. Senior Nurse, HOD — ICU"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none"
              required
            />
          </div>

          {/* Department */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <select
              value={form.department_id}
              onChange={e => setForm({ ...form, department_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none bg-white"
            >
              <option value="">Select department...</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none bg-white"
            >
              {ROLE_OPTIONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* PIN */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Choose a 4-digit PIN <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                value={form.pin}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setForm({ ...form, pin: val });
                }}
                placeholder="****"
                maxLength={4}
                inputMode="numeric"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none tracking-widest text-center text-lg"
                required
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Confirm PIN */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Confirm PIN <span className="text-red-500">*</span>
            </label>
            <input
              type={showPin ? 'text' : 'password'}
              value={form.confirmPin}
              onChange={e => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                setForm({ ...form, confirmPin: val });
              }}
              placeholder="****"
              maxLength={4}
              inputMode="numeric"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none tracking-widest text-center text-lg"
              required
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-even-blue text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>

          <p className="text-xs text-gray-400 text-center">
            Already have an account?{' '}
            <a href="/auth/login" className="text-even-blue hover:underline">Log in</a>
          </p>
        </form>

        <p className="text-center text-white/30 text-xs mt-6">
          &copy; {new Date().getFullYear()} Even Hospitals
        </p>
      </div>
    </div>
  );
}
