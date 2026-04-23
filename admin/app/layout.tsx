import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VoxStudio Admin",
  description: "Quản trị hệ thống VoxStudio",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
