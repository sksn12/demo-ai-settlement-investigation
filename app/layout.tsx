import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlowScope AI",
  description: "AI 기반 결제·정산 조사 워크벤치",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
