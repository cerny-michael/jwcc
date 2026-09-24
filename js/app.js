/* app.js — wiring for the page: journal picker, file intake, results. */
(function () {
  'use strict';

  var W = window.WordCount;
  var data = null;              // {meta, journals}
  var journal = null;           // selected journal record
  var overrides = {};           // component -> 1|0|null, user edits
  var result = null;            // last extraction result
  var fileLabel = '';

  var el = {
    select: document.getElementById('journal'),
    count: document.getElementById('journal-count'),
    custom: document.getElementById('custom-limit'),
    jcard: document.getElementById('journal-card'),
    drop: document.getElementById('drop'),
    file: document.getElementById('file'),
    status: document.getElementById('status'),
    results: document.getElementById('results'),
    verdict: document.getElementById('verdict'),
    lower: document.getElementById('num-lower'),
    best: document.getElementById('num-best'),
    upper: document.getElementById('num-upper'),
    total: document.getElementById('num-total'),
    fileNote: document.getElementById('file-note'),
    tbody: document.getElementById('breakdown-body'),
    warnings: document.getElementById('warnings'),
    reset: document.getElementById('reset-rules'),
    sourceNote: document.getElementById('source-note'),
    sourceCaveat: document.getElementById('source-caveat')
  };

  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  /* --------------------------------------------------------------- load data */

  fetch('data/journals.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (json) {
      data = json;
      data.journals.sort(function (a, b) { return a.name.localeCompare(b.name); });
      fillSelect();
      el.sourceNote.textContent = 'Journal limits and counting criteria come from ' +
        data.meta.source + '. ' + data.meta.sourceNote;
      el.sourceCaveat.textContent = data.meta.caveat;
    })
    .catch(function (e) {
      el.count.textContent = 'Could not load the journal list (' + e.message +
        '). You can still set your own word limit below.';
    });

  /* Every journal, grouped by the first subfield the dataset lists for it. */
  function fillSelect() {
    var keep = data.journals;
    el.select.innerHTML = '';
    var none = document.createElement('option');
    none.value = '';
    none.textContent = '— No journal: I will set my own limit —';
    el.select.appendChild(none);

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

    el.count.textContent = keep.length + ' journals, grouped by subfield. ' +
      'Type inside the list to jump to a title.';
  }

  function shortLimit(j) {
    if (j.limitWords) return fmt(j.limitWords) + ' words';
    if (j.limitPages) return j.limitPages + ' pages';
    return j.limitText;
  }

  /* Words a journal's limit amounts to, pages converted at 250 words/page. */
  function journalLimitWords(j) {
    if (!j) return null;
    if (j.limitWords) return j.limitWords;
    if (j.limitPages) return j.limitPages * data.meta.pageWords;
    return null;
  }

  function effectiveLimit() {
    var custom = parseInt(el.custom.value, 10);
    if (custom > 0) return { words: custom, source: 'the limit you entered' };
    var w = journalLimitWords(journal);
    if (w) {
      return {
        words: w,
        source: journal.limitPages
          ? journal.name + '’s ' + journal.limitPages + '-page limit, at ' +
            data.meta.pageWords + ' words per double-spaced page'
          : journal.name + '’s stated limit'
      };
    }
    return null;
  }

  /* ------------------------------------------------------------ journal card */

  function statusBadge(s) {
    var cls = 'badge-warn';
    if (/^verified$/i.test(s)) cls = 'badge-ok';
    if (/not verified|conflicting|correction/i.test(s)) cls = 'badge-bad';
    return '<span class="badge ' + cls + '">' + esc(s) + '</span>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderJournalCard() {
    if (!journal) { el.jcard.hidden = true; return; }
    var j = journal;
    var rows = '';
    function row(k, v) { if (v) rows += '<dt>' + k + '</dt><dd>' + v + '</dd>'; }

    row('Limit', '<span class="limit-figure">' + esc(j.limitText) + '</span>' +
      (j.limitPages ? ' <span class="sub">≈ ' + fmt(j.limitPages * data.meta.pageWords) +
        ' words at ' + data.meta.pageWords + ' words per page</span>' : ''));
    row('Counted / not counted', esc(j.included));
    row('Qualification', esc(j.note));
    row('Field' + (j.fields.length > 1 ? 's' : ''), esc(j.fields.join('; ')));
    row('Source', j.url ? '<a href="' + esc(j.url) + '" target="_blank" rel="noopener">' +
      'Author instructions</a>' : '');

    var alert = '';
    if (j.conflicting) {
      alert = '<p class="verdict bad" style="margin:12px 0 0">The published instructions for this ' +
        'journal contradict themselves on what counts. Every component is therefore treated as ' +
        'unclear, which makes the two bounds far apart. Ask the editors before relying on either.</p>';
    } else if (j.limitKind === 'unknown') {
      alert = '<p class="verdict warn" style="margin:12px 0 0">No limit could be confirmed for this ' +
        'journal, so no target is applied. Enter your own figure above if you know it. A missing ' +
        'limit is not the same as no limit.</p>';
    } else if (j.limitKind === 'none') {
      alert = '<p class="verdict ok" style="margin:12px 0 0">This journal states no fixed maximum. ' +
        'Read the qualification above — an expectation is not the same as an absence of one.</p>';
    }

    el.jcard.innerHTML = '<h3>' + esc(j.name) + ' ' + statusBadge(j.status) + '</h3>' +
      '<dl>' + rows + '</dl>' + alert;
    el.jcard.hidden = false;
  }

  /* ----------------------------------------------------------------- results */

  function activeRules() {
    var base = journal && !journal.conflicting
      ? journal.rules
      : (journal && journal.conflicting ? allUnclear() : null);
    var out = {};
    W.COMPONENTS.forEach(function (c) {
      out[c] = overrides.hasOwnProperty(c) ? overrides[c]
             : (base ? base[c] : W.STANDARD_PROFILE[c]);
    });
    return out;
  }

  function allUnclear() {
    var o = {};
    W.COMPONENTS.forEach(function (c) { o[c] = c === 'body' ? 1 : null; });
    return o;
  }

  function render() {
    if (!result) return;
    var rules = activeRules();
    var b = W.computeBounds(result.counts, result.separable, rules);

    el.lower.textContent = fmt(b.lower);
    el.best.textContent = fmt(b.best);
    el.upper.textContent = fmt(b.upper);
    el.total.textContent = fmt(b.total);
    el.fileNote.textContent = fileLabel;

    /* Breakdown table */
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

    /* Verdict */
    var lim = effectiveLimit();
    var v = el.verdict;
    v.className = 'verdict';
    if (!lim) {
      v.innerHTML = 'No word limit is set, so the figures below are just the counts.' +
        '<span>Pick a journal with a confirmed limit, or type a figure into the limit box.</span>';
    } else if (b.upper <= lim.words) {
      v.className = 'verdict ok';
      v.innerHTML = 'Within the limit on every reading of the instructions.' +
        '<span>Even counting everything not explicitly excluded (' + fmt(b.upper) +
        ') you are ' + fmt(lim.words - b.upper) + ' words under ' + fmt(lim.words) +
        ', per ' + esc(lim.source) + '.</span>';
    } else if (b.lower > lim.words) {
      v.className = 'verdict bad';
      v.innerHTML = 'Over the limit on every reading of the instructions.' +
        '<span>Even counting only what is clearly included (' + fmt(b.lower) + ') you are ' +
        fmt(b.lower - lim.words) + ' words over ' + fmt(lim.words) + ', per ' + esc(lim.source) +
        '. Cutting at least that much is unavoidable.</span>';
    } else {
      v.className = 'verdict warn';
      var verdictBest = b.best <= lim.words
        ? 'The best estimate (' + fmt(b.best) + ') is ' + fmt(lim.words - b.best) + ' words under.'
        : 'The best estimate (' + fmt(b.best) + ') is ' + fmt(b.best - lim.words) + ' words over.';
      v.innerHTML = 'It depends on how the journal counts.' +
        '<span>The limit of ' + fmt(lim.words) + ' (' + esc(lim.source) + ') falls between the two bounds, ' +
        fmt(b.lower) + ' and ' + fmt(b.upper) + '. ' + verdictBest +
        ' Cut to ' + fmt(lim.words) + ' on the upper bound to be safe under any reading.</span>';
    }

    /* Caveats */
    el.warnings.innerHTML = '';
    var list = b.caveats.concat(result.warnings);
    if (journal && /older guidance|not verified|incomplete|conflicting|unclear|correction/i.test(journal.status)) {
      list.unshift('This journal’s entry is flagged "' + journal.status +
        '" in the source dataset. Confirm the rule against the journal’s own page before submitting.');
    }
    list.forEach(function (w) {
      var li = document.createElement('li');
      li.textContent = w;
      el.warnings.appendChild(li);
    });

    el.results.hidden = false;
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
        setStatus('Done: ' + name + '.');
        render();
        el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  el.select.addEventListener('change', function () {
    var picked = this.value;
    journal = null;
    if (picked && data) {
      journal = data.journals.filter(function (j) { return j.name === picked; })[0] || null;
    }
    overrides = {};
    renderJournalCard();
    render();
  });

  el.custom.addEventListener('input', function () { render(); });

  el.reset.addEventListener('click', function () { overrides = {}; render(); });

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
