import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Wavevo — Multitrack audio studio",
  description: "Bring your tracks together. Mix audio on a colorful timeline and export your sound as a waveform video.",
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
