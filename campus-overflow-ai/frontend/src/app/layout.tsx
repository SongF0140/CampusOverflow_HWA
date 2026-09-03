import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CampusOverflow AI",
  description: "面向高校课程场景的智能问答平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
