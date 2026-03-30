import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Primordia",
  description: "A self-modifying web application that evolves based on your instructions.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-mono antialiased bg-gray-950 text-gray-100">
        {children}
      </body>
    </html>
  );
}
