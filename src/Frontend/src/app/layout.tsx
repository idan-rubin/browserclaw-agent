import type { Metadata } from 'next';
import { Mona_Sans, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { ThemeColor } from '@/components/theme-toggle';
import { Toaster } from 'sonner';
import Script from 'next/script';
import './globals.css';

const monaSans = Mona_Sans({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-mona-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    template: '%s | browserclaw.org',
    default: 'browserclaw.org — AI that browses for you',
  },
  description: 'Type what you want done. Watch AI do it in a real browser. Get a reusable skill.',
  icons: {
    icon: [{ url: '/icon.png', type: 'image/png' }],
  },
};

const rawGaId = process.env.NEXT_PUBLIC_GA_ID;
const gaId = rawGaId != null && (/^G-[A-Z0-9]+$/.test(rawGaId) || /^UA-\d+-\d+$/.test(rawGaId)) ? rawGaId : undefined;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {gaId != null && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
            <Script id="gtag-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaId}');`}
            </Script>
          </>
        )}
      </head>
      <body className={`${monaSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
          <ThemeColor />
          {children}
          <Toaster
            position="top-right"
            richColors
            closeButton
            toastOptions={{ style: { borderRadius: 'var(--radius-xl)' } }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
