import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Wavevo — Multitrack audio studio",
  description: "Bring your tracks together. Arrange audio on a colorful timeline and export a Full HD or 4K video of your studio.",
  // Wavevo supplies both themes; keep Dark Reader from rewriting colors before hydration.
  other: { "darkreader-lock": "true" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
