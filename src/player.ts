export interface Clock {
  time(): number
  playing(): boolean
  play(): void
  pause(): void
  seek(t: number): void
  destroy(): void
}

type YTPlayer = {
  playVideo(): void
  pauseVideo(): void
  seekTo(s: number, allow: boolean): void
  getCurrentTime(): number
  getPlayerState(): number
  getPlaybackRate(): number
  destroy(): void
}
declare global {
  interface Window {
    YT: { Player: new (el: HTMLElement, opts: object) => YTPlayer }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiReady: Promise<void> | null = null
function loadApi(): Promise<void> {
  apiReady ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve()
    window.onYouTubeIframeAPIReady = () => resolve()
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.append(s)
  })
  return apiReady
}

const EMBED_ERRORS: Record<number, string> = {
  2: 'That link has an invalid video ID.',
  5: 'This video cannot play in the browser player.',
  100: 'This video was removed or is private.',
  101: 'The owner blocked this video from playing on other sites.',
  150: 'The owner blocked this video from playing on other sites.',
  153: 'YouTube needs the page served over http(s). Run it with npm run dev.',
}

export interface YouTubeEvents {
  onEnded(): void
  onError(message: string, code: number): void
  onStateChange(playing: boolean): void
}

export async function youtubeClock(el: HTMLElement, videoId: string, ev: YouTubeEvents): Promise<Clock> {
  await loadApi()
  let last = 0
  let lastAt = performance.now()
  const player = await new Promise<YTPlayer>((resolve) => {
    const p: YTPlayer = new window.YT.Player(el, {
      videoId,
      playerVars: { playsinline: 1, rel: 0, controls: 0, disablekb: 1, modestbranding: 1, iv_load_policy: 3, cc_load_policy: 0 },
      events: {
        onReady: () => resolve(p),
        onStateChange: (e: { data: number }) => {
          if (e.data === 0) ev.onEnded()
          ev.onStateChange(e.data === 1)
        },
        onError: (e: { data: number }) => ev.onError(EMBED_ERRORS[e.data] ?? `YouTube error ${e.data}.`, e.data),
      },
    })
  })
  const playing = () => player.getPlayerState() === 1
  return {
    time() {
      const t = player.getCurrentTime() ?? 0
      const now = performance.now()
      if (t !== last || !playing()) {
        last = t
        lastAt = now
        return t
      }
      return t + ((now - lastAt) / 1000) * (player.getPlaybackRate() || 1)
    },
    playing,
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek: (t) => player.seekTo(t, true),
    destroy: () => player.destroy(),
  }
}

export function internalClock(onState: (playing: boolean) => void): Clock {
  let base = 0
  let startedAt: number | null = null
  const time = () => (startedAt === null ? base : base + (performance.now() - startedAt) / 1000)
  return {
    time,
    playing: () => startedAt !== null,
    play() {
      if (startedAt !== null) return
      startedAt = performance.now()
      onState(true)
    },
    pause() {
      if (startedAt === null) return
      base = time()
      startedAt = null
      onState(false)
    },
    seek(t) {
      base = t
      if (startedAt !== null) startedAt = performance.now()
    },
    destroy() {},
  }
}

export function parseVideoId(input: string): string | null {
  const s = input.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1, 12) || null
    const v = u.searchParams.get('v')
    if (v) return v
    const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/)
    return m?.[1] ?? null
  } catch {
    return null
  }
}
