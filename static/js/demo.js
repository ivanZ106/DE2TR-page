/* DE²TR — interactive case demo
   click a prediction -> seek & play that segment, auto-stop at its end
   click a top-5 frame  -> seek & play its 2s clip, auto-stop
   saliency curve drawn on <canvas> with GT shading, matched-prediction overlays, top-5 dots
*/
(function () {
  'use strict';

  var CASES = window.CASES;
  var sel = document.getElementById('caseSel');
  var video = document.getElementById('caseVideo');
  var queryEl = document.getElementById('caseQuery');
  var segWrap = document.getElementById('caseSegs');
  var curve = document.getElementById('caseCurve');
  var top5El = document.getElementById('caseTop5');
  var statusEl = document.getElementById('caseStatus');
  if (!CASES || !sel || !video || !curve) return;

  var current = null;       // active case object
  var segActive = null;     // {s, e} while auto-stop armed
  var segButton = null;     // the segment button being played

  /* ---------------- video source selection (robust, all regions) ----------------
     jsDelivr is a global CDN with mainland-China nodes: it is fast both inside and
     outside China, so we use it for EVERYONE (no fragile timezone sniffing).
     The in-repo static/video/ (GitHub Pages) stays as an automatic fallback if the
     mirror fails or stalls (e.g. jsDelivr hiccup). */
  var PRIMARY_BASE = 'static/video/';
  var MIRROR_BASE = 'https://cdn.jsdelivr.net/gh/ivanZ106/DE2TR@main/demo/';
  var USE_MIRROR = true;
  function videoURL(vid) { return (USE_MIRROR ? MIRROR_BASE : PRIMARY_BASE) + vid + '.mp4'; }

  /* iOS Safari is conservative with media: multiple concurrent video loads can
     stall. We keep things simple there (no hidden preloader, metadata preload). */
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
  var IS_SAFARI = !IS_IOS && /Safari\//.test(navigator.userAgent || '') &&
                  !/Chrome|CriOS|Chromium/.test(navigator.userAgent || '');
  var SIMPLE_VIDEO = IS_IOS || IS_SAFARI;

  /* Robust loading.
     A source counts as "working" as soon as METADATA arrives (readyState >= 1).
     With preload="metadata" the browser only fetches metadata up front, so using
     readyState >= 2 here would wrongly drop a good source after 5s (the bug that
     made Chrome slow). Only when the browser receives NOTHING at all within the
     timeout (readyState still 0) do we switch source. */
  function applySrc(el, vid, base) {
    el._vid = vid;
    el._base = base;
    el.src = base + vid + '.mp4';
    el.load();
  }
  function setVideoSource(el, vid, base) {
    applySrc(el, vid, base || (USE_MIRROR ? MIRROR_BASE : PRIMARY_BASE));
    armStallGuard(el, vid);
  }
  function otherBase(base) { return base === MIRROR_BASE ? PRIMARY_BASE : MIRROR_BASE; }
  function disarmStallGuard(el) {
    if (el._guard) { clearTimeout(el._guard); el._guard = null; }
  }
  function armStallGuard(el, vid) {
    if (el._guard) clearTimeout(el._guard);
    el._guard = setTimeout(function () {
      el._guard = null;
      if (el.readyState >= 1) return;            // metadata arrived -> this source works
      el._tries = (el._tries || 0) + 1;
      if (el._tries > 2) {                        // give up flipping: settle on in-repo
        applySrc(el, vid, PRIMARY_BASE);
        return;
      }
      applySrc(el, vid, otherBase(el._base));     // try the other source
      armStallGuard(el, vid);
    }, 5000);
  }
  function onSourceReady(el) { el._tries = 0; disarmStallGuard(el); }
  video.addEventListener('loadedmetadata', function () { onSourceReady(video); });
  video.addEventListener('loadeddata', function () { onSourceReady(video); });
  video.addEventListener('error', function () {
    disarmStallGuard(video);
    if (video._vid && video._base === MIRROR_BASE) applySrc(video, video._vid, PRIMARY_BASE);
  });

  /* ---------------- helpers ---------------- */
  function fmtSec(s) {
    return (Math.round(s * 10) / 10) + ' s';
  }
  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  /* ---------------- segment playback ---------------- */
  function playSegment(s, e, btn) {
    if (!video.src) return;
    video.currentTime = Math.max(0, s);
    segActive = { s: s, e: e };
    segButton = btn || null;
    if (segButton) segButton.classList.add('playing');
    if (statusEl) statusEl.textContent = 'Playing ' + fmtSec(s) + ' – ' + fmtSec(e);
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay blocked; user will press play */ });
  }

  function clearSegment() {
    if (segButton) { segButton.classList.remove('playing'); segButton = null; }
    segActive = null;
  }

  video.addEventListener('timeupdate', function () {
    if (segActive && video.currentTime >= segActive.e - 0.05) {
      var e = segActive.e;
      clearSegment();
      video.pause();
      video.currentTime = Math.min(e, video.duration || e);
      setStatus('Stopped at ' + fmtSec(e));
    }
  });
  video.addEventListener('pause', function () {
    /* user pressed pause manually (our end-of-segment pause already cleared
       segActive, so it is a no-op there) -> disarm auto-stop */
    if (segActive) { clearSegment(); }
  });
  video.addEventListener('seeked', function () {
    /* only disarm when the user drags the timeline OUTSIDE the active segment;
       programmatic seeks to s (start) or e (end) stay within [s, e] */
    if (segActive) {
      var t = video.currentTime;
      if (t < segActive.s - 0.2 || t > segActive.e + 0.2) {
        clearSegment();
        setStatus('Click a prediction or GT to play');
      }
    }
  });

  /* ---------------- case selector ---------------- */
  function buildSelector() {
    sel.innerHTML = '';
    CASES.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'case-chip' + (i === 0 ? ' active' : '');
      b.textContent = 'video-' + (i + 1);
      b.title = c.query;
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(sel.children, function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        loadCase(i);
      });
      sel.appendChild(b);
    });
  }

  /* ---------------- load one case ---------------- */
  var loadedVid = null;
  var preloadTimer = null;

  /* Preload the NEXT case's video in a hidden element so switching feels instant.
     Videos are now small (faststart + ~2s keyframes), so warming the HTTP cache
     costs little but makes case switching start playback almost immediately. */
  var preloadVid = null;
  function ensurePreloadEl() {
    if (preloadVid) return preloadVid;
    preloadVid = document.createElement('video');
    preloadVid.preload = 'metadata';
    preloadVid.muted = true;
    preloadVid.setAttribute('playsinline', '');
    preloadVid.style.display = 'none';
    preloadVid.addEventListener('loadedmetadata', function () { onSourceReady(preloadVid); });
    preloadVid.addEventListener('loadeddata', function () { onSourceReady(preloadVid); });
    preloadVid.addEventListener('error', function () {
      disarmStallGuard(preloadVid);
      if (preloadVid._vid && preloadVid._base === MIRROR_BASE) applySrc(preloadVid, preloadVid._vid, PRIMARY_BASE);
    });
    document.body.appendChild(preloadVid);
    return preloadVid;
  }
  function warmNext(i) {
    if (SIMPLE_VIDEO) return;                     // iOS/Safari: don't run a hidden preloader
    var next = CASES[(i + 1) % CASES.length];
    if (!next || next.vid === loadedVid) return;
    setVideoSource(ensurePreloadEl(), next.vid);
  }
  function schedulePreload(i) {
    if (preloadTimer) clearTimeout(preloadTimer);
    /* wait a beat so the main video's initial load isn't starved, then warm the next */
    preloadTimer = setTimeout(function () { warmNext(i); }, 1500);
  }

  function loadCase(i) {
    var c = CASES[i];
    current = c;
    clearSegment();

    /* video (lazy: set src only when first shown) */
    if (loadedVid !== c.vid) {
      setVideoSource(video, c.vid);
      loadedVid = c.vid;
    }
    schedulePreload(i);

    /* query */
    queryEl.textContent = '“' + c.query + '”';

    /* ground-truth + matched predictions: one row per GT */
    segWrap.innerHTML = '';
    var label = document.createElement('p');
    label.className = 'seg-hint';
    label.textContent = 'Click a GT or a prediction to play its moment';
    segWrap.appendChild(label);

    c.matches.forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'seg-row';

      var gt = document.createElement('button');
      gt.type = 'button';
      gt.className = 'seg seg-gt';
      gt.title = 'Play the ground-truth moment (' + fmtSec(m.gt[0]) + ' – ' + fmtSec(m.gt[1]) + ')';
      gt.innerHTML = 'GT&nbsp; ' + fmtSec(m.gt[0]) + ' – ' + fmtSec(m.gt[1]);
      gt.addEventListener('click', function () { playSegment(m.gt[0], m.gt[1], gt); });
      row.appendChild(gt);

      if (m.s === null) {
        var none = document.createElement('span');
        none.className = 'seg seg-none';
        none.textContent = 'no matching prediction';
        row.appendChild(none);
      } else {
        var p = document.createElement('button');
        p.type = 'button';
        p.className = 'seg seg-pred';
        p.innerHTML = '<span class="seg-play">&#9654;</span>' +
          '<span class="seg-time">' + fmtSec(m.s) + ' – ' + fmtSec(m.e) + '</span>' +
          '<span class="seg-iou">IoU ' + (m.iou * 100).toFixed(1) + '%</span>';
        p.title = 'Play the predicted moment (' + fmtSec(m.s) + ' – ' + fmtSec(m.e) + ')';
        p.addEventListener('click', function () { playSegment(m.s, m.e, p); });
        row.appendChild(p);
      }
      segWrap.appendChild(row);
    });
    setStatus('Click a GT, a prediction or a top-5 frame to play');

    /* top-5 frames */
    top5El.innerHTML = '';
    c.top5.forEach(function (clip, rank) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'frame-btn';
      btn.innerHTML = '<img src="' + c.frames[rank] + '" alt="Top-' + (rank + 1) + ' saliency frame at ' + fmtSec(clip * 2 + 1) + '" loading="lazy">' +
        '<span class="frame-time">' + fmtSec(clip * 2) + '</span>' +
        '<span class="frame-rank">#' + (rank + 1) + '</span>';
      btn.title = 'Play the clip of top-' + (rank + 1) + ' saliency (' + fmtSec(clip * 2) + ' – ' + fmtSec(clip * 2 + 2) + ')';
      btn.addEventListener('click', function () {
        var s = clip * 2;
        playSegment(s, s + 2, btn);
      });
      top5El.appendChild(btn);
    });

    drawCurve(c);
  }

  /* ---------------- saliency curve ---------------- */
  function drawCurve(c) {
    var dpr = window.devicePixelRatio || 1;
    var W = curve.clientWidth || 600;
    var H = curve.clientHeight || 170;
    curve.width = Math.round(W * dpr);
    curve.height = Math.round(H * dpr);
    var ctx = curve.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var padL = 40, padR = 12, padT = 14, padB = 22;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var sal = c.sal;
    var n = sal.length;
    var vmin = Math.min.apply(null, sal);
    var vmax = Math.max.apply(null, sal);
    var span = (vmax - vmin) || 1;

    function X(clip) { return padL + clip * plotW / (n - 1); }
    function Y(v) { return padT + (1 - (v - vmin) / span) * plotH; }
    function xSec(t) { return padL + (t / 2) * plotW / (n - 1); } // seconds -> clip -> px

    ctx.clearRect(0, 0, W, H);

    /* grid */
    ctx.strokeStyle = '#E4EAF3';
    ctx.lineWidth = 1;
    ctx.font = '11px "JetBrains Mono", ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#8A97AD';
    for (var t = 0; t <= 150; t += 30) {
      var gx = xSec(t);
      ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, padT + plotH); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillText(t + 's', gx, H - 8);
    }
    for (var k = 0; k <= 2; k++) {
      var gy = padT + k * plotH / 2;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + plotW, gy); ctx.stroke();
    }

    /* GT windows (teal) */
    c.gt.forEach(function (w) {
      ctx.fillStyle = 'rgba(14,159,174,0.10)';
      ctx.fillRect(xSec(w[0]), padT, Math.max(2, xSec(w[1]) - xSec(w[0])), plotH);
    });

    /* matched predictions (coral) — one per GT */
    c.matches.forEach(function (m) {
      if (m.s === null) return;
      ctx.fillStyle = 'rgba(232,81,126,0.13)';
      ctx.fillRect(xSec(m.s), padT, Math.max(2, xSec(m.e) - xSec(m.s)), plotH);
      ctx.strokeStyle = '#E8517E';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(xSec(m.s), padT); ctx.lineTo(xSec(m.s), padT + plotH);
      ctx.moveTo(xSec(m.e), padT); ctx.lineTo(xSec(m.e), padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    /* curve area */
    var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, 'rgba(14,159,174,0.28)');
    grad.addColorStop(1, 'rgba(14,159,174,0.02)');
    ctx.beginPath();
    ctx.moveTo(X(0), Y(sal[0]));
    for (var i = 1; i < n; i++) ctx.lineTo(X(i), Y(sal[i]));
    ctx.lineTo(X(n - 1), padT + plotH);
    ctx.lineTo(X(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    /* curve line */
    ctx.beginPath();
    ctx.moveTo(X(0), Y(sal[0]));
    for (var i2 = 1; i2 < n; i2++) ctx.lineTo(X(i2), Y(sal[i2]));
    ctx.strokeStyle = '#0A7E8C';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* top-5 dots */
    c.top5.forEach(function (clip, rank) {
      var dx = X(clip), dy = Y(sal[clip]);
      ctx.beginPath();
      ctx.arc(dx, dy, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#F1A63C';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#8A6A2E';
      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(rank + 1), dx, dy + 2.5);
    });

    /* axis label */
    ctx.fillStyle = '#8A97AD';
    ctx.textAlign = 'left';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('saliency score', 6, 12);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (!current) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { drawCurve(current); }, 120);
  });

  /* ---------------- init ---------------- */
  buildSelector();
  loadCase(0);
})();
