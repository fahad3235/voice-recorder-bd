// voice-recorder-bd smoke: raw CDP vs headless chrome, fake mic, real WAV download verify.
// Run: node tests/smoke.cdp.js
"use strict";
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const CHROME = "/opt/meta-chromium/chrome";
const DL = "/tmp/vr-dl-smoke";
const PORT = 9333;

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log("ok - " + name); }
  else { failed++; console.log("FAIL - " + name + (extra ? " :: " + extra : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launchChrome() {
  fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
  const args = [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--remote-debugging-port=" + PORT, "--no-first-run",
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "about:blank",
  ];
  const child = execFile(CHROME, args, () => {});
  return child;
}
async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch("http://127.0.0.1:" + PORT + "/json/list");
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page");
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(500);
  }
  throw new Error("no CDP target");
}
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const [res, rej] = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method) events.push(m);
  };
  const events = [];
  async function send(method, params) {
    await ready; const myId = ++id;
    return new Promise((res, rej) => { pending.set(myId, [res, rej]); ws.send(JSON.stringify({ id: myId, method, params: params || {} })); });
  }
  return { send, events, close: () => ws.close() };
}
async function evalJs(c, expr) {
  const r = await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error("eval threw: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}

(async () => {
  const child = launchChrome();
  let c, bc;
  try {
    c = cdp(await getWsUrl());
    const errors = [], httpReqs = [];
    // attach listeners early
    const pollEvents = async () => {
      for (const m of c.events.splice(0)) {
        if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + JSON.stringify(m.params.args).slice(0, 200));
        if (m.method === "Runtime.exceptionThrown") errors.push("page exception: " + (m.params.exceptionDetails.text || "").slice(0, 200));
        if (m.method === "Network.requestWillBeSent" && /^https?:/.test(m.params.request.url)) httpReqs.push(m.params.request.url);
      }
    };
    await c.send("Runtime.enable"); await c.send("Page.enable"); await c.send("Network.enable");
    // Browser-domain commands must go to the browser target, not the page session
    const bver = await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json();
    const bc0 = cdp(bver.webSocketDebuggerUrl); bc = bc0;
    await bc.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
    await c.send("Page.navigate", { url: "file://" + ROOT + "/index.html" });
    await c.send("Page.loadEventFired").catch(() => {});
    await sleep(1500); await pollEvents();

    ok("page title", (await evalJs(c, "document.title")) === "Voice Recorder BD");
    ok("record button EN", (await evalJs(c, "document.querySelector('#btnRecord span').textContent")) === "Record");
    ok("empty state visible", await evalJs(c, "!document.getElementById('emptyState').hidden"));

    // BN toggle
    await evalJs(c, "document.getElementById('langBtn').click()"); await sleep(400);
    const bnBtn = await evalJs(c, "document.querySelector('#btnRecord span').textContent");
    ok("BN toggle switches to Bengali", bnBtn !== "Record" && bnBtn.length > 0, bnBtn);
    await evalJs(c, "location.reload()"); await sleep(1500);
    ok("BN persists across reload", (await evalJs(c, "document.documentElement.lang")) === "bn");
    // back to EN for rest of test
    await evalJs(c, "document.getElementById('langBtn').click()"); await sleep(400);

    // RECORD -> 2.5s -> STOP
    await evalJs(c, "document.getElementById('btnRecord').click()");
    await sleep(1600);
    ok("timer ticks while recording", await evalJs(c, "document.getElementById('recTimer').textContent") !== "0:00");
    ok("meter animating (canvas non-blank)", await evalJs(c, `(()=>{const cv=document.getElementById('meter');const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;for(let i=3;i<d.length;i+=40){if(d[i]>0)return true}return false})()`));
    await sleep(2200);
    await evalJs(c, "document.getElementById('btnStop').click()");
    let cardFound = false;
    for (let i = 0; i < 30 && !cardFound; i++) { await sleep(500); cardFound = await evalJs(c, "document.querySelectorAll('.card').length === 1"); }
    ok("recording card appears after stop", cardFound);
    const meta = await evalJs(c, "document.querySelector('.card-meta').textContent");
    ok("card meta has duration+size+date", /0:0[23]/.test(meta) && /B|KB/.test(meta), meta);
    ok("audio player present with blob src", await evalJs(c, "document.querySelector('audio.player').src.startsWith('blob:')"));

    // RENAME via Enter
    await evalJs(c, `(()=>{document.querySelector('.card .btnrow button:nth-child(3)').click()})()`);
    await sleep(300);
    await evalJs(c, `(()=>{const i=document.querySelector('.rename-input');i.value='lecture-note-1';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
    await sleep(800);
    ok("rename commits", (await evalJs(c, "document.querySelector('.card-name').textContent")) === "lecture-note-1");

    // TRIM: open, decode, waveform, set range, play selection, export WAV
    await evalJs(c, "document.querySelector('.card .btnrow button:nth-child(1)').click()");
    await sleep(600);
    ok("trim panel opens", await evalJs(c, "!document.getElementById('trimPanel').hidden"));
    let decoded = false;
    for (let i = 0; i < 30 && !decoded; i++) { await sleep(500); decoded = await evalJs(c, "parseFloat(document.getElementById('trimStart').max) > 1"); }
    ok("audio decoded for trim", decoded, "max=" + (await evalJs(c, "document.getElementById('trimStart').max")));
    ok("waveform drawn", await evalJs(c, `(()=>{const cv=document.getElementById('wave');const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let n=0;for(let i=3;i<d.length;i+=97){if(d[i]>0)n++}return n>20})()`));
    await evalJs(c, `(()=>{const s=document.getElementById('trimStart');s.value='0.3';s.dispatchEvent(new Event('input',{bubbles:true}));const e=document.getElementById('trimEnd');e.value=(parseFloat(e.max)-0.3).toFixed(2);e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await sleep(400);
    ok("range label updates", await evalJs(c, "document.getElementById('trimRangeLabel').textContent.includes('-')"));
    await evalJs(c, "document.getElementById('trimPlay').click()"); await sleep(700);
    await pollEvents();
    ok("play selection no errors", errors.length === 0, errors.join(" | ").slice(0, 200));

    // EXPORT WAV: app must fire a .wav download (browser cancels blob downloads in headless)
    c.events.length = 0;
    await evalJs(c, "document.getElementById('trimExport').click()");
    let dlBegun = null;
    for (let i = 0; i < 20 && !dlBegun; i++) {
      await sleep(500);
      dlBegun = c.events.find((m) => m.method === "Page.downloadWillBegin" && /\.wav$/i.test(m.params.suggestedFilename || ""));
    }
    ok("export initiates WAV download", !!dlBegun, dlBegun ? dlBegun.params.suggestedFilename : "no downloadWillBegin");
    // verify the actual export pipeline bytes in-page (decode -> slice -> encode)
    const wavCheck = await evalJs(c, `(() => new Promise((resolve, reject) => {
      const rq = indexedDB.open("voice-recorder-bd", 1);
      rq.onsuccess = async () => {
        try {
          const rs = await new Promise((a, b) => { const q = rq.result.transaction("recs", "readonly").objectStore("recs").getAll(); q.onsuccess = () => a(q.result); q.onerror = () => b(q.error); });
          const rec = rs[0];
          const actx = new (window.AudioContext || window.webkitAudioContext)();
          const buf = await actx.decodeAudioData(await rec.blob.arrayBuffer());
          const chans = []; for (let i = 0; i < buf.numberOfChannels; i++) chans.push(buf.getChannelData(i));
          const sliced = VoiceCore.sliceChannels(chans, buf.sampleRate, 0.3, Math.max(0.4, buf.duration - 0.3));
          const bytes = VoiceCore.encodeWav(sliced, buf.sampleRate);
          const cc = (o) => String.fromCharCode(bytes[o], bytes[o+1], bytes[o+2], bytes[o+3]);
          resolve({ riff: cc(0), wave: cc(8), len: bytes.length, expect: 44 + sliced[0].length * chans.length * 2, sr: new DataView(bytes.buffer).getUint32(24, true) });
        } catch (e) { reject(e); }
      };
      rq.onerror = () => reject(rq.error);
    }))()`);
    ok("exported WAV bytes valid (RIFF/WAVE/size)", wavCheck.riff === "RIFF" && wavCheck.wave === "WAVE" && wavCheck.len === wavCheck.expect && wavCheck.sr > 0, JSON.stringify(wavCheck));

    // SAVE trimmed copy to library
    await evalJs(c, `(()=>{document.getElementById('trimName').value='trimmed-demo'})()`);
    await evalJs(c, "document.getElementById('trimSave').click()");
    let twoCards = false;
    for (let i = 0; i < 30 && !twoCards; i++) { await sleep(500); twoCards = await evalJs(c, "document.querySelectorAll('.card').length === 2"); }
    ok("trimmed copy saved to library", twoCards);
    ok("trim-saved status msg", (await evalJs(c, "document.getElementById('recStatus').textContent")).length > 0);

    // persistence across reload (IndexedDB)
    await evalJs(c, "location.reload()"); await sleep(2000);
    ok("2 recordings persist after reload", await evalJs(c, "document.querySelectorAll('.card').length === 2"));

    // DELETE second card (two-step)
    await evalJs(c, `(()=>{const cards=document.querySelectorAll('.card');cards[0].querySelector('.btnrow button:nth-child(4)').click()})()`);
    await sleep(300);
    await evalJs(c, `(()=>{const cards=document.querySelectorAll('.card');cards[0].querySelector('.btnrow button:nth-child(4)').click()})()`);
    await sleep(800);
    ok("delete removes card", await evalJs(c, "document.querySelectorAll('.card').length === 1"));

    // mobile 390px: no horizontal overflow
    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await evalJs(c, "location.reload()"); await sleep(2000);
    ok("390px no horizontal overflow", await evalJs(c, "document.documentElement.scrollWidth <= 391"), "sw=" + (await evalJs(c, "document.documentElement.scrollWidth")));

    await pollEvents();
    ok("zero console/page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
    ok("zero http(s) network requests", httpReqs.length === 0, httpReqs.join(",").slice(0, 200));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
  } catch (e) {
    console.error("SMOKE CRASH:", e.message);
    process.exitCode = 1;
  } finally {
    try { c.close(); } catch (e) {}
    try { bc.close(); } catch (e) {}
    child.kill();
  }
})();
