'use client';

import Link from 'next/link';
import { ChevronRight, ArrowLeft, Home } from 'lucide-react';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface AdminLayoutProps {
  breadcrumbs: Breadcrumb[];
  children: React.ReactNode;
}

export function AdminLayout({ breadcrumbs, children }: AdminLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top navbar */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center h-14 gap-3">
            {/* Back to App button */}
            <Link
              href="/"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-even-blue hover:bg-even-blue/5 rounded-lg transition-colors shrink-0"
              title="Back to Rounds"
            >
              <Home size={16} />
              <span className="hidden sm:inline font-medium">Rounds</span>
            </Link>

            {/* Separator */}
            <ChevronRight size={14} className="text-gray-300 shrink-0" />

            {/* Breadcrumbs */}
            <nav className="flex items-center gap-1 text-sm overflow-x-auto min-w-0">
              {(breadcrumbs || []).map((crumb, i) => {
                const isLast = i === breadcrumbs.length - 1;
                return (
                  <span key={i} className="flex items-center gap-1 shrink-0">
                    {i > 0 && <ChevronRight size={12} className="text-gray-300" />}
                    {isLast || !crumb.href ? (
                      <span className={isLast ? 'font-semibold text-even-navy' : 'text-gray-500'}>
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        href={crumb.href}
                        className="text-gray-500 hover:text-even-blue transition-colors"
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </span>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="max-w-6xl mx-auto">
        {children}
      </main>
    </div>
  );
}
