export { auth as middleware } from '@/lib/auth';

export const config = {
  matcher: [
    // Protect all routes except auth, api/auth, and static assets
    '/((?!auth|api/auth|_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png).*)',
  ],
};
