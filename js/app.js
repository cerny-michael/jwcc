/* app.js — wiring for the page: file intake, the choice of rules, results. */
(function () {
  'use strict';

  var W = window.WordCount;
  var data = null;              // {meta, journals}
  var mode = null;              // 'journal' | 'custom', or null before a choice
  var journal = null;           // selected journal record
  var overrides = {};           // component -> 1|0|null, edits in the breakdown table
  var custom = {};              // component -> 1|0, the "choose your own" ticks
  var result = null;            // last extraction result
  var fileLabel = '';

  /* Short names for the split view. */
  var SHORT = {
    title: 'Front matter', abstract: 'Abstract', body: 'Main text', notes: 'Notes',
    captions: 'Caption', tables: 'Table text', refs: 'References', appendix: 'Appendix',
    acks: 'Acknowledgements', equations: 'Equations'
  };

  var el = {
    drop: document.getElementById('drop'),
    file: document.getElementById('file'),
    status: document.getElementById('status'),
    modeJournal: document.getElementById('mode-journal'),
    modeCustom: document.getElementById('mode-custom'),
    panelJournal: document.getElementById('panel-journal'),
    panelCustom: document.getElementById('panel-custom'),
    filter: document.getElementById('journal-filter'),
    select: document.getElementById('journal'),
    count: document.getElementById('journal-count'),
    jcard: document.getElementById('journal-card'),
    parts: document.getElementById('parts'),
    resetParts: document.getElementById('reset-parts'),
    limitField: document.getElementById('limit-field'),
    limitSub: document.getElementById('limit-sub'),
    limit: document.getElementById('custom-limit'),
    results: document.getElementById('results'),
    verdict: document.getElementById('verdict'),
    figures: document.getElementById('figures'),
    figLower: document.getElementById('fig-lower'),
    figUpper: document.getElementById('fig-upper'),
    bestLabel: document.getElementById('best-label'),
    bestNote: document.getElementById('best-note'),
    lower: document.getElementById('num-lower'),
    best: document.getElementById('num-best'),
    upper: document.getElementById('num-upper'),
    total: document.getElementById('num-total'),
    fileNote: document.getElementById('file-note'),
    breakdownCard: document.getElementById('breakdown-card'),
    tbody: document.getElementById('breakdown-body'),
    reset: document.getElementById('reset-rules'),
    split: document.getElementById('split-list'),
    splitNote: document.getElementById('split-note'),
    warnings: document.getElementById('warnings'),
    updForm: document.getElementById('update-form'),
    updJournal: document.getElementById('upd-journal'),
    updNames: document.getElementById('journal-names'),
    updSource: document.getElementById('upd-source'),
    updDetails: document.getElementById('upd-details'),
    updNote: document.getElementById('upd-note')
  };

  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* --------------------------------------------------------------- load data */

  fetch('data/journals.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (json) {
      data = json;
      data.journals.sort(function (a, b) { return a.name.localeCompare(b.name); });
      fillSelect('');
      data.journals.forEach(function (j) {
        var o = document.createElement('option');
        o.value = j.name;
        el.updNames.appendChild(o);
      });

      /* A link of the form ?journal=<name> opens with that journal chosen. */
      var wanted = journalFromUrl();
      var hit = wanted && data.journals.filter(function (j) { return j.name === wanted; })[0];
      if (hit) {
        journal = hit;
        el.select.value = hit.name;
        setMode('journal');
      }
    })
    .catch(function (e) {
      el.count.textContent = 'Could not load the journal list (' + e.message +
        '). Choose your own rules instead.';
    });

  /* --------------------------------------------------------- journal picker */

  /* "American Journal of Political Science" gives ajops and ajps;
   * "The Journal of Politics" gives jop and jp. */
  function abbreviations(name) {
    var ws = name.replace(/^the\s+/i, '').split(/[\s:&,\-]+/).filter(Boolean);
    var initials = function (list) {
      return list.map(function (w) { return w.charAt(0); }).join('').toLowerCase();
    };
    return [initials(ws), initials(ws.filter(function (w) {
      return !/^(of|and|the|for|in|on)$/i.test(w);
    }))];
  }

  function matches(j, q) {
    if (!q) return true;
    if (j.name.toLowerCase().indexOf(q) >= 0) return true;
    var bare = q.replace(/[\s.]/g, '');
    return bare.length >= 2 && abbreviations(j.name).indexOf(bare) >= 0;
  }

  /* The journals matching the filter, grouped by the first subfield the
   * dataset lists for each. */
  function fillSelect(query) {
    if (!data) return;
    var q = String(query || '').trim().toLowerCase();
    var keep = data.journals.filter(function (j) { return matches(j, q); });
    el.select.innerHTML = '';

    var groups = {};
    keep.forEach(function (j) {
      var g = j.fields[0] || 'Other';
      (groups[g] = groups[g] || []).push(j);
    });
    Object.keys(groups).sort().forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g;
      groups[g].forEach(function (j) {
        var o = document.createElement('option');
        o.value = j.name;
        o.textContent = j.name + ' — ' + shortLimit(j);
        og.appendChild(o);
      });
      el.select.appendChild(og);
    });
    if (!keep.length) {
      var none = document.createElement('option');
      none.disabled = true;
      none.textContent = 'No journal matches “' + query.trim() + '”';
      el.select.appendChild(none);
    }
    el.select.value = journal ? journal.name : '';

    el.count.textContent = q
      ? keep.length + ' of ' + data.journals.length + ' journals match.'
      : data.journals.length + ' journals, grouped by subfield. Type above to narrow the list.';
  }

  function shortLimit(j) {
    if (j.limitWords) return fmt(j.limitWords) + ' words';
    if (j.limitPages) return j.limitPages + ' pages';
    return j.limitText;
  }

  function journalFromUrl() {
    var m = /[?&]journal=([^&#]*)/.exec((window.location && window.location.search) || '');
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  /* Keeps the address shareable: a coauthor opening it gets the same journal. */
  function updateUrl() {
    if (!window.history || !window.history.replaceState) return;
    var q = mode === 'journal' && journal ? '?journal=' + encodeURIComponent(journal.name) : '';
    window.history.replaceState(null, '', window.location.pathname + q);
  }

  /* ------------------------------------------------------------- the target */

  /* What the manuscript is measured against. A typed figure wins; otherwise
   * the journal's limit, or its guideline where it names a length to aim for
   * rather than a cap. */
  function effectiveLimit() {
    var typed = parseInt(el.limit.value, 10);
    if (typed > 0) {
      return { words: typed, guide: false,
               source: mode === 'custom' ? 'your limit' : 'the limit you entered' };
    }
    if (mode !== 'journal' || !journal) return null;
    var j = journal, pw = data.meta.pageWords;
    if (j.limitPages) {
      return { words: j.limitPages * pw, guide: false, pages: j.limitPages,
               source: j.name + '’s ' + j.limitPages + '-page limit, at ' + pw +
                       ' words per double-spaced page' };
    }
    if (j.limitKind === 'soft') {
      return { words: j.limitWords, guide: true, source: j.name + '’s guideline' };
    }
    if (j.guideWords) {
      return { words: j.guideWords, guide: true, source: j.name + '’s guideline' };
    }
    if (j.limitWords) return { words: j.limitWords, guide: false, source: j.name + '’s stated limit' };
    return null;
  }

  /* ------------------------------------------------------------ journal card */

  function statusBadge(s) {
    var cls = 'badge-warn';
    if (/^verified$/i.test(s)) cls = 'badge-ok';
    if (/not verified|conflicting|correction/i.test(s)) cls = 'badge-bad';
    return '<span class="badge ' + cls + '">' + esc(s) + '</span>';
  }

  function renderJournalCard() {
    if (!journal) { el.jcard.hidden = true; return; }
    var j = journal;
    var rows = '';
    function row(k, v) { if (v) rows += '<dt>' + k + '</dt><dd>' + v + '</dd>'; }

    row('Limit', '<span class="limit-figure">' + esc(j.limitText) + '</span>' +
      (j.limitPages ? ' <span class="sub">≈ ' + fmt(j.limitPages * data.meta.pageWords) +
        ' words at ' + data.meta.pageWords + ' words per page</span>' : '') +
      (j.guideWords ? ' <span class="sub">· guideline ' + fmt(j.guideWords) + ' words</span>' : ''));
    row('Counted / not counted', esc(j.included));
    row('Qualification', esc(j.note));
    row('Field' + (j.fields.length > 1 ? 's' : ''), esc(j.fields.join('; ')));
    row('Source', j.url ? '<a href="' + esc(j.url) + '" target="_blank" rel="noopener">' +
      'Author instructions</a>' : '');

    var alert = '';
    if (j.conflicting) {
      alert = '<p class="verdict bad">The published instructions for this ' +
        'journal contradict themselves on what counts. Every component is therefore treated as ' +
        'unclear, which makes the two bounds far apart. Ask the editors before relying on either.</p>';
    } else if (j.limitKind === 'unknown') {
      alert = '<p class="verdict warn">No limit could be confirmed for this ' +
        'journal, so no target is applied. Enter your own figure below if you know it. A missing ' +
        'limit is not the same as no limit.</p>';
    } else if (j.limitKind === 'none' && j.guideWords) {
      alert = '<p class="verdict">This journal states no fixed maximum, only a length to aim ' +
        'for. The result is measured against ' + fmt(j.guideWords) + ' words as a guideline. ' +
        'Read the qualification above.</p>';
    } else if (j.limitKind === 'none') {
      alert = '<p class="verdict ok">This journal states no fixed maximum. ' +
        'Read the qualification above — an expectation is not the same as an absence of one.</p>';
    } else if (j.limitKind === 'soft') {
      alert = '<p class="verdict">This figure is a guideline rather than a hard cap, and the ' +
        'result is measured against it as one. Read the qualification above.</p>';
    }

    el.jcard.innerHTML = '<h3>' + esc(j.name) + ' ' + statusBadge(j.status) + '</h3>' +
      '<dl>' + rows + '</dl>' + alert;
    el.jcard.hidden = false;
  }

  /* ---------------------------------------------------------- choose your own */

  var partInputs = {}, partCounts = {};

  function resetCustom() {
    W.COMPONENTS.forEach(function (c) { custom[c] = W.STANDARD_PROFILE[c]; });
  }

  /* One checkbox per component, built once so focus survives re-rendering. */
  function buildParts() {
    W.COMPONENTS.forEach(function (c) {
      var label = document.createElement('label');
      label.className = 'part' + (c === 'body' ? ' locked' : '');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.id = 'part-' + c;
      box.checked = !!custom[c];
      box.disabled = c === 'body';
      box.addEventListener('change', function () {
        custom[c] = this.checked ? 1 : 0;
        render();
      });
      var name = document.createElement('span');
      name.className = 'part-label';
      name.textContent = W.LABELS[c] + (c === 'body' ? ' — always counted' : '');
      var n = document.createElement('span');
      n.className = 'part-n';
      label.appendChild(box);
      label.appendChild(name);
      label.appendChild(n);
      el.parts.appendChild(label);
      partInputs[c] = box;
      partCounts[c] = n;
    });
  }

  function syncParts() {
    W.COMPONENTS.forEach(function (c) {
      partInputs[c].checked = !!custom[c];
      if (!result) { partCounts[c].textContent = ''; return; }
      partCounts[c].textContent = fmt(result.counts[c] || 0) + ' words' +
        (result.separable[c] === false ? ' · not separable in this file' : '');
    });
  }

  /* ------------------------------------------------------------------- modes */

  function showMode() {
    el.modeJournal.setAttribute('aria-pressed', mode === 'journal' ? 'true' : 'false');
    el.modeCustom.setAttribute('aria-pressed', mode === 'custom' ? 'true' : 'false');
    el.panelJournal.hidden = mode !== 'journal';
    el.panelCustom.hidden = mode !== 'custom';
    el.limitField.hidden = !mode;
    el.limitSub.textContent = mode === 'journal'
      ? '(optional; overrides the journal’s figure)'
      : '(leave blank for just the count)';
  }

  function setMode(m) {
    mode = m;
    showMode();
    updateUrl();
    renderJournalCard();
    render();
  }

  /* ----------------------------------------------------------------- results */

  function activeRules() {
    var out = {};
    if (mode === 'custom') {
      W.COMPONENTS.forEach(function (c) { out[c] = custom[c]; });
      return out;
    }
    var base = mode === 'journal' && journal
      ? (journal.conflicting ? allUnclear() : journal.rules)
      : W.STANDARD_PROFILE;
    W.COMPONENTS.forEach(function (c) {
      out[c] = overrides.hasOwnProperty(c) ? overrides[c] : base[c];
    });
    return out;
  }

  function allUnclear() {
    var o = {};
    W.COMPONENTS.forEach(function (c) { o[c] = c === 'body' ? 1 : null; });
    return o;
  }

  function render() {
    syncParts();
    if (!result) return;
    var rules = activeRules();
    var b = W.computeBounds(result.counts, result.separable, rules);
    var useJournal = mode === 'journal' && journal;

    /* Three figures where a journal's rule leaves room for doubt; one where
     * every component is simply counted or not. */
    var three = useJournal || b.lower !== b.upper;
    el.figures.className = 'figures' + (three ? '' : ' single');
    el.figLower.hidden = !three;
    el.figUpper.hidden = !three;
    el.bestLabel.textContent = three ? 'Best estimate' : 'Word count';
    el.bestNote.textContent = useJournal ? 'Journal’s rule, gaps filled by the standard scope'
      : mode === 'custom' ? 'The parts you ticked in step 2'
      : Object.keys(overrides).length ? 'The standard scope, with your changes below'
      : 'Standard scope: main text, notes and captions';

    el.lower.textContent = fmt(b.lower);
    el.best.textContent = fmt(b.best);
    el.upper.textContent = fmt(b.upper);
    el.total.textContent = fmt(b.total);
    el.fileNote.textContent = fileLabel;

    el.breakdownCard.hidden = mode === 'custom';
    el.reset.textContent = useJournal ? 'Reset to the journal’s own rule' : 'Reset to the standard scope';
    renderBreakdown(b);
    renderVerdict(b, three);
    renderSplit(b);
    renderCaveats(b);

    el.results.hidden = false;
  }

  function renderBreakdown(b) {
    el.tbody.innerHTML = '';
    b.rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (!r.words) tr.className = 'zero';

      var td1 = document.createElement('td');
      td1.className = 'label';
      td1.innerHTML = esc(r.label) +
        (r.separable ? '' : '<small>Could not be separated in this file</small>');
      tr.appendChild(td1);

      var td2 = document.createElement('td');
      td2.className = 'num';
      td2.textContent = fmt(r.words);
      tr.appendChild(td2);

      var td3 = document.createElement('td');
      var sel = document.createElement('select');
      [['1', 'Counts'], ['0', 'Does not count'], ['', 'Unclear']].forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt[0];
        o.textContent = opt[1];
        sel.appendChild(o);
      });
      sel.value = r.rule === 1 ? '1' : (r.rule === 0 ? '0' : '');
      sel.setAttribute('aria-label', 'Does ' + r.label + ' count toward the limit?');
      sel.disabled = r.component === 'body';
      sel.addEventListener('change', function () {
        overrides[r.component] = this.value === '' ? null : parseInt(this.value, 10);
        render();
      });
      td3.appendChild(sel);
      tr.appendChild(td3);

      var td4 = document.createElement('td');
      td4.className = 'flags';
      td4.innerHTML = [
        r.inLower ? '<b>lower</b>' : 'lower',
        r.inBest ? '<b>best</b>' : 'best',
        r.inUpper ? '<b>upper</b>' : 'upper'
      ].join(' · ');
      tr.appendChild(td4);

      el.tbody.appendChild(tr);
    });
  }

  function renderVerdict(b, three) {
    var lim = effectiveLimit();
    var v = el.verdict;
    v.className = 'verdict';

    if (!lim) {
      if (!mode) {
        v.innerHTML = 'No target yet.' +
          '<span>Choose a journal or set your own rules in step 2 to compare this count against a limit.</span>';
      } else if (mode === 'journal' && !journal) {
        v.innerHTML = 'No journal chosen yet.' +
          '<span>Pick one in step 2, or type a word limit there.</span>';
      } else if (mode === 'journal') {
        v.innerHTML = 'No word limit is set, so the figures below are just the counts.' +
          '<span>This journal has no confirmed limit. Type one into the word limit box in step 2 if you know it.</span>';
      } else {
        v.innerHTML = 'No word limit is set, so this is just the count.' +
          '<span>Type a limit in step 2 to compare against it.</span>';
      }
      return;
    }

    var noun = lim.guide ? 'guideline' : 'limit';
    var per = ', per ' + esc(lim.source) + '.';
    var tail = lim.guide
      ? ' This journal names a length to aim for rather than a hard cap; read the qualification on its card before cutting.'
      : '';
    if (lim.pages && result.source === 'pdf' && !(parseInt(el.limit.value, 10) > 0)) {
      tail += ' Your PDF runs to ' + result.detail.pages + ' pages against the ' + lim.pages +
        '-page limit. If it is formatted to the journal’s specification, that is the more direct comparison.';
    }

    if (!three) {
      if (b.best <= lim.words) {
        v.className = 'verdict ok';
        v.innerHTML = 'Within the ' + noun + '.<span>' + fmt(b.best) + ' words, ' +
          fmt(lim.words - b.best) + ' under ' + fmt(lim.words) + per + tail + '</span>';
      } else {
        v.className = 'verdict ' + (lim.guide ? 'warn' : 'bad');
        v.innerHTML = 'Over the ' + noun + '.<span>' + fmt(b.best) + ' words, ' +
          fmt(b.best - lim.words) + ' over ' + fmt(lim.words) + per + tail + '</span>';
      }
      return;
    }

    if (b.upper <= lim.words) {
      v.className = 'verdict ok';
      v.innerHTML = 'Within the ' + noun + ' on every reading of the instructions.' +
        '<span>Even counting everything not explicitly excluded (' + fmt(b.upper) +
        ') you are ' + fmt(lim.words - b.upper) + ' words under ' + fmt(lim.words) + per + tail + '</span>';
    } else if (b.lower > lim.words) {
      v.className = 'verdict ' + (lim.guide ? 'warn' : 'bad');
      v.innerHTML = 'Over the ' + noun + ' on every reading of the instructions.' +
        '<span>Even counting only what is clearly included (' + fmt(b.lower) + ') you are ' +
        fmt(b.lower - lim.words) + ' words over ' + fmt(lim.words) + per +
        (lim.guide ? '' : ' Cutting at least that much is unavoidable.') + tail + '</span>';
    } else {
      v.className = 'verdict warn';
      var verdictBest = b.best <= lim.words
        ? 'The best estimate (' + fmt(b.best) + ') is ' + fmt(lim.words - b.best) + ' words under.'
        : 'The best estimate (' + fmt(b.best) + ') is ' + fmt(b.best - lim.words) + ' words over.';
      v.innerHTML = 'It depends on how the journal counts.' +
        '<span>The ' + noun + ' of ' + fmt(lim.words) + ' (' + esc(lim.source) + ') falls between the two bounds, ' +
        fmt(b.lower) + ' and ' + fmt(b.upper) + '. ' + verdictBest +
        ' Cut to ' + fmt(lim.words) + ' on the upper bound to be safe under any reading.' + tail + '</span>';
    }
  }

  /* Consecutive paragraphs given to the same component, in document order,
   * so a misplaced boundary is easy to spot. */
  function renderSplit(b) {
    var counted = {}, listed = {};
    b.rows.forEach(function (r) { counted[r.component] = r.inBest; });

    var runs = [];
    (result.segments || []).forEach(function (s) {
      var last = runs[runs.length - 1];
      if (last && last.component === s.component) {
        /* A run that opens with a bare heading shows the start of the
         * paragraph under it too, which is where a boundary goes wrong. */
        if (last.paras === 1 && last.preview.length < 40) {
          last.preview += ' — ' + s.preview;
          last.cut = s.preview.length >= 110;
        }
        last.paras++;
        last.words += s.words;
      } else {
        runs.push({ component: s.component, paras: 1, words: s.words, preview: s.preview,
                    cut: s.preview.length >= 110 });
      }
      listed[s.component] = (listed[s.component] || 0) + s.words;
    });

    el.split.innerHTML = '';
    runs.forEach(function (r) {
      var li = document.createElement('li');
      li.className = counted[r.component] ? '' : 'out';
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = SHORT[r.component];
      var meta = document.createElement('span');
      meta.className = 'run-meta';
      meta.textContent = r.paras + (r.paras === 1 ? ' paragraph' : ' paragraphs') +
        ' · ' + fmt(r.words) + ' words';
      var text = document.createElement('span');
      text.className = 'run-preview';
      text.textContent = r.preview + (r.cut ? '…' : '');
      li.appendChild(tag);
      li.appendChild(meta);
      li.appendChild(text);
      el.split.appendChild(li);
    });

    /* Notes and maths are read apart from the paragraph stream. */
    var apart = [];
    var notes = (result.counts.notes || 0) - (listed.notes || 0);
    if (notes > 0) {
      apart.push(result.source === 'pdf'
        ? 'Text in smaller type (' + fmt(notes) + ' words), taken as footnotes, is not listed.'
        : 'Footnotes and endnotes (' + fmt(notes) + ' words) are read from their own part of the file and are not listed.');
    }
    if (result.counts.equations) {
      apart.push('Display equations (' + fmt(result.counts.equations) + ' words) are counted apart and not listed.');
    }
    el.splitNote.textContent = apart.join(' ');
  }

  function renderCaveats(b) {
    el.warnings.innerHTML = '';
    var list = b.caveats.concat(result.warnings);
    if (mode === 'journal' && journal &&
        /older guidance|not verified|incomplete|conflicting|unclear|correction/i.test(journal.status)) {
      list.unshift('This journal’s entry is flagged "' + journal.status +
        '" in the source dataset. Confirm the rule against the journal’s own page before submitting.');
    }
    list.forEach(function (w) {
      var li = document.createElement('li');
      li.textContent = w;
      el.warnings.appendChild(li);
    });
  }

  /* ---------------------------------------------------------- update request */

  /* The request goes out through the reader's own email app, so nothing is
   * sent from this page. The address is assembled here rather than written
   * into the page, which keeps it from the simplest address harvesters. */
  var MAINTAINER = ['michael_cerny', 'g.harvard.edu'].join('@');

  function sendUpdateRequest() {
    var name = el.updJournal.value.trim();
    var source = el.updSource.value.trim();
    var body = 'Journal: ' + name + '\n' +
      (source ? 'Instructions: ' + source + '\n' : '') +
      '\n' + el.updDetails.value.trim() + '\n';
    window.location.href = 'mailto:' + MAINTAINER +
      '?subject=' + encodeURIComponent('Word count checker: update for ' + name) +
      '&body=' + encodeURIComponent(body);
    el.updNote.textContent = 'If no email app opened, send the same details to ' + MAINTAINER + '.';
  }

  /* -------------------------------------------------------------- file input */

  function handleFile(file) {
    if (!file) return;
    var name = file.name || 'document';
    var lower = name.toLowerCase();
    var isDocx = /\.docx$/.test(lower);
    var isPdf = /\.pdf$/.test(lower);

    if (!isDocx && !isPdf) {
      setStatus(/\.doc$/.test(lower)
        ? 'Old-style .doc files cannot be read here. Open it in Word and save as .docx.'
        : 'Unsupported file type. Please choose a .docx or .pdf file.', true);
      return;
    }
    if (lower.indexOf('~$') === 0) {
      setStatus('That is a Word lock file, not your document. Pick the file without the "~$" prefix.', true);
      return;
    }

    setStatus('Reading ' + name + '…');
    var reader = new FileReader();
    reader.onerror = function () { setStatus('The file could not be read.', true); };
    reader.onload = function () {
      var buf = reader.result;
      var job = isDocx ? W.extractDocx(buf) : W.extractPdf(buf);
      job.then(function (res) {
        result = res;
        overrides = {};
        fileLabel = 'From ' + name + (res.source === 'pdf'
          ? ' (' + res.detail.pages + ' pages, read as PDF text).'
          : ' (Word document, ' + res.detail.notes + ' footnotes or endnotes).');
        setStatus('Done: ' + name + '.' + (mode ? '' : ' Now decide what counts, below.'));
        render();
        /* Before a choice is made, step 2 is the next thing to look at. */
        if (mode) el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }).catch(function (e) {
        console.error(e);
        setStatus(e && e.message ? e.message : 'The document could not be parsed.', true);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function setStatus(msg, isError) {
    el.status.textContent = msg;
    el.status.className = 'status' + (isError ? ' error' : '');
  }

  /* ------------------------------------------------------------------ events */

  resetCustom();
  buildParts();
  showMode();

  el.modeJournal.addEventListener('click', function () { setMode('journal'); });
  el.modeCustom.addEventListener('click', function () { setMode('custom'); });

  el.filter.addEventListener('input', function () { fillSelect(this.value); });

  el.select.addEventListener('change', function () {
    var picked = this.value;
    journal = null;
    if (picked && data) {
      journal = data.journals.filter(function (j) { return j.name === picked; })[0] || null;
    }
    overrides = {};
    /* A journal being looked at is the likeliest one to report on. */
    if (journal && !el.updJournal.value.trim()) el.updJournal.value = journal.name;
    updateUrl();
    renderJournalCard();
    render();
  });

  el.updForm.addEventListener('submit', function (e) {
    e.preventDefault();
    sendUpdateRequest();
  });

  el.limit.addEventListener('input', function () { render(); });

  el.reset.addEventListener('click', function () { overrides = {}; render(); });
  el.resetParts.addEventListener('click', function () { resetCustom(); render(); });

  el.drop.addEventListener('click', function () { el.file.click(); });
  el.drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.file.click(); }
  });
  el.file.addEventListener('change', function () { handleFile(this.files[0]); });

  ['dragenter', 'dragover'].forEach(function (t) {
    el.drop.addEventListener(t, function (e) {
      e.preventDefault(); e.stopPropagation(); el.drop.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    el.drop.addEventListener(t, function (e) {
      e.preventDefault(); e.stopPropagation(); el.drop.classList.remove('over');
    });
  });
  el.drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });
})();
