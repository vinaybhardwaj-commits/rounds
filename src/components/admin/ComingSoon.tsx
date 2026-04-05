'use client';

import { Construction } from 'lucide-react';
import Link from 'next/link';

interface ComingSoonProps {
  title: string;
  description?: string;
  phase?: string;
}

/**
 * Placeholder component for admin pages that haven't been built yet.
 * Shows a clean "coming soon" message with a link back to the dashboard.
 */
export function ComingSoon({ title, description, phase }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-even-blue/10 flex items-center justify-center mb-6">
        <Construction size={32} className="text-even-blue" />
      </div>
      <h1 className="text-2xl font-bold text-even-navy mb-2">{title}</h1>
      <p className="text-sm text-gray-600 max-w-md mb-1">
        {description || 'This page is under development and will be available soon.'}
      </p>
      {phase && (
        <p className="text-xs text-gray-400 mb-6">Scheduled for {phase}</p>
      )}
      <Link
        href="/admin"
        className="px-4 py-2 bg-even-blue text-white text-sm font-medium rounded-lg hover:bg-even-blue/90 transition-colors"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
