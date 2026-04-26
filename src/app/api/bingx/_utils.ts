import { bingxRequest } from "@/lib/bingx"

export function getEnvKeys(): { apiKey: string; secretKey: string } {
  const apiKey = process.env.BINGX_API_KEY
  const secretKey = process.env.BINGX_SECRET_KEY
  if (!apiKey || !secretKey) {
    throw new Error("Missing BINGX_API_KEY or BINGX_SECRET_KEY")
  }
  return { apiKey, secretKey }
}

export function envBingxRequest<T>(opts: {
  method: "GET" | "POST" | "DELETE"
  path: string
  params?: Record<string, string | number | boolean | undefined | null>
}): Promise<T> {
  const { apiKey, secretKey } = getEnvKeys()
  return bingxRequest<T>({ ...opts, apiKey, secretKey })
}

