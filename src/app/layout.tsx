import type { Metadata } from "next"
import { Orbitron, Share_Tech_Mono } from "next/font/google"
import "./globals.css"
import "../styles/cyberpunk.css"
import { BrandingProvider } from "@/components/BrandingProvider"
import { BitcoinHack } from "@/components/effects/BitcoinHack"
import { DataStreams } from "@/components/effects/DataStreams"
import { HackBackground } from "@/components/effects/HackBackground"
import { HackedScreen } from "@/components/effects/HackedScreen"

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
        <HackBackground />
        <BitcoinHack />
        <DataStreams />
        <HackedScreen />
        <div style={{ position: "relative", zIndex: 1 }}>
          <BrandingProvider>{children}</BrandingProvider>
        </div>
      </body>
    </html>
  )
}
