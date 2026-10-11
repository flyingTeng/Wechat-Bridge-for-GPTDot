import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wechat Bridge for GPTDot",
  description: "本人专用的微信连接测试。扫码由你完成，只发送无敏感内容的测试消息。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
