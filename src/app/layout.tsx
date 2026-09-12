import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Climate Career Exploration Tool",
  description:
    "Explore climate fields and roles that use the skills you already have.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
