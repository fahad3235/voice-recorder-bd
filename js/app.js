/* voice-recorder-bd app: recorder + IndexedDB library + trimmer. Pure-ASCII source; all user strings via VOICE_I18N. */
(function () {
  "use strict";
  var C = window.VoiceCore, T = function (k) { return (window.VOICE_I18N[State.lang] || {})[k] || window.VOICE_I18N.en[k] || k; };

  var BN = ["\u09E6", "\u09E7", "\u09E8", "\u09E9", "\u09EA", "\u09EB", "\u09EC", "\u09ED", "\u09EE", "\u09EF"];
  function bnDigits(s) { return State.lang === "bn" ? String(s).replace(/[0-9]/g, function (d) { return BN[+d]; }) : String(s); }

  var State = { lang: "en", rec: null, stream: null, mr: null, chunks: [], t0: 0, tick: 0, raf: 0, analyser: null, actx: null, playing: null, trimCtx: null };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  /* ---------- language ---------- */
  function applyLang() {
    document.querySelectorAll("[data-i18n]").forEach(function (n) { n.textContent = T(n.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (n) { n.setAttribute("placeholder", T(n.getAttribute("data-i18n-ph"))); });
    document.documentElement.lang = State.lang === "bn" ? "bn" : "en";
    $("langBtn").textContent = State.lang === "bn" ? "EN" : "\u09AC\u09BE\u0982\u09B2\u09BE";
    renderList(true);
  }
  function setLang(l) { State.lang = l; try { localStorage.setItem("vr-lang", l); } catch (e) {} applyLang(); }

  /* ---------- IndexedDB ---------- */
  var DB_NAME = "voice-recorder-bd", dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore("recs", { keyPath: "id" }); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
    return dbP;
  }
  function tx(mode) { return db().then(function (d) { return d.transaction("recs", mode).objectStore("recs"); }); }
  function putRec(r) { return tx("readwrite").then(function (s) { return new Promise(function (res, rej) { var q = s.put(r); q.onsuccess = function () { res(); }; q.onerror = function () { rej(q.error); }; }); }); }
  function delRec(id) { return tx("readwrite").then(function (s) { return new Promise(function (res, rej) { var q = s.delete(id); q.onsuccess = function () { res(); }; q.onerror = function () { rej(q.error); }; }); }); }
  function allRecs() { return tx("readonly").then(function (s) { return new Promise(function (res, rej) { var q = s.getAll(); q.onsuccess = function () { res((q.result || []).sort(function (a, b) { return b.createdAt - a.createdAt; })); }; q.onerror = function () { rej(q.error); }; }); }); }
  function getRec(id) { return tx("readonly").then(function (s) { return new Promise(function (res, rej) { var q = s.get(id); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); }; }); }); }

  /* ---------- recording ---------- */
  function setStatus(msg, isErr) { var s = $("recStatus"); s.textContent = msg || ""; s.classList.toggle("err", !!isErr); }
  function fmtClock(ms) { return C.fmtTime(ms / 1000); }

  function pickMime() {
    var cands = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"];
    for (var i = 0; i < cands.length; i++) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(cands[i])) return cands[i]; } catch (e) {} }
    return "";
  }

  function startLevelMeter() {
    var canvas = $("meter"), ctx = canvas.getContext("2d");
    function draw() {
      State.raf = requestAnimationFrame(draw);
      var a = new Uint8Array(State.analyser.fftSize);
      State.analyser.getByteTimeDomainData(a);
      var sum = 0; for (var i = 0; i < a.length; i++) { var v = (a[i] - 128) / 128; sum += v * v; }
      var rms = Math.sqrt(sum / a.length), w = Math.min(1, rms * 3);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#0d9488"; ctx.fillRect(0, 0, canvas.width * w, canvas.height);
    }
    draw();
  }

  function startRecording() {
    setStatus("", false);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setStatus(T("micUnsupported"), true); return; }
    if (!window.MediaRecorder) { setStatus(T("micUnsupported"), true); return; }
    $("btnRecord").disabled = true;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      State.stream = stream;
      try { State.actx = State.actx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
      if (State.actx) {
        var src = State.actx.createMediaStreamSource(stream);
        State.analyser = State.actx.createAnalyser(); State.analyser.fftSize = 1024;
        src.connect(State.analyser);
      }
      var mime = pickMime();
      var mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      State.mr = mr; State.mime = mr.mimeType || mime; State.chunks = [];
      mr.ondataavailable = function (e) { if (e.data && e.data.size) State.chunks.push(e.data); };
      mr.onstop = onRecStop;
      mr.start(250);
      State.rec = true; State.t0 = Date.now();
      $("btnRecord").classList.add("recording"); $("btnRecord").disabled = false;
      $("btnRecord").querySelector("span").textContent = T("stop");
      $("btnStop").hidden = false;
      startLevelMeter();
      State.tick = setInterval(function () { $("recTimer").textContent = bnDigits(fmtClock(Date.now() - State.t0)); }, 200);
      setStatus("");
    }).catch(function (err) {
      $("btnRecord").disabled = false;
      var name = err && err.name;
      setStatus(name === "NotAllowedError" || name === "SecurityError" ? T("micDenied") : T("micError"), true);
    });
  }

  function stopRecording() {
    if (!State.mr || State.mr.state === "inactive") return;
    clearInterval(State.tick); cancelAnimationFrame(State.raf);
    State.mr.stop();
  }

  function onRecStop() {
    var blob = new Blob(State.chunks, { type: State.mime || "audio/webm" });
    var dur = (Date.now() - State.t0) / 1000;
    stopTracks(); resetRecUI();
    var name = T("newRecording") + " " + bnDigits(fmtClock(dur * 1000));
    allRecs().then(function (rs) { return putRec({ id: C.uid(), name: name, blob: blob, mime: blob.type, size: blob.size, duration: dur, createdAt: Date.now() }); })
      .then(function () { renderList(); })
      .catch(function () { setStatus(T("micError"), true); });
  }

  function stopTracks() { if (State.stream) { State.stream.getTracks().forEach(function (t) { t.stop(); }); State.stream = null; } }
  function resetRecUI() {
    State.rec = null; State.mr = null;
    var c = $("meter").getContext("2d"); c.clearRect(0, 0, $("meter").width, $("meter").height);
    $("recTimer").textContent = bnDigits("0:00");
    $("btnRecord").classList.remove("recording");
    $("btnRecord").querySelector("span").textContent = T("record");
    $("btnStop").hidden = true;
  }

  /* ---------- library ---------- */
  function fmtDate(ts) { var d = new Date(ts); return d.toLocaleString(State.lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }

  function renderList(keepLang) {
    var wrap = $("recList"); wrap.innerHTML = "";
    allRecs().then(function (rs) {
      $("emptyState").hidden = rs.length > 0;
      rs.forEach(function (r) { wrap.appendChild(cardEl(r)); });
    });
  }

  function downloadBlob(blob, filename) {
    var a = el("a"); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  function cardEl(r) {
    var card = el("div", "card"); card.dataset.id = r.id;
    var head = el("div", "card-head");
    var name = el("div", "card-name", r.name);
    var meta = el("div", "card-meta", bnDigits(C.fmtTime(r.duration)) + "  |  " + bnDigits(C.fmtBytes(r.size)) + "  |  " + fmtDate(r.createdAt));
    head.appendChild(name); head.appendChild(meta);
    var audio = el("audio", "player"); audio.controls = true; audio.preload = "metadata";
    audio.src = URL.createObjectURL(r.blob);
    var row = el("div", "btnrow");
    var bTrim = el("button", "btn ghost", T("trim"));
    var bDl = el("button", "btn ghost", T("download"));
    var bRen = el("button", "btn ghost", T("renaming"));
    var bDel = el("button", "btn danger-ghost", T("delete"));
    bTrim.onclick = function () { openTrim(r.id); };
    bDl.onclick = function () { downloadBlob(r.blob, r.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + "." + C.extForMime(r.mime)); };
    bRen.onclick = function () {
      var inp = el("input", "rename-input"); inp.value = r.name; inp.maxLength = 60;
      name.replaceWith(inp); inp.focus(); inp.select();
      var commit = function (ok) {
        var nn = inp.value.trim();
        if (ok && nn && nn !== r.name) { r.name = nn; putRec(r).then(function () { renderList(); }); }
        else renderList();
      };
      inp.onkeydown = function (e) { if (e.key === "Enter") commit(true); if (e.key === "Escape") commit(false); };
      inp.onblur = function () { commit(true); };
    };
    bDel.onclick = function () {
      if (bDel.dataset.arm) { delRec(r.id).then(function () { renderList(); }); }
      else { bDel.dataset.arm = "1"; bDel.textContent = T("yesDelete"); bDel.classList.add("armed");
        setTimeout(function () { if (bDel.isConnected) { delete bDel.dataset.arm; bDel.textContent = T("delete"); bDel.classList.remove("armed"); } }, 3000); }
    };
    row.appendChild(bTrim); row.appendChild(bDl); row.appendChild(bRen); row.appendChild(bDel);
    card.appendChild(head); card.appendChild(audio); card.appendChild(row);
    return card;
  }

  /* ---------- trimmer ---------- */
  function decodeToMono(blob) {
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = new AC();
    return blob.arrayBuffer().then(function (ab) { return ctx.decodeAudioData(ab); }).then(function (buf) {
      var ch0 = buf.getChannelData(0), out = new Float32Array(ch0.length);
      if (buf.numberOfChannels === 1) { out.set(ch0); return { channels: [out], sr: buf.sampleRate, dur: buf.duration }; }
      var chans = [];
      for (var c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
      for (var i = 0; i < out.length; i++) { var s = 0; for (var c2 = 0; c2 < chans.length; c2++) s += chans[c2][i]; out[i] = s / chans.length; }
      return { channels: chans, mono: out, sr: buf.sampleRate, dur: buf.duration };
    });
  }

  function openTrim(id) {
    closeTrim();
    getRec(id).then(function (r) {
      if (!r) return;
      var tctx = { rec: r, start: 0, end: r.duration, mono: null, channels: null, sr: 44100, buf: null, srcNode: null };
      State.trimCtx = tctx;
      var panel = $("trimPanel"); panel.hidden = false;
      $("trimTitle").textContent = T("trim") + ": " + r.name;
      $("trimStart").max = r.duration; $("trimEnd").max = r.duration;
      $("trimStartNum").max = r.duration; $("trimEndNum").max = r.duration;
      setTrimInputs(tctx, 0, r.duration);
      decodeToMono(r.blob).then(function (d) {
        if (State.trimCtx !== tctx) return;
        tctx.channels = d.channels; tctx.mono = d.mono || d.channels[0]; tctx.sr = d.sr; tctx.end = d.dur;
        ["trimStart", "trimEnd", "trimStartNum", "trimEndNum"].forEach(function (id) { $(id).max = d.dur; });
        $("trimStart").step = "0.01"; $("trimEnd").step = "0.01";
        setTrimInputs(tctx, 0, d.dur);
      }).catch(function () { $("trimErr").textContent = T("micError"); $("trimErr").hidden = false; });
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function setTrimInputs(t, s, e) {
    var c = C.clampTrim(s, e, t.end === 0 ? t.rec.duration : Math.max(t.end, t.rec.duration));
    var dur = t.rec.duration;
    $("trimStart").value = c.start; $("trimEnd").value = c.end;
    $("trimStartNum").value = Math.round(c.start * 100) / 100; $("trimEndNum").value = Math.round(c.end * 100) / 100;
    $("trimRangeLabel").textContent = bnDigits(C.fmtTime(c.start)) + " - " + bnDigits(C.fmtTime(c.end));
    t.start = c.start; t.end = c.end;
    drawWave(t);
  }

  function drawWave(t) {
    var canvas = $("wave"), ctx = canvas.getContext("2d");
    var W = canvas.clientWidth || 640, H = 160, dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr; ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    var dur = Math.max(t.end, t.rec.duration, 0.01);
    if (t.mono) {
      var peaks = C.computePeaks(t.mono, Math.max(50, Math.floor(W / 2)));
      var bw = W / peaks.length;
      ctx.fillStyle = "#99f6e4";
      peaks.forEach(function (p, i) {
        var x = i * bw, y1 = H / 2 - p.max * (H / 2 - 4), y2 = H / 2 - p.min * (H / 2 - 4);
        ctx.fillRect(x, Math.min(y1, y2), Math.max(1, bw - 0.5), Math.abs(y2 - y1) || 1);
      });
      // dim outside selection
      var sx0 = (t.start / dur) * W, sx1 = (t.end / dur) * W;
      ctx.fillStyle = "rgba(15,23,42,.55)";
      ctx.fillRect(0, 0, sx0, H); ctx.fillRect(sx1, 0, W - sx1, H);
      ctx.fillStyle = "#0d9488"; ctx.fillRect(sx0 - 1, 0, 2, H); ctx.fillRect(sx1 - 1, 0, 2, H);
    } else {
      ctx.fillStyle = "#64748b"; ctx.font = "14px sans-serif"; ctx.fillText("...", W / 2 - 8, H / 2);
    }
  }

  function playSelection(t) {
    stopPlaying();
    if (!t.channels) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    var ctx = new AC();
    var buf = ctx.createBuffer(t.channels.length, t.channels[0].length, t.sr);
    t.channels.forEach(function (ch, i) { buf.getChannelData(i).set(ch); });
    var src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    t._ctx = ctx; t.srcNode = src;
    src.onended = function () { if (t.srcNode === src) stopPlaying(); };
    var len = Math.max(0.01, t.end - t.start);
    src.start(0, t.start, len);
  }
  function stopPlaying() {
    var t = State.trimCtx;
    if (t && t.srcNode) { try { t.srcNode.stop(); } catch (e) {} try { t._ctx && t._ctx.close(); } catch (e) {} t.srcNode = null; }
  }
  function closeTrim() { stopPlaying(); State.trimCtx = null; $("trimPanel").hidden = true; $("trimErr").hidden = true; }

  function exportTrimWav(t, saveToLibrary) {
    var c = C.clampTrim(t.start, t.end, t.end);
    if (!c.valid || !t.channels) { $("trimErr").textContent = T("invalidTime"); $("trimErr").hidden = false; return; }
    var sliced = C.sliceChannels(t.channels, t.sr, c.start, c.end);
    var bytes = C.encodeWav(sliced, t.sr);
    var blob = new Blob([bytes], { type: "audio/wav" });
    var base = t.rec.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "recording";
    if (saveToLibrary) {
      var nm = $("trimName").value.trim() || (base + "-trimmed");
      putRec({ id: C.uid(), name: nm, blob: blob, mime: "audio/wav", size: blob.size, duration: c.end - c.start, createdAt: Date.now() })
        .then(function () { setStatus(T("trimSaved")); renderList(); closeTrim(); });
    } else {
      downloadBlob(blob, base + "-trimmed.wav");
    }
  }

  /* ---------- init ---------- */
  function init() {
    var saved = null;
    try { saved = localStorage.getItem("vr-lang"); } catch (e) {}
    State.lang = saved === "bn" ? "bn" : "en";
    $("btnRecord").addEventListener("click", function () { State.rec ? stopRecording() : startRecording(); });
    $("btnStop").addEventListener("click", stopRecording);
    $("langBtn").addEventListener("click", function () { setLang(State.lang === "bn" ? "en" : "bn"); });
    $("trimStart").addEventListener("input", function () { if (State.trimCtx) setTrimInputs(State.trimCtx, +$("trimStart").value, State.trimCtx.end); });
    $("trimEnd").addEventListener("input", function () { if (State.trimCtx) setTrimInputs(State.trimCtx, State.trimCtx.start, +$("trimEnd").value); });
    $("trimStartNum").addEventListener("change", function () { if (State.trimCtx) setTrimInputs(State.trimCtx, +$("trimStartNum").value, State.trimCtx.end); });
    $("trimEndNum").addEventListener("change", function () { if (State.trimCtx) setTrimInputs(State.trimCtx, State.trimCtx.start, +$("trimEndNum").value); });
    $("trimPlay").addEventListener("click", function () { if (State.trimCtx) playSelection(State.trimCtx); });
    $("trimExport").addEventListener("click", function () { if (State.trimCtx) exportTrimWav(State.trimCtx, false); });
    $("trimSave").addEventListener("click", function () { if (State.trimCtx) exportTrimWav(State.trimCtx, true); });
    $("trimClose").addEventListener("click", closeTrim);
    window.addEventListener("resize", function () { if (State.trimCtx) drawWave(State.trimCtx); });
    applyLang();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
