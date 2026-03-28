'use client';

// Custom auth provider — no longer uses NextAuth SessionProvider
// JWT-based auth is handled server-side via cookies + middleware
// This wrapper is kept for future context providers (e.g., user context)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
