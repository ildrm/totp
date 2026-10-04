import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Still — Your codes. Your control.',
  description:
    'A private, encrypted, local-first authenticator. Your TOTP and HOTP codes, available offline.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Still' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f7f8fa' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
