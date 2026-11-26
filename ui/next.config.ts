import type { NextConfig } from 'next';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

// per-launch secret behind the read keys; the front server (cron/fileServer.ts) sets it first when it launches Next
if (process.env.AI_TOOLKIT_AUTH && !process.env.AI_TOOLKIT_READ_SECRET) {
  process.env.AI_TOOLKIT_READ_SECRET = randomBytes(32).toString('hex');
}

const versionFile = readFileSync(join(__dirname, '..', 'version.py'), 'utf8');
const versionMatch = versionFile.match(/VERSION\s*=\s*["']([^"']+)["']/);
const appVersion = versionMatch ? versionMatch[1] : 'unknown';

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  serverExternalPackages: ['macstats', 'osx-temperature-sensor'],
  turbopack: {},
  async rewrites() {
    return [
      {
        source: '/proxy-8866/:path*',
        destination: 'http://localhost:8866/:path*',
      },
    ];
  },
  devIndicators: false,
  typescript: {
    // Remove this. Build fails because of route types
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '100gb',
    },
    proxyClientMaxBodySize: '100gb',
  },
};

export default nextConfig;
