# TEST_RESULTS — voice-recorder-bd (run #116, 2026-10-23)

## Unit tests — 23/23 PASS (`node tests/unit.test.js`)

- fmtTime: 0→"0:00", 65→"1:05", 125.9 floors→"2:05", negative/NaN→"0:00"
- fmtBytes: 500→"500 B", 2048→"2 KB", 1536→"1.5 KB", 5MiB→"5 MB"
- clampTrim: (1,5,10) valid; (-2,99,10)→(0,10); reversed/zero-duration → invalid
- computePeaks: sine extremes exact per bucket; empty-safe
- encodeWav: exact RIFF byte layout — chunk size, fmt, sampleRate, channels, data; 0.5→16384, -0.5→-16384, 1→32767, -1→-32768; stereo interleaves L/R correctly; rejects empty/mismatched channels
- sliceChannels: 1s..2s of 4s @8kHz → exactly 8000 samples, correct offset
- extForMime: webm/ogg/m4a/default mapping
- uid: unique, matches /^r[0-9a-z]+$/
- i18n: EN/BN key sets identical; no empty strings

## Headless-Chrome smoke — 25/25 PASS (`node tests/smoke.cdp.js`)

Real browser flow (raw CDP, /opt/meta-chromium/chrome --headless=new, --use-fake-device-for-media-stream + --use-fake-ui-for-media-stream, file://):

1. page title / EN record button / empty state visible
2. BN toggle renders Bengali, persists across reload (documentElement.lang == "bn")
3. Record → timer ticks, level-meter canvas animates
4. Stop → card appears; meta shows 0:02 duration + byte size + date; audio player with blob: src
5. Rename via Enter commits ("lecture-note-1")
6. Trim panel opens; decode completes (trimStart.max ≈ 2.4); waveform canvas drawn (>20 lit pixels)
7. Range handles update label; play selection → zero errors
8. Export WAV: Page.downloadWillBegin fires with *.wav suggestedFilename; in-page decode→slice→encode produces valid RIFF/WAVE bytes, exact expected length, sampleRate > 0
9. Save trimmed copy → 2nd card; status message shown
10. Reload → 2 recordings persist (IndexedDB)
11. Two-step delete removes card
12. 390px viewport: documentElement.scrollWidth <= 391
13. Zero console.error / page exceptions; zero http(s) network requests

## Repairs

- 2 test-side fixes (timer assertion raced sub-second floor; WAV download must be asserted via downloadWillBegin — this Chromium build cancels blob: downloads in headless; app byte path verified in-page instead). 0 app-logic bugs.

## Sources

All app sources pure ASCII (Bengali as \uXXXX escapes in js/i18n.js, numeric entities in index.html); verified with `grep -P '[^\x00-\x7F]'` = zero matches.
