"use client"

import { useEffect, useMemo, useRef, useState } from "react"

type Track = { name: string; tempo: number; style: "pulse" | "dark" | "danger" | "hack" }

export function MusicPlayer() {
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.3)
  const [track, setTrack] = useState(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const nodesRef = useRef<any[]>([])

  const tracks = useMemo<Track[]>(
    () => [
      { name: "CYBER_PULSE", tempo: 120, style: "pulse" },
      { name: "DARK_MATRIX", tempo: 90, style: "dark" },
      { name: "DANGER_ZONE", tempo: 140, style: "danger" },
      { name: "HACK_MODE", tempo: 100, style: "hack" }
    ],
    []
  )

  function createCyberSound(ctx: AudioContext, vol: number, style: Track["style"]) {
    const nodes: any[] = []

    const master = ctx.createGain()
    master.gain.value = Math.max(0, Math.min(1, vol))
    master.connect(ctx.destination)
    nodes.push(master)

    const drone = ctx.createOscillator()
    const droneGain = ctx.createGain()
    drone.type = "sawtooth"
    drone.frequency.value = style === "dark" ? 40 : style === "danger" ? 55 : style === "hack" ? 60 : 50
    droneGain.gain.value = vol * 0.15
    drone.connect(droneGain)
    droneGain.connect(master)
    drone.start()
    nodes.push(drone, droneGain)

    const pulseInterval = window.setInterval(() => {
      if (!ctx || ctx.state === "closed") return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const filter = ctx.createBiquadFilter()

      filter.type = "lowpass"
      filter.frequency.value = style === "danger" ? 800 : 400

      osc.type = style === "hack" ? "square" : "sawtooth"
      osc.frequency.value = style === "dark" ? 60 : style === "danger" ? 80 : style === "hack" ? 120 : 100

      gain.gain.setValueAtTime(vol * 0.4, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)

      osc.connect(filter)
      filter.connect(gain)
      gain.connect(master)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.2)
    }, style === "danger" ? 300 : style === "hack" ? 400 : 500)

    nodes.push({ stop: () => window.clearInterval(pulseInterval) })

    const glitchInterval = window.setInterval(() => {
      if (!ctx || ctx.state === "closed") return
      if (Math.random() > 0.4) return
      const bufferSize = Math.floor(ctx.sampleRate * 0.05)
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3
      const noise = ctx.createBufferSource()
      const noiseGain = ctx.createGain()
      const noiseFilter = ctx.createBiquadFilter()
      noiseFilter.type = "highpass"
      noiseFilter.frequency.value = 3000
      noiseGain.gain.setValueAtTime(vol * 0.2, ctx.currentTime)
      noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)
      noise.buffer = buffer
      noise.connect(noiseFilter)
      noiseFilter.connect(noiseGain)
      noiseGain.connect(master)
      noise.start()
    }, 150)

    nodes.push({ stop: () => window.clearInterval(glitchInterval) })

    const scales: Record<Track["style"], number[]> = {
      pulse: [261, 311, 392, 466],
      dark: [138, 164, 185, 220],
      danger: [220, 233, 277, 311],
      hack: [196, 220, 261, 311]
    }

    const scale = scales[style] ?? scales.pulse
    let noteIndex = 0

    const melodyInterval = window.setInterval(() => {
      if (!ctx || ctx.state === "closed") return
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "square"
      osc.frequency.value = scale[noteIndex % scale.length] ?? 261
      noteIndex += 1
      gain.gain.setValueAtTime(vol * 0.08, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
      osc.connect(gain)
      gain.connect(master)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.15)
    }, 250)

    nodes.push({ stop: () => window.clearInterval(melodyInterval) })

    return nodes
  }

  function stopAll() {
    nodesRef.current.forEach((node) => {
      try {
        if (node?.stop) node.stop()
        if (node?.disconnect) node.disconnect()
      } catch {
        return
      }
    })
    nodesRef.current = []
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined)
      audioCtxRef.current = null
    }
  }

  function startMusic(nextTrackIndex?: number) {
    stopAll()
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const currentTrack = tracks[nextTrackIndex ?? track] ?? tracks[0]
    nodesRef.current = createCyberSound(ctx, volume, currentTrack.style)
    setPlaying(true)
  }

  function toggleMusic() {
    if (playing) {
      stopAll()
      setPlaying(false)
    } else {
      startMusic()
    }
  }

  function changeTrack(direction: number) {
    const next = (track + direction + tracks.length) % tracks.length
    setTrack(next)
    if (playing) startMusic(next)
  }

  useEffect(() => {
    return () => stopAll()
  }, [])

  useEffect(() => {
    if (!playing || !audioCtxRef.current) return
    const master = nodesRef.current.find((n) => n && typeof n.gain?.value === "number") as GainNode | undefined
    if (!master?.gain) return
    master.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), audioCtxRef.current.currentTime)
  }, [volume, playing])

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#000",
        border: "1px solid #00FF8820",
        borderRadius: 4,
        padding: "4px 12px",
        fontFamily: "var(--font-cyber)",
        fontSize: 10
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 2, height: 20 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: playing ? `${Math.random() * 16 + 4}px` : "4px",
              background: "var(--neon-green)",
              borderRadius: 1,
              boxShadow: playing ? "0 0 4px var(--neon-green)" : "none",
              transition: "height 0.1s",
              animation: playing ? `bar${i} 0.${3 + i}s infinite alternate` : "none"
            }}
          />
        ))}
      </div>

      <button
        onClick={() => changeTrack(-1)}
        className="cyber-btn"
        style={{ padding: "2px 6px", fontSize: 12, border: "none", background: "none", color: "#00FF8860" }}
        type="button"
      >
        ◀
      </button>

      <button
        onClick={toggleMusic}
        style={{
          background: playing ? "rgba(0,255,136,0.15)" : "transparent",
          border: `1px solid ${playing ? "var(--neon-green)" : "#00FF8830"}`,
          borderRadius: 3,
          color: playing ? "var(--neon-green)" : "#00FF8860",
          padding: "3px 10px",
          fontSize: 11,
          cursor: "pointer",
          fontFamily: "var(--font-cyber)",
          letterSpacing: 1,
          boxShadow: playing ? "var(--glow-green)" : "none",
          transition: "all 0.2s"
        }}
        type="button"
      >
        {playing ? "■ STOP" : "▶ MUSIC"}
      </button>

      <button
        onClick={() => changeTrack(1)}
        className="cyber-btn"
        style={{ padding: "2px 6px", fontSize: 12, border: "none", background: "none", color: "#00FF8860" }}
        type="button"
      >
        ▶
      </button>

      <span style={{ color: "#00FF8850", fontSize: 9, letterSpacing: 1, minWidth: 80 }}>{tracks[track]?.name ?? ""}</span>

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ color: "#00FF8840", fontSize: 9 }}>VOL</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          style={{ width: 60, accentColor: "var(--neon-green)", cursor: "pointer" }}
        />
      </div>

      <style>{`
        @keyframes bar0{0%{height:4px}100%{height:14px}}
        @keyframes bar1{0%{height:8px}100%{height:18px}}
        @keyframes bar2{0%{height:6px}100%{height:20px}}
        @keyframes bar3{0%{height:10px}100%{height:16px}}
        @keyframes bar4{0%{height:4px}100%{height:12px}}
      `}</style>
    </div>
  )
}

