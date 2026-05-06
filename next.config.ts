import type { NextConfig } from 'next'
import withPWAInit from '@ducanh2912/next-pwa'

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  reloadOnOnline: true,
})

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {},
  serverExternalPackages: ['bcryptjs'],
}

export default withPWA(nextConfig)
