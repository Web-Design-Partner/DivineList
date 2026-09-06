import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const securityHeaders = (contentSecurityPolicy: string) =>
  [
    ['Content-Security-Policy', contentSecurityPolicy],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    [
      'Permissions-Policy',
      'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    ],
    ['Referrer-Policy', 'no-referrer'],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-DNS-Prefetch-Control', 'off'],
    ['X-Frame-Options', 'DENY'],
    ['X-Robots-Tag', 'noindex, nofollow, noarchive'],
  ] as const;

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDevelopment = process.env.NODE_ENV === 'development';
  const contentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' blob: data:",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${isDevelopment ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "worker-src 'self'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);
  requestHeaders.set('x-nonce', nonce);
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  for (const [name, value] of securityHeaders(contentSecurityPolicy)) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = { matcher: '/:path*' };
