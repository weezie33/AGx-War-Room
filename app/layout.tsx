import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Last Z War Room",
  description: "Multiplayer Last Z Survival planning board",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
