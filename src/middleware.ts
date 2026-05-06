export { auth as middleware } from '@/lib/auth'

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/record/:path*',
    '/recordings/:path*',
    '/meetings/:path*',
    '/live/:path*',
    '/documents/:path*',
    '/settings/:path*',
  ],
}
