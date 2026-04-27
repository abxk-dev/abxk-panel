import type { SessionData } from "@/lib/scalping3/types"

const istOffsetMs = 5.5 * 60 * 60 * 1000

export function checkSession(): SessionData {
  const now = new Date()
  const utcHour = now.getUTCHours()
  const utcMin = now.getUTCMinutes()
  const utcTime = utcHour + utcMin / 60

  let currentSession = "DEAD_HOURS"
  let sessionScore = 0
  let isOptimal = false
  let allowTrade = false

  if (utcTime >= 13 && utcTime < 16) {
    currentSession = "LONDON_NY_OVERLAP"
    sessionScore = 30
    isOptimal = true
    allowTrade = true
  } else if (utcTime >= 16 && utcTime < 21) {
    currentSession = "NEW_YORK"
    sessionScore = 20
    isOptimal = true
    allowTrade = false
  } else if (utcTime >= 8 && utcTime < 13) {
    currentSession = "LONDON"
    sessionScore = 15
    isOptimal = true
    allowTrade = false
  } else if (utcTime >= 0 && utcTime < 8) {
    currentSession = "ASIAN"
    sessionScore = 0
    isOptimal = false
    allowTrade = false
  }

  let nextOptimalTime = ""
  if (!isOptimal || !allowTrade) {
    const hoursToLondon = utcHour < 8 ? 8 - utcHour : 32 - utcHour
    const hoursToNY = utcHour < 13 ? 13 - utcHour : 37 - utcHour
    const hoursToNext = Math.min(hoursToLondon, hoursToNY)
    const nextTime = new Date(now.getTime() + hoursToNext * 60 * 60 * 1000)
    const nextIST = new Date(nextTime.getTime() + istOffsetMs)
    nextOptimalTime = `${nextIST.getUTCHours()}:${String(nextIST.getUTCMinutes()).padStart(2, "0")} IST`
  }

  const reason = allowTrade
    ? `${currentSession.replace(/_/g, " ")} — trading allowed`
    : `${currentSession.replace(/_/g, " ")} — waiting for ${nextOptimalTime}`

  return {
    currentSession,
    sessionScore,
    isOptimal,
    allowTrade,
    nextOptimalTime,
    reason
  }
}
