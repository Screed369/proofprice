export const metadata = {
  title: "Price Paid plug",
  description: "Real prices actually paid, from official records, in one place for AI agents. Private test.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "40px auto", padding: "0 16px", lineHeight: 1.5, color: "#1a1a1a", background: "#fff" }}>
        {children}
      </body>
    </html>
  );
}
