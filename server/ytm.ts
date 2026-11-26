export interface Song {
  videoId: string
  title: string
  artist: string
  album: string
  duration: number
  thumb: string
}

const FILTERS = {
  songs: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
  videos: 'EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D',
} as const
export type SearchKind = keyof typeof FILTERS

const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const CONTEXT = { client: { clientName: 'WEB_REMIX', clientVersion: `1.${today}.01.00`, hl: 'en', gl: 'US' } }

const cache = new Map<string, { at: number; songs: Song[] }>()
const TTL = 10 * 60_000

export async function searchYtm(query: string, kind: SearchKind = 'songs'): Promise<Song[]> {
  const q = query.trim().slice(0, 120)
  if (!q) return []
  const key = `${kind}:${q.toLowerCase()}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.songs

  const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://music.youtube.com',
      Referer: 'https://music.youtube.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    },
    body: JSON.stringify({ context: CONTEXT, query: q, params: decodeURIComponent(FILTERS[kind]) }),
  })
  if (!res.ok) throw new Error(`YouTube Music returned ${res.status}`)
  const songs = parse(await res.json())
  cache.set(key, { at: Date.now(), songs })
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
  return songs
}

function parse(data: any): Song[] {
  const sections: any[] =
    data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents ?? []
  const out: Song[] = []
  for (const section of sections) {
    for (const item of section?.musicShelfRenderer?.contents ?? []) {
      const r = item?.musicResponsiveListItemRenderer
      if (!r) continue
      const videoId: string | undefined =
        r.playlistItemData?.videoId ??
        r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
      const runs: any[][] = (r.flexColumns ?? []).map((c: any) => c?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [])
      const title = (runs[0] ?? []).map((x) => x.text).join('')
      if (!videoId || !title) continue
      const info = runs[1] ?? []
      const pageType = (x: any) =>
        x?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType
      const parts: string[] = info.map((x) => x.text).join('').split(' • ').map((s: string) => s.trim())
      const durText = parts.find((p) => /^\d+(:\d{2}){1,2}$/.test(p))
      const duration = durText ? durText.split(':').reduce((a, n) => a * 60 + +n, 0) : 0
      const artists = info.filter((x) => /ARTIST|USER_CHANNEL/.test(pageType(x) ?? '')).map((x) => x.text)
      const album = info.find((x) => pageType(x) === 'MUSIC_PAGE_TYPE_ALBUM')?.text ?? ''
      const meta = parts.filter((p) => p !== durText && !/^[\d.,]+\s?[KMB]?\s(views?|plays?)$/i.test(p))
      const artist = artists.length ? artists.join(', ') : meta[0] === 'Song' || meta[0] === 'Video' ? meta[1] ?? '' : meta[0] ?? ''
      const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? []
      const thumb: string = (thumbs.at(-1)?.url ?? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`).replace(
        /=w\d+-h\d+/,
        '=w180-h180',
      )
      out.push({ videoId, title, artist, album, duration, thumb })
    }
  }
  return out
}

export async function handleSearch(url: URL): Promise<{ status: number; body: unknown }> {
  const q = url.searchParams.get('q') ?? ''
  const kind = url.searchParams.get('kind') === 'videos' ? 'videos' : 'songs'
  try {
    return { status: 200, body: await searchYtm(q, kind) }
  } catch (err) {
    return { status: 502, body: { error: (err as Error).message } }
  }
}
