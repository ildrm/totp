import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
const config: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  transpilePackages: ['@still/core'],
  experimental: { sri: { algorithm: 'sha384' } },
  webpack(config) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};
export default function configuration(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    const { output: _output, ...development } = config;
    return {
      ...development,
      async rewrites() {
        return [{ source: '/api/:path*', destination: 'http://127.0.0.1:4000/api/:path*' }];
      },
    };
  }
  return config;
}
