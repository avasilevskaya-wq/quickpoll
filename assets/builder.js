/* QuickPoll — builder */
(function () {
  'use strict';
  var el = QP.el;
  var store = QP.store;
  var cfg = window.QP_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- State ---------- */
  var drafts = store.get('qp_drafts', {});          // id -> { s: survey, u: updatedAt }
  var survey = null;
  var mode = 'cards';
  var activeQ = -1;
  var showErrors = false;
  var runner = null;
  var lastDeleted = null;
  var supportsFieldSizing = !!(window.CSS && CSS.supports && CSS.supports('field-sizing', 'content'));

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function savedEndpoint() { return (store.get('qp_endpoint', '') || '').trim(); }
  function endpoint() { return savedEndpoint() || (cfg.endpoint || '').trim(); }

  function isBlank(s) { return !s.t.trim() && !s.d.trim() && !s.q.length; }

  function load(id) {
    var d = drafts[id];
    survey = d ? QP.normalize(d.s) : QP.newSurvey();
    // builder keeps editable arrays for choice questions
    survey.q.forEach(ensureShape);
    store.set('qp_current', survey.id);
    activeQ = -1; showErrors = false;
    render();
    if (runner) runner.update(previewSurvey()); else startPreview();
    runner.goTo(runner.hasIntro() ? -1 : 0, true);
  }

  function ensureShape(q) {
    if ((q.k === 's' || q.k === 'm' || q.k === 'i') && (!q.o || !q.o.length)) q.o = ['', ''];
    if (q.k === 'i') { q.i = q.i || []; while (q.i.length < q.o.length) q.i.push(''); }
    if (q.k === 'r') { q.s = q.s === 10 ? 10 : 5; q.l = q.l || ['', '']; }
  }

  /* ---------- Saving ---------- */
  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    $('saved').textContent = 'Saving…';
    saveTimer = setTimeout(function () {
      if (isBlank(survey) && !drafts[survey.id]) { $('saved').textContent = ''; return; }
      drafts[survey.id] = { s: survey, u: Date.now() };
      var ok = store.set('qp_drafts', drafts);
      store.set('qp_current', survey.id);
      $('saved').textContent = ok ? 'Saved' : 'Not saved (storage blocked)';
    }, 350);
  }

  var previewTimer = null;
  function changed(opts) {
    save();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      runner.update(previewSurvey());
      if (opts && typeof opts.goTo === 'number') runner.goTo(opts.goTo, true);
    }, 120);
    if (showErrors) refreshErrors();
  }

  function previewSurvey() { return QP.normalize(clone(survey)); }

  function startPreview() {
    runner = new QP.Runner($('preview'), previewSurvey(), { preview: true });
  }

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function toast(msg, action) {
    var t = $('toast');
    t.textContent = '';
    t.appendChild(el('span', { text: msg }));
    if (action) t.appendChild(el('button', { type: 'button', onclick: function () { action.fn(); t.classList.remove('show'); } }, action.label));
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, action ? 6000 : 2200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  function autosize(t) {
    if (supportsFieldSizing) return;
    t.style.height = 'auto';
    t.style.height = (t.scrollHeight + 2) + 'px';
  }

  /* ---------- Rendering ---------- */
  function render() {
    $('tab-cards').classList.toggle('is-on', mode === 'cards');
    $('tab-text').classList.toggle('is-on', mode === 'text');
    $('tab-cards').setAttribute('aria-selected', mode === 'cards');
    $('tab-text').setAttribute('aria-selected', mode === 'text');
    $('cards-view').hidden = mode !== 'cards';
    $('text-view').hidden = mode !== 'text';
    $('editor-hint').textContent = mode === 'cards'
      ? 'Tip: paste a list into an option to add many at once'
      : 'Type or paste questions — the preview updates as you go';
    if (mode === 'cards') renderCards(); else renderText();
  }

  function toggle(label, checked, onchange) {
    return el('label', { class: 'toggle' }, [
      el('input', { type: 'checkbox', checked: checked ? true : null, onchange: function (e) { onchange(e.target.checked); } }),
      el('span', { class: 'track', 'aria-hidden': 'true' }),
      el('span', { text: label })
    ]);
  }

  function renderCards() {
    var root = $('cards-view');
    root.textContent = '';

    var title = el('input', {
      class: 'title-input', type: 'text', placeholder: 'Poll title', 'aria-label': 'Poll title', value: survey.t, maxlength: '200',
      oninput: function (e) { survey.t = e.target.value; changed(); },
      onfocus: function () { setActive(-1); }
    });
    var desc = el('textarea', {
      class: 'desc-input', rows: '1', placeholder: 'Short intro for your client (optional)', 'aria-label': 'Description', maxlength: '1000',
      oninput: function (e) { survey.d = e.target.value; autosize(e.target); changed({ goTo: -1 }); },
      onfocus: function () { setActive(-1); if (runner.hasIntro()) runner.goTo(-1, true); }
    }, survey.d);
    root.appendChild(el('div', { class: 'panel meta-panel' }, [
      title, desc,
      el('div', { class: 'meta-row' }, [
        toggle('Ask for respondent’s name', survey.n, function (v) { survey.n = v ? 1 : 0; changed({ goTo: v ? -1 : undefined }); })
      ])
    ]));
    requestAnimationFrame(function () { autosize(desc); });

    if (!survey.q.length) {
      root.appendChild(emptyState());
    } else {
      var list = el('div', { class: 'qlist', id: 'qlist' });
      survey.q.forEach(function (q, i) { list.appendChild(renderCard(q, i)); });
      root.appendChild(list);
    }
    root.appendChild(addBar());
    if (showErrors) refreshErrors();
  }

  function emptyState() {
    var tpls = (window.QP_TEMPLATES || []).slice(0, 3);
    return el('div', { class: 'panel empty' }, [
      el('h3', { text: 'Add your first question' }),
      el('p', { text: 'Pick a question type below, or start from a template.' }),
      el('div', { class: 'empty-actions' }, tpls.map(function (t) {
        return el('button', { class: 'btn btn-sm', type: 'button', onclick: function () { applyTemplate(t, true); } }, t.name);
      }))
    ]);
  }

  function addBar() {
    return el('div', { class: 'panel addbar' }, [el('span', { class: 'addbar-label', text: 'Add' })].concat(
      QP.TYPE_ORDER.map(function (k) {
        return el('button', { class: 'btn btn-sm add-type', type: 'button', 'data-add': k, onclick: function () { addQuestion(k); } }, [
          el('span', { class: 'ic', 'aria-hidden': 'true', text: QP.TYPES[k].icon }), QP.TYPES[k].short
        ]);
      })
    ));
  }

  function setActive(i) {
    activeQ = i;
    var cards = document.querySelectorAll('.qcard');
    for (var n = 0; n < cards.length; n++) cards[n].classList.toggle('is-active', Number(cards[n].getAttribute('data-i')) === i);
    if (i >= 0 && runner && runner.idx !== i) runner.goTo(i, true);
  }

  function cardEl(i) { return document.querySelector('.qcard[data-i="' + i + '"]'); }
  function rerenderCard(i, focusSel, caretEnd) {
    var old = cardEl(i);
    if (!old) return renderCards();
    var fresh = renderCard(survey.q[i], i);
    old.replaceWith(fresh);
    if (focusSel) {
      var f = fresh.querySelector(focusSel);
      if (f) { f.focus(); if (caretEnd && f.setSelectionRange) { var l = f.value.length; f.setSelectionRange(l, l); } }
    }
  }

  function renderCard(q, i) {
    var n = survey.q.length;
    var typeSel = el('select', {
      class: 'type-select', 'aria-label': 'Question type',
      onchange: function (e) { convert(q, e.target.value); rerenderCard(i); changed({ goTo: i }); }
    }, QP.TYPE_ORDER.map(function (k) {
      return el('option', { value: k, selected: k === q.k ? true : null }, QP.TYPES[k].icon + '  ' + QP.TYPES[k].label);
    }));

    var head = el('div', { class: 'qcard-head' }, [
      el('span', { class: 'qnum', text: String(i + 1) }),
      typeSel,
      el('div', { class: 'qcard-tools' }, [
        el('button', { class: 'icon-btn', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0 ? true : null, onclick: function () { move(i, -1); } }, '↑'),
        el('button', { class: 'icon-btn', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === n - 1 ? true : null, onclick: function () { move(i, 1); } }, '↓'),
        el('button', { class: 'icon-btn', type: 'button', title: 'Duplicate', 'aria-label': 'Duplicate', onclick: function () { duplicate(i); } }, '⧉'),
        el('button', { class: 'icon-btn danger', type: 'button', title: 'Delete', 'aria-label': 'Delete question', onclick: function () { remove(i); } }, '✕')
      ])
    ]);

    var text = el('textarea', {
      class: 'q-text', rows: '1', placeholder: 'Type your question', 'aria-label': 'Question ' + (i + 1), maxlength: '500',
      oninput: function (e) { q.t = e.target.value; autosize(e.target); changed(); }
    }, q.t);
    requestAnimationFrame(function () { autosize(text); });

    var hint = el('input', {
      class: 'q-hint-input', type: 'text', placeholder: 'Hint under the question (optional)', 'aria-label': 'Hint', value: q.h || '', maxlength: '500',
      oninput: function (e) { q.h = e.target.value; changed(); }
    });

    var body;
    if (q.k === 's' || q.k === 'm') body = optionsEditor(q, i);
    else if (q.k === 'i') body = imagesEditor(q, i);
    else if (q.k === 'y') body = el('div', { class: 'yn-demo', 'aria-hidden': 'true' }, [el('span', { text: '✓ Yes' }), el('span', { text: '✕ No' })]);
    else if (q.k === 'r') body = scaleEditor(q, i);
    else body = el('div', { class: 'type-note', text: 'Respondent types a short answer. Use sparingly — taps are faster.' });

    var foot = el('div', { class: 'qcard-foot' }, [
      toggle('Required', q.r, function (v) { q.r = v ? 1 : 0; changed({ goTo: i }); }),
      toggle('Allow comment', q.c, function (v) { q.c = v ? 1 : 0; changed({ goTo: i }); })
    ]);

    var card = el('div', {
      class: 'panel qcard' + (i === activeQ ? ' is-active' : ''), 'data-i': String(i), id: 'q-' + i
    }, [head, text, hint, el('div', { class: 'q-err', hidden: true }), body, foot]);
    card.addEventListener('focusin', function () { if (activeQ !== i) setActive(i); });
    card.addEventListener('mousedown', function () { if (activeQ !== i) setActive(i); });
    return card;
  }

  function splitPasted(text) {
    return text.split(/\r?\n/).map(function (l) { return l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim(); }).filter(Boolean);
  }

  function optionsEditor(q, i) {
    var wrap = el('div', { class: 'opts' });
    var multi = q.k === 'm';
    q.o.forEach(function (o, j) {
      var inp = el('input', {
        class: 'opt-input', type: 'text', value: o, placeholder: 'Option ' + (j + 1), 'aria-label': 'Option ' + (j + 1), 'data-j': String(j), maxlength: '200',
        oninput: function (e) { q.o[j] = e.target.value; changed(); },
        onkeydown: function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            q.o.splice(j + 1, 0, '');
            rerenderCard(i, '.opt-input[data-j="' + (j + 1) + '"]');
            changed();
          } else if (e.key === 'Backspace' && !e.target.value && q.o.length > 1) {
            e.preventDefault();
            q.o.splice(j, 1);
            rerenderCard(i, '.opt-input[data-j="' + Math.max(0, j - 1) + '"]', true);
            changed();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            var t = cardEl(i).querySelector('.opt-input[data-j="' + (j + (e.key === 'ArrowDown' ? 1 : -1)) + '"]');
            if (t) { e.preventDefault(); t.focus(); }
          }
        },
        onpaste: function (e) {
          var txt = (e.clipboardData || window.clipboardData).getData('text');
          if (!/\n/.test(txt)) return;
          e.preventDefault();
          var items = splitPasted(txt);
          if (!items.length) return;
          var before = e.target.value.trim();
          if (before) q.o.splice(j + 1, 0, ...items); else q.o.splice(j, 1, ...items);
          // drop empty trailing placeholders
          q.o = q.o.filter(function (x, idx) { return x.trim() || idx < 1; });
          if (!q.o.length) q.o = [''];
          var last = (before ? j + items.length : j + items.length - 1);
          rerenderCard(i, '.opt-input[data-j="' + Math.min(last, q.o.length - 1) + '"]', true);
          changed();
          toast('Added ' + items.length + ' options');
        }
      });
      wrap.appendChild(el('div', { class: 'opt-row' }, [
        el('span', { class: 'opt-bullet' + (multi ? ' sq' : ''), 'aria-hidden': 'true' }),
        inp,
        el('button', {
          class: 'icon-btn danger', type: 'button', 'aria-label': 'Remove option ' + (j + 1), title: 'Remove', disabled: q.o.length <= 1 ? true : null,
          onclick: function () { q.o.splice(j, 1); rerenderCard(i); changed(); }
        }, '✕')
      ]));
    });
    // ghost "add option" input
    wrap.appendChild(el('div', { class: 'opt-row' }, [
      el('span', { class: 'opt-bullet' + (multi ? ' sq' : ''), 'aria-hidden': 'true', style: 'opacity:.4' }),
      el('input', {
        class: 'opt-input opt-add', type: 'text', placeholder: '+ Add option', 'aria-label': 'Add option',
        oninput: function (e) {
          var v = e.target.value;
          if (!v) return;
          q.o.push(v);
          rerenderCard(i, '.opt-input[data-j="' + (q.o.length - 1) + '"]', true);
          changed();
        },
        onpaste: function (e) {
          var txt = (e.clipboardData || window.clipboardData).getData('text');
          if (!/\n/.test(txt)) return;
          e.preventDefault();
          var items = splitPasted(txt);
          q.o = q.o.filter(function (x) { return x.trim(); }).concat(items);
          rerenderCard(i, '.opt-add');
          changed();
          toast('Added ' + items.length + ' options');
        }
      }),
      el('span', { style: 'width:32px;flex:none' })
    ]));
    return wrap;
  }

  function imagesEditor(q, i) {
    var wrap = el('div', { class: 'opts' });
    q.o.forEach(function (o, j) {
      var url = q.i[j] || '';
      var thumb = el('div', { class: 'opt-thumb', 'aria-hidden': 'true' });
      var setThumb = function (u) { var s = QP.safeUrl(u); thumb.style.backgroundImage = s ? 'url("' + s.replace(/"/g, '%22') + '")' : ''; };
      setThumb(url);
      wrap.appendChild(el('div', { class: 'img-row' }, [
        thumb,
        el('input', {
          class: 'opt-input', type: 'text', value: o, placeholder: 'Label (e.g. ' + String.fromCharCode(65 + j) + ')', 'aria-label': 'Image ' + (j + 1) + ' label', maxlength: '200',
          oninput: function (e) { q.o[j] = e.target.value; changed(); }
        }),
        el('input', {
          class: 'opt-input url', type: 'url', value: url, placeholder: 'Image link https://…', 'aria-label': 'Image ' + (j + 1) + ' link', 'data-j': String(j),
          oninput: function (e) { q.i[j] = e.target.value.trim(); setThumb(q.i[j]); changed(); },
          onpaste: function (e) {
            var txt = (e.clipboardData || window.clipboardData).getData('text');
            var urls = txt.split(/\s+/).filter(function (u) { return QP.safeUrl(u); });
            if (urls.length < 2) return;
            e.preventDefault();
            urls.forEach(function (u, k) {
              var at = j + k;
              if (at < q.o.length && (k === 0 || !q.i[at])) { q.i[at] = u; }
              else { q.o.splice(at, 0, ''); q.i.splice(at, 0, u); }
            });
            rerenderCard(i);
            changed();
            toast('Added ' + urls.length + ' images');
          }
        }),
        el('button', {
          class: 'icon-btn danger', type: 'button', 'aria-label': 'Remove image ' + (j + 1), title: 'Remove', disabled: q.o.length <= 1 ? true : null,
          onclick: function () { q.o.splice(j, 1); q.i.splice(j, 1); rerenderCard(i); changed(); }
        }, '✕')
      ]));
    });
    wrap.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'btn btn-sm', type: 'button', onclick: function () { q.o.push(''); q.i.push(''); rerenderCard(i, '.opt-input.url[data-j="' + (q.o.length - 1) + '"]'); changed(); } }, '+ Add image'),
      el('span', { class: 'paste-tip', text: 'Use direct image links (ending in .png, .jpg…). Tip: paste several links at once.' })
    ]));
    return wrap;
  }

  function scaleEditor(q, i) {
    var seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Scale size' }, [5, 10].map(function (m) {
      return el('button', { type: 'button', class: q.s === m ? 'is-on' : '', onclick: function () { q.s = m; rerenderCard(i); changed({ goTo: i }); } }, '1–' + m);
    }));
    return el('div', { class: 'scale-cfg' }, [
      seg,
      el('input', { class: 'opt-input', type: 'text', value: q.l[0], placeholder: 'Low label (e.g. Poor)', 'aria-label': 'Low end label', maxlength: '60', oninput: function (e) { q.l[0] = e.target.value; changed(); } }),
      el('input', { class: 'opt-input', type: 'text', value: q.l[1], placeholder: 'High label (e.g. Great)', 'aria-label': 'High end label', maxlength: '60', oninput: function (e) { q.l[1] = e.target.value; changed(); } })
    ]);
  }

  /* ---------- Question operations ---------- */
  function convert(q, k) {
    var from = q.k;
    q.k = k;
    if (k === 's' || k === 'm' || k === 'i') {
      if (!q.o || !q.o.length) q.o = ['', ''];
      if (from === 'i' && k !== 'i') { /* keep labels; urls kept in q.i for switching back */ }
    }
    if (k === 'x' && from !== 'x') q.r = 0;
    if (from === 'x' && k !== 'x') q.r = 1;
    ensureShape(q);
  }

  function addQuestion(k) {
    var q = QP.newQuestion(k);
    survey.q.push(q);
    var i = survey.q.length - 1;
    activeQ = i;
    renderCards();
    changed({ goTo: i });
    var c = cardEl(i);
    if (c) {
      c.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var t = c.querySelector('.q-text'); if (t) t.focus({ preventScroll: true });
    }
  }

  function move(i, d) {
    var j = i + d;
    if (j < 0 || j >= survey.q.length) return;
    var tmp = survey.q[i]; survey.q[i] = survey.q[j]; survey.q[j] = tmp;
    activeQ = j;
    renderCards();
    changed({ goTo: j });
    var c = cardEl(j); if (c) c.scrollIntoView({ block: 'nearest' });
  }

  function duplicate(i) {
    survey.q.splice(i + 1, 0, clone(survey.q[i]));
    activeQ = i + 1;
    renderCards();
    changed({ goTo: i + 1 });
    toast('Question duplicated');
  }

  function remove(i) {
    lastDeleted = { q: survey.q[i], i: i };
    survey.q.splice(i, 1);
    activeQ = -1;
    renderCards();
    changed({ goTo: Math.min(i, survey.q.length - 1) });
    toast('Question deleted', { label: 'Undo', fn: function () {
      if (!lastDeleted) return;
      survey.q.splice(lastDeleted.i, 0, lastDeleted.q);
      activeQ = lastDeleted.i;
      lastDeleted = null;
      renderCards(); changed({ goTo: activeQ });
    } });
  }

  /* ---------- Errors ---------- */
  function refreshErrors() {
    var errs = QP.validate(survey);
    var cards = document.querySelectorAll('.qcard');
    for (var n = 0; n < cards.length; n++) {
      var i = Number(cards[n].getAttribute('data-i'));
      var mine = errs.filter(function (e) { return e.q === i; });
      cards[n].classList.toggle('has-error', mine.length > 0);
      var box = cards[n].querySelector('.q-err');
      if (box) { box.hidden = !mine.length; box.textContent = mine.map(function (e) { return e.msg.replace(/^Question \d+: /, ''); }).join(' '); }
    }
    return errs;
  }

  /* ---------- Text mode ---------- */
  var textTimer = null;
  function renderText() {
    var root = $('text-view');
    root.textContent = '';
    var ta = el('textarea', { class: 'text-area', spellcheck: 'false', 'aria-label': 'Poll as text' });
    ta.value = QP.toText(survey);
    ta.addEventListener('input', function () {
      clearTimeout(textTimer);
      textTimer = setTimeout(function () {
        var id = survey.id;
        survey = QP.fromText(ta.value, survey);
        survey.id = id;
        survey.q.forEach(ensureShape);
        changed();
      }, 250);
    });
    var help = el('div', { class: 'text-help' }, [
      el('strong', { text: 'Format' }),
      el('ul', null, [
        li(['Title: ', code('# Poll title'), ' · intro: ', code('> text'), ' · ask name: ', code('[ask name]')]),
        li(['A line is a question; lines starting with ', code('-'), ' are its options (single choice).']),
        li(['Type in brackets at the end: ', code('[multi]'), ' ', code('[yes/no]'), ' ', code('[1-5: Bad | Great]'), ' ', code('[1-10]'), ' ', code('[images]'), ' ', code('[text]')]),
        li(['Extras: ', code('optional'), ' ', code('comment'), ' — e.g. ', code('[yes/no, comment]'), '. Hint line: ', code('? text')]),
        li(['Images: ', code('- Label | https://link-to-image.png')])
      ])
    ]);
    root.appendChild(el('div', { class: 'panel text-panel' }, [ta, help]));
  }
  function li(kids) { return el('li', null, kids); }
  function code(t) { return el('code', { text: t }); }

  function setMode(m) {
    if (m === mode) return;
    clearTimeout(textTimer);
    if (mode === 'text') {
      var ta = document.querySelector('.text-area');
      if (ta) { var id = survey.id; survey = QP.fromText(ta.value, survey); survey.id = id; survey.q.forEach(ensureShape); changed(); }
    }
    mode = m;
    render();
  }

  /* ---------- Templates / new ---------- */
  function applyTemplate(t, inPlace) {
    var id = (inPlace || isBlank(survey)) ? survey.id : QP.uid(6);
    var s = QP.fromText(t.text);
    s.id = id;
    s.q.forEach(ensureShape);
    survey = s;
    drafts[survey.id] = { s: survey, u: Date.now() };
    store.set('qp_drafts', drafts);
    activeQ = -1; showErrors = false;
    mode = 'cards';
    render();
    runner.update(previewSurvey());
    runner.goTo(runner.hasIntro() ? -1 : 0, true);
    save();
    toast('Template added — edit anything');
  }

  function newBlank() {
    if (!isBlank(survey)) {
      survey = QP.newSurvey();
    }
    activeQ = -1; showErrors = false; mode = 'cards';
    store.set('qp_current', survey.id);
    render();
    runner.update(previewSurvey());
    runner.goTo(0, true);
    var t = document.querySelector('.title-input'); if (t) t.focus();
  }

  function openNewDialog() {
    var grid = $('tpl-grid');
    grid.textContent = '';
    grid.appendChild(el('button', { class: 'tpl', type: 'button', onclick: function () { $('dlg-new').close(); newBlank(); } }, [
      el('strong', { text: 'Blank poll' }), el('span', { text: 'Start from scratch' })
    ]));
    (window.QP_TEMPLATES || []).forEach(function (t) {
      grid.appendChild(el('button', { class: 'tpl', type: 'button', onclick: function () { $('dlg-new').close(); applyTemplate(t, false); } }, [
        el('strong', { text: t.name }), el('span', { text: t.desc })
      ]));
    });
    $('dlg-new').showModal();
  }

  /* ---------- My polls ---------- */
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }

  function openPolls() {
    var list = $('poll-list');
    list.textContent = '';
    var ids = Object.keys(drafts).sort(function (a, b) { return (drafts[b].u || 0) - (drafts[a].u || 0); });
    if (!ids.length) list.appendChild(el('div', { class: 'note', text: 'No saved polls yet.' }));
    ids.forEach(function (id) {
      var d = drafts[id];
      var s = d.s || {};
      var del = el('button', { class: 'btn btn-sm btn-quiet btn-danger', type: 'button' }, 'Delete');
      del.addEventListener('click', function () {
        if (del.getAttribute('data-sure')) {
          delete drafts[id]; store.set('qp_drafts', drafts);
          if (survey.id === id) { survey = QP.newSurvey(); render(); runner.update(previewSurvey()); }
          openPolls();
        } else { del.setAttribute('data-sure', '1'); del.textContent = 'Sure?'; }
      });
      list.appendChild(el('div', { class: 'poll-item' + (id === survey.id ? ' is-current' : '') }, [
        el('div', { class: 'info' }, [
          el('div', { class: 't', text: s.t || 'Untitled poll' }),
          el('div', { class: 'm', text: ((s.q || []).length) + ' questions · ' + fmtDate(d.u) })
        ]),
        el('button', { class: 'btn btn-sm', type: 'button', onclick: function () { $('dlg-polls').close(); load(id); } }, 'Open'),
        el('button', { class: 'btn btn-sm btn-quiet', type: 'button', title: 'Make a copy with a new answers tab', onclick: function () {
          var c = clone(s); c.id = QP.uid(6); c.t = (c.t || 'Untitled poll') + ' (copy)';
          drafts[c.id] = { s: c, u: Date.now() }; store.set('qp_drafts', drafts);
          $('dlg-polls').close(); load(c.id); toast('Copy created');
        } }, 'Copy'),
        del
      ]));
    });
    $('import-err').hidden = true;
    $('import-link').value = '';
    $('dlg-polls').showModal();
  }

  function importLink() {
    var v = $('import-link').value.trim();
    var code = v.indexOf('#') >= 0 ? v.slice(v.indexOf('#') + 1) : v;
    QP.decode(code).then(function (s) {
      delete s.e;
      drafts[s.id] = { s: s, u: Date.now() };
      store.set('qp_drafts', drafts);
      $('dlg-polls').close();
      load(s.id);
      toast('Poll opened for editing');
    }, function () {
      var e = $('import-err'); e.hidden = false; e.textContent = 'That doesn’t look like a complete poll link.';
    });
  }

  /* ---------- Settings ---------- */
  function openSettings() {
    $('endpoint').value = savedEndpoint() || cfg.endpoint || '';
    var st = $('endpoint-status');
    st.className = 'note';
    st.textContent = cfg.endpoint
      ? 'A connection is already set in config.js. Leave as is, or paste another URL to override it in this browser.'
      : 'Paste the Web App URL from Google Apps Script. Setup takes about 5 minutes — see SETUP.md.';
    $('dlg-settings').showModal();
  }

  function looksLikeWebApp(u) { return /^https:\/\/script\.google(usercontent)?\.com\/.+\/exec(\?.*)?$/.test(u); }

  function checkEndpoint() {
    var u = $('endpoint').value.trim();
    var st = $('endpoint-status');
    if (!u) { st.className = 'note warn'; st.textContent = 'Paste the URL first.'; return; }
    if (!looksLikeWebApp(u)) { st.className = 'note warn'; st.textContent = 'This doesn’t look like a Web App URL — it should start with https://script.google.com/ and end with /exec.'; return; }
    st.className = 'note'; st.textContent = 'Checking…';
    fetch(u + (u.indexOf('?') >= 0 ? '&' : '?') + 'ping=1', { redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) { st.className = 'note ok'; st.textContent = 'Connected ✓ Answers will go to “' + (j.sheet || 'your sheet') + '”.'; }
        else throw new Error();
      })
      .catch(function () {
        st.className = 'note err';
        st.textContent = 'Couldn’t reach the script. Check that it’s deployed as a Web App with access “Anyone”, and that you copied the /exec URL.';
      });
  }

  function saveSettings() {
    var u = $('endpoint').value.trim();
    if (u && !looksLikeWebApp(u)) { checkEndpoint(); return; }
    if (u === (cfg.endpoint || '').trim()) store.del('qp_endpoint'); else store.set('qp_endpoint', u);
    $('dlg-settings').close();
    toast(u ? 'Connection saved' : 'Connection removed');
  }

  /* ---------- Get link ---------- */
  function openLink() {
    var body = $('link-body');
    body.textContent = '';
    body.className = 'dlg'; body.style.padding = '0';
    showErrors = true;
    if (mode === 'text') setMode('cards');
    var errs = refreshErrors();
    if (errs.length) {
      [
        el('p', { text: 'A couple of things to finish first:' }),
        el('ul', { class: 'err-list' }, errs.map(function (e) {
          return el('li', null, [e.msg + ' ', e.q >= 0 ? el('button', { type: 'button', onclick: function () { $('dlg-link').close(); focusCard(e.q); } }, 'Fix') : (
            !survey.t.trim() ? el('button', { type: 'button', onclick: function () { $('dlg-link').close(); var t = document.querySelector('.title-input'); if (t) t.focus(); } }, 'Fix') : null)]);
        }))
      ].forEach(function (k) { body.appendChild(k); });
      $('dlg-link').showModal();
      return;
    }

    var ep = endpoint();
    var out = previewSurvey();
    if (ep && ep !== (cfg.endpoint || '').trim()) out.e = ep;
    QP.encode(out).then(function (code) {
      var link = QP.surveyLink(code);
      var n = out.q.length;
      var mins = Math.max(1, Math.round(n / 6));
      var msg = 'Hi! Could you answer a quick poll? ' + n + ' question' + (n === 1 ? '' : 's') + ', about ' + mins + ' min — just tap your answers:\n' + link;
      var linkField = el('input', { class: 'field', type: 'text', readonly: true, value: link, 'aria-label': 'Poll link', onfocus: function (e) { e.target.select(); } });
      var msgField = el('textarea', { class: 'field', rows: '4', 'aria-label': 'Message for your client' }, msg);
      var kids = [];
      if (!ep) {
        kids.push(el('div', { class: 'note warn' }, [
          'Answers won’t be saved yet — connect your Google Sheet first. ',
          el('button', { class: 'linkish', type: 'button', onclick: function () { $('dlg-link').close(); openSettings(); } }, 'Open settings')
        ]));
      }
      kids.push(el('div', null, [
        el('label', { class: 'field-label', text: 'Link' }),
        el('div', { class: 'row' }, [
          linkField,
          el('button', { class: 'btn btn-primary', type: 'button', onclick: function () { copyText(link).then(function () { toast('Link copied'); }, function () { linkField.select(); }); } }, 'Copy link'),
          el('a', { class: 'btn', href: link, target: '_blank', rel: 'noopener' }, 'Open')
        ])
      ]));
      kids.push(el('div', null, [
        el('label', { class: 'field-label', text: 'Ready-to-send message' }),
        msgField,
        el('div', { class: 'row', style: 'margin-top:8px' }, [
          el('button', { class: 'btn', type: 'button', onclick: function () { copyText(msgField.value).then(function () { toast('Message copied'); }); } }, 'Copy message')
        ])
      ]));
      kids.push(el('p', { text: 'Edited the poll after sending? Just send the new link — answers keep going to the same sheet tab.' }));
      if (link.length > 4000) kids.push(el('div', { class: 'note warn', text: 'This link is quite long (' + link.length + ' characters), probably because of image links. It works in browsers, but some messengers may cut it — test it before sending.' }));
      kids.forEach(function (k) { body.appendChild(k); });
      $('dlg-link').showModal();
      linkField.focus(); linkField.select();
    });
  }

  function focusCard(i) {
    if (mode !== 'cards') setMode('cards');
    setActive(i);
    var c = cardEl(i);
    if (!c) return;
    c.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var target = !survey.q[i].t.trim() ? c.querySelector('.q-text') : (c.querySelector('.opt-input') || c.querySelector('.q-text'));
    if (target) setTimeout(function () { target.focus({ preventScroll: true }); }, 250);
  }

  /* ---------- Wiring ---------- */
  $('tab-cards').addEventListener('click', function () { setMode('cards'); });
  $('tab-text').addEventListener('click', function () { setMode('text'); });
  $('btn-link').addEventListener('click', openLink);
  $('btn-new').addEventListener('click', openNewDialog);
  $('btn-polls').addEventListener('click', openPolls);
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-check').addEventListener('click', checkEndpoint);
  $('btn-save-settings').addEventListener('click', saveSettings);
  $('btn-import').addEventListener('click', importLink);
  $('import-link').addEventListener('keydown', function (e) { if (e.key === 'Enter') importLink(); });
  $('btn-restart').addEventListener('click', function () { runner.reset(); });
  $('sw-edit').addEventListener('click', function () { document.body.classList.remove('show-preview'); $('sw-edit').classList.add('is-on'); $('sw-preview').classList.remove('is-on'); });
  $('sw-preview').addEventListener('click', function () { document.body.classList.add('show-preview'); $('sw-preview').classList.add('is-on'); $('sw-edit').classList.remove('is-on'); window.scrollTo(0, 0); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
    b.addEventListener('click', function () { b.closest('dialog').close(); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); }); // click on backdrop
  });
  window.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); openLink(); }
  });

  // start
  var current = store.get('qp_current', null);
  survey = (current && drafts[current]) ? QP.normalize(drafts[current].s) : QP.newSurvey();
  survey.q.forEach(ensureShape);
  startPreview();
  render();
})();
