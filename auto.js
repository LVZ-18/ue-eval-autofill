/*
 * UE Eval Autofill — bookmarklet version (works in Chrome on Windows, Mac and Linux)
 *
 * On each item it picks one of your ticked ratings (tick one = same on every item,
 * tick several = random mix) and clicks "Next Item".
 * At the last item (COMMENTS AND/OR SUGGESTIONS) it does what you chose:
 *   - wait     : stop at the comment box so you can type, then you press SUBMIT
 *   - blank    : press SUBMIT with no comment
 *   - comment  : type your preset comment, then press SUBMIT
 * It accepts the "Do you want to save now?" message, and on the "Finished" page
 * it clicks Continue for the next subject.
 *
 * The UE site reloads the whole page on every "Next Item", which would erase a normal
 * bookmarklet. So this one opens the evaluation inside a full-window frame on the same
 * page and stays in the outer page: the reloads happen inside the frame and the panel
 * keeps running. (If the site ever refuses the frame, it falls back to working on the
 * page directly, and you click the bookmark again after each reload.)
 */
(function () {
  'use strict';

  var NS = '__ueEvalAuto';
  var KEY = 'ueEvalAuto.state';
  var LABELS = ['Outstanding', 'Very Good', 'Good', 'Fair', 'Poor'];
  var END_TEXT = {
    wait: 'stop at the comment box',
    blank: 'submit without a comment',
    comment: 'submit with your comment'
  };

  if (window[NS]) { window[NS].showPanel(); return; }

  // Only run on the UE evaluation site.
  if (!/websefp/i.test(location.href)) {
    alert('UE Eval Autofill: open the UE faculty evaluation (apps.ue.edu.ph/websefp) first, then click this bookmark there.');
    return;
  }

  var DEFAULTS = { running: false, ratings: [1], delay: 1200, jitter: 300, endMode: 'wait', comment: '', continueNext: false };
  var saved = loadState() || {};
  if (!Array.isArray(saved.ratings) && saved.rating) saved.ratings = [saved.rating]; // older version
  var state = Object.assign({}, DEFAULTS, saved);
  state.ratings = cleanRatings(state.ratings);

  var panel = null, statusEl = null, startBtn = null, delayInput = null;
  var endSelect = null, commentInput = null, continueBox = null, ratingBtns = [];
  var miniBtn = null, settingsBox = null;
  var loopId = 0;
  var looping = false;
  var frame = null; // full-window frame the evaluation runs in (survives page reloads)

  /* ---------- the page being automated (inside the frame when there is one) ---------- */
  function D() {
    if (frame) { try { if (frame.contentDocument) return frame.contentDocument; } catch (e) { /* ignore */ } }
    return document;
  }
  function W() {
    if (frame) { try { if (frame.contentWindow) return frame.contentWindow; } catch (e) { /* ignore */ } }
    return window;
  }
  function newEvent(type) { return new (W().Event)(type, { bubbles: true }); }

  /* ---------- state ---------- */
  function loadState() {
    try { return JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { return null; }
  }
  function saveState() {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function cleanRatings(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (n) {
      n = parseInt(n, 10);
      if (n >= 1 && n <= 5 && out.indexOf(n) < 0) out.push(n);
    });
    return out.sort();
  }

  /* ---------- helpers ---------- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function half() {
    // Half the per-item delay, plus an optional random offset.
    var j = state.jitter > 0 ? (Math.random() * 2 - 1) * state.jitter : 0;
    return Math.max(150, Math.round((state.delay + j) / 2));
  }
  function pickRating() {
    return state.ratings[Math.floor(Math.random() * state.ratings.length)];
  }
  function ratingText() {
    var r = state.ratings;
    if (r.length === 1) return r[0] + '. ' + LABELS[r[0] - 1];
    return 'a random rating from ' + r.join(', ');
  }

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (panel && panel.contains(el)) return false; // never touch our own panel
    var r = el.getBoundingClientRect();
    var s = (el.ownerDocument && el.ownerDocument.defaultView || window).getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }

  function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }

  function pageText() {
    var b = D().body;
    var t = (b && (b.innerText || b.textContent)) || '';
    if (panel && !frame) t = t.replace(panel.innerText || panel.textContent || '', '');
    return t;
  }
  function isFinishedPage() { return /successfully recorded/i.test(pageText()); }
  function proceedButton() { return findButton(/^proceed\s+with\s+(the\s+)?evaluation$/i); }
  function hasPending() { return /pending evaluation/i.test(pageText()); }

  function labelText(radio) {
    var t = '';
    if (radio.id) {
      var l = D().querySelector('label[for="' + CSS.escape(radio.id) + '"]');
      if (l) t = l.textContent;
    }
    if (!clean(t)) {
      var wrap = radio.closest('label');
      if (wrap) t = wrap.textContent;
    }
    if (!clean(t)) {
      var n = radio.nextSibling, guard = 0;
      while (n && !clean(t) && guard++ < 5) { t = n.textContent || ''; n = n.nextSibling; }
    }
    if (!clean(t) && radio.parentElement) t = radio.parentElement.textContent;
    return clean(t);
  }

  function usableRadios() {
    return Array.prototype.slice.call(D().querySelectorAll('input[type="radio"]'))
      .filter(function (r) {
        return !r.disabled && (visible(r) || visible(r.closest('label')) || visible(r.parentElement));
      });
  }

  function commentBox() {
    var tas = D().querySelectorAll('textarea');
    for (var i = 0; i < tas.length; i++) {
      if (visible(tas[i]) && !tas[i].disabled && !tas[i].readOnly) return tas[i];
    }
    return null;
  }

  function findChoice(rating) {
    var radios = usableRadios();
    if (!radios.length) return null;
    var i, txt;

    // 1) Label starts with the number: "1. Outstanding"
    var numRe = new RegExp('^\\(?' + rating + '\\s*[\\.\\)\\-:]');
    for (i = 0; i < radios.length; i++) {
      if (numRe.test(labelText(radios[i]))) return radios[i];
    }
    // 2) Label word matches exactly: "Very Good" (not confused with "Good")
    var want = LABELS[rating - 1].toLowerCase();
    for (i = 0; i < radios.length; i++) {
      txt = labelText(radios[i]).replace(/^\(?\d+\s*[\.\)\-:]?\s*/, '').toLowerCase();
      if (txt === want) return radios[i];
    }
    // 3) Position within a group of exactly 5 radios
    var name = radios[0].name;
    var group = radios.filter(function (r) { return r.name === name; });
    if (group.length === 5) return group[rating - 1];
    // 4) Radio value
    for (i = 0; i < radios.length; i++) {
      if (String(radios[i].value).trim() === String(rating)) return radios[i];
    }
    return null;
  }

  function findButton(re, root) {
    var els = (root || D()).querySelectorAll('button, input[type="button"], input[type="submit"], a, [role="button"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      // <input> buttons show their value; <button>/<a> show their text (their value may be anything).
      var txt = clean(el.tagName === 'INPUT' ? el.value : (el.textContent || el.value));
      if (re.test(txt) && visible(el) && !el.disabled && !el.classList.contains('disabled')) return el;
    }
    return null;
  }

  function counter() {
    var els = D().querySelectorAll('span, small, div, label, b, strong, p, td, em');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.children.length) continue;
      var m = /^\s*(\d+)\s*of\s*(\d+)\s*$/i.exec(el.textContent || '');
      if (m && visible(el)) return { cur: +m[1], total: +m[2] };
    }
    return null;
  }

  function signature() {
    var c = counter();
    var checked = usableRadios().map(function (r) { return r.checked ? '1' : '0'; }).join('');
    return (c ? c.cur + '/' + c.total : '?') + '|' + checked + '|' + (commentBox() ? 'T' : '') + '|' + (isFinishedPage() ? 'F' : '');
  }

  async function waitFor(fn, timeout) {
    var t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (fn()) return true;
      await sleep(150);
    }
    return false;
  }

  function setFieldValue(el, value) {
    var proto = Object.getPrototypeOf(el);
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(newEvent('input'));
    el.dispatchEvent(newEvent('change'));
  }

  function report(msg) {
    if (statusEl) statusEl.textContent = msg;
    refreshPanel();
  }

  /* ---------- end of evaluation ---------- */
  async function clickConfirmModal() {
    // If the site shows its own in-page "Are you sure?" box after SUBMIT, press its Yes/OK.
    var sel = '.modal.show, .modal.in, .swal2-popup, .swal-modal, .bootbox, .jconfirm, [role="dialog"], [role="alertdialog"]';
    var t0 = Date.now();
    while (Date.now() - t0 < 4000) {
      var boxes = D().querySelectorAll(sel);
      for (var i = 0; i < boxes.length; i++) {
        if (!visible(boxes[i])) continue;
        var b = findButton(/^(yes|ok|okay|confirm)$/i, boxes[i]);
        if (b) { b.click(); return true; }
      }
      if (isFinishedPage()) return false;
      await sleep(200);
    }
    return false;
  }

  async function handleCommentItem(ta, myId) {
    if (state.endMode === 'wait') {
      try { ta.scrollIntoView({ block: 'center' }); ta.focus(); } catch (e) { /* ignore */ }
      stop('All ratings done. Type your comment, then press SUBMIT.');
      return;
    }

    if (state.endMode === 'comment') {
      setFieldValue(ta, state.comment || '');
      report('Comment typed. Submitting…');
    } else {
      report('No comment. Submitting…');
    }
    await sleep(half());
    if (!state.running || myId !== loopId) return;

    var submit = findButton(/^submit(\s*evaluation)?$/i) || findButton(/submit/i);
    if (!submit) { stop('Could not find the SUBMIT button. Press it yourself.'); return; }

    // Remember before clicking: the page reloads after saving.
    if (!state.continueNext) state.running = false;
    saveState();

    // Say OK to "Do you want to save now?" (and any follow-up message) for this click.
    var pw = W();
    var originalConfirm = pw.confirm, originalAlert = pw.alert;
    pw.confirm = function () { return true; };
    pw.alert = function () { };
    setTimeout(function () { try { pw.confirm = originalConfirm; pw.alert = originalAlert; } catch (e) { /* page changed */ } }, 8000);

    submit.click();
    await clickConfirmModal();

    // Usually the page reloads to "Finished" here and this script ends.
    // If it didn't reload, look for the Finished page ourselves.
    var finished = await waitFor(isFinishedPage, 12000);
    if (!finished) {
      stop('Pressed SUBMIT. Check the page to confirm it was saved.');
      return;
    }
    if (!state.continueNext) {
      stop(hasPending()
        ? (frame ? 'Saved! Press Start to go on to the next subject.' : 'Saved! Press Continue on the page for the next subject, then click the bookmark again.')
        : 'Saved! All your evaluations are done.');
    }
    // else the main loop sees the Finished page and clicks Continue
  }

  async function continueToNextSubject() {
    if (!hasPending()) { stop('All your evaluations are done.'); return false; }
    var cont = findButton(/^continue$/i);
    if (!cont) { stop('Press Continue on the page, then click the bookmark again.'); return false; }

    report(frame ? 'Going on to the next subject…' : 'Going on to the next subject… (if the page reloads, click the bookmark again)');
    saveState(); // still running: clicking the bookmark on the next page carries on
    await sleep(half());
    cont.click();

    // If the page reloads, this script ends here. If not, wait for the next evaluation.
    var opened = await waitFor(function () { return !isFinishedPage() && (usableRadios().length > 0 || !!proceedButton()); }, 15000);
    if (!opened) {
      report('When the next evaluation opens, click the bookmark again to carry on.');
      return false;
    }
    return true;
  }

  /* ---------- main loop ---------- */
  async function run(myId) {
    looping = true;
    try { await loop(myId); } finally { if (myId === loopId || !state.running) looping = false; }
  }

  async function loop(myId) {
    while (state.running && myId === loopId) {
      // "Finished — your responses were recorded" page
      if (isFinishedPage()) {
        if (!(await continueToNextSubject())) return;
        continue;
      }

      // Intro page: "Proceed with the evaluation" — only when no item is showing yet
      // (the button can stay on screen even after item 1 is open).
      var proceed = (usableRadios().length || commentBox()) ? null : proceedButton();
      if (proceed) {
        report(frame ? 'Opening the evaluation…' : 'Opening the evaluation… (if the page reloads, click the bookmark again)');
        saveState();
        await sleep(half());
        proceed.click();
        var shown = await waitFor(function () { return usableRadios().length > 0 || !!commentBox(); }, 15000);
        if (!shown) { report('When item 1 opens, click the bookmark again to carry on.'); return; }
        await sleep(half());
        continue;
      }

      var c = counter();
      var radios = usableRadios();
      var ta = commentBox();

      // Last item: comment box, no rating options
      if (ta && !radios.length) {
        await handleCommentItem(ta, myId);
        if (!state.running || myId !== loopId) return;
        continue;
      }

      if (!radios.length) {
        var appeared = await waitFor(function () { return usableRadios().length > 0 || commentBox() || isFinishedPage() || proceedButton(); }, 6000);
        if (!appeared) { stop('No rating options on this page. Open the evaluation item first.'); return; }
        continue;
      }

      var rating = pickRating();
      var choice = findChoice(rating);
      if (!choice) {
        stop('Could not find option ' + rating + ' on this item. Stopped.');
        return;
      }
      if (!choice.checked) {
        choice.click();
        if (!choice.checked) {
          choice.checked = true;
          choice.dispatchEvent(newEvent('input'));
          choice.dispatchEvent(newEvent('change'));
        }
      }
      report('Item ' + (c ? c.cur + ' of ' + c.total : '?') + ': picked ' + rating + '. ' + LABELS[rating - 1]);

      await sleep(half());
      if (!state.running || myId !== loopId) return;

      var next = findButton(/^next\s*item$/i) || findButton(/next\s*item/i);
      if (!next) {
        stop('No "Next Item" button found. Review the page and continue yourself.');
        return;
      }

      var before = signature();
      next.click();
      // If the site reloads the page on Next, this script ends here; click the bookmark again to carry on.
      var moved = await waitFor(function () { return signature() !== before; }, 8000);
      if (!moved) {
        stop('The page did not move to the next item. Check for a message on the page.');
        return;
      }
      await sleep(half());
    }
  }

  function start() {
    state.ratings = cleanRatings(state.ratings);
    if (!state.ratings.length) { report('Tick at least one rating first.'); return false; }
    if (state.endMode === 'comment' && !clean(state.comment)) {
      report('Type a comment first, or choose a different end option.');
      return false;
    }
    state.running = true;
    saveState();
    loopId++;
    report('Running — ' + ratingText() + ' on each item, then ' + END_TEXT[state.endMode] + '.');
    run(loopId);
    return true;
  }

  function stop(msg) {
    state.running = false;
    saveState();
    loopId++;
    report(msg || 'Stopped.');
  }

  /* ---------- floating panel ---------- */
  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text) e.textContent = text;
    return e;
  }

  var FIELD_CSS = 'padding:4px;border-radius:4px;border:1px solid #3a4152;background:#11141b;color:#eee;font:inherit';

  function buildPanel() {
    if (panel) return;
    panel = el('div', [
      'position:fixed', 'right:calc(12px + env(safe-area-inset-right, 0px))', 'bottom:calc(12px + env(safe-area-inset-bottom, 0px))',
      'z-index:2147483647', 'width:min(290px, calc(100vw - 24px))', 'max-height:calc(100vh - 24px)', 'overflow:auto', 'box-sizing:border-box',
      'background:#1f2430', 'color:#f2f2f2', 'font:13px/1.4 Segoe UI,Arial,sans-serif',
      'border-radius:10px', 'box-shadow:0 8px 24px rgba(0,0,0,.35)', 'padding:12px'
    ].join(';'));
    panel.id = 'ue-eval-auto-panel';

    var head = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600', 'UE Eval Autofill');
    var btns = el('div', 'display:flex;gap:10px;align-items:center');
    var mini = el('button', 'background:none;border:0;color:#aaa;font-size:20px;cursor:pointer;line-height:1;padding:0 4px', '–');
    mini.title = 'Make the panel small';
    mini.onclick = function () { state.min = !state.min; saveState(); refreshPanel(); };
    var close = el('button', 'background:none;border:0;color:#aaa;font-size:18px;cursor:pointer;line-height:1;padding:0 4px', '×');
    close.title = 'Stop and close';
    close.onclick = function () { stop('Closed.'); panel.style.display = 'none'; };
    btns.appendChild(mini);
    btns.appendChild(close);
    head.appendChild(btns);
    panel.appendChild(head);
    miniBtn = mini;
    settingsBox = el('div', '');

    settingsBox.appendChild(el('div', 'color:#aab;font-size:12px;margin-bottom:4px', 'Rating to click — tick one, or several to mix randomly:'));
    var row = el('div', 'display:grid;gap:4px;margin-bottom:10px');
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var b = el('button', 'text-align:left;padding:5px 8px;border-radius:6px;border:1px solid #3a4152;background:#2a303d;color:#eee;cursor:pointer');
        b.onclick = function () {
          if (state.running) return;
          var at = state.ratings.indexOf(n);
          if (at >= 0) state.ratings.splice(at, 1); else state.ratings.push(n);
          state.ratings = cleanRatings(state.ratings);
          saveState();
          refreshPanel();
        };
        b.dataset.n = n;
        ratingBtns.push(b);
        row.appendChild(b);
      })(i);
    }
    settingsBox.appendChild(row);

    settingsBox.appendChild(el('div', 'color:#aab;font-size:12px;margin-bottom:4px', 'At the end (comment box + SUBMIT):'));
    endSelect = el('select', FIELD_CSS + ';width:100%;margin-bottom:6px');
    [['wait', 'Wait for my comment (I\'ll type, then SUBMIT)'], ['blank', 'Submit without comment'], ['comment', 'Submit with this comment…']]
      .forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0]; opt.textContent = o[1];
        endSelect.appendChild(opt);
      });
    endSelect.value = state.endMode;
    endSelect.onchange = function () { state.endMode = endSelect.value; saveState(); refreshPanel(); };
    settingsBox.appendChild(endSelect);

    commentInput = el('textarea', FIELD_CSS + ';width:100%;box-sizing:border-box;height:54px;resize:vertical;margin-bottom:6px');
    commentInput.placeholder = 'Your comment…';
    commentInput.value = state.comment;
    commentInput.oninput = function () { state.comment = commentInput.value; saveState(); };
    settingsBox.appendChild(commentInput);

    var cl = el('label', 'display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:12px;cursor:pointer');
    continueBox = document.createElement('input');
    continueBox.type = 'checkbox';
    continueBox.checked = state.continueNext;
    continueBox.onchange = function () { state.continueNext = continueBox.checked; saveState(); };
    cl.appendChild(continueBox);
    cl.appendChild(document.createTextNode('Go on to next subject after submitting'));
    settingsBox.appendChild(cl);

    var dl = el('label', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px', 'Time per item (ms)');
    delayInput = el('input', FIELD_CSS + ';width:80px');
    delayInput.type = 'number'; delayInput.min = '200'; delayInput.step = '100';
    delayInput.value = state.delay;
    delayInput.onchange = function () { state.delay = Math.max(200, parseInt(delayInput.value, 10) || 1200); saveState(); };
    dl.appendChild(delayInput);
    settingsBox.appendChild(dl);
    panel.appendChild(settingsBox);

    startBtn = el('button', 'width:100%;padding:8px;border:0;border-radius:6px;font-weight:600;cursor:pointer;color:#fff');
    startBtn.onclick = function () {
      if (state.running) { stop('Stopped.'); return; }
      state.endMode = endSelect.value;
      state.comment = commentInput.value;
      state.continueNext = continueBox.checked;
      state.delay = Math.max(200, parseInt(delayInput.value, 10) || 1200);
      start();
    };
    panel.appendChild(startBtn);

    statusEl = el('div', 'margin-top:8px;color:#c8cbd2;font-size:12px;min-height:16px', 'Tick your rating(s), pick the end option, then press Start.');
    panel.appendChild(statusEl);

    document.body.appendChild(panel);
    refreshPanel();
  }

  function refreshPanel() {
    if (!panel) return;
    ratingBtns.forEach(function (b) {
      var n = +b.dataset.n;
      var on = state.ratings.indexOf(n) >= 0;
      b.textContent = (on ? '☑  ' : '☐  ') + n + '. ' + LABELS[n - 1];
      b.style.background = on ? '#2f6fde' : '#2a303d';
      b.style.borderColor = on ? '#2f6fde' : '#3a4152';
      b.style.opacity = state.running ? '0.7' : '1';
    });
    commentInput.style.display = state.endMode === 'comment' ? 'block' : 'none';
    settingsBox.style.display = state.min ? 'none' : 'block';
    miniBtn.textContent = state.min ? '+' : '–';
    miniBtn.title = state.min ? 'Show all settings' : 'Make the panel small';
    startBtn.textContent = state.running ? 'Stop' : 'Start';
    startBtn.style.background = state.running ? '#d9534f' : '#28a745';
  }

  function showPanel() {
    if (!panel) buildPanel(); else panel.style.display = 'block';
  }

  window[NS] = {
    start: start,
    stop: function () { stop('Stopped.'); },
    showPanel: showPanel,
    status: function () { return JSON.parse(JSON.stringify(state)); }
  };

  var resumeOnLoad = !!state.running; // a run was active before this page loaded

  // Opens the evaluation in a full-window frame so page reloads don't stop the panel.
  function openFrame(done) {
    var f = document.createElement('iframe');
    f.id = 'ue-eval-auto-frame';
    // No top-navigation permission, so the page can't break out of the frame.
    f.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-modals allow-popups allow-downloads');
    f.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;border:0;margin:0;padding:0;z-index:2147483646;background:#fff';
    var finished = false;
    function finish(ok) {
      if (finished) return;
      finished = true;
      if (!ok) { try { f.remove(); } catch (e) { /* ignore */ } frame = null; }
      done(ok);
    }
    f.onload = function () {
      var ok = false;
      try { ok = !!f.contentDocument && /websefp/i.test(f.contentWindow.location.href); } catch (e) { ok = false; }
      if (ok) {
        frame = f;
        document.documentElement.style.overflow = 'hidden';
        f.onload = null;
        // Phones show the UE page zoomed out to desktop size, which shrinks the panel.
        // The outer page is now just the frame + panel, so give it the phone's real width.
        // Hide the original page behind the frame so it can't make the outer page wider than the phone.
        Array.prototype.forEach.call(document.body.children, function (c) {
          if (c !== f && c !== panel) c.style.setProperty('display', 'none', 'important');
        });
        document.body.style.setProperty('margin', '0', 'important');
        document.body.style.setProperty('overflow', 'hidden', 'important');
        if (!document.querySelector('meta[name="viewport"]')) {
          var vm = document.createElement('meta');
          vm.name = 'viewport';
          vm.content = 'width=device-width, initial-scale=1';
          (document.head || document.documentElement).appendChild(vm);
        }
      }
      finish(ok);
    };
    setTimeout(function () { finish(false); }, 20000);
    f.src = location.href;
    document.body.appendChild(f);
  }

  function init() {
    buildPanel();
    report('Loading…');
    openFrame(function (ok) {
      report(ok
        ? 'Tick your rating(s), pick the end option, then press Start.'
        : 'Ready (this page will need the bookmark clicked again after each reload).');
      if (resumeOnLoad && state.running && !looping) {
        report('Carrying on — ' + ratingText() + ' on each item…');
        setTimeout(function () { if (state.running && !looping) { loopId++; run(loopId); } }, 800);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
