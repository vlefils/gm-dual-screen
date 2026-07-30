import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const socialImageUrl = `${siteUrl.replace(/\/$/, "")}/og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Écran du MJ — Pilotez votre table en double écran",
  description:
    "Préparez vos cartes, révélez le brouillard de guerre et affichez vos illustrations sur un second écran.",
  applicationName: "Écran du MJ",
  openGraph: {
    title: "Écran du MJ",
    description:
      "La console locale pour piloter cartes, brouillard et illustrations sur un second écran.",
    type: "website",
    images: [{ url: socialImageUrl, width: 1536, height: 1024 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Écran du MJ",
    description:
      "Pilotez cartes, brouillard et illustrations sur un second écran.",
    images: [socialImageUrl],
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#0b0d10",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
