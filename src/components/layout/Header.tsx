'use client';

import { useSession, signOut } from 'next-auth/react';
import { LogOut, Menu, Bell } from 'lucide-react';

interface HeaderProps {
  onMenuToggle?: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const { data: session } = useSession();
  const user = session?.user as Record<string, unknown> | undefined;

  return (
    <header className="sticky top-0 z-50 bg-even-navy text-even-white h-14 flex items-center px-4 shadow-md">
      {/* Mobile menu toggle */}
      <button
        onClick={onMenuToggle}
        className="lg:hidden mr-3 p-1 rounded hover:bg-white/10"
        aria-label="Toggle menu"
      >
        <Menu size={22} />
      </button>

      {/* Logo / App name */}
      <div className="flex items-center gap-2 flex-1">
        <span className="text-lg font-bold tracking-tight">Rounds</span>
        <span className="text-xs text-white/50 hidden sm:inline">Even Hospital</span>
      </div>

      {/* Right side */}
      {session && (
        <div className="flex items-center gap-3">
          {/* Notifications bell (placeholder for Phase 2) */}
          <button className="p-1.5 rounded hover:bg-white/10 relative" aria-label="Notifications">
            <Bell size={18} />
          </button>

          {/* User info */}
          <div className="hidden sm:flex flex-col items-end text-xs leading-tight">
            <span className="font-medium">{session.user?.name}</span>
            <span className="text-white/60 capitalize">{String(user?.role || 'staff')}</span>
          </div>

          {/* Avatar */}
          {session.user?.image ? (
            <img
              src={session.user.image}
              alt=""
              className="w-8 h-8 rounded-full border border-white/20"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-even-blue flex items-center justify-center text-sm font-bold">
              {session.user?.name?.charAt(0) || '?'}
            </div>
          )}

          {/* Sign out */}
          <button
            onClick={() => signOut()}
            className="p-1.5 rounded hover:bg-white/10"
            aria-label="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      )}
    </header>
  );
}
