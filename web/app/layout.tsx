import type { Metadata, Viewport } from "next";
import { B612, B612_Mono } from "next/font/google";
import "./globals.css";

// B612: the open typeface Airbus commissioned for cockpit screens. Bundled at build time,
// so pages never fetch fonts from another site while running.
const b612 = B612({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-b612" });
const b612Mono = B612_Mono({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-b612-mono" });

export const metadata: Metadata = {
  title: "ArGuide",
  description: "Live remote help for aircraft maintenance.",
};

export const viewport: Viewport = {
  themeColor: "#18222b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${b612.variable} ${b612Mono.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
