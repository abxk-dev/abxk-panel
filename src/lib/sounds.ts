export function playBeep(freq = 440, dur = 100, vol = 0.1, type: OscillatorType = "square") {
  try {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextCtor) return
    const ctx = new AudioContextCtor()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    osc.type = type
    gain.gain.setValueAtTime(vol, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur / 1000)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + dur / 1000)
    window.setTimeout(() => {
      ctx.close().catch(() => undefined)
    }, dur + 100)
  } catch {
    return
  }
}

export const SFX = {
  tradeOpen: () => {
    playBeep(880, 80)
    window.setTimeout(() => playBeep(1100, 80), 90)
  },
  tradeWin: () => {
    playBeep(1200, 150)
    window.setTimeout(() => playBeep(1600, 200), 160)
  },
  tradeLoss: () => playBeep(220, 400, 0.15, "sawtooth"),
  levelUp: () => {
    playBeep(1400, 200)
    window.setTimeout(() => playBeep(1800, 300), 210)
  },
  alert: () => {
    playBeep(660, 80)
    window.setTimeout(() => playBeep(660, 80), 120)
  },
  scan: () => playBeep(440, 50, 0.05),
  error: () => playBeep(200, 300, 0.1, "sawtooth"),
  click: () => playBeep(1200, 30, 0.03)
}

