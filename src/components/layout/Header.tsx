'use client';

import { LogOut, Menu, Bell } from 'lucide-react';

interface HeaderProps {
  onMenuToggle?: () => void;
  userName?: string;
  userRole?: string;
}

export function Header({ onMenuToggle, userName, userRole }: HeaderProps) {
  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/auth/login';
  };

  return (
    <header className="sticky top-0 z-50 bg-even-navy text-even-white h-14 flex items-center px-4 shadow-md">
      <button
        onClick={onMenuToggle}
        className="lg:hidden mr-3 p-1 rounded hover:bg-white/10"
        aria-label="Toggle menu"
      >
        <Menu size={22} />
      </button>

      <div className="flex items-center gap-2 flex-1">
        <span className="text-lg font-bold tracking-tight">Rounds</span>
        <span className="text-xs text-white/50 hidden sm:inline">Even Hospital</span>
      </div>

      <div className="flex items-center gap-3">
        <button className="p-1.5 rounded hover:bg-white/10 relative" aria-label="Notifications">
          <Bell size={18} />
        </button>

        {userName && (
          <div className="hidden sm:flex flex-col items-end text-xs leading-tight">
            <span className="font-medium">{userName}</span>
            <span className="text-white/60 capitalize">{(userRole || 'staff').replace('_', ' ')}</span>
          </div>
        )}

        <div className="w-8 h-8 rounded-full bg-even-blue flex items-center justify-center text-sm font-bold">
          {userName?.charAt(0) || '?'}
        </div>

        <button
          onClick={handleLogout}
          className="p-1.5 rounded hover:bg-white/10"
          aria-label="Sign out"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
