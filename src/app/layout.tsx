import type { Metadata } from "next"
import { Orbitron, Share_Tech_Mono } from "next/font/google"
import "./globals.css"
import "../styles/cyberpunk.css"
import { BrandingProvider } from "@/components/BrandingProvider"

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-display"
})

const shareTechMono = Share_Tech_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-cyber"
})

export const metadata: Metadata = {
  title: "ABXK Crypto Compounding Bot",
  description: "Crypto Compounding Bot Dashboard"
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${orbitron.variable} ${shareTechMono.variable}`}>
      <body>
        <BrandingProvider>{children}</BrandingProvider>
      </body>
    </html>
  )
}
