import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Wavevo — Audio into motion",
  description: "Turn audio into a polished waveform video.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
