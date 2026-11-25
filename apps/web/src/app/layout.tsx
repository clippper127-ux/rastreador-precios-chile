import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MobileNav } from "@/components/nav-links";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Rastreador de precios", template: "%s · Rastreador" },
  description: "Sigue precios en tiendas chilenas y compra en el mejor momento.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fb" },
    { media: "(prefers-color-scheme: dark)", color: "#14161c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-dvh font-sans`}>
        <ThemeProvider>
          <a
            href="#contenido"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
          >
            Saltar al contenido
          </a>
          <SiteHeader />
          <main id="contenido" className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 md:pb-16">
            {children}
          </main>
          <MobileNav />
        </ThemeProvider>
      </body>
    </html>
  );
}
