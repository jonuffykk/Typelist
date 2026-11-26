import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/jetbrains-mono'
import './style.css'
import {
  createIcons, ArrowLeft, AudioLines, Check, CircleAlert, Clock3, Keyboard, Link, LoaderCircle, Moon, Music,
  Play, RotateCcw, Search, Settings2, Sun, X,
} from 'lucide'
import {
  findLyrics, findVideos, fmtTime, lyricsChoices, searchSongs, target, toLyrics,
  type Lyrics, type LyricsChoice, type SearchSource, type Track,
} from './lyrics'
import { internalClock, parseVideoId, youtubeClock, type Clock } from './player'
type Theme = 'light' | 'dark' | 'system'
const store = <T,>(key: string, fallback: T) => ({
  get: (): T => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null')
      return v === null ? fallback : Array.isArray(fallback) ? v : { ...fallback, ...v }
    } catch {
      return fallback
    }
  },
  set: (v: T) => localStorage.setItem(key, JSON.stringify(v)),
})
const settingsStore = store('typelist:settings', { easy: true, wait: false, offset: 0, theme: 'light' as Theme })
const bestsStore = store<Record<string, { wpm: number; acc: number }>>('typelist:bests', {})
const recentStore = store<Track[]>('typelist:recent', [])
let settings = settingsStore.get()
const songKey = (s: Track) => s.videoId || `lrclib:${s.lrclibId}`
const choiceCache = new Map<string, LyricsChoice[]>()

