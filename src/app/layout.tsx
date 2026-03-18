import type { Metadata } from "next";
import "@/index.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "PromptFarm",
  description: "PromptFarm landing page",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

type RootLayoutProps = {
  children: React.ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
