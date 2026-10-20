import "./globals.css";
import type { Metadata, Viewport } from "next";
import { LogoMark } from "./_components/Logo";
import { CONTACT, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../lib/site/constants";
import { OG_IMAGE } from "../lib/site/meta";

const DEFAULT_TITLE = "ProofPrice: what people actually paid";

// Pages set their own title (the template adds " · ProofPrice"), description and canonical URL with pageMetadata()
// from lib/site/meta.ts. There is deliberately no canonical here: a layout canonical would be inherited by every page
// that does not set its own and would point it at the wrong address.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: DEFAULT_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { type: "website", siteName: SITE_NAME, title: DEFAULT_TITLE, description: SITE_DESCRIPTION, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: DEFAULT_TITLE, description: SITE_DESCRIPTION, images: [OG_IMAGE.url] },
  // Setting icons here replaces Next's automatic links for app/icon.svg and app/apple-icon.png, so all of them are listed.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf6" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1513" },
  ],
  colorScheme: "light dark",
};

const NAV = [
  { href: "/connect", label: "Connect" },
  { href: "/sources", label: "Sources" },
  { href: "/prices", label: "Prices" },
  { href: "/pricing", label: "Pricing" },
  { href: "/trust", label: "Trust" },
  { href: "/status", label: "Status" },
  { href: "/method", label: "Method" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#content">
          Skip to content
        </a>
        <header className="site-header">
          <div className="wrap bar">
            <a className="brand" href="/" aria-label="ProofPrice home">
              <LogoMark />
              <span className="wordmark">
                Proof<span>Price</span>
              </span>
            </a>
            <nav className="site-nav" aria-label="Main">
              {NAV.map((n) => (
                <a key={n.href} href={n.href}>
                  {n.label}
                </a>
              ))}
            </nav>
          </div>
        </header>
        <div className="wrap" id="content">
          {children}
          <footer className="site-footer">
            <a href="/">ProofPrice</a> · <a href="/connect">Connect your AI</a> · <a href="/sources">Sources</a> · <a href="/trust">Trust</a> · <a href="/pricing">Pricing</a> ·{" "}
            <a href="/status">Status</a> · <a href="/prices">Prices</a> · <a href="/method">Method</a> · <a href="/privacy">Privacy</a> ·{" "}
            <a href="/terms">Terms</a> · <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
