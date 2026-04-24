/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip type checking during Vercel build — types validated locally via tsc
  typescript: {
    ignoreBuildErrors: true,
  },
  // Redirects
  async redirects() {
    return [
      {
        // Soft-deprecated 24 Apr 2026: pre-pivot admissions tracker superseded by
        // surgical_cases + /admin/cases (Sprint 3). Table + API + downstream
        // billing/claims code kept intact — only the UI entry point is hidden.
        source: '/admin/admissions',
        destination: '/admin/cases',
        permanent: true,
      },
    ];
  },
  // Security + PWA headers
  async headers() {
    return [
      {
        source: '/manifest.json',
        headers: [
          { key: 'Content-Type', value: 'application/manifest+json' },
        ],
      },
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
