'use client';

// ============================================
// InstallPrompt — PWA install banner.
// Shows "Add to Home Screen" on mobile browsers
// when the app is installable.
// Step 7.1: PWA
// ============================================

import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if already dismissed this session
    if (sessionStorage.getItem('pwa-install-dismissed')) {
      setDismissed(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('pwa-install-dismissed', '1');
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-even-navy text-white px-4 py-3 safe-area-top">
      <div className="flex items-center gap-3 max-w-lg mx-auto">
        <Download size={18} className="shrink-0 text-even-blue" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Install Rounds</p>
          <p className="text-xs text-white/60">Add to home screen for quick access</p>
        </div>
        <button
          onClick={handleInstall}
          className="px-3 py-1.5 bg-even-blue text-white rounded-lg text-xs font-medium shrink-0"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="p-1 text-white/40 hover:text-white/70"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
