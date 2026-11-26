# Contributing

Thanks for helping with Typelist.

## Setup

```sh
npm install
npm run dev
```

Before you open a pull request, run `npm run build`. It type-checks the project and builds it.

## Guidelines

- Keep the app small: vanilla TypeScript, no UI framework, and few dependencies.
- Code has no comments. Use clear names instead.
- UI text is in English.
- Keep text contrast at 4.5:1 or higher and touch targets at 44 px or larger, and respect `prefers-reduced-motion`.
- Don't add anything that downloads audio or video, stores lyrics, or needs an API key.
- Screenshots in the repo must not show copyrighted lyrics or album art. Use a public-domain song.

## Reporting bugs

Open an issue with the song, the browser, and what happened. If search broke, include the `/api/search` response. YouTube changes InnerTube now and then.
