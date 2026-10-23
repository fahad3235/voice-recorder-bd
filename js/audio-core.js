/* voice-recorder-bd: pure audio helpers (no DOM). Node-testable. */
(function (root) {
  "use strict";

  // seconds -> "m:ss" (floors sub-second)
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // bytes -> "12.3 KB" style
  function fmtBytes(n) {
    if (!isFinite(n) || n < 0) n = 0;
    if (n < 1024) return Math.round(n) + " B";
    var units = ["KB", "MB", "GB"], v = n / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (Math.round(v * 10) / 10) + " " + units[i];
  }

  // Clamp a trim range [start,end] into [0,dur]; returns {start,end,valid}
  function clampTrim(start, end, dur) {
    start = Number(start); end = Number(end); dur = Number(dur);
    if (!isFinite(dur) || dur <= 0) return { start: 0, end: 0, valid: false };
    if (!isFinite(start) || start < 0) start = 0;
    if (!isFinite(end) || end > dur) end = dur;
    if (start > dur) start = dur;
    if (end < 0) end = 0;
    if (start >= end) return { start: start, end: end, valid: false };
    return { start: start, end: end, valid: true };
  }

  // Min/max peaks per bucket from mono-ish float data. Returns [{min,max}].
  function computePeaks(data, buckets) {
    buckets = Math.max(1, Math.floor(buckets) || 1);
    var n = data.length, out = new Array(buckets), per = Math.max(1, Math.floor(n / buckets));
    for (var b = 0; b < buckets; b++) {
      var lo = b * per, hi = Math.min(n, lo + per), mn = 1, mx = -1, v;
      for (var i = lo; i < hi; i++) { v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      if (hi <= lo) { mn = 0; mx = 0; }
      out[b] = { min: mn, max: mx };
    }
    return out;
  }

  // Encode channel Float32Arrays -> 16-bit PCM WAV bytes (Uint8Array).
  function encodeWav(channels, sampleRate) {
    if (!channels.length) throw new Error("no channels");
    var n = channels[0].length, ch = channels.length, sr = Math.floor(sampleRate) || 44100;
    for (var c = 1; c < ch; c++) if (channels[c].length !== n) throw new Error("channel length mismatch");
    var dataBytes = n * ch * 2;
    var buf = new ArrayBuffer(44 + dataBytes);
    var v = new DataView(buf);
    function wstr(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    wstr(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); wstr(8, "WAVE");
    wstr(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, ch, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    wstr(36, "data"); v.setUint32(40, dataBytes, true);
    var off = 44;
    for (var i = 0; i < n; i++) {
      for (var cc = 0; cc < ch; cc++) {
        var s = Math.max(-1, Math.min(1, channels[cc][i]));
        v.setInt16(off, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
        off += 2;
      }
    }
    return new Uint8Array(buf);
  }

  // Slice channel arrays to [startSec,endSec]
  function sliceChannels(channels, sampleRate, startSec, endSec) {
    var a = Math.max(0, Math.floor(startSec * sampleRate));
    var b = Math.min(channels[0].length, Math.ceil(endSec * sampleRate));
    return channels.map(function (ch) { return ch.slice(a, b); });
  }

  function uid() {
    return "r" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  // Guess download extension for a recorded mime type
  function extForMime(mime) {
    mime = String(mime || "").toLowerCase();
    if (mime.indexOf("webm") >= 0) return "webm";
    if (mime.indexOf("ogg") >= 0 || mime.indexOf("opus") >= 0) return "ogg";
    if (mime.indexOf("mp4") >= 0) return "m4a";
    return "webm";
  }

  var api = { fmtTime: fmtTime, fmtBytes: fmtBytes, clampTrim: clampTrim,
    computePeaks: computePeaks, encodeWav: encodeWav, sliceChannels: sliceChannels,
    uid: uid, extForMime: extForMime };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.VoiceCore = api;
})(typeof self !== "undefined" ? self : this);
