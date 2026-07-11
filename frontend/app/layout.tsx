import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { MotionProvider } from "@/components/MotionProvider";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "FAIV Predict | Content performance tiers",
  description:
    "Classify Instagram draft performance relative to each brand's verified history, inspect model evidence, and plan content.",
  authors: [{ name: "FAIV" }],
  openGraph: {
    title: "FAIV Predict | Content performance tiers",
    description: "Classify Instagram draft performance relative to verified brand history.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeBootstrap = `(() => {
    try {
      const stored = localStorage.getItem("faiv-theme");
      const theme = stored === "dark" || stored === "light"
        ? stored
        : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.classList.remove("dark", "light");
      document.documentElement.classList.add(theme);
    } catch { document.documentElement.classList.add("light"); }
  })();`;
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
