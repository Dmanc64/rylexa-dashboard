import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fixes icon transpilation for standard build environments
  transpilePackages: ['lucide-react'],

  // TypeScript errors will now correctly fail the build.
  // Fix type errors rather than shipping them to production.

  // Optimized for Fly.io/Docker deployments
  output: 'standalone',

  // ── Image Optimization ──
  // Allow remote images from Supabase storage and placeholder services
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'via.placeholder.com',
      },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  // Allow up to 10MB file uploads via Server Actions (default is 1MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '10MB',
    },
    // Tree-shake barrel imports for smaller bundles
    optimizePackageImports: ['lucide-react', 'recharts'],
  },

  // ── Security Headers ──
  // Applied to every response. Mitigates XSS, clickjacking, MIME-sniffing, and downgrade attacks.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self)',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://api.mapbox.com https://events.mapbox.com https://js.stripe.com",
              "style-src 'self' 'unsafe-inline' https://api.mapbox.com https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://*.mapbox.com https://*.supabase.co https://*.stripe.com",
              "font-src 'self' https://fonts.gstatic.com",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.mapbox.com https://events.mapbox.com https://api.stripe.com https://js.stripe.com",
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },

  // Pin Turbopack's workspace root to THIS directory.
  // Without this, the dev server detects the stray C:\Users\Dan\package-lock.json
  // and tries to index the entire home directory → OOM crash on startup.
  // The empty object also keeps `next dev` (Turbopack) from erroring on the
  // Serwist webpack wrapper. SW is disabled in dev anyway.
  turbopack: {
    root: import.meta.dirname,
  },

  // Note: ESLint 'ignoreDuringBuilds' is now handled via CLI or .eslintrc
  // Note: NEXT_PUBLIC_ env vars are automatically injected; no need for manual mapping here.
};

export default withSerwist(nextConfig);