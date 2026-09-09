import type { Metadata } from 'next';
import {
  Fraunces,
  Inter_Tight,
  JetBrains_Mono,
  Anton,
  Archivo,
  Instrument_Serif,
  IBM_Plex_Sans,
  IBM_Plex_Mono,
  Plus_Jakarta_Sans,
} from 'next/font/google';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';
import '@/components/marketing/night-garden/night-garden.css';

const fraunces = Fraunces({
  variable: '--font-display',
  subsets: ['latin'],
  weight: 'variable',
  axes: ['opsz'],
});

const interTight = Inter_Tight({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: 'variable',
});

const plusJakarta = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
});

const anton = Anton({
  variable: '--font-anton',
  subsets: ['latin'],
  weight: '400',
});

const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
});

const instrumentSerif = Instrument_Serif({
  variable: '--font-instrument',
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
});

// Today v2 foundation fonts. `--font-serif-display`, `--font-sans-operator`,
// and `--font-mono-operator` are consumed by the `.today-theme` scope in
// globals.css. Existing variables (`--font-display`, `--font-sans`,
// `--font-mono`, `--font-instrument`) are intentionally preserved.
const serifDisplay = Instrument_Serif({
  variable: '--font-serif-display',
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
});

// Spec asks for IBM Plex Sans weight 450, which Google Fonts does not publish.
// Using 500 as the nearest available weight.
const sansOperator = IBM_Plex_Sans({
  variable: '--font-sans-operator',
  weight: ['300', '400', '500', '600'],
  subsets: ['latin'],
});

const monoOperator = IBM_Plex_Mono({
  variable: '--font-mono-operator',
  weight: ['400', '500'],
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Odesa | The AI property operations assistant for small landlords',
  description:
    'Odesa captures tenant calls and texts, checks rent and maintenance records, prepares owner-reviewed actions, and delivers one clear briefing for landlords with 5 to 50 units.',
  openGraph: {
    title: 'Odesa | The AI property operations assistant for small landlords',
    description:
      'Odesa captures tenant calls and texts, checks rent and maintenance records, prepares owner-reviewed actions, and delivers one clear briefing for landlords with 5 to 50 units.',
    type: 'website',
    siteName: 'Odesa',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Odesa | The AI property operations assistant for small landlords',
    description:
      'Tenant evidence captured, rent and maintenance records checked, reviewed actions prepared, and one clear owner briefing for landlords with 5 to 50 units.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${interTight.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} ${anton.variable} ${archivo.variable} ${instrumentSerif.variable} ${serifDisplay.variable} ${sansOperator.variable} ${monoOperator.variable} antialiased`}
      >
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
