"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"

type BrandingState = {
  logo: string | null
  botName: string
  tagline: string
}

type BrandingContextValue = BrandingState & {
  updateBranding: (patch: Partial<BrandingState>) => void
}

const DEFAULTS: BrandingState = {
  logo: null,
  botName: "ABXK-BOT",
  tagline: "Next.js + BingX Futures"
}

const BrandingContext = createContext<BrandingContextValue | null>(null)

function readLocalStorage(): BrandingState {
  if (typeof window === "undefined") return DEFAULTS
  const logo = window.localStorage.getItem("bot_logo")
  const botName = window.localStorage.getItem("bot_name")
  const tagline = window.localStorage.getItem("bot_tagline")
  return {
    logo: logo && logo.trim() ? logo : null,
    botName: botName && botName.trim() ? botName : DEFAULTS.botName,
    tagline: tagline && tagline.trim() ? tagline : DEFAULTS.tagline
  }
}

function writeLocalStorage(next: BrandingState) {
  if (typeof window === "undefined") return
  if (next.logo) window.localStorage.setItem("bot_logo", next.logo)
  else window.localStorage.removeItem("bot_logo")
  window.localStorage.setItem("bot_name", next.botName)
  window.localStorage.setItem("bot_tagline", next.tagline)
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BrandingState>(DEFAULTS)

  useEffect(() => {
    const init = readLocalStorage()
    setState(init)
    writeLocalStorage(init)

    const onStorage = (e: StorageEvent) => {
      if (e.key !== "bot_logo" && e.key !== "bot_name" && e.key !== "bot_tagline") return
      setState(readLocalStorage())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const value = useMemo<BrandingContextValue>(() => {
    const updateBranding = (patch: Partial<BrandingState>) => {
      setState((prev) => {
        const next: BrandingState = {
          logo: patch.logo !== undefined ? patch.logo : prev.logo,
          botName: patch.botName !== undefined ? patch.botName : prev.botName,
          tagline: patch.tagline !== undefined ? patch.tagline : prev.tagline
        }
        writeLocalStorage(next)
        return next
      })
    }
    return { ...state, updateBranding }
  }, [state])

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext)
  if (!ctx) {
    return {
      ...DEFAULTS,
      updateBranding: () => undefined
    }
  }
  return ctx
}

