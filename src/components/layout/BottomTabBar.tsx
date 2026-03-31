'use client';

import { Users, MessageSquare, ClipboardCheck, UserCircle, ClipboardList } from 'lucide-react';

export type TabId = 'patients' | 'chat' | 'forms' | 'tasks' | 'me';

interface BottomTabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  badges?: Partial<Record<TabId, number>>;
}

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'patients', label: 'Patients', icon: Users },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'forms', label: 'Forms', icon: ClipboardList },
  { id: 'tasks', label: 'Tasks', icon: ClipboardCheck },
  { id: 'me', label: 'Me', icon: UserCircle },
];

export function BottomTabBar({ activeTab, onTabChange, badges = {} }: BottomTabBarProps) {
  return (
    <nav className="shrink-0 z-40 bg-white border-t border-gray-200 safe-area-bottom">
      <div className="flex items-center justify-around h-14 max-w-lg mx-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const badge = badges[tab.id];

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                isActive ? 'text-even-blue' : 'text-gray-400'
              }`}
            >
              <div className="relative">
                <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                {badge && badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] mt-0.5 ${isActive ? 'font-semibold' : 'font-medium'}`}>
                {tab.label}
              </span>
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-even-blue rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
