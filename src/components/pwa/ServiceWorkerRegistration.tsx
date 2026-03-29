'use client';

// ============================================
// ServiceWorkerRegistration — registers the SW
// and manages push notification subscription.
// Step 7.1: PWA
// ============================================

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });
        console.log('[SW] Registered:', registration.scope);

        // Check for updates periodically (every 30 minutes)
        setInterval(() => {
          registration.update();
        }, 30 * 60 * 1000);
      } catch (err) {
        console.error('[SW] Registration failed:', err);
      }
    };

    register();

    // Listen for messages from SW (e.g., notification clicks)
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK') {
        // Could dispatch a custom event or use router
        const url = event.data.url;
        if (url && url !== window.location.pathname) {
          window.location.href = url;
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, []);

  return null;
}

// ── Push subscription helper ──
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[Push] Not supported in this browser');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Check existing subscription
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) return subscription;

    // Get VAPID public key from server
    const res = await fetch('/api/push/vapid-key');
    if (!res.ok) return null;
    const { data } = await res.json();
    if (!data?.publicKey) return null;

    // Convert VAPID key
    const applicationServerKey = urlBase64ToUint8Array(data.publicKey);

    // Subscribe
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    // Send subscription to server
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });

    return subscription;
  } catch (err) {
    console.error('[Push] Subscription failed:', err);
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
