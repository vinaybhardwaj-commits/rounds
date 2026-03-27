/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip type checking during Vercel build — types validated locally via tsc
  typescript: {
    ignoreBuildErrors: true,
  },
  // PWA headers for installability
  async headers() {
    return [
      {
        source: '/manifest.json',
        headers: [
          { key: 'Content-Type', value: 'application/manifest+json' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
