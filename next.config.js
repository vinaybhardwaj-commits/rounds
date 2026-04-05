/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip type checking during Vercel build — types validated locally via tsc
  typescript: {
    ignoreBuildErrors: true,
  },
  // Keep pdfkit as external (not bundled) so its AFM font data files resolve correctly on Vercel
  serverComponentsExternalPackages: ['pdfkit'],
  experimental: {
    outputFileTracingIncludes: {
      '/api/forms/[id]/pdf': ['./node_modules/pdfkit/**/*'],
    },
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
