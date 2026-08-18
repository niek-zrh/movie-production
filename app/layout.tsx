import type { Metadata } from "next";
import "./globals.css";
import { Archivo, Martian_Mono } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

// Brand faces per kinolab.ai: Archivo (display + UI, variable width) and
// Martian Mono (codes, labels, filenames).
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  axes: ["wdth"],
});
const martianMono = Martian_Mono({
  subsets: ["latin"],
  variable: "--font-martian-mono",
});

export const metadata: Metadata = {
  title: "Kinolab",
  description: "Film production, built for the age of AI",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html
        lang="en"
        className={cn("font-sans", archivo.variable, martianMono.variable)}
      >
        <body>
          <ConvexClientProvider>{children}</ConvexClientProvider>
          <Toaster position="bottom-right" />
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
