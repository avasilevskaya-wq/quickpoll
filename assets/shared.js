/* QuickPoll — shared core.
 * Survey schema, link encoding, text format, and the survey runner
 * (used by the respondent page and by the builder's live preview).
 * No dependencies. All survey content is treated as untrusted (it comes from a URL):
 * text is always set with textContent, image URLs are restricted to http(s).
 */
(function (global) {
  'use strict';

  var QP = {};

  /* ---------- Question types ---------- */
  QP.TYPES = {
    s: { label: 'Single choice', short: 'Single', icon: '◉' },
    m: { label: 'Multiple choice', short: 'Multiple', icon: '☑' },
    y: { label: 'Yes / No', short: 'Yes/No', icon: '⇄' },
    r: { label: 'Scale', short: 'Scale', icon: '★' },
    i: { label: 'Image choice', short: 'Images', icon: '▦' },
    x: { label: 'Short text', short: 'Text', icon: '✎' }
  };
  QP.TYPE_ORDER = ['s', 'm', 'y', 'r', 'i', 'x'];

  /* ---------- Small helpers ---------- */
  QP.uid = function (n) {
    var abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    var out = '';
    var arr = new Uint8Array(n || 6);
    (global.crypto || global.msCrypto).getRandomValues(arr);
    for (var i = 0; i < arr.length; i++) out += abc[arr[i] % abc.length];
    return out;
  };

  function str(v, max) {
    if (v === undefined || v === null) return '';
    v = String(v);
    return v.length > max ? v.slice(0, max) : v;
  }

  QP.safeUrl = function (u) {
    u = str(u, 2000).trim();
    if (!u) return '';
    try {
      var p = new URL(u);
      return (p.protocol === 'https:' || p.protocol === 'http:') ? p.href : '';
    } catch (e) { return ''; }
  };

  QP.el = function (tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  };
  var el = QP.el;

  QP.store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  /* ---------- Schema ----------
   * Compact keys keep links short:
   * { v:1, id, t:title, d:description, n:askName(0/1), e:endpoint?,
   *   q:[{ k:type, t:text, h:hint, o:[options], i:[imageUrls], r:required(0/1),
   *        c:allowComment(0/1), s:scaleMax(5|10), l:[lowLabel, highLabel] }] }
   */
  QP.newQuestion = function (k) {
    var q = { k: k, t: '', h: '', r: 1, c: 0 };
    if (k === 's' || k === 'm') q.o = ['', ''];
    if (k === 'i') { q.o = ['', '']; q.i = ['', '']; }
    if (k === 'r') { q.s = 5; q.l = ['', '']; }
    if (k === 'x') q.r = 0;
    return q;
  };

  QP.newSurvey = function () {
    return { v: 1, id: QP.uid(6), t: '', d: '', n: 0, q: [] };
  };

  QP.normalize = function (raw) {
    raw = raw || {};
    var s = {
      v: 1,
      id: /^[a-z0-9]{4,16}$/.test(raw.id) ? raw.id : QP.uid(6),
      t: str(raw.t, 200),
      d: str(raw.d, 1000),
      n: raw.n ? 1 : 0,
      q: []
    };
    var e = QP.safeUrl(raw.e);
    if (e) s.e = e;
    (Array.isArray(raw.q) ? raw.q : []).slice(0, 60).forEach(function (rq) {
      if (!rq || !QP.TYPES[rq.k]) return;
      var q = { k: rq.k, t: str(rq.t, 500), h: str(rq.h, 500), r: rq.r ? 1 : 0, c: rq.c ? 1 : 0 };
      if (q.k === 's' || q.k === 'm' || q.k === 'i') {
        q.o = (Array.isArray(rq.o) ? rq.o : []).slice(0, 30).map(function (o) { return str(o, 200); });
      }
      if (q.k === 'i') {
        var imgs = Array.isArray(rq.i) ? rq.i : [];
        q.i = q.o.map(function (_, idx) { return QP.safeUrl(imgs[idx]); });
        if (rq.y === 'g' || rq.y === 'r' || rq.y === 'f') q.y = rq.y;   // layout: grid / row / full width (none = auto)
      }
      if (q.k === 'r') {
        q.s = rq.s === 10 ? 10 : 5;
        var l = Array.isArray(rq.l) ? rq.l : [];
        q.l = [str(l[0], 60), str(l[1], 60)];
      }
      s.q.push(q);
    });
    return s;
  };

  /* Strip empty values before encoding so links stay short. */
  QP.compact = function (s) {
    var out = { v: 1, id: s.id, t: s.t };
    if (s.d) out.d = s.d;
    if (s.n) out.n = 1;
    if (s.e) out.e = s.e;
    out.q = s.q.map(function (q) {
      var o = { k: q.k, t: q.t };
      if (q.h) o.h = q.h;
      o.r = q.r ? 1 : 0;
      if (q.c) o.c = 1;
      if (q.o && (q.k === 's' || q.k === 'm' || q.k === 'i')) {
        // keep options that have a label (or an image for image questions)
        var keep = q.o.map(function (lbl, i) { return !!(lbl.trim() || (q.k === 'i' && q.i && q.i[i])); });
        o.o = q.o.filter(function (_, i) { return keep[i]; }).map(function (x) { return x.trim(); });
        if (q.k === 'i') o.i = (q.i || []).filter(function (_, i) { return keep[i]; });
        if (q.k === 'i' && q.y) o.y = q.y;
      }
      if (q.k === 'r') {
        if (q.s === 10) o.s = 10;
        if (q.l && (q.l[0] || q.l[1])) o.l = [q.l[0] || '', q.l[1] || ''];
      }
      return o;
    });
    return out;
  };

  /* Returns a list of human-readable problems ([] = ready to share). */
  QP.validate = function (s) {
    var errs = [];
    if (!s.t.trim()) errs.push({ q: -1, msg: 'Add a poll title.' });
    if (!s.q.length) errs.push({ q: -1, msg: 'Add at least one question.' });
    s.q.forEach(function (q, i) {
      var n = 'Question ' + (i + 1);
      if (!q.t.trim()) errs.push({ q: i, msg: n + ': write the question.' });
      if (q.k === 's' || q.k === 'm') {
        var filled = (q.o || []).filter(function (o) { return o.trim(); }).length;
        if (filled < 2) errs.push({ q: i, msg: n + ': add at least 2 options.' });
      }
      if (q.k === 'i') {
        var withImg = (q.i || []).filter(function (u) { return u; }).length;
        if (withImg < 2) errs.push({ q: i, msg: n + ': add at least 2 image links.' });
      }
    });
    return errs;
  };

  /* ---------- Link encoding: JSON -> deflate-raw -> base64url ---------- */
  function b64urlFromBytes(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function bytesFromB64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function streamBytes(bytes, stream) {
    var piped = new Blob([bytes]).stream().pipeThrough(stream);
    return new Response(piped).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  QP.encode = function (survey) {
    var json = JSON.stringify(QP.compact(survey));
    var bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream === 'function') {
      try {
        return streamBytes(bytes, new CompressionStream('deflate-raw'))
          .then(function (z) { return 'z' + b64urlFromBytes(z); })
          .catch(function () { return 'j' + b64urlFromBytes(bytes); });
      } catch (e) { /* fall through */ }
    }
    return Promise.resolve('j' + b64urlFromBytes(bytes));
  };

  QP.decode = function (code) {
    return new Promise(function (resolve, reject) {
      code = (code || '').replace(/^#/, '').trim();
      if (!code) return reject(new Error('empty'));
      var kind = code[0];
      var bytes;
      try { bytes = bytesFromB64url(code.slice(1)); } catch (e) { return reject(new Error('broken')); }
      var done = function (b) {
        try { resolve(QP.normalize(JSON.parse(new TextDecoder().decode(b)))); }
        catch (e) { reject(new Error('broken')); }
      };
      if (kind === 'j') return done(bytes);
      if (kind === 'z') {
        if (typeof DecompressionStream !== 'function') return reject(new Error('old-browser'));
        return streamBytes(bytes, new DecompressionStream('deflate-raw')).then(done, function () { reject(new Error('broken')); });
      }
      reject(new Error('broken'));
    });
  };

  /* Base URL of the site (folder containing index.html), from any page. */
  QP.siteBase = function () {
    var path = location.pathname.replace(/[^/]*$/, '');      // strip file name
    if (/\/s\/$/.test(path)) path = path.replace(/s\/$/, ''); // respondent page lives in /s/
    return location.origin + path;
  };
  QP.surveyLink = function (code) { return QP.siteBase() + 's/#' + code; };

  /* ---------- Text format (two-way) ----------
   *   # Poll title
   *   > Optional description
   *   [ask name]
   *
   *   Question text            (options below → single choice)
   *   - Option A
   *   - Option B
   *
   *   Question text [multi]
   *   Question text [yes/no]
   *   Question text [1-5: Low label | High label]    or [1-10]
   *   Question text [images]
   *   - Label | https://image.url
   *   Question text [text]
   *   Flags (comma-separated inside the brackets): optional, comment
   *   A line starting with "  ?" or "? " under a question is a hint.
   */
  QP.toText = function (s) {
    var lines = [];
    lines.push('# ' + (s.t || ''));
    if (s.d) s.d.split('\n').forEach(function (l) { lines.push('> ' + l); });
    if (s.n) lines.push('[ask name]');
    s.q.forEach(function (q) {
      lines.push('');
      var tags = [];
      if (q.k === 'm') tags.push('multi');
      if (q.k === 'y') tags.push('yes/no');
      if (q.k === 'i') tags.push('images');
      if (q.k === 'i' && q.y) tags.push({ g: 'grid', r: 'row', f: 'full' }[q.y]);
      if (q.k === 'x') tags.push('text');
      if (q.k === 'r') {
        var r = '1-' + (q.s || 5);
        if (q.l && (q.l[0] || q.l[1])) r += ': ' + (q.l[0] || '') + ' | ' + (q.l[1] || '');
        tags.push(r);
      }
      var defaultReq = q.k !== 'x';
      if (defaultReq && !q.r) tags.push('optional');
      if (!defaultReq && q.r) tags.push('required');
      if (q.c) tags.push('comment');
      lines.push(q.t + (tags.length ? ' [' + tags.join(', ') + ']' : ''));
      if (q.h) lines.push('? ' + q.h);
      if (q.o && (q.k === 's' || q.k === 'm' || q.k === 'i')) q.o.forEach(function (o, i) {
        if (!o && !(q.i && q.i[i])) return;
        lines.push('- ' + o + (q.k === 'i' ? ' | ' + ((q.i || [])[i] || '') : ''));
      });
    });
    return lines.join('\n') + '\n';
  };

  QP.fromText = function (text, base) {
    var s = base ? JSON.parse(JSON.stringify(base)) : QP.newSurvey();
    s.t = ''; s.d = ''; s.n = 0; s.q = [];
    var desc = [];
    var cur = null;
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (/^#\s*/.test(line) && !s.t && !s.q.length) { s.t = line.replace(/^#\s*/, ''); return; }
      if (/^>/.test(line) && !s.q.length) { desc.push(line.replace(/^>\s?/, '')); return; }
      if (/^\[ask name\]$/i.test(line)) { s.n = 1; return; }
      if (/^[-*•]\s*/.test(line) && cur) {
        var body = line.replace(/^[-*•]\s*/, '');
        if (cur.k === 'y' || cur.k === 'r' || cur.k === 'x') cur.k = 's';
        if (!cur.o) cur.o = [];
        if (cur.k === 'i') {
          var parts = body.split('|');
          var url = parts.length > 1 ? parts.pop().trim() : '';
          cur.o.push(parts.join('|').trim());
          cur.i.push(QP.safeUrl(url));
        } else {
          cur.o.push(body);
        }
        return;
      }
      if (/^\?\s*/.test(line) && cur && !cur.h) { cur.h = line.replace(/^\?\s*/, ''); return; }
      // a new question
      var m = line.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
      var qt = m ? m[1] : line;
      var tags = m ? m[2].split(',').map(function (t) { return t.trim().toLowerCase(); }) : [];
      var k = 's';
      var q = { k: 's', t: qt.replace(/^\d+[.)]\s*/, ''), h: '', r: 1, c: 0, o: [] };
      tags.forEach(function (t) {
        if (t === 'multi' || t === 'multiple') k = 'm';
        else if (t === 'yes/no' || t === 'yesno' || t === 'yes-no') k = 'y';
        else if (t === 'images' || t === 'image') k = 'i';
        else if (t === 'text') k = 'x';
        else if (/^1\s*-\s*(5|10)/.test(t)) {
          k = 'r';
          var mm = t.match(/^1\s*-\s*(5|10)\s*(?::\s*(.*))?$/);
          q.s = mm && mm[1] === '10' ? 10 : 5;
          var lab = (m[2].split(',').filter(function (x) { return /^\s*1\s*-/.test(x); })[0] || '').split(':')[1];
          var lp = lab ? lab.split('|') : [];
          q.l = [(lp[0] || '').trim(), (lp[1] || '').trim()];
        }
      });
      q.k = k;
      if (k === 'x') q.r = 0;
      if (tags.indexOf('optional') >= 0) q.r = 0;
      if (tags.indexOf('required') >= 0) q.r = 1;
      if (tags.indexOf('comment') >= 0) q.c = 1;
      if (k === 'i') {
        q.i = [];
        if (tags.indexOf('grid') >= 0) q.y = 'g';
        else if (tags.indexOf('row') >= 0) q.y = 'r';
        else if (tags.indexOf('full') >= 0 || tags.indexOf('full width') >= 0) q.y = 'f';
      }
      if (k !== 's' && k !== 'm' && k !== 'i') delete q.o;
      if (k === 'r' && !q.l) { q.s = 5; q.l = ['', '']; }
      s.q.push(q);
      cur = q;
    });
    s.d = desc.join('\n');
    return QP.normalize(s);
  };

  /* ---------- Answers ---------- */
  QP.answerText = function (q, a) {
    if (!a || a.v === undefined || a.v === null || a.v === '') return '';
    if (Array.isArray(a.v)) return a.v.join('; ');
    if (q.k === 'r') return a.v + ' / ' + (q.s || 5);
    return String(a.v);
  };
  QP.isAnswered = function (q, a) {
    if (!a) return false;
    if (Array.isArray(a.v)) return a.v.length > 0;
    return a.v !== undefined && a.v !== null && String(a.v).trim() !== '';
  };

  /* ---------- Runner ----------
   * new QP.Runner(root, survey, {
   *   preview: bool,            // builder preview: no keyboard, no storage, fake submit
   *   storageKey: string,       // persist in-progress answers (live page)
   *   onSubmit: fn(payload) -> Promise,
   *   ui: bool                  // render with the design system (assets/ui.css) instead of base.css look
   * })
   */
  var SVG = {
    arrow: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h11M11 5.5l4.5 4.5-4.5 4.5"/></svg>',
    back: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 10H5M9 5.5L4.5 10 9 14.5"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>',
    yes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    no: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    zoom: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8.5 3.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12.2 12.2L16.5 16.5M8.5 6.5v4M6.5 8.5h4"/></svg>'
  };
  function icon(name) { var t = document.createElement('template'); t.innerHTML = SVG[name]; return t.content.firstChild; }

  function Runner(root, survey, opts) {
    this.root = root;
    this.opts = opts || {};
    this.survey = survey;
    this.answers = {};
    this.name = '';
    this.idx = 0;            // -1 intro, 0..n-1 questions, n review, n+1 done
    this.noteOpen = {};
    this.startedAt = new Date().toISOString();
    this.state = 'idle';     // idle | sending | error | done
    this._timer = null;
    this._dir = 1;
    if (this.opts.storageKey) {
      var saved = QP.store.get(this.opts.storageKey, null);
      if (saved && saved.answers) {
        this.answers = saved.answers; this.name = saved.name || '';
        if (saved.startedAt) this.startedAt = saved.startedAt;
      }
    }
    this.idx = this.hasIntro() ? -1 : 0;
    if (!this.opts.preview) this._bindKeys();
    this.render();
  }
  QP.Runner = Runner;

  Runner.prototype.hasIntro = function () { return !!(this.survey.d || this.survey.n); };

  /* Button in either look. kind: primary | secondary | ghost; o.lead / o.trail: 'back' | 'arrow'; o.sm; o.cls: extra classes. */
  Runner.prototype._btn = function (kind, label, attrs, o) {
    o = o || {}; attrs = attrs || {};
    attrs.type = 'button';
    if (!this.opts.ui) {
      attrs['class'] = 'qp-btn qp-btn-' + kind + (o.sm ? ' qp-btn-sm' : '') + (o.cls ? ' ' + o.cls : '');
      return el('button', attrs, (o.lead === 'back' ? '← ' : '') + label + (o.trail === 'arrow' ? ' →' : ''));
    }
    attrs['class'] = 'ui-btn ui-btn--' + kind + (o.sm ? ' ui-btn--sm' : '') + (o.cls ? ' ' + o.cls : '');
    return el('button', attrs, el('span', { class: 'ui-btn__face' }, [o.lead ? icon(o.lead) : null, label, o.trail ? icon(o.trail) : null]));
  };
  /* Change a button's label in place (keeps icons). */
  function setBtnLabel(b, label) {
    var face = b.querySelector('.ui-btn__face') || b;
    for (var k = 0; k < face.childNodes.length; k++) if (face.childNodes[k].nodeType === 3) { face.childNodes[k].nodeValue = label; return; }
    face.appendChild(document.createTextNode(label));
  }
  /* Right after a click, show the result — not the "click again to unselect" hover — until the pointer leaves. */
  Runner.prototype._picked = function (node, id) {
    var self = this;
    if (this._jp !== id) return node;
    node.classList.add('just-picked');
    node.addEventListener('mouseleave', function () { node.classList.remove('just-picked'); if (self._jp === id) self._jp = null; });
    return node;
  };
  Runner.prototype.n = function () { return this.survey.q.length; };

  Runner.prototype.update = function (survey) {
    this.survey = survey;
    var max = this.n();
    if (this.idx > max) this.idx = max;
    if (this.idx < 0 && !this.hasIntro()) this.idx = 0;
    if (this.state === 'done') this.state = 'idle';
    this.render(true);
  };

  Runner.prototype.goTo = function (i, quiet) {
    clearTimeout(this._timer);
    this._jp = null;
    var min = this.hasIntro() ? -1 : 0;
    i = Math.max(min, Math.min(i, this.n()));
    this._dir = i >= this.idx ? 1 : -1;
    if (i >= this.n()) this.returnToReview = false;
    this.idx = i;
    if (this.state !== 'sending') this.state = 'idle';
    this.render(quiet);
  };
  Runner.prototype.next = function () {
    if (this.returnToReview && this.idx >= 0 && this.idx < this.n()) return this.goTo(this.n());
    this.goTo(this.idx + 1);
  };
  Runner.prototype.back = function () { this.returnToReview = false; this.goTo(this.idx - 1); };

  Runner.prototype.reset = function () {
    this.answers = {}; this.name = ''; this.noteOpen = {}; this.returnToReview = false;
    this.state = 'idle';
    this.startedAt = new Date().toISOString();
    this._save();
    this.goTo(this.hasIntro() ? -1 : 0);
  };

  Runner.prototype._save = function () {
    if (!this.opts.storageKey) return;
    QP.store.set(this.opts.storageKey, { answers: this.answers, name: this.name, startedAt: this.startedAt });
  };

  Runner.prototype.setAnswer = function (i, patch) {
    var a = this.answers[i] || {};
    for (var k in patch) a[k] = patch[k];
    this.answers[i] = a;
    this._save();
  };

  /* Indexes of required questions that have no answer yet. */
  Runner.prototype.missingRequired = function () {
    var self = this;
    return this.survey.q.map(function (q, i) { return q.r && !QP.isAnswered(q, self.answers[i]) ? i : -1; })
      .filter(function (i) { return i >= 0; });
  };

  Runner.prototype.payload = function () {
    var self = this;
    return {
      sid: this.survey.id,
      title: this.survey.t,
      name: this.name.trim(),
      startedAt: this.startedAt,
      submittedAt: new Date().toISOString(),
      answers: this.survey.q.map(function (q, i) {
        var a = self.answers[i] || {};
        return {
          n: i + 1,
          q: q.t,
          type: q.k,
          a: QP.answerText(q, a),
          note: (a.note || '').trim()
        };
      })
    };
  };

  Runner.prototype.submit = function () {
    var self = this;
    if (this.state === 'sending') return;
    this.state = 'sending';
    this.render(true);
    var p = this.opts.onSubmit ? this.opts.onSubmit(this.payload()) : Promise.resolve();
    Promise.resolve(p).then(function () {
      self.state = 'done';
      self.idx = self.n() + 1;
      if (self.opts.storageKey) QP.store.del(self.opts.storageKey);
      self.render();
    }, function (err) {
      self.state = 'error';
      self.error = (err && err.message) || 'Network error';
      self.render(true);
    });
  };

  Runner.prototype._bindKeys = function () {
    var self = this;
    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target && e.target.tagName) || '';
      var typing = tag === 'INPUT' || tag === 'TEXTAREA';
      var q = self.survey.q[self.idx];
      if (e.key === 'Enter' && !e.shiftKey) {
        if (typing && tag === 'TEXTAREA' && q && q.k === 'x') { /* plain Enter in long text moves on */ }
        else if (typing && tag === 'TEXTAREA') return;
        var btn = self.root.querySelector('[data-primary]:not([disabled])');
        if (btn) { e.preventDefault(); btn.click(); }
        return;
      }
      if (typing || !q) return;
      var opts = self.root.querySelectorAll('[data-key]');
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].getAttribute('data-key') === e.key.toLowerCase()) { e.preventDefault(); opts[i].click(); return; }
      }
    });
  };

  /* ----- Rendering ----- */
  Runner.prototype.render = function (quiet) {
    var root = this.root;
    root.textContent = '';
    var screen;
    if (this.opts.preview && !this.n() && this.idx >= 0) {
      root.appendChild(this._top());
      root.appendChild(el('div', { class: 'qp-empty', text: 'Your questions will appear here.' }));
      return;
    }
    if (this.idx === -1) screen = this._intro();
    else if (this.idx < this.n()) screen = this._question(this.idx);
    else if (this.idx === this.n() && this.state !== 'done') screen = this._review();
    else screen = this._done();
    var wrap = el('div', { class: 'qp-screen' + (quiet ? '' : (this._dir > 0 ? ' qp-in-next' : ' qp-in-prev')) }, screen);
    root.appendChild(this._top());
    root.appendChild(wrap);
    if (!quiet && !this.opts.preview) {
      if (window.scrollY > 0) window.scrollTo(0, 0);
      var touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
      var f = touch ? null : wrap.querySelector('[data-autofocus]');
      if (f) setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } }, 30);
    }
  };

  Runner.prototype._top = function () {
    var self = this;
    var n = this.n();
    var inQ = this.idx >= 0 && this.idx < n;
    var pct = this.idx < 0 ? 0 : Math.min(100, Math.round((Math.min(this.idx, n) / Math.max(n, 1)) * 100));
    if (this.state === 'done') pct = 100;
    if (this.opts.ui) {
      return el('div', { class: 'qp-top' }, el('div', { class: 'ui-progress' }, [
        el('div', { class: 'ui-progress__head' }, [
          el('span', { class: 'qp-top-title', text: this.survey.t || 'Untitled poll' }),
          el('span', { class: 'qp-count', text: inQ ? (this.idx + 1) + ' / ' + n : '' })
        ]),
        el('div', { class: 'ui-progress__track', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' },
          el('div', { class: 'ui-progress__bar', style: 'width:' + pct + '%' }))
      ]));
    }
    return el('div', { class: 'qp-top' }, [
      el('div', { class: 'qp-top-row' }, [
        el('div', { class: 'qp-top-title', text: this.survey.t || 'Untitled poll' }),
        el('div', { class: 'qp-count', text: inQ ? (this.idx + 1) + ' / ' + n : '' })
      ]),
      el('div', { class: 'qp-progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' },
        el('div', { class: 'qp-progress-bar', style: 'width:' + pct + '%' }))
    ]);
  };

  Runner.prototype._intro = function () {
    var self = this;
    var s = this.survey;
    var kids = [el('h1', { class: 'qp-title', text: s.t || 'Untitled poll' })];
    if (s.d) kids.push(el('p', { class: 'qp-desc', text: s.d }));
    var meta = s.q.length + ' question' + (s.q.length === 1 ? '' : 's') + ' · about ' + Math.max(1, Math.round(s.q.length / 6)) + ' min';
    kids.push(el('p', { class: 'qp-meta', text: meta }));
    if (s.n) {
      kids.push(el('label', { class: 'qp-label', for: 'qp-name', text: 'Your name' }));
      kids.push(el('input', {
        id: 'qp-name', class: this.opts.ui ? 'ui-input qp-name' : 'qp-input', type: 'text', autocomplete: 'name', placeholder: 'e.g. Alex',
        value: this.name, 'data-autofocus': true,
        oninput: function (e) { self.name = e.target.value; self._save(); }
      }));
    }
    kids.push(el('div', { class: 'qp-actions' }, this._btn('primary', 'Start', {
      'data-primary': true, disabled: !s.q.length, onclick: function () { self.next(); }
    }, { trail: 'arrow' })));
    return kids;
  };

  Runner.prototype._question = function (i) {
    var self = this;
    var q = this.survey.q[i];
    var a = this.answers[i] || {};
    var kids = [];
    if (q.r) {
      kids.push(el('div', { class: 'qp-req' }, [
        el('span', { class: this.opts.ui ? 'ui-badge ui-badge--required' : 'qp-req-tag', text: 'Required' }),
        el('span', { class: 'qp-req-note', text: 'You can skip it for now — we’ll remind you before sending.' })
      ]));
    }
    kids.push(el('h2', { class: 'qp-q', id: 'qp-q-' + i, text: q.t || 'Untitled question' }));
    var sub = q.h || ({ m: 'Select all that apply' })[q.k] || '';
    if (sub) kids.push(el('p', { class: 'qp-hint', text: sub }));

    if (q.k === 's' || q.k === 'm') kids.push(this._choices(i, q, a));
    else if (q.k === 'y') kids.push(this._yesno(i, q, a));
    else if (q.k === 'r') kids.push(this._scale(i, q, a));
    else if (q.k === 'i') kids.push(this._images(i, q, a));
    else if (q.k === 'x') kids.push(this._text(i, q, a));

    // Optional comment — available at any moment, no auto-advance gets in the way
    if (q.c) {
      if (this.noteOpen[i] || a.note) {
        kids.push(el('textarea', {
          class: (this.opts.ui ? 'ui-textarea' : 'qp-input') + ' qp-note', rows: '2', placeholder: 'Add a comment (optional)',
          'aria-label': 'Comment',
          oninput: function (e) { self.setAnswer(i, { note: e.target.value }); }
        }, a.note || ''));
      } else {
        var openNote = function () { self.noteOpen[i] = true; self.render(true); var t = self.root.querySelector('.qp-note'); if (t) t.focus(); };
        kids.push(this.opts.ui
          ? this._btn('ghost', '+ Add a comment', { onclick: openNote }, { sm: true, cls: 'qp-add-note' })
          : el('button', { class: 'qp-link', type: 'button', onclick: openNote }, '+ Add a comment'));
      }
    }
    kids.push(this._nav(i));
    return kids;
  };

  /* Bottom navigation: ← Previous on the left; on the right Skip (secondary) until
   * the question is answered, then Next → (primary). */
  Runner.prototype._nav = function (i) {
    var self = this;
    var q = this.survey.q[i];
    var answered = QP.isAnswered(q, this.answers[i]);
    var last = i === this.n() - 1;
    var toReview = last || this.returnToReview;
    var minIdx = this.hasIntro() ? -1 : 0;
    var prev = this._btn(this.opts.ui ? 'secondary' : 'ghost', 'Previous', {
      disabled: i <= minIdx ? true : null, 'aria-hidden': i <= minIdx ? 'true' : null,
      onclick: function () { self.back(); }
    }, { lead: 'back', cls: 'qp-prev' });
    var fwd = answered
      ? this._btn('primary', toReview ? (this.returnToReview ? 'Back to review' : 'Review') : 'Next',
          { 'data-primary': true, onclick: function () { self.next(); } }, { trail: 'arrow', cls: 'qp-next' })
      : this._btn('secondary', toReview ? (this.returnToReview ? 'Back to review' : 'Skip to review') : 'Skip',
          { onclick: function () { self.next(); } }, { cls: 'qp-skip' });
    return el('div', { class: 'qp-nav' }, [prev, fwd]);
  };

  /* Re-draw only the navigation (keeps focus in text fields while typing). */
  Runner.prototype._refreshNav = function (i) {
    var old = this.root.querySelector('.qp-nav');
    if (old) old.replaceWith(this._nav(i));
  };

  function keyFor(idx) { return idx < 9 ? String(idx + 1) : (idx < 35 ? String.fromCharCode(97 + idx - 9) : ''); }

  Runner.prototype._choices = function (i, q, a) {
    var self = this;
    var multi = q.k === 'm';
    var opts = (q.o || []).map(function (o, idx) { return { label: o.trim(), idx: idx }; }).filter(function (o) { return o.label; });
    var selected = multi ? (Array.isArray(a.v) ? a.v : []) : [a.v];
    return el('div', { class: 'qp-options', role: multi ? 'group' : 'radiogroup', 'aria-labelledby': 'qp-q-' + i },
      opts.map(function (o, n) {
        var on = selected.indexOf(o.label) >= 0;
        var pid = 'c' + i + ':' + n;
        var ui = self.opts.ui;
        return self._picked(el('button', {
          class: ui ? 'ui-option' + (multi ? ' ui-option--multi' : '') : 'qp-opt' + (on ? ' is-on' : '') + (multi ? ' is-multi' : ''),
          type: 'button', role: multi ? 'checkbox' : 'radio', 'aria-checked': on ? 'true' : 'false',
          'data-key': keyFor(n), 'data-autofocus': n === 0 ? true : null,
          onclick: function () {
            self._jp = pid;
            if (multi) {
              var cur = Array.isArray(a.v) ? a.v.slice() : [];
              var at = cur.indexOf(o.label);
              if (at >= 0) cur.splice(at, 1); else cur.push(o.label);
              // keep option order
              cur.sort(function (x, y) { return q.o.indexOf(x) - q.o.indexOf(y); });
              self.setAnswer(i, { v: cur });
              self.render(true);
            } else {
              self.setAnswer(i, { v: a.v === o.label ? undefined : o.label });   // second click unselects
              self.render(true);
            }
          }
        }, ui ? [
          el('span', { class: 'ui-option__key', 'aria-hidden': 'true', text: keyFor(n) }),
          el('span', { class: 'ui-option__label', text: o.label }),
          el('span', { class: 'ui-option__mark', 'aria-hidden': 'true' }, icon('check'))
        ] : [
          el('span', { class: 'qp-key', 'aria-hidden': 'true', text: keyFor(n) }),
          el('span', { class: 'qp-opt-label', text: o.label }),
          el('span', { class: 'qp-check', 'aria-hidden': 'true', text: on ? '✓' : '' })
        ]), pid);
      }));
  };

  Runner.prototype._yesno = function (i, q, a) {
    var self = this;
    if (this.opts.ui) {
      return el('div', { class: 'ui-yn qp-yesno', role: 'radiogroup', 'aria-labelledby': 'qp-q-' + i },
        [['Yes', 'y', 'yes'], ['No', 'n', 'no']].map(function (p, n) {
          var on = a.v === p[0];
          var pid = 'y' + i + ':' + n;
          return el('div', { class: 'ui-yn__item' + (on ? ' is-selected' : '') }, [
            self._picked(el('button', {
              class: 'ui-yn__btn ui-yn__btn--' + p[2], type: 'button', role: 'radio', 'aria-label': p[0],
              'aria-checked': on ? 'true' : 'false', 'data-key': p[1], 'data-autofocus': n === 0 ? true : null,
              onclick: function () { self._jp = pid; self.setAnswer(i, { v: a.v === p[0] ? undefined : p[0] }); self.render(true); }
            }, icon(p[2])), pid),
            el('span', { class: 'ui-yn__label', 'aria-hidden': 'true', text: p[0] })
          ]);
        }));
    }
    return el('div', { class: 'qp-yesno', role: 'radiogroup', 'aria-labelledby': 'qp-q-' + i },
      [['Yes', 'y', '✓'], ['No', 'n', '✕']].map(function (p, n) {
        var on = a.v === p[0];
        return el('button', {
          class: 'qp-yn qp-yn-' + p[1] + (on ? ' is-on' : ''), type: 'button', role: 'radio',
          'aria-checked': on ? 'true' : 'false', 'data-key': p[1], 'data-autofocus': n === 0 ? true : null,
          onclick: function () { self.setAnswer(i, { v: a.v === p[0] ? undefined : p[0] }); self.render(true); }
        }, [el('span', { class: 'qp-yn-icon', 'aria-hidden': 'true', text: p[2] }), el('span', { text: p[0] })]);
      }));
  };

  Runner.prototype._scale = function (i, q, a) {
    var self = this;
    var max = q.s === 10 ? 10 : 5;
    var btns = [];
    for (var v = 1; v <= max; v++) {
      (function (v) {
        var on = Number(a.v) === v;
        var pid = 'r' + i + ':' + v;
        btns.push(self._picked(el('button', {
          class: self.opts.ui ? 'ui-key' + (max === 10 ? ' ui-key--sm' : '') : 'qp-scale-btn' + (on ? ' is-on' : ''), type: 'button', role: 'radio',
          'aria-checked': on ? 'true' : 'false', 'aria-label': String(v) + ' of ' + max,
          'data-key': v === 10 ? '0' : String(v), 'data-autofocus': v === 1 ? true : null,
          onclick: function () { self._jp = pid; self.setAnswer(i, { v: Number(a.v) === v ? undefined : v }); self.render(true); }
        }, String(v)), pid));
      })(v);
    }
    var labels = q.l || ['', ''];
    var ui = this.opts.ui;
    return el('div', { class: 'qp-scale-wrap' }, [
      el('div', { class: (ui ? 'ui-scale ' : '') + 'qp-scale qp-scale-' + max, role: 'radiogroup', 'aria-labelledby': 'qp-q-' + i }, btns),
      (labels[0] || labels[1]) ? el('div', { class: ui ? 'ui-scale__labels qp-scale-labels' : 'qp-scale-labels' }, [
        el('span', { text: labels[0] || '' }), el('span', { text: labels[1] || '' })
      ]) : null
    ]);
  };

  /* Image aspect ratios, remembered so re-renders don't jump. */
  QP._ratio = {};

  /* Auto layout: wide pictures (screenshots, mockups) go full width, others in a grid. */
  function autoLayout(items) {
    var r = items.map(function (it) { return QP._ratio[it.url]; });
    if (!r.length || r.some(function (x) { return !x; })) return null;   // not measured yet
    var avg = r.reduce(function (a, b) { return a + b; }, 0) / r.length;
    if (avg >= 1.45) return 'f';
    return items.length === 3 ? 'r' : 'g';
  }

  Runner.prototype._images = function (i, q, a) {
    var self = this;
    var items = (q.o || []).map(function (lbl, idx) {
      return { label: lbl.trim(), url: (q.i || [])[idx] || '', idx: idx };
    }).filter(function (it) { return it.url || it.label; });
    var layout = q.y || autoLayout(items) || 'g';
    var gallery = items.map(function (it, n) { return { url: it.url, value: it.label || ('Option ' + String.fromCharCode(65 + n)) }; })
      .filter(function (g) { return g.url; });
    var wrap = el('div', { class: 'qp-images qp-lay-' + layout, role: 'radiogroup', 'aria-labelledby': 'qp-q-' + i });
    var pending = 0;
    items.forEach(function (it, n) {
      var value = it.label || ('Option ' + String.fromCharCode(65 + n));
      var on = a.v === value;
      var img = null;
      if (it.url) {
        img = el('img', { src: it.url, alt: it.label || value, referrerpolicy: 'no-referrer' });
        img.addEventListener('error', function () { img.replaceWith(el('div', { class: 'qp-img-missing', text: 'Image unavailable' })); });
        if (!q.y && !QP._ratio[it.url]) {
          pending++;
          img.addEventListener('load', function () {
            QP._ratio[it.url] = img.naturalWidth / Math.max(1, img.naturalHeight);
            var lay = autoLayout(items);
            if (lay && lay !== layout && wrap.isConnected) { wrap.className = 'qp-images qp-lay-' + lay; layout = lay; }
          });
        }
      }
      var pid = 'i' + i + ':' + n;
      var pick = function () { self._jp = pid; self.setAnswer(i, { v: a.v === value ? undefined : value }); self.render(true); };
      var zoom = function (e) { e.stopPropagation(); self._lightbox(i, gallery, gallery.map(function (g) { return g.url; }).indexOf(it.url)); };
      if (self.opts.ui) {
        wrap.appendChild(el('div', { class: 'qp-img-item' }, [
          self._picked(el('button', {
            class: 'ui-imgcard', type: 'button', role: 'radio',
            'aria-checked': on ? 'true' : 'false', 'data-key': keyFor(n), 'data-autofocus': n === 0 ? true : null,
            onclick: pick
          }, [
            el('span', { class: 'ui-imgcard__box' }, img || el('span', { class: 'qp-img-missing', text: 'No image' })),
            el('span', { class: 'ui-imgcard__cap' }, [
              el('span', { class: 'ui-option__key', 'aria-hidden': 'true', text: keyFor(n) }),
              el('span', { class: 'ui-option__label', text: value }),
              el('span', { class: 'ui-option__mark', 'aria-hidden': 'true' }, icon('check'))
            ])
          ]), pid),
          it.url ? el('button', {
            class: 'ui-btn ui-btn--overlay ui-btn--icon ui-btn--sm qp-zoom-ui', type: 'button', 'aria-label': 'Enlarge ' + value, title: 'Enlarge',
            onclick: zoom
          }, el('span', { class: 'ui-btn__face' }, icon('zoom'))) : null
        ]));
        return;
      }
      var card = el('div', { class: 'qp-img-item' }, [
        el('button', {
          class: 'qp-img-opt' + (on ? ' is-on' : ''), type: 'button', role: 'radio',
          'aria-checked': on ? 'true' : 'false', 'data-key': keyFor(n), 'data-autofocus': n === 0 ? true : null,
          onclick: pick
        }, [
          el('div', { class: 'qp-img-box' }, img || el('div', { class: 'qp-img-missing', text: 'No image' })),
          el('div', { class: 'qp-img-cap' }, [
            el('span', { class: 'qp-key', 'aria-hidden': 'true', text: keyFor(n) }),
            el('span', { class: 'qp-img-label', text: value }),
            el('span', { class: 'qp-check', 'aria-hidden': 'true', text: on ? '✓' : '' })
          ])
        ]),
        it.url ? el('button', {
          class: 'qp-zoom', type: 'button', 'aria-label': 'Enlarge ' + value, title: 'Enlarge',
          onclick: zoom
        }, zoomIcon()) : null
      ]);
      wrap.appendChild(card);
    });
    return wrap;
  };

  function zoomIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M8.5 3.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12.2 12.2L16.5 16.5M8.5 6.5v4M6.5 8.5h4');
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linecap', 'round');
    svg.appendChild(p);
    return svg;
  }

  /* Full-screen gallery: ‹ › arrows, keyboard ← →, swipe, counter, and "Choose this" for the picture on screen. */
  Runner.prototype._lightbox = function (qi, gallery, start) {
    var self = this;
    if (!gallery.length) return;
    var idx = Math.max(0, start);
    var prevFocus = document.activeElement;
    var many = gallery.length > 1;
    var img = el('img', { alt: '', referrerpolicy: 'no-referrer' });
    var label = el('span', { class: 'qp-lb-label' });
    var count = el('div', { class: 'qp-lb-count', 'aria-live': 'polite' });
    var choose = this._btn('primary', 'Choose this', {}, { cls: 'qp-lb-choose' });
    var badge = this.opts.ui
      ? el('span', { class: 'qp-lb-badge', 'aria-hidden': 'true' }, icon('check'))
      : el('span', { class: 'qp-lb-badge', 'aria-hidden': 'true', text: '✓' });
    var frame = el('div', { class: 'qp-lb-frame' }, [img, badge]);
    var box;
    var show = function (n) {
      idx = (n + gallery.length) % gallery.length;
      var g = gallery[idx];
      img.src = g.url; img.alt = g.value;
      label.textContent = g.value;
      count.textContent = many ? (idx + 1) + ' / ' + gallery.length : '';
      var on = (self.answers[qi] || {}).v === g.value;
      setBtnLabel(choose, on ? 'Unselect' : 'Choose this');
      choose.className = self.opts.ui
        ? 'ui-btn qp-lb-choose ' + (on ? 'ui-btn--secondary' : 'ui-btn--primary')
        : 'qp-btn qp-lb-choose ' + (on ? 'qp-btn-secondary' : 'qp-btn-primary');
      frame.classList.toggle('is-on', on);
      badge.hidden = !on;
    };
    var close = function () {
      box.remove(); document.removeEventListener('keydown', onKey, true);
      self.render(true);
      var again = self.root.querySelectorAll('.qp-zoom, .qp-zoom-ui')[idx];
      if (again) again.focus(); else if (prevFocus && prevFocus.focus) prevFocus.focus();
    };
    var onKey = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' && many) { e.preventDefault(); e.stopPropagation(); show(idx + 1); }
      else if (e.key === 'ArrowLeft' && many) { e.preventDefault(); e.stopPropagation(); show(idx - 1); }
      else if (e.key === 'Enter' && e.target !== choose && !(e.target.classList && e.target.classList.contains('qp-lb-close'))) { e.preventDefault(); e.stopPropagation(); choose.click(); }
      else e.stopPropagation();   // keep the survey's shortcuts (digits, Enter) from acting behind the viewer
    };
    choose.addEventListener('click', function () {
      var g = gallery[idx];
      var on = (self.answers[qi] || {}).v === g.value;
      if (on) { self.setAnswer(qi, { v: undefined }); show(idx); return; }   // unselect, keep the viewer open
      self.setAnswer(qi, { v: g.value });
      show(idx);
      setTimeout(close, 220);
    });
    var arrow = function (dir) {
      return el('button', {
        class: 'qp-lb-arrow qp-lb-' + (dir < 0 ? 'prev' : 'next'), type: 'button',
        'aria-label': dir < 0 ? 'Previous image' : 'Next image',
        onclick: function (e) { e.stopPropagation(); show(idx + dir); }
      }, dir < 0 ? '‹' : '›');
    };
    var stage = el('div', { class: 'qp-lb-stage' }, [many ? arrow(-1) : null, frame, many ? arrow(1) : null]);
    box = el('div', { class: 'qp-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Image viewer',
      onclick: function (e) { if (e.target === box || e.target === stage) close(); } }, [
      count,
      el('button', { class: 'qp-lb-close', type: 'button', 'aria-label': 'Close', onclick: close }, '✕'),
      stage,
      el('div', { class: 'qp-lb-bar' }, [label, choose])
    ]);
    // swipe on touch screens
    var sx = null, sy = null;
    stage.addEventListener('touchstart', function (e) { var t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (sx === null || !many) return;
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) show(idx + (dx < 0 ? 1 : -1));
      sx = sy = null;
    });
    show(idx);
    document.body.appendChild(box);
    document.addEventListener('keydown', onKey, true);
    choose.focus();
  };

  Runner.prototype._text = function (i, q, a) {
    var self = this;
    var ta = el('textarea', {
      class: (this.opts.ui ? 'ui-textarea' : 'qp-input') + ' qp-text', rows: '3', placeholder: 'Type your answer…',
      'aria-labelledby': 'qp-q-' + i, 'data-autofocus': true,
      oninput: function (e) {
        var had = QP.isAnswered(q, self.answers[i]);
        self.setAnswer(i, { v: e.target.value });
        if (had !== QP.isAnswered(q, self.answers[i])) self._refreshNav(i);
      }
    }, a.v || '');
    return ta;
  };

  Runner.prototype._review = function () {
    var self = this;
    var s = this.survey;
    var missing = this.missingRequired();
    var kids = [el('h2', { class: 'qp-q', text: 'Ready to send?' }),
      el('p', { class: 'qp-hint', text: 'Tap any answer to change it.' })];
    if (missing.length) {
      kids.push(el('div', { class: 'qp-alert qp-alert-warn', role: 'status' }, [
        el('span', { text: missing.length === 1
          ? 'One required question still needs an answer.'
          : missing.length + ' required questions still need an answer.' }),
        this._btn('secondary', 'Answer now', { onclick: function () { self.returnToReview = true; self.goTo(missing[0]); } }, { sm: true, trail: 'arrow' })
      ]));
    }
    kids.push(el('ol', { class: 'qp-review' }, s.q.map(function (q, i) {
      var txt = QP.answerText(q, self.answers[i]);
      var note = (self.answers[i] && self.answers[i].note) || '';
      var miss = missing.indexOf(i) >= 0;
      return el('li', null, el('button', {
        class: 'qp-review-item' + (miss ? ' is-missing' : ''), type: 'button',
        onclick: function () { self.returnToReview = true; self.goTo(i); }
      }, [
        el('span', { class: 'qp-review-q', text: (i + 1) + '. ' + (q.t || 'Untitled question') }),
        el('span', { class: 'qp-review-a' + (txt ? '' : ' is-empty'), text: txt || (q.r ? 'Required — tap to answer' : 'Skipped') }),
        note ? el('span', { class: 'qp-review-note', text: '“' + note + '”' }) : null
      ]));
    })));
    if (this.state === 'error') {
      kids.push(el('div', { class: 'qp-alert', role: 'alert' }, [
        el('strong', { text: 'Couldn’t send your answers. ' }),
        el('span', { text: 'Check your connection and try again — nothing is lost.' })
      ]));
    }
    var sending = this.state === 'sending';
    kids.push(el('div', { class: 'qp-nav' }, [
      this._btn(this.opts.ui ? 'secondary' : 'ghost', 'Previous', { onclick: function () { self.back(); } }, { lead: 'back', cls: 'qp-prev' }),
      this._btn('primary', sending ? 'Sending…' : (this.state === 'error' ? 'Try again' : 'Send answers'), {
        'data-primary': true, disabled: sending || missing.length > 0, onclick: function () { self.submit(); }
      }, { cls: 'qp-btn-send' })
    ]));
    return kids;
  };

  Runner.prototype._done = function () {
    var self = this;
    var kids = [
      this.opts.ui ? el('div', { class: 'qp-done-icon', 'aria-hidden': 'true' }, icon('yes')) : el('div', { class: 'qp-done-icon', 'aria-hidden': 'true', text: '✓' }),
      el('h2', { class: 'qp-q qp-center', text: 'Thank you!' }),
      el('p', { class: 'qp-hint qp-center', text: this.opts.preview ? 'This is a preview — nothing was sent.' : 'Your answers have been sent. You can close this page.' })
    ];
    if (this.opts.preview || this.opts.allowRestart) {
      kids.push(el('div', { class: 'qp-actions qp-center' }, this._btn('ghost', this.opts.preview ? 'Restart preview' : 'Answer again', { onclick: function () { self.reset(); } })));
    }
    return el('div', { class: 'qp-done' }, kids);
  };

  global.QP = QP;
})(window);
