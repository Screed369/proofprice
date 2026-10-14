export const metadata = {
  title: "ProofPrice: what people actually paid",
  description: "Real prices actually paid, from official records, in one place for AI agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "40px auto", padding: "0 16px", lineHeight: 1.5, color: "#1a1a1a", background: "#fff" }}>
        {children}
        <footer style={{ marginTop: 48, paddingTop: 16, borderTop: "1px solid #e5e5e5", fontSize: 13, color: "#555" }}>
          <a href="/">ProofPrice</a> · <a href="/connect">Connect your AI</a> · <a href="/method">Method</a> ·{" "}
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="mailto:hello@proofprice.com">hello@proofprice.com</a>
        </footer>
      </body>
    </html>
  );
}
