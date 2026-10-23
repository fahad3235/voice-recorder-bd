# Voice Recorder BD

Offline bilingual (EN/বাংলা) voice recorder with a built-in audio trimmer. Record voice notes, rename and manage them, trim any recording on a waveform, and export or save trimmed copies as WAV — 100% offline, everything stays on the device.

## Features

1. **One-tap recording** — big record button, live timer, real-time level meter; pause via Stop.
2. **Recording library** — recordings persist in IndexedDB (name, duration, size, date), with inline playback, rename, two-step delete.
3. **Waveform trimmer** — decodes the recording locally, renders a peak waveform, drag start/end handles or type exact seconds, play the selection before committing.
4. **WAV export** — exports the trimmed selection as 16-bit PCM WAV (correct RIFF header), or saves the trimmed copy back into the library.
5. **Bilingual UI** — EN/বাংলা toggle persisted in localStorage, Bengali digits in the BN locale.
6. **Offline & private** — zero network requests; microphone permission handled with clear error states (denied / no mic / unsupported browser).

## Stack

- Vanilla HTML/CSS/JS, no dependencies, no build step
- Web APIs: MediaRecorder, getUserMedia, Web Audio (decodeAudioData, AnalyserNode), IndexedDB, Canvas

## Run locally

```bash
# any static server; file:// also works
npx serve .
# or
python3 -m http.server 8000
```

Open `http://localhost:8000`. Microphone access requires a secure context (localhost or HTTPS) in real browsers; `file://` works for local testing.

## Tests

```bash
node tests/unit.test.js    # 23 pure-logic tests (time/size formatting, trim clamping, WAV encoding, peaks, i18n)
node tests/smoke.cdp.js    # 25 headless-Chrome end-to-end checks (raw CDP, fake mic device):
                           # record -> stop -> rename -> trim -> WAV export -> save copy ->
                           # reload persistence -> delete -> 390px mobile -> zero console/network errors
```

See `tests/TEST_RESULTS.md` for the verified results of this build.

## Project structure

```
index.html        # UI shell (Bengali via numeric entities)
css/style.css     # dark theme, responsive
js/audio-core.js  # pure helpers: fmtTime, fmtBytes, clampTrim, computePeaks, encodeWav, sliceChannels (node-testable)
js/i18n.js        # EN/বাংলা strings (generated; Bengali as \uXXXX escapes, pure-ASCII source)
js/app.js         # recorder, IndexedDB library, trimmer, UI wiring
tests/            # unit + headless-Chrome smoke tests
```

## Limitations

- Playback/download of the *original* recording uses the browser's MediaRecorder container (usually WebM/Opus); only trimmed exports are normalized to WAV.
- Trim decode requires the browser to decode the recorded container (Chrome/Edge/Firefox fine).
- This is a personal voice-note tool, not a professional studio / legal-evidence recorder.

## Status

Built 2026-10-23 (factory run #116). 23/23 unit + 25/25 smoke green, 0 console/page errors, 0 network requests.
