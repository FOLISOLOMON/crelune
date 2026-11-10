import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CRELUNE — Personal Creative & Media Operations Platform',
  description:
    'Organize members, birthdays, design jobs, templates, and creative operations in one elegant workspace.',
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased bg-[#F8F7FA] text-[#24212B]">
        {children}
      </body>
    </html>
  );
}
