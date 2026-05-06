import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {},
  // Aumentar límite de body para uploads de video
  serverExternalPackages: ['bcryptjs'],
}

export default nextConfig
