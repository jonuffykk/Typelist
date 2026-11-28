# Dossier: "Type along with your favorite song"

Research notes for **Typelist**, a lyric-typing app built with Vite. Compiled November 2026.

---

## 1. What the genre is

You type a song's lyrics while the song plays. The music sets the pace, the lyrics are the text, and the score is words per minute plus accuracy. It is a typing trainer with a rhythm game's sense of timing, and it works because people already know the words to songs they like.

There are three ways to handle timing, and each product picks one:

| Model | How it works | Feels like | Examples |
|---|---|---|---|
| **Song waits for you** | The video pauses when you fall behind and resumes when you catch up | Typing test with a soundtrack | SongTyping |
| **Song never waits** | Each line has a window. When the window closes, whatever you did not type is missed | Karaoke / rhythm game | TypingMania, KaraokeType, LyricHero, typetown |
| **Judged on timing** | Each word is graded perfect / great / good / early / late against the moment it is sung | Piano Tiles for the keyboard | typetown, TypingTube (combo, score) |

Typelist uses **line windows (song never waits)**, plus a "Wait for me" toggle that pauses the video at the end of a line you haven't finished. When a song only has plain lyrics, it switches to **untimed mode**: the song plays and the lines advance as you finish them.

---

## 2. Existing products

| Product | Lyrics source | Media | Business model | Worth borrowing |
|---|---|---|---|---|
| **SongTyping** (songtyping.com) | Genius, LRCLIB, YouTube captions | YouTube embed | Paid pass ($5+), ads | Easy mode (no caps, no punctuation, accents optional), pauses after 8 words behind, 0.5x speed, "loop a line", weak-letter heatmap, songs rated by WPM needed |
| **TypingTube** (typing-tube.net) | Curated, community-timed | YouTube music videos | Free, account for rankings | Huge catalog (46k songs), keys-per-second, combo, 5 difficulty levels |
| **typetown** (type.roncodes.in) | **LRCLIB** | YouTube audio, Apple Music charts | Free | A caret shows where the singer is. Hook mode (just the chorus, ~30 s). Speed presets 0.75x / 0.9x / 1x |
| **LyricsType** (lyricstype.com) | Curated | Song clips | Free | Multiplayer |
| **KaraokeType** | Curated | YouTube | Free, credits | Recommended WPM per song, sorted by difficulty |
| **TypingMania NEO** (open source, GitHub) | Hand-timed CSV | Local audio/video or YouTube | Free | Tab skips a line, two progress bars (song and line), keyboard-only control |
| **TypeTheLyrics** (open source) | Spotify lyrics endpoint | Spotify | Free | Lowercase and no-punctuation filters, raw WPM |
| **LyricHero** (open source, Vue + Vite) | Hardcoded | Audio | Demo | One line at a time, with a hard deadline at the next line |

**Patterns every good one has:** an easy mode on by default, a line progress bar, results showing WPM and accuracy, and keyboard-only control.
**Where they fall short:** closed catalogs (you can't type a song that isn't listed), paywalls on full songs, sign-ups, and heavy pages.

**The gap Typelist fills:** any song in LRCLIB (millions of synced tracks), no account, no paywall, no server, and one small static bundle.

---

## 3. Free building blocks

### 3.1 Synced lyrics: LRCLIB (main source)

- `https://lrclib.net/api`. **Free, no key, `Access-Control-Allow-Origin: *`**, so it can be called straight from the browser.
- Endpoints:
  - `GET /api/search?q=<text>`: full records, lyrics included. Heavy: about 300 KB for 20 results.
  - `GET /api/v2/search?q=<text>` (beta): metadata only, plus the flags `hasSyncedLyrics`, `hasWordSync`, `duration`. Up to 20 results. **Use this for the result list.**
  - `GET /api/get/<id>`: one full record. **Use this after the user picks a song.**
  - `GET /api/get?artist_name=&track_name=&album_name=&duration=`: exact match. Duration is matched within ±2 s.
- Record fields: `syncedLyrics` (LRC: `[mm:ss.xx] line`), `plainLyrics`, `instrumental`, `duration`, `hasWordSync` (word-level timings inside the `lyricsfile` YAML).
- Rate limits are per IP: about 45/min for anonymous clients and about 90/min for identified ones. Browsers can't set `User-Agent`, so send **`Lrclib-Client: <app-name>`** instead. A 429 response includes `Retry-After`; wait that long plus some jitter.
- Calling it from the browser means each visitor uses their own quota. Do not route it through a shared proxy, which would pool every visitor onto one IP.

### 3.2 Fallback lyrics sources

