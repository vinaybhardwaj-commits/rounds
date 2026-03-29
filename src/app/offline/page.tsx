'use client';

// ============================================
// Offline fallback page (shown when no network)
// Step 7.1: PWA
// ============================================

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-even-navy text-white p-6">
      <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mb-6">
        <span className="text-3xl font-bold">R</span>
      </div>
      <h1 className="text-xl font-bold mb-2">You&apos;re Offline</h1>
      <p className="text-white/60 text-center text-sm max-w-xs mb-6">
        Rounds needs an internet connection to show live patient data and chat messages.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-6 py-2.5 bg-even-blue text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}
