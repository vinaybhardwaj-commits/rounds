'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageSquare,
  Users,
  Settings,
  Shield,
  LayoutDashboard,
  X,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const navItems = [
  { label: 'Messages', href: '/', icon: MessageSquare },
  { label: 'Contacts', href: '/contacts', icon: Users },
];

const adminItems = [
  { label: 'Admin Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Manage Profiles', href: '/admin/profiles', icon: Users },
  { label: 'Departments', href: '/admin/departments', icon: Shield },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
];

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const user = session?.user as Record<string, unknown> | undefined;
  const isAdmin = user?.role === 'super_admin' || user?.role === 'department_head';

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-14 left-0 bottom-0 w-64 bg-even-navy text-even-white z-50
          transform transition-transform duration-200
          lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Mobile close */}
        <button
          onClick={onClose}
          className="lg:hidden absolute top-3 right-3 p-1 rounded hover:bg-white/10"
        >
          <X size={18} />
        </button>

        <nav className="mt-4 px-3 space-y-1">
          {/* Main nav */}
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                  transition-colors
                  ${active ? 'bg-even-blue text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}
                `}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}

          {/* Admin section */}
          {isAdmin && (
            <>
              <div className="pt-4 pb-1 px-3">
                <span className="text-[10px] uppercase tracking-widest text-white/40 font-semibold">
                  Admin
                </span>
              </div>
              {adminItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                      transition-colors
                      ${active ? 'bg-even-blue text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}
                    `}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>
      </aside>
    </>
  );
}