const media = matchMedia('(prefers-color-scheme: dark)')
function applyTheme() {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0e0f0c' : '#f6f5f0')
}
media.addEventListener('change', applyTheme)
applyTheme()
const app = document.querySelector<HTMLElement>('#app')!
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => app.querySelector<T>(sel)!
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`
const paint = () =>
  createIcons({
    icons: { ArrowLeft, AudioLines, Check, CircleAlert, Clock3, Keyboard, Link, LoaderCircle, Moon, Music, Play, RotateCcw, Search, Settings2, Sun, X },
    attrs: { 'stroke-width': 1.75 },
  })
const cover = (s: Track, cls = 'cover') =>
  s.thumb
    ? `<img class="${cls}" src="${esc(s.thumb)}" data-fallback="${s.videoId ? `https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg` : ''}" alt="" referrerpolicy="no-referrer" decoding="async" />`
    : `<span class="${cls} blank">${icon('music')}</span>`
document.addEventListener(
  'error',
  (e) => {
    const img = e.target as HTMLImageElement
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('cover')) return
    const next = img.dataset.fallback
    img.dataset.fallback = ''
    if (next) img.src = next
    else img.replaceWith(Object.assign(document.createElement('span'), { className: `${img.className} blank` }))
  },
  true,
)

let cleanup: (() => void) | null = null
function view(html: string) {
  cleanup?.()
  cleanup = null
  app.innerHTML = html
  paint()
  window.scrollTo(0, 0)
}

const isDark = () => document.documentElement.dataset.theme === 'dark'
const header = (back = false) => `
  <header class="top">
    ${back ? `<button class="icon-btn" data-act="home" aria-label="Back to search">${icon('arrow-left')}</button>` : ''}
    <a class="mark" href="#" data-act="home">type<span>list</span></a>
    <button class="icon-btn" data-act="theme" aria-label="Switch to ${isDark() ? 'light' : 'dark'} theme">${icon(isDark() ? 'sun' : 'moon')}</button>
    <button class="icon-btn" data-act="settings" aria-label="Settings">${icon('settings-2')}</button>
  </header>`

app.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')
  const act = el?.dataset.act
  if (act === 'home') (e.preventDefault(), home())
  if (act === 'settings') openSettings()
  if (act === 'theme') {
    settings.theme = isDark() ? 'light' : 'dark'
    settingsStore.set(settings)
    applyTheme()
    el!.outerHTML = `<button class="icon-btn" data-act="theme" aria-label="Switch to ${isDark() ? 'light' : 'dark'} theme">${icon(isDark() ? 'sun' : 'moon')}</button>`
    paint()
    app.querySelector<HTMLInputElement>('.sink')?.focus({ preventScroll: true })
  }
})
const SUGGESTIONS = ['Yellow Coldplay', 'Hello Adele', 'Get Lucky', 'Birds of a Feather', 'Mr. Brightside', 'Bohemian Rhapsody']
let lastQuery = ''
let lastResults: Track[] = []
let lastSource: SearchSource = 'ytm'

function home() {
  view(`${header()}
  <main class="home">
    <h1>Type the lyrics of any song while it plays.</h1>
    <p class="lede">Search a song. Typelist finds its synced lyrics and the track on YouTube Music, then you type along.</p>
    <form class="search" role="search">
      ${icon('search')}
      <input name="q" type="search" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="Song or artist" value="${esc(lastQuery)}" aria-label="Search songs" />
      <kbd>/</kbd>
    </form>
    <div class="results" aria-live="polite"></div>
  </main>`)

  const input = $<HTMLInputElement>('input[name=q]')
  const results = $('.results')
  let timer = 0
  let ctrl: AbortController | null = null
  let shown: Track[] = []

  const row = (s: Track, i: number) => {
    const best = bestsStore.get()[songKey(s)]
    return `<li><button class="row" data-i="${i}">
      ${cover(s)}
      <span class="row-main"><strong>${esc(s.title)}</strong><span class="muted">${esc([s.artist, s.album].filter(Boolean).join(' · '))}</span></span>
      ${best ? `<span class="best">${best.wpm} wpm</span>` : ''}
      <span class="row-end muted num">${s.duration ? fmtTime(s.duration) : ''}</span>
    </button></li>`
  }
  const renderList = (list: Track[], title = '') => {
    shown = list
    results.innerHTML = `${title}${
      list.length ? `<ul class="list">${list.map(row).join('')}</ul>` : `<p class="muted empty">Nothing found. Try the song title with the artist.</p>`
    }${lastSource === 'lrclib' && !title ? `<p class="muted small note">${icon('circle-alert')} YouTube Music search isn't reachable here, so these results come from LRCLIB and play without video.</p>` : ''}`
    paint()
  }
  const idle = () => {
    const recent = recentStore.get()
    shown = recent
    results.innerHTML = `${
      recent.length ? `<h2 class="label">Recently typed</h2><ul class="list">${recent.map(row).join('')}</ul>` : ''
    }<h2 class="label">Try one of these</h2>
      <div class="chips">${SUGGESTIONS.map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`
    paint()
  }
  const run = async (q: string) => {
    lastQuery = q
    ctrl?.abort()
    if (q.trim().length < 2) return idle()
    ctrl = new AbortController()
    results.innerHTML = `<p class="muted loading">${icon('loader-circle')} Searching</p>`
    paint()
    try {
      const r = await searchSongs(q, ctrl.signal)
      lastResults = r.songs
      lastSource = r.source
      renderList(lastResults)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') results.innerHTML = `<p class="error">${esc((err as Error).message)}</p>`
    }
  }

  async function open(btn: HTMLButtonElement, song: Track) {
    if (btn.getAttribute('aria-busy')) return
    btn.setAttribute('aria-busy', 'true')
    const end = btn.querySelector('.row-end')!
    const was = end.innerHTML
    end.innerHTML = `${icon('loader-circle')} Finding lyrics`
    paint()
    try {
      const lyrics = await findLyrics(song)
      if (!btn.isConnected) return
      if (!lyrics) {
        end.innerHTML = 'No lyrics found'
        btn.classList.add('dead')
        return
      }
      recentStore.set([song, ...recentStore.get().filter((r) => songKey(r) !== songKey(song))].slice(0, 5))
      play(song, lyrics, !!song.videoId)
    } catch (err) {
      end.innerHTML = `<span class="error">${esc((err as Error).message)}</span>`
      setTimeout(() => btn.isConnected && ((end.innerHTML = was), btn.removeAttribute('aria-busy')), 4000)
    } finally {
      if (btn.isConnected && !btn.classList.contains('dead')) btn.removeAttribute('aria-busy')
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = window.setTimeout(() => run(input.value), 300)
  })
  $('form').addEventListener('submit', (e) => {
    e.preventDefault()
    clearTimeout(timer)
    run(input.value)
    input.blur()
  })
  results.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-q],[data-i]')
    if (!el) return
    if (el.dataset.q) (input.value = el.dataset.q), run(el.dataset.q)
    else open(el as HTMLButtonElement, shown[+el.dataset.i!])
  })
  const onSlash = (e: KeyboardEvent) => {
    if (e.key === '/' && document.activeElement !== input && !document.querySelector('dialog[open]')) {
      e.preventDefault()
      input.focus()
      input.select()
    }
  }
  window.addEventListener('keydown', onSlash)
  cleanup = () => window.removeEventListener('keydown', onSlash)

  if (lastQuery.trim().length >= 2 && lastResults.length) renderList(lastResults)
  else idle()
  input.focus()
  input.select()
}
interface LineState {
  typed: string
  correct: number
  errors: number
  done: boolean
  skipped: boolean
  from: number | null
  finishedAt: number | null
}

function play(song: Track, lyrics: Lyrics, withVideo: boolean) {
  const { timed, lines } = lyrics
  const tg = lines.map((l) => target(l.text, settings.easy))
  const st: LineState[] = lines.map((l) => ({ typed: '', correct: 0, errors: 0, done: false, skipped: false, from: timed ? l.start : null, finishedAt: null }))
  const typeable = tg.map((t, i) => (t ? i : -1)).filter((i) => i >= 0)
  let keys = 0
  let hits = 0
  let active = -1
  let cursor = -1
  let started = false
  let userPaused = false
  let waiting = false
  let finished = false
  let videoOn = withVideo && !!song.videoId

  view(`${header(true)}
  <main class="play">
    <aside class="media">
      <div class="frame"></div>
      <div class="meta">
        ${cover(song, 'cover sm')}
        <span><strong>${esc(song.title)}</strong><span class="muted">${esc(song.artist)}</span></span>
      </div>
      <div class="songbar"><i></i></div>
      <p class="muted small status"></p>
    </aside>
    <section class="stage">
      <div class="hud num">
        <span><b data-k="wpm">0</b> wpm</span>
        <span><b data-k="acc">100</b>% accuracy</span>
        <span><b data-k="line">0</b>/${typeable.length} lines</span>
        ${timed ? `<span class="muted">sync <b data-k="offset">${fmtOffset()}</b></span>` : ''}
      </div>
      <div class="lines">
        <p class="prev"></p>
        <p class="cur"></p>
        <p class="next"></p>
        <p class="next2"></p>
      </div>
      <div class="linebar"><i></i></div>
      <div class="overlay"></div>
      <p class="keys muted small">${icon('keyboard')}<span><kbd>Esc</kbd> pause</span><span><kbd>Tab</kbd> skip line</span>${
        timed ? '<span><kbd>[</kbd> <kbd>]</kbd> sync</span>' : ''
      }<span><kbd>Ctrl</kbd> <kbd>Enter</kbd> restart</span></p>
    </section>
    <input class="sink" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Type the current line" />
  </main>`)

  const sink = $<HTMLInputElement>('.sink')
  const overlay = $('.overlay')
  const frame = $('.frame')
  const statusEl = $('.status')
  const curEl = $('.cur')
  const lineBar = $('.linebar i')
  const songBar = $('.songbar i')
  const hud = (k: string) => app.querySelector(`[data-k=${k}]`)
  const focus = () => sink.focus({ preventScroll: true })
  const same = (a: string, b: string) => (settings.easy ? a.toLowerCase() === b.toLowerCase() : a === b)
  const say = (html: string) => ((statusEl.innerHTML = html), paint())
  let clock: Clock | null = null
  let clockTime: HTMLElement | null = null
  const tried = new Set<string>()
  let alternates: string[] | null = null
  const lyricTime = () => (clock ? clock.time() - (timed ? settings.offset / 1000 : 0) : 0)

  async function mountVideo(id: string) {
    tried.add(id)
    const resumeAt = started ? clock?.time() ?? 0 : 0
    clock?.destroy()
    clock = null
    frame.className = 'frame'
    frame.innerHTML = '<div></div>'
    const c = await youtubeClock(frame.firstElementChild as HTMLElement, id, {
      onEnded: () => finish(),
      onError: (msg, code) => recover(msg, code),
      onStateChange: () => {},
    })
    if (!frame.isConnected) return c.destroy()
    clock = c
    if (started) {
      clock.seek(resumeAt)
      if (!userPaused) clock.play()
    }
  }
  async function recover(msg: string, code: number) {
    if ([5, 100, 101, 150].includes(code) && tried.size < 5) {
      say(`${icon('loader-circle')} That upload can't play here. Trying another one.`)
      alternates ??= (await findVideos(song)).map((s) => s.videoId)
      const next = alternates.find((id) => !tried.has(id))
      if (next) {
        await mountVideo(next)
        return say('Playing another upload of this song. If the lyrics drift, nudge them with [ and ].')
      }
    }
    useOwnPlayer(`${msg} Play the song in any player and press Start at the same moment.`)
  }
  function useOwnPlayer(note = 'Play the song in any player and press Start at the same moment.') {
    const at = started ? clock?.time() ?? 0 : 0
    clock?.destroy()
    videoOn = false
    frame.className = 'frame clock'
    frame.innerHTML = `<span class="clock-time num">0:00</span>`
    clockTime = frame.querySelector('.clock-time')
    clock = internalClock(() => {})
    if (started) {
      clock.seek(at)
      if (!userPaused) clock.play()
    }
    say(note)
    renderOverlay()
  }

  const choices = () => choiceCache.get(songKey(song))
  function lyricsPicker() {
    const list = choices()
    if (!list) return `<p class="muted small loading">${icon('loader-circle')} Looking for other lyrics versions</p>`
    if (list.length < 2) return ''
    return `<label class="pick"><span>Lyrics version</span><select data-o="lyrics">${list
      .map((c) => `<option value="${c.id}" ${c.id === lyrics.id ? 'selected' : ''}>${esc(c.label)}</option>`)
      .join('')}</select></label>`
  }
  if (!choices()) {
    lyricsChoices(song, lyrics.id)
      .then((list) => choiceCache.set(songKey(song), list))
      .catch(() => choiceCache.set(songKey(song), []))
      .finally(() => frame.isConnected && renderOverlay())
  }

  function renderOverlay() {
    if (started) return
    overlay.innerHTML = `
      ${cover(song, 'cover lg')}
      <p class="o-title"><strong>${esc(song.title)}</strong><span class="muted">${esc(song.artist)}</span></p>
      <p class="badge">${timed ? `${icon('clock-3')} Synced lyrics · ${typeable.length} lines` : `${icon('keyboard')} Untimed lyrics · type at your own pace`}</p>
      ${lyricsPicker()}
      <button class="btn primary big" data-o="start">${icon('play')} Start</button>
      <p class="muted small">or press Enter</p>
      ${
        videoOn
          ? `<button class="btn ghost small" data-o="own">${icon('audio-lines')} Use my own player instead</button>`
          : `<label class="field link">${icon('link')}<input data-o="link" placeholder="Optional: paste a YouTube link" autocomplete="off" spellcheck="false" /></label>`
      }`
    paint()
  }

  overlay.addEventListener('click', (e) => {
    const o = (e.target as HTMLElement).closest<HTMLElement>('[data-o]')?.dataset.o
    if (o === 'start') begin()
    if (o === 'own') useOwnPlayer()
  })
  overlay.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement
    if (el.dataset.o !== 'lyrics') return
    const pick = choices()?.find((c) => c.id === +el.value)
    const next = pick && toLyrics(pick.record, song.duration)
    if (next) play(song, next, videoOn)
  })
  overlay.addEventListener('input', async (e) => {
    if ((e.target as HTMLElement).dataset.o !== 'link') return
    const id = parseVideoId((e.target as HTMLInputElement).value)
    if (!id) return
    videoOn = true
    await mountVideo(id)
    say('')
    renderOverlay()
  })
  function renderLines() {
    const at = (i: number) => (i >= 0 ? tg[i] ?? '' : '')
    $('.prev').textContent = at(cursor - 1)
    $('.next').textContent = at(cursor + 1)
    $('.next2').textContent = at(cursor + 2)
    curEl.classList.remove('enter', 'done')
    void curEl.offsetWidth
    curEl.classList.add('enter')
    if (!lines[cursor] || !tg[cursor]) {
      const label = cursor < 0 ? 'Intro' : cursor >= lines.length ? 'End' : 'Instrumental'
      curEl.innerHTML = `<span class="break">${icon('music')} ${label}</span>`
      return paint()
    }
    renderChars()
  }
  function renderChars() {
    const t = tg[cursor]
    if (!t) return
    const s = st[cursor]
    let html = ''
    for (let i = 0; i < t.length; i++) {
      const ch = t[i]
      const k = s.typed[i]
      const cls = k === undefined ? (i === s.typed.length ? 'c caret' : 'c') : same(k, ch) ? 'c ok' : `c bad${ch === ' ' ? ' sp' : ''}`
      html += `<span class="${cls}">${esc(ch)}</span>`
    }
    if (s.done) html += `<span class="tick">${icon('check')}</span>`
    curEl.innerHTML = html
    curEl.classList.toggle('done', s.done)
    if (s.done) paint()
  }
  const countCorrect = (i: number) => [...tg[i]].filter((ch, j) => st[i].typed[j] !== undefined && same(st[i].typed[j], ch)).length

  function setActive(i: number) {
    if (i === active) return
    if (active >= 0 && tg[active]) st[active].correct = countCorrect(active)
    active = i
    if (!timed && st[i]) st[i].from = lyricTime()
    moveCursor()
  }
  function cursorFor() {
    if (!timed) return active
    const cur = st[active]
    if (cur && tg[active] && !cur.done && !cur.skipped) return active
    const next = typeable.find((j) => j > active)
    if (next === undefined) return active
    const lead = cur?.done || cur?.skipped ? 8 : 2.5
    return lines[next].start - lyricTime() <= lead ? next : active
  }
  function moveCursor() {
    const c = cursorFor()
    if (c === cursor) return
    cursor = c
    sink.value = st[c]?.typed ?? ''
    renderLines()
  }
  function nextUntimed() {
    const next = typeable.find((j) => j > active)
    if (next === undefined) return finish()
    setActive(next)
  }

  sink.addEventListener('input', () => {
    const t = tg[cursor]
    const s = st[cursor]
    if (!started || !t || !s || s.done || userPaused) {
      sink.value = s?.typed ?? ''
      return
    }
    const v = sink.value.slice(0, t.length)
    for (let j = s.typed.length; j < v.length; j++) {
      keys++
      if (same(v[j], t[j])) hits++
      else s.errors++
    }
    s.typed = v
    sink.value = v
    if (timed && s.from !== null) s.from = Math.min(s.from, lyricTime())
    if (same(v, t)) {
      s.done = true
      s.finishedAt = lyricTime()
      s.correct = t.length
      if (waiting) {
        waiting = false
        clock?.play()
      }
      if (!timed) setTimeout(() => !finished && st[active] === s && nextUntimed(), 220)
      else setTimeout(() => !finished && moveCursor(), 220)
    }
    renderChars()
  })
  function begin() {
    if (started || !clock) return
    started = true
    overlay.hidden = true
    clock.play()
    if (!timed) setActive(typeable[0])
    focus()
  }
  function togglePause() {
    if (!started || finished || !clock) return
    userPaused = !userPaused
    if (userPaused) clock.pause()
    else if (!waiting) clock.play()
    app.classList.toggle('is-paused', userPaused)
    focus()
  }
  function skip() {
    if (!clock || !started) return
    if (st[cursor]) st[cursor].skipped = true
    if (!timed) return nextUntimed()
    const next = typeable.find((j) => j > cursor && lines[j].start > lyricTime() + 0.05)
    if (next === undefined) return finish()
    waiting = false
    clock.seek(lines[next].start + settings.offset / 1000 + 0.02)
    if (!userPaused) clock.play()
  }
  function nudge(ms: number) {
    if (!timed) return
    settings.offset += ms
    settingsStore.set(settings)
    const el = hud('offset')
    if (el) el.textContent = fmtOffset()
  }
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('dialog[open]')) return
    if ((e.target as HTMLElement).matches?.('[data-o=link], select')) return
    if (e.key === 'Enter' && e.ctrlKey) return e.preventDefault(), play(song, lyrics, withVideo)
    if (!started && e.key === 'Enter') return e.preventDefault(), begin()
    if (e.key === 'Escape') return e.preventDefault(), togglePause()
    if (e.key === 'Tab') return e.preventDefault(), skip()
    if (e.key === '[' || e.key === ']') return e.preventDefault(), nudge(e.key === ']' ? 100 : -100)
    if (started && document.activeElement !== sink && e.key.length === 1) focus()
  }
  window.addEventListener('keydown', onKey)
  $('.stage').addEventListener('click', (e) => started && !(e.target as HTMLElement).closest('.overlay') && focus())
  function stats(now: number) {
    let chars = 0
    let secs = 0
    for (const i of typeable) {
      const s = st[i]
      if (s.from === null || s.from > now) continue
      const correct = i === active || i === cursor ? countCorrect(i) : s.correct
      if (s.skipped && !correct) continue
      chars += correct
      const end = s.finishedAt ?? (timed ? Math.min(now, lines[i].end) : i === active ? now : s.from)
      secs += Math.max(0, end - s.from)
    }
    return { wpm: secs > 2 ? Math.round(chars / 5 / (secs / 60)) : 0, acc: keys ? Math.round((hits / keys) * 100) : 100 }
  }
  let raf = 0
  let frameN = 0
  const loop = () => {
    raf = requestAnimationFrame(loop)
    if (!clock || finished) return
    const now = lyricTime()
    if (clockTime) clockTime.textContent = fmtTime(Math.max(0, clock.time()))
    if (song.duration) songBar.style.transform = `scaleX(${Math.min(1, Math.max(0, clock.time() / song.duration))})`

    if (timed) {
      let i = -1
      while (i + 1 < lines.length && lines[i + 1].start <= now) i++
      const cur = st[active]
      if (settings.wait && started && tg[active] && cur && !cur.done && !cur.skipped && !userPaused && i > active) {
        if (!waiting) {
          waiting = true
          clock.pause()
        }
      } else setActive(i)
      moveCursor()
      const line = lines[active]
      lineBar.style.transform = `scaleX(${line ? Math.min(1, Math.max(0, (now - line.start) / (line.end - line.start))) : 0})`
      if (!videoOn && song.duration && now > song.duration + 1) finish()
    } else {
      const done = typeable.filter((j) => st[j].done || st[j].skipped).length
      lineBar.style.transform = `scaleX(${done / typeable.length})`
    }
    if (++frameN % 10 === 0) {
      const s = stats(now)
      hud('wpm')!.textContent = String(s.wpm)
      hud('acc')!.textContent = String(s.acc)
      hud('line')!.textContent = String(typeable.filter((j) => st[j].done).length)
    }
  }

  function finish() {
    if (finished) return
    finished = true
    for (const i of [active, cursor]) if (i >= 0 && tg[i]) st[i].correct = countCorrect(i)
    const now = lyricTime()
    const s = stats(timed ? Math.max(now, lines.at(-1)?.end ?? now) : now)
    const total = typeable.reduce((n, i) => n + tg[i].length, 0)
    const correct = typeable.reduce((n, i) => n + st[i].correct, 0)
    results(song, lyrics, withVideo, {
      ...s,
      completion: total ? Math.round((correct / total) * 100) : 0,
      perfect: typeable.filter((i) => st[i].done && !st[i].errors).length,
      missed: typeable.filter((i) => (st[i].from ?? Infinity) <= now && st[i].correct === 0).length,
      lines: typeable.length,
    })
  }

  cleanup = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('keydown', onKey)
    app.classList.remove('is-paused')
    clock?.destroy()
    frame.innerHTML = ''
  }

  renderLines()
  if (videoOn) {
    frame.innerHTML = `<span class="muted small loading">${icon('loader-circle')} Loading video</span>`
    paint()
    mountVideo(song.videoId).then(() => !started && renderOverlay())
  } else useOwnPlayer(song.videoId ? undefined : 'No video for this result. Play the song anywhere, or paste a YouTube link.')
  renderOverlay()
  raf = requestAnimationFrame(loop)
}

