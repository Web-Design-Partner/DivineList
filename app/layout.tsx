import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'DivineList – Evidensverkstaden',
  description:
    'Lokal och transparent prioritering av strukturerade webbplatsobservationer.',
  icons: { icon: [{ type: 'image/svg+xml', url: '/favicon.svg' }] },
  robots: {
    follow: false,
    index: false,
    noarchive: true,
    noimageindex: true,
    nosnippet: true,
  },
};

export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
