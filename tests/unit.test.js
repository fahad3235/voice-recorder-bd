// voice-recorder-bd unit tests: node, no deps. Run: node tests/unit.test.js
"use strict";
var assert = require("assert");
var C = require("../js/audio-core.js");
var I18N = require("../js/i18n.js");
var n = 0;
function t(name, fn) { fn(); n++; console.log("ok - " + name); }

// fmtTime
t("fmtTime 0 -> 0:00", function () { assert.strictEqual(C.fmtTime(0), "0:00"); });
t("fmtTime 65 -> 1:05", function () { assert.strictEqual(C.fmtTime(65), "1:05"); });
t("fmtTime 125.9 floors -> 2:05", function () { assert.strictEqual(C.fmtTime(125.9), "2:05"); });
t("fmtTime negative/NaN -> 0:00", function () { assert.strictEqual(C.fmtTime(-3), "0:00"); assert.strictEqual(C.fmtTime(NaN), "0:00"); });

// fmtBytes
t("fmtBytes 500 -> 500 B", function () { assert.strictEqual(C.fmtBytes(500), "500 B"); });
t("fmtBytes 2048 -> 2 KB", function () { assert.strictEqual(C.fmtBytes(2048), "2 KB"); });
t("fmtBytes 1536 -> 1.5 KB", function () { assert.strictEqual(C.fmtBytes(1536), "1.5 KB"); });
t("fmtBytes 5MB", function () { assert.strictEqual(C.fmtBytes(5 * 1024 * 1024), "5 MB"); });

// clampTrim
t("clampTrim normal", function () { var r = C.clampTrim(1, 5, 10); assert.deepStrictEqual([r.start, r.end, r.valid], [1, 5, true]); });
t("clampTrim clamps to duration", function () { var r = C.clampTrim(-2, 99, 10); assert.deepStrictEqual([r.start, r.end, r.valid], [0, 10, true]); });
t("clampTrim invalid reversed", function () { var r = C.clampTrim(5, 5, 10); assert.strictEqual(r.valid, false); });
t("clampTrim invalid start>end", function () { var r = C.clampTrim(8, 2, 10); assert.strictEqual(r.valid, false); });
t("clampTrim zero duration invalid", function () { assert.strictEqual(C.clampTrim(0, 1, 0).valid, false); });

// computePeaks
t("computePeaks sine extremes", function () {
  var d = new Float32Array([0, 1, 0, -1, 0, 1, 0, -1]);
  var p = C.computePeaks(d, 2);
  assert.strictEqual(p.length, 2);
  assert.deepStrictEqual([p[0].min, p[0].max], [-1, 1]);
  assert.deepStrictEqual([p[1].min, p[1].max], [-1, 1]);
});
t("computePeaks empty-safe", function () { var p = C.computePeaks(new Float32Array(0), 4); assert.strictEqual(p.length, 4); });

// encodeWav: header + round-trip samples
t("encodeWav RIFF header + exact bytes", function () {
  var ch = new Float32Array([0, 0.5, -0.5, 1, -1]);
  var bytes = C.encodeWav([ch], 8000);
  assert.strictEqual(bytes.length, 44 + 5 * 2);
  function s(o, str) { for (var i = 0; i < str.length; i++) assert.strictEqual(bytes[o + i], str.charCodeAt(i)); }
  s(0, "RIFF"); s(8, "WAVE"); s(12, "fmt "); s(36, "data");
  var dv = new DataView(bytes.buffer);
  assert.strictEqual(dv.getUint32(24, true), 8000, "sampleRate");
  assert.strictEqual(dv.getUint16(22, true), 1, "channels");
  assert.strictEqual(dv.getUint32(4, true), 36 + 10, "chunk size");
  assert.strictEqual(dv.getInt16(44, true), 0);
  assert.strictEqual(dv.getInt16(46, true), 16384, "0.5 -> 16384");
  assert.strictEqual(dv.getInt16(48, true), -16384, "-0.5 -> -16384");
  assert.strictEqual(dv.getInt16(50, true), 32767, "1 -> 32767");
  assert.strictEqual(dv.getInt16(52, true), -32768, "-1 -> -32768");
});
t("encodeWav stereo interleaves", function () {
  var L = new Float32Array([0.25, 0.25]), R = new Float32Array([-0.25, -0.25]);
  var bytes = C.encodeWav([L, R], 44100);
  var dv = new DataView(bytes.buffer);
  assert.strictEqual(bytes.length, 44 + 8);
  assert.strictEqual(dv.getUint16(22, true), 2);
  assert.strictEqual(dv.getInt16(44, true), 8192);   // L0
  assert.strictEqual(dv.getInt16(46, true), -8192);  // R0
});
t("encodeWav rejects empty/mismatched", function () {
  assert.throws(function () { C.encodeWav([], 8000); });
  assert.throws(function () { C.encodeWav([new Float32Array(4), new Float32Array(2)], 8000); });
});

// sliceChannels
t("sliceChannels 1s..2s of 4s @8kHz", function () {
  var ch = new Float32Array(32000); for (var i = 0; i < 32000; i++) ch[i] = i / 32000;
  var s = C.sliceChannels([ch], 8000, 1, 2);
  assert.strictEqual(s[0].length, 8000);
  assert.strictEqual(s[0][0], 8000 / 32000);
});

// extForMime
t("extForMime mapping", function () {
  assert.strictEqual(C.extForMime("audio/webm;codecs=opus"), "webm");
  assert.strictEqual(C.extForMime("audio/ogg;codecs=opus"), "ogg");
  assert.strictEqual(C.extForMime("audio/mp4"), "m4a");
  assert.strictEqual(C.extForMime(""), "webm");
});

// uid
t("uid unique + shape", function () { var a = C.uid(), b = C.uid(); assert.notStrictEqual(a, b); assert.ok(/^r[0-9a-z]+$/.test(a)); });

// i18n completeness
t("i18n en/bn keys identical", function () {
  assert.deepStrictEqual(Object.keys(I18N.en).sort(), Object.keys(I18N.bn).sort());
});
t("i18n no empty strings", function () {
  ["en", "bn"].forEach(function (l) { Object.keys(I18N[l]).forEach(function (k) { assert.ok(I18N[l][k].length > 0, l + "." + k); }); });
});

console.log("\n" + n + "/" + n + " unit tests passed");