| API | Key | Synced | CORS | Notes |
|---|---|---|---|---|
| Megalobiz (`api.megalobiz.com/api/public/v1`) | Optional | Yes, LRC | Yes | 30/min and 1,000/day without a key. Send `duration` to get the right version |
| lyrics.ovh | None | No | Yes | Plain lyrics only |
| Better Lyrics API | None | Syllable-level TTML | Yes | Built for a YouTube Music extension. Rate-limited, upstream unstable |
| Genius API | Token | No | Partial | Returns metadata and annotations, not full lyrics |
| Musixmatch | Paid | From the paid "Grow" tier | No | Not free |

### 3.3 Playback: YouTube IFrame Player API

- `https://www.youtube.com/iframe_api`. **No key.** Gives you `new YT.Player`, `playVideo`, `pauseVideo`, `seekTo`, `getCurrentTime`, `setPlaybackRate`, and `onStateChange` / `onError`.
- **YouTube Music uses the same video IDs**: `music.youtube.com/watch?v=ID` plays in the normal embed.
- Errors to handle:
  - `101` / `150`: the owner blocked embedding. Common on official VEVO videos. Tell the user and ask for another link.
  - `100`: the video was removed or is private.
  - `153`: no Referer header. Serve the page from http(s), not `file://`.
- Sound needs a user gesture, so start playback from a click or a key press.
- `getCurrentTime()` updates in steps of roughly 250 ms. Interpolate it with `performance.now()` while the state is PLAYING to get smooth timing.
- "Artist - Topic" uploads (YouTube Music's auto-generated album audio) usually match LRC timings best, because the lyrics were timed against the album audio. Music videos often have intros that shift the timing.

### 3.4 Finding the track without an API key (the Metrolist approach)

Metrolist (an open-source YouTube Music client for Android) never uses the YouTube Data API. It talks to **InnerTube**, the private JSON API that the music.youtube.com website itself calls:

```http
POST https://music.youtube.com/youtubei/v1/search?prettyPrint=false
Content-Type: application/json

{ "context": { "client": { "clientName": "WEB_REMIX", "clientVersion": "1.YYYYMMDD.01.00", "hl": "en", "gl": "US" } },
  "query": "mr brightside",
  "params": "EgWKAQIIAWoKEAkQBRAKEAMQBA==" }
```

- `params` is a search filter. Metrolist's `FILTER_SONG` = `EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D`. `FILTER_VIDEO` = `EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D`.
- Results are in `contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[].musicShelfRenderer.contents[].musicResponsiveListItemRenderer`:
  - `flexColumns[0]` holds the title.
  - `flexColumns[1]` holds `artist • album • m:ss`.
  - `playlistItemData.videoId` holds the video ID.
  - `thumbnail.musicThumbnailRenderer` holds the cover (swap `=w60-h60` for a bigger size).
- **"Songs" results are the album audio ("Topic" uploads).** They are the same recordings that LRCLIB lyrics were timed against, so the timing lines up without an offset.
- **No key and no quota.** But music.youtube.com sends no CORS headers, so a browser can't call it. One small server hop is required:
  - in development: Vite middleware (`vite.config.ts`, it serves `/api/search`)
  - in production: one serverless function (`api/search.ts`, Vercel's format, using the Web-standard `Request`/`Response`). A 10-minute in-memory cache cuts repeat calls.
- **Risks:** InnerTube is undocumented and can change, and YouTube can throttle a datacenter IP. Typelist falls back to LRCLIB search plus a pasted link (or no video) when `/api/search` fails.

Lyrics lookup follows Metrolist's LRCLIB provider:
1. `GET /api/get` with title, artist, album, and duration (an exact match within ±2 s).
2. If there's no synced match, `GET /api/search?track_name=&artist_name=`, keeping the synced record whose duration is closest, within ±6 s.
3. If nothing is synced, use the plain lyrics: **untimed mode**, where the song plays and you type at your own pace.
4. Before the lookup, clean the titles: drop `(feat. …)`, `(Official Video)`, and `- Remastered 2011`, and keep only the first artist.

When an upload can't be embedded (YouTube errors 101/150/100/5), Typelist searches with `FILTER_VIDEO` and tries up to 4 other uploads, ordered by closest duration. Only after that does it fall back to "play it in your own player" mode.

Options considered and rejected:

| Option | Why not |
|---|---|
| YouTube Data API v3 | Needs a key, and allows only 100 searches/day |
| Invidious / Piped instances | Public instances go down and get blocked often |
| Pasting a link as the main flow | Extra work for the user |

### 3.5 No-video mode

Lyrics on an internal clock. The user plays the song anywhere (Spotify, Apple Music, a vinyl) and starts the clock on the first line. A sync offset of ±100 ms per keypress fixes any drift.

---

## 4. Typing engine design

**Text normalization (Easy mode, on by default)**
- Lowercase. Strip diacritics (`NFD` then remove `\p{M}`). Drop apostrophes (`it's` becomes `its`). Other punctuation becomes a space. Collapse spaces.
- Strict mode compares the exact characters, including case and punctuation.

**Line model**
- LRC gives start times. A line ends where the next one starts.
- Empty LRC lines are instrumental breaks. They aren't typed, and they show a "break" indicator.
- The active line is the last one whose start time is at or before `now + offset`.
- Typing goes into one hidden `<input>`. Its value *is* the typed text for the line. That gives backspace, IME, and mobile keyboards for free.
- A line completes when the typed text equals the target. You can't type a line before it starts. When the line changes, the leftover characters count as missed.

**Metrics**
- WPM = (correct characters / 5) / minutes of song time spent on lyric lines.
- Accuracy = correct keystrokes / all keystrokes, counted per keystroke so that fixing an error doesn't erase it.
- Completion = characters typed correctly / total characters.
- Per-line result: perfect, partial, or missed.

**Controls**
- `Esc` pauses or resumes. `[` / `]` shift the sync offset by 100 ms. `Tab` skips a line. `Ctrl+Enter` restarts.

---

## 5. Stack decisions

| Need | Choice | Why |
|---|---|---|
| Build | **Vite + vanilla TypeScript** | No framework runtime. The app's code is about 10 KB gzipped |
| Song search | **InnerTube WEB_REMIX** through `/api/search` | No key, the real YouTube Music catalog, album audio |
| Lyrics | **LRCLIB**, called from the browser | No key, CORS enabled, each visitor uses their own rate limit |
| Playback | **YouTube IFrame API** | Official embed, no key |
| Icons | **`lucide`** (vanilla build) | Tree-shaken, consistent 24px grid |
| Fonts | Instrument Sans (UI) and JetBrains Mono (lyrics), self-hosted with `@fontsource-variable` | No Google Fonts request. Mono keeps the caret and the per-character colors aligned |
| Theme | Light by default, dark, or follow the system | Toggle in the header, full choice in Settings, saved in `localStorage` |
| State | Module variables + `localStorage` (settings, best scores, last 5 songs) | Too small an app to need a store |
| Hosting | **Vercel** (zero config: Vite build + `api/` functions) | Free tier. Any static host also works, with the LRCLIB-only fallback |

**Files**
```
index.html
vite.config.ts     dev/preview middleware for /api/search
api/search.ts      InnerTube search + parser + cache, and the Vercel function
src/main.ts        screens, typing engine, game loop
src/lyrics.ts      search client, LRCLIB matching, LRC parser, normalizer
src/player.ts      YouTube embed clock + internal clock
src/style.css      light/dark tokens + layout
```

---

## 6. Legal and ethical notes

- Lyrics are copyrighted. LRCLIB is community-sourced, and the app shows lyrics one line at a time as typing material, never as a lyrics page. Credit LRCLIB in the UI.
- Audio and video stay on YouTube through the official embed, which preserves the rights holder's ads and view counts. Never download or proxy the audio.
- The `/api/search` function only forwards the search text to YouTube Music and caches the results for 10 minutes. It stores nothing about the user. Best scores and recent songs stay in `localStorage`.

## 7. Future ideas (not built)

- Word-level timing from LRCLIB `lyricsfile` (`hasWordSync`) to add a typetown-style singer caret.
- Hook mode (type only the chorus) by finding the most repeated block of lines.
- Weak-key heatmap.
- Playback speed 0.75x / 0.9x through `setPlaybackRate` (the lyric clock scales automatically, because it reads the video's time).
- Share a run as a URL: `#/youtube-id`.
- Search suggestions while typing (InnerTube `music/get_search_suggestions`).
- More lyrics providers in Metrolist's order (BetterLyrics, KuGou) when LRCLIB has nothing.

## Sources

- Metrolist, InnerTube search and filters: https://github.com/MetrolistGroup/Metrolist/blob/main/innertube/src/main/kotlin/com/metrolist/innertube/YouTube.kt
- Metrolist, LRCLIB provider: https://github.com/MetrolistGroup/Metrolist/blob/main/app/src/main/kotlin/com/metrolist/music/lyrics/LrcLibLyricsProvider.kt

- LRCLIB API docs: https://lrclib.net/docs
- LRCLIB CORS and rate-limit test: https://cors.dev/guides/free-lyrics-api
- YouTube IFrame API reference: https://developers.google.com/youtube/iframe_api_reference
- YouTube Data API quota: https://developers.google.com/youtube/data/getting-started
- SongTyping FAQ: https://www.songtyping.com/faq
- typetown: https://type.roncodes.in/typing-games
- TypingTube: https://typing-tube.net/lp/en
- TypingMania NEO: https://github.com/innocenat/typingmania
- TypeTheLyrics: https://github.com/ArjunCodess/typethelyrics
- LyricHero: https://github.com/AaronFlore/LyricHero
- Megalobiz API: https://megalobiz.com/developers
- Better Lyrics API: https://github.com/better-lyrics/api
