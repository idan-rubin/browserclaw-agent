import type { Metadata } from 'next';
import { Inter, Source_Serif_4, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { ThemeColor } from '@/components/theme-toggle';
import { Toaster } from 'sonner';
import Script from 'next/script';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-heading',
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
      <body
        className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} font-[family-name:var(--font-inter)] antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
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
