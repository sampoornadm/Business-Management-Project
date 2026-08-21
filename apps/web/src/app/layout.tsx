import "./globals.css";

import { Toaster } from "@bmp/ui";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import type { PropsWithChildren } from "react";

import { AuthProvider } from "@/providers/auth-provider";
import { QueryProvider } from "@/providers/query-provider";
import { ThemeProvider } from "@/providers/theme-provider";

// IBM Plex Sans for UI/body text, IBM Plex Mono reserved for identifiers and
// tabular data (tender numbers, item codes, amounts) — see packages/config's
// tailwind preset for how these become the font-sans/font-mono utilities.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Business Management Platform",
  description: "Tender, estimation, procurement, project, and finance management for contractors",
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable}`}>
      <head>
        <script
          // Mirrors next-themes' own inline-script approach: read the last-applied
          // color synchronously and paint it before hydration, avoiding a flash of
          // the default color. The DashboardLayout effect reconciles it against the
          // server-derived value once the auth store hydrates (e.g. if this cache
          // is stale because the color was changed on another device).
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var v=JSON.parse(localStorage.getItem("bmp-theme-color-vars"));if(!v)return;var s=document.documentElement.style;s.setProperty("--primary",v.primary);s.setProperty("--primary-foreground",v.primaryForeground);s.setProperty("--ring",v.ring);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <QueryProvider>
            <AuthProvider>
              {children}
              <Toaster />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
