import type { Song } from '../api/search'
export type { Song }

const LRCLIB = 'https://lrclib.net/api'
const HEADERS = { 'Lrclib-Client': 'typelist/1.0' }

export type Track = Song & { lrclibId?: number }
export type SearchSource = 'ytm' | 'lrclib'

export interface Line {
  start: number
  end: number
  text: string
}

export interface Lyrics {
  id: number
  timed: boolean
  lines: Line[]
}

export interface LyricsChoice {
  id: number
  label: string
  timed: boolean
  record: LrclibRecord
}

export interface LrclibRecord {
  id: number
  trackName: string
  artistName: string
  albumName: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

export async function searchSongs(q: string, signal?: AbortSignal): Promise<{ songs: Track[]; source: SearchSource }> {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal })
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error('Search API unavailable')
    return { songs: await res.json(), source: 'ytm' }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    const list =
      (await lrclib<(LrclibRecord & { hasSyncedLyrics: boolean })[]>(`/v2/search?q=${encodeURIComponent(q)}`, signal)) ?? []
    return {
      source: 'lrclib',
      songs: list
        .filter((r) => r.hasSyncedLyrics)
        .map((r) => ({ videoId: '', title: r.trackName, artist: r.artistName, album: r.albumName, duration: r.duration, thumb: '', lrclibId: r.id })),
    }
  }
}

export async function findVideos(song: Track): Promise<Song[]> {
  try {
    const res = await fetch(`/api/search?kind=videos&q=${encodeURIComponent(`${firstArtist(song.artist)} ${cleanTitle(song.title)}`)}`)
    if (!res.ok) return []
    const list: Song[] = await res.json()
    return list.sort((a, b) => Math.abs(a.duration - song.duration) - Math.abs(b.duration - song.duration))
  } catch {
    return []
  }
}

async function lrclib<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const res = await fetch(LRCLIB + path, { headers: HEADERS, signal })
  if (res.status === 429) throw new Error(`Too many lyric lookups. Try again in ${res.headers.get('Retry-After') ?? 'a few'} seconds.`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`LRCLIB returned ${res.status}.`)
  return res.json()
}

export const cleanTitle = (t: string) =>
  t
    .replace(/\s*[([](feat|ft|with|prod|official|lyric|audio|video|visuali[sz]er|remaster|live|explicit)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, '')
    .trim()
const firstArtist = (a: string) => a.split(/\s*(?:,|&| x | feat\.? | ft\.? )\s*/i)[0]
const closeTo = (song: Track) => (r: LrclibRecord) => !song.duration || Math.abs(r.duration - song.duration) <= 6
const byDuration = (song: Track) => (a: LrclibRecord, b: LrclibRecord) =>
  Math.abs(a.duration - song.duration) - Math.abs(b.duration - song.duration)

export async function findLyrics(song: Track): Promise<Lyrics | null> {
  const close = closeTo(song)
  let pick: LrclibRecord | null = null
  if (song.lrclibId) pick = await lrclib<LrclibRecord>(`/get/${song.lrclibId}`)
  if (!pick?.syncedLyrics) {
    const p = new URLSearchParams({ track_name: cleanTitle(song.title), artist_name: firstArtist(song.artist) })
    if (song.album) p.set('album_name', song.album)
    if (song.duration) p.set('duration', String(Math.round(song.duration)))
    pick = (await lrclib<LrclibRecord>(`/get?${p}`)) ?? pick
  }
  if (!pick?.syncedLyrics || !close(pick)) {
    const list = (await searchRecords(song)).filter((r) => !r.instrumental)
    pick = list.find((r) => r.syncedLyrics && close(r)) ?? pick ?? list.find((r) => r.plainLyrics) ?? null
  }
  return pick ? toLyrics(pick, song.duration, close(pick)) : null
}

async function searchRecords(song: Track): Promise<LrclibRecord[]> {
  const p = new URLSearchParams({ track_name: cleanTitle(song.title), artist_name: firstArtist(song.artist) })
  return ((await lrclib<LrclibRecord[]>(`/search?${p}`)) ?? []).sort(byDuration(song))
}

export async function lyricsChoices(song: Track, current: number): Promise<LyricsChoice[]> {
  const close = closeTo(song)
  const list = (await searchRecords(song)).filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics))
  if (!list.some((r) => r.id === current)) {
    const rec = await lrclib<LrclibRecord>(`/get/${current}`)
    if (rec) list.unshift(rec)
  }
  const rank = (r: LrclibRecord) => (r.id === current ? -1 : r.syncedLyrics ? (close(r) ? 0 : 1) : 2)
  const seen = new Set<string>()
  return list
    .sort((a, b) => rank(a) - rank(b))
    .filter((r) => {
      const text = (r.syncedLyrics ?? r.plainLyrics ?? '').replace(STAMP, '').replace(/\s+/g, ' ').trim().toLowerCase()
      const key = `${!!r.syncedLyrics}|${Math.round(r.duration / 4)}|${text}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 10)
    .map((r) => {
      const lines = (r.syncedLyrics ?? r.plainLyrics ?? '').split('\n').filter((l) => l.replace(STAMP, '').trim()).length
      const album = r.albumName && !/^(null|<unknown>)$/i.test(r.albumName) ? r.albumName : r.artistName
      return {
        id: r.id,
        timed: !!r.syncedLyrics,
        record: r,
        label: `${album} · ${fmtTime(r.duration)} · ${r.syncedLyrics ? 'synced' : 'untimed'}, ${lines} lines`,
      }
    })
}

export function toLyrics(r: LrclibRecord, duration: number, useTiming = true): Lyrics | null {
  if (r.syncedLyrics && useTiming) return { id: r.id, timed: true, lines: parseLrc(r.syncedLyrics, duration || r.duration) }
  const plain = r.plainLyrics ?? r.syncedLyrics?.replace(STAMP, '') ?? ''
  const lines = plain
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ start: NaN, end: NaN, text }))
  return lines.length ? { id: r.id, timed: false, lines } : null
}

const STAMP = /\[(\d+):(\d+(?:\.\d+)?)\]/g

export function parseLrc(lrc: string, duration: number): Line[] {
  const rows: { start: number; text: string }[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const text = raw.replace(STAMP, '').trim()
    for (const m of raw.matchAll(STAMP)) rows.push({ start: +m[1] * 60 + +m[2], text })
  }
  rows.sort((a, b) => a.start - b.start)
  return rows.map((r, i) => ({ start: r.start, end: rows[i + 1]?.start ?? Math.max(duration, r.start + 4), text: r.text }))
}

export function target(text: string, easy: boolean): string {
  if (!easy) return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['‘’`´]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
