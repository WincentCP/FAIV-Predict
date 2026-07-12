import type { Metadata } from "next";
import { MotionProvider } from "@/components/MotionProvider";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "FAIV Predict | Decide before you publish",
  description:
    "Use verified Instagram history to evaluate drafts, understand likely performance, and improve content before publishing.",
  authors: [{ name: "FAIV" }],
  openGraph: {
    title: "FAIV Predict | Decide before you publish",
    description: "Evaluate and improve Instagram content before publishing.",
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
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
