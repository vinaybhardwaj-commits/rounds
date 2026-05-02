import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/layout/AuthProvider';
import { ServiceWorkerRegistration } from '@/components/pwa/ServiceWorkerRegistration';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { ErrorReporterInit } from '@/components/ErrorReporterInit';
// 1 May 2026 (sub-sprint D.3): client-side feature flag context.
import { FeatureFlagsProvider } from '@/components/FeatureFlagsProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Rounds | Even Hospital',
  description: 'AI-organized hospital communication platform',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#002054',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ServiceWorkerRegistration />
        <InstallPrompt />
        <ErrorReporterInit />
        <AuthProvider>
          <FeatureFlagsProvider>{children}</FeatureFlagsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
