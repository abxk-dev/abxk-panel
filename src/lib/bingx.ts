import crypto from "crypto"

const API_URL = "https://open-api.bingx.com"

export type BingxMethod = "GET" | "POST" | "DELETE"

export async function bingxRequest<T>(opts: {
  method: BingxMethod
  path: string
  params?: Record<string, string | number | boolean | undefined | null>
  apiKey: string
  secretKey: string
}): Promise<T> {
  const query = buildSignedQuery(opts.params ?? {}, opts.secretKey)
  const url = `${API_URL}${opts.path}?${query}`

  const res = await fetch(url, {
    method: opts.method,
    headers: {
      "X-BX-APIKEY": opts.apiKey
    },
    cache: "no-store"
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${opts.method} ${opts.path} failed: ${res.status} ${text}`)
  }

  let parsed: any
  try {
    parsed = JSON.parse(text) as any
  } catch {
    throw new Error(`Non-JSON response from BingX: ${text}`)
  }

  if (parsed && typeof parsed === "object") {
    const code = parsed.code
    if (typeof code === "number" && code !== 0) {
      const msg =
        typeof parsed.msg === "string" ? parsed.msg : typeof parsed.message === "string" ? parsed.message : "BingX error"
      throw new Error(`${opts.method} ${opts.path} failed: code=${code} ${msg}`)
    }
    if (parsed.success === false) {
      const msg =
        typeof parsed.msg === "string" ? parsed.msg : typeof parsed.message === "string" ? parsed.message : "BingX error"
      throw new Error(`${opts.method} ${opts.path} failed: ${msg}`)
    }
  }

  return parsed as T
}

export function buildSignedQuery(
  params: Record<string, string | number | boolean | undefined | null>,
  secretKey: string
): string {
  const base = buildQuery({ ...params, timestamp: Date.now() })
  const signature = crypto.createHmac("sha256", secretKey).update(base).digest("hex")
  return `${base}&signature=${signature}`
}

export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => a.localeCompare(b))

  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&")
}
