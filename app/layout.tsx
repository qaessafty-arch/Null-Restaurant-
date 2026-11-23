import type { Metadata, Viewport } from 'next'
import { THEME_SCRIPT } from '@/lib/theme'
import './globals.css'
import './ordering.css'
import './staff.css'
import './tokens.css'
import './pos.css'
import './kds.css'
import './floor.css'
import './public.css'
import './inventory.css'
import './finance.css'

export const metadata: Metadata = {
  title: "Smashed Burger Erbil | Best Smash Burgers in Erbil, Iraq",
  description: "Erbil's boldest smash burgers. 100% fresh beef, crispy edges, melted cheese. Dine-in, takeaway & delivery in Erbil. Order now!",
  generator: 'v0.app',
  keywords: ['burger Erbil', 'best burger Erbil', 'smash burger Erbil', 'restaurant Erbil'],
  openGraph: {
    title: "Smashed Burger Erbil | Best Smash Burgers in Erbil, Iraq",
    description: "Erbil's boldest smash burgers. Fresh beef, crispy edges, melted cheese.",
    type: 'website',
    locale: 'en_IQ',
    images: ['/smashed-burger-hero.png'],
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#161617' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
