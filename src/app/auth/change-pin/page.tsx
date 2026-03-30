'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Key, Eye, EyeOff, ShieldAlert, CheckCircle } from 'lucide-react';

export default function ChangePinPage() {
  const router = useRouter();
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!currentPin || currentPin.length !== 4) {
      setError('Please enter your temporary 4-digit PIN');
      return;
    }

    if (!newPin || newPin.length !== 4) {
      setError('New PIN must be exactly 4 digits');
      return;
    }

    if (newPin !== confirmPin) {
      setError('New PINs do not match');
      return;
    }

    if (newPin === currentPin) {
      setError('New PIN must be different from your temporary PIN');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error);
        setLoading(false);
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/');
        router.refresh();
      }, 1500);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-even-navy flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-even-blue rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-3xl font-bold text-white">R</span>
          </div>
          <h1 className="text-2xl font-bold text-even-white">Rounds</h1>
          <p className="text-white/50 text-sm mt-1">Even Hospital Communication</p>
        </div>

        {/* Change PIN card */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 shadow-xl space-y-5">
          {/* Header with alert */}
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 -mt-1">
            <ShieldAlert size={20} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-amber-800">PIN Change Required</h2>
              <p className="text-xs text-amber-600 mt-1">
                Your PIN was set by an administrator. Please choose a new personal PIN to continue.
              </p>
            </div>
          </div>

          {success ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle size={40} className="text-green-500" />
              <p className="text-sm font-medium text-green-700">PIN changed successfully!</p>
              <p className="text-xs text-gray-400">Redirecting...</p>
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
                  {error}
                </div>
              )}

              {/* Temporary PIN */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Temporary PIN</label>
                <div className="relative">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPin}
                    onChange={e => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Enter PIN given by admin"
                    maxLength={4}
                    inputMode="numeric"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none tracking-widest text-center text-lg"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(!showCurrent)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* New PIN */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New PIN</label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPin}
                    onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Choose your new 4-digit PIN"
                    maxLength={4}
                    inputMode="numeric"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-even-blue focus:border-even-blue outline-none tracking-widest text-center text-lg"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Confirm New PIN */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New PIN</label>
                <input
                  type="password"
                  value={confirmPin}
                  onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Re-enter new PIN"
                  maxLength={4}
                  inputMode="numeric"
                  className={`w-full px-3 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-even-blue outline-none tracking-widest text-center text-lg ${
                    confirmPin.length === 4 && confirmPin !== newPin
                      ? 'border-red-300 bg-red-50/30'
                      : confirmPin.length === 4 && confirmPin === newPin
                        ? 'border-green-300 bg-green-50/30'
                        : 'border-gray-200'
                  }`}
                  required
                />
                {confirmPin.length === 4 && confirmPin !== newPin && (
                  <p className="text-xs text-red-500 mt-1">PINs do not match</p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || newPin.length !== 4 || confirmPin !== newPin || currentPin.length !== 4}
                className="w-full py-3 bg-even-blue text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Key size={16} />
                {loading ? 'Changing PIN...' : 'Set New PIN'}
              </button>
            </>
          )}
        </form>

        <p className="text-center text-white/30 text-xs mt-8">
          &copy; {new Date().getFullYear()} Even Hospitals
        </p>
      </div>
    </div>
  );
}
