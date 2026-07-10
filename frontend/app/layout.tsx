import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { MotionProvider } from "@/components/MotionProvider";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "FAIV Predict — AI content performance prediction",
  description:
    "AI-powered content performance prediction for creative agencies. Predict virality, diagnose performance, and optimize captions before you post.",
  authors: [{ name: "FAIV" }],
  openGraph: {
    title: "FAIV Predict — AI content performance prediction",
    description: "Predict virality, diagnose performance, and optimize captions before you post.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`light ${manrope.variable}`} suppressHydrationWarning>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
