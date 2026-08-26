import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AccountHeader } from "@/components/account-header";
import { getServerSession } from "@/lib/session";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TimeTable",
  description: "학교 시간표 작성",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getServerSession();

  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {session ? <AccountHeader username={session.username} /> : null}
        {children}
      </body>
    </html>
  );
}