const fmtOffset = () => `${settings.offset > 0 ? '+' : ''}${settings.offset}ms`
interface Result { wpm: number; acc: number; completion: number; perfect: number; missed: number; lines: number }

function results(song: Track, lyrics: Lyrics, withVideo: boolean, r: Result) {
  const bests = bestsStore.get()
  const prev = bests[songKey(song)]
  const isBest = r.wpm > 0 && (!prev || r.wpm > prev.wpm)
  if (isBest) bestsStore.set({ ...bests, [songKey(song)]: { wpm: r.wpm, acc: r.acc } })
  const note = !prev
    ? r.wpm > 0 ? 'First run on this song' : 'Type a few lines to set a score'
    : isBest ? `New best, up from ${prev.wpm} wpm` : `Your best is ${prev.wpm} wpm`

  view(`${header(true)}
  <main class="results-view">
    <div class="r-head">${cover(song, 'cover md')}<div><h2>${esc(song.title)}</h2><p class="muted">${esc(song.artist)}</p></div></div>
    <div class="score">
      <div class="big num">${r.wpm}<span>wpm</span></div>
      <p class="${isBest ? 'accent' : 'muted'}">${note}</p>
    </div>
    <dl class="grid num">
      <div><dt>Accuracy</dt><dd>${r.acc}%</dd></div>
      <div><dt>Lyrics typed</dt><dd>${r.completion}%</dd></div>
      <div><dt>Perfect lines</dt><dd>${r.perfect}<small>/${r.lines}</small></dd></div>
      <div><dt>Missed lines</dt><dd>${r.missed}</dd></div>
    </dl>
    <div class="actions">
      <button class="btn primary" data-go="again">${icon('rotate-ccw')} Play again</button>
      <button class="btn" data-act="home">${icon('search')} Another song</button>
    </div>
    <p class="muted small credit">Lyrics from LRCLIB. Music from YouTube Music.</p>
  </main>`)
  $('[data-go=again]').addEventListener('click', () => play(song, lyrics, withVideo))
  const onKey = (e: KeyboardEvent) => e.key === 'Enter' && !document.querySelector('dialog[open]') && play(song, lyrics, withVideo)
  window.addEventListener('keydown', onKey)
  cleanup = () => window.removeEventListener('keydown', onKey)
}
function openSettings() {
  document.querySelector('dialog')?.remove()
  const d = document.createElement('dialog')
  d.className = 'settings'
  const themeOpt = (v: Theme, label: string) =>
    `<label><input type="radio" name="theme" value="${v}" ${settings.theme === v ? 'checked' : ''}/><span>${label}</span></label>`
  d.innerHTML = `
    <form method="dialog">
      <header><h3>Settings</h3><button class="icon-btn" value="close" aria-label="Close">${icon('x')}</button></header>
      <div class="stack"><strong>Theme</strong><div class="segmented">${themeOpt('light', 'Light')}${themeOpt('dark', 'Dark')}${themeOpt('system', 'System')}</div></div>
      <label class="toggle"><input type="checkbox" name="easy" ${settings.easy ? 'checked' : ''}/><span><strong>Easy mode</strong><small>Lowercase, no punctuation, accents optional. Applies from the next song.</small></span></label>
      <label class="toggle"><input type="checkbox" name="wait" ${settings.wait ? 'checked' : ''}/><span><strong>Wait for me</strong><small>Pause the song at the end of a line you haven't finished</small></span></label>
      <label class="stack"><strong>Lyrics sync offset (ms)</strong><small>Positive values show lyrics later. While playing: <kbd>[</kbd> and <kbd>]</kbd></small>
        <input type="number" name="offset" step="50" value="${settings.offset}" /></label>
      <footer><button class="btn primary" value="save">Save</button></footer>
    </form>`
  document.body.append(d)
  paint()
  d.querySelector('.segmented')!.addEventListener('change', (e) => {
    settings.theme = (e.target as HTMLInputElement).value as Theme
    applyTheme()
  })
  const before = { ...settings }
  d.addEventListener('close', () => {
    if (d.returnValue === 'save') {
      const f = new FormData(d.querySelector('form')!)
      settings = { easy: f.has('easy'), wait: f.has('wait'), offset: Number(f.get('offset')) || 0, theme: (f.get('theme') as Theme) ?? 'light' }
    } else settings = before
    settingsStore.set(settings)
    applyTheme()
    const off = app.querySelector('[data-k=offset]')
    if (off) off.textContent = fmtOffset()
    const t = app.querySelector('[data-act=theme]')
    if (t) (t.outerHTML = `<button class="icon-btn" data-act="theme" aria-label="Switch to ${isDark() ? 'light' : 'dark'} theme">${icon(isDark() ? 'sun' : 'moon')}</button>`), paint()
    d.remove()
  })
  d.showModal()
}

home()
