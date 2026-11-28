# Typelist

Type the lyrics of any song while it plays. Search a song, and Typelist finds its synced lyrics on LRCLIB and the track on YouTube Music. You need no account and no API key.

## Features

- One search box. Results come from YouTube Music, with album audio first, so the lyric timing lines up.
- Synced lyrics from LRCLIB. You can pick another lyrics version before you start.
- Untimed mode for songs that only have plain lyrics.
- Easy mode (no capitals, punctuation or accents), "Wait for me", and a sync offset you change with `[` and `]`.
- If a video can't be embedded, Typelist tries other uploads. If none plays, you can use your own player.
- Light, dark or system theme. Best scores and recent songs are saved in your browser.

## Run it

Requires Node 20 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:5173. `npm run build` type-checks and builds `dist/`. `npm run preview` serves the build together with the search endpoint.

## Deploy

On Vercel, import the repository and keep the defaults. Vercel builds the Vite app and serves `api/search.ts` as a function.

Static-only hosts also work. Search then falls back to LRCLIB, and songs play without video unless you paste a YouTube link.

## Keys

| Key | Action |
|---|---|
| `Enter` | Start |
| `Esc` | Pause or resume |
| `Tab` | Skip the current line or intro |
| `[` `]` | Move lyrics 100 ms earlier or later |
| `Ctrl` `Enter` | Restart |
| `/` | Focus search |

## How it works

`api/search.ts` calls YouTube Music's InnerTube search with the `WEB_REMIX` client and the songs filter, the same approach as the Metrolist app. Browsers can't call it directly (no CORS), so it runs as a Vercel function at `/api/search`. In development, `vite.config.ts` serves the same handler. Lyrics come from LRCLIB straight from the browser. Playback uses the official YouTube IFrame Player API. [DOSSIER.md](DOSSIER.md) has the full research notes.

```
api/search.ts    InnerTube search, parser, cache and the Vercel function
src/main.ts      screens, typing engine, game loop
src/lyrics.ts    search client, lyrics matching, LRC parser
src/player.ts    YouTube player and internal clock
src/style.css    light and dark theme, layout
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Legal

Typelist is an independent project. It is not affiliated with, endorsed by, or sponsored by YouTube, Google, or LRCLIB.

- Lyrics belong to their authors and publishers. Typelist shows them one line at a time as typing practice and doesn't store or republish them.
- Music plays through the official YouTube embed. Typelist never downloads, records, or proxies audio or video.
- The search endpoint uses an undocumented YouTube Music interface. It may change or stop working, and using it may be subject to YouTube's Terms of Service. If you deploy Typelist, you're responsible for that use.
- Typelist collects no personal data. Settings and scores stay in your browser's `localStorage`.

Code is released under the [MIT License](LICENSE). Lucide icons are under the ISC license. Instrument Sans and JetBrains Mono are under the SIL Open Font License.
