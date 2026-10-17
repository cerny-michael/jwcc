var console = { error: function () {}, log: function () {} };
var pass = 0, fail = 0;
function eq(got, want, what) {
  if (got === want) pass++;
  else { fail++; print('FAIL ' + what + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
}
function ok(cond, what) { eq(!!cond, true, what); }
function has(node, needle, what) {
  var t = node.allText();
  if (t.indexOf(needle) >= 0) pass++;
  else { fail++; print('FAIL ' + what + ': "' + needle + '" not found in ' + JSON.stringify(t.slice(0, 260))); }
}

var E = function (id) { return document.getElementById(id); };

/* A canned extraction, so the UI is tested rather than the parser. */
var COUNTS = { title: 16, abstract: 240, body: 9309, notes: 213, captions: 52,
               tables: 482, refs: 1389, appendix: 0, acks: 0, equations: 0 };
var SEP = {}; WordCount.COMPONENTS.forEach(function (c) { SEP[c] = true; });
var SEGMENTS = [
  { component: 'title', words: 16, preview: 'Hawks and Doves in the Bureaucracy' },
  { component: 'abstract', words: 1, preview: 'Abstract' },
  { component: 'abstract', words: 239, preview: 'We show that professional pressure reshapes advice' },
  { component: 'body', words: 1, preview: 'Introduction' },
  { component: 'body', words: 9308, preview: 'The first paragraph of the article proper' },
  { component: 'refs', words: 1389, preview: 'References' }
];
WordCount.extractDocx = function () {
  return Promise.resolve({ source: 'docx', counts: COUNTS, separable: SEP,
    warnings: ['A canned warning.'], segments: SEGMENTS, detail: { blocks: 431, notes: 6 } });
};

function flush(n, fn) {                 /* let the promise chain settle */
  var p = Promise.resolve();
  for (var i = 0; i < n; i++) p = p.then(function () {});
  return p.then(fn);
}
function pick(name) { E('journal').value = name; E('journal').fire('change'); }
function limit(v) { E('custom-limit').value = v; E('custom-limit').fire('input'); }
function filter(v) { E('journal-filter').value = v; E('journal-filter').fire('input'); }
function options() {
  var out = [];
  E('journal').children.forEach(function (c) {
    if (c.tagName === 'OPTGROUP') c.children.forEach(function (o) { out.push(o.textContent); });
    else out.push(c.textContent);
  });
  return out;
}

flush(6, function () {
  /* --- the journal list loaded --- */
  var groups = E('journal').children.filter(function (c) { return c.tagName === 'OPTGROUP'; });
  ok(groups.length >= 10, 'one group per subfield');
  eq(options().length, 133, 'every journal is an option');
  has(E('journal-count'), '133 journals', 'journal tally reported');

  /* --- nothing chosen yet: step 2 waits for a choice --- */
  eq(E('mode-journal').getAttribute('aria-pressed'), 'false', 'journal button starts unpressed');
  eq(E('mode-custom').getAttribute('aria-pressed'), 'false', 'custom button starts unpressed');
  eq(E('panel-journal').hidden, true, 'journal panel hidden before a choice');
  eq(E('panel-custom').hidden, true, 'custom panel hidden before a choice');
  eq(E('limit-field').hidden, true, 'limit field hidden before a choice');

  /* --- step 1: the document first --- */
  E('file').files = [{ name: 'manuscript.docx' }];
  E('file').fire('change');
  return flush(8, function () {
    eq(E('results').hidden, false, 'results revealed');
    has(E('status'), 'Now decide what counts', 'status points to step 2');
    eq(E('results').scrolled, undefined, 'no jump past step 2 before a choice');
    has(E('verdict'), 'No target yet', 'verdict asks for a choice');
    eq(E('fig-lower').hidden, true, 'one figure, not three, under the standard scope');
    eq(E('best-label').textContent, 'Word count', 'and it is labelled as a count');
    eq(E('num-best').textContent, '9,574', 'standard scope: main text, notes, captions');
    eq(E('num-total').textContent, '11,701', 'whole-document total rendered');
    eq(E('breakdown-body').children.length, 10, 'one table row per component');
    has(E('warnings'), 'A canned warning.', 'engine warnings surfaced');

    /* --- the split view --- */
    var runs = E('split-list').children;
    eq(runs.length, 4, 'consecutive paragraphs merged into runs');
    has(runs[1], 'Abstract — We show', 'a run opening with a heading shows the text under it');
    has(runs[2], '2 paragraphs', 'a run reports its paragraphs');
    eq(runs[3].className, 'out', 'references are greyed under the standard scope');
    eq(runs[2].className, '', 'main text is not');
    has(E('split-note'), 'Footnotes and endnotes (213 words)', 'notes read apart are mentioned');

    /* --- step 2: choose a journal --- */
    E('mode-journal').fire('click');
    eq(E('mode-journal').getAttribute('aria-pressed'), 'true', 'journal button pressed');
    eq(E('panel-journal').hidden, false, 'journal panel shown');
    eq(E('panel-custom').hidden, true, 'custom panel still hidden');
    eq(E('limit-field').hidden, false, 'limit field shown');
    has(E('verdict'), 'No journal chosen yet', 'verdict asks for a journal');

    /* --- the filter: by title or abbreviation --- */
    filter('ajps');
    ok(options().join('|').indexOf('American Journal of Political Science') >= 0, 'AJPS found by abbreviation');
    has(E('journal-count'), ' of 133 journals match', 'filtered tally reported');
    filter('journal of politics');
    ok(options().join('|').indexOf('The Journal of Politics') >= 0, 'a title found without its "The"');
    filter('apsr');
    ok(options().join('|').indexOf('American Political Science Review') >= 0, 'APSR found by abbreviation');
    filter('zzzz');
    has(E('journal'), 'No journal matches', 'an empty result says so');
    filter('');
    eq(options().length, 133, 'clearing the filter restores the list');

    /* --- pick a journal --- */
    pick('American Journal of Political Science');
    eq(E('journal-card').hidden, false, 'journal card shown');
    has(E('journal-card'), '10,000 words', 'card states the limit');
    has(E('journal-card'), 'Verified', 'card shows the verification badge');
    eq(window.history.last, '/?journal=American%20Journal%20of%20Political%20Science', 'address names the journal');
    eq(E('upd-journal').value, 'American Journal of Political Science', 'the update form takes the chosen journal');
    eq(E('fig-lower').hidden, false, 'three figures for a journal');
    eq(E('best-label').textContent, 'Best estimate', 'middle figure is the best estimate');
    eq(E('num-lower').textContent, '9,574', 'AJPS lower bound rendered');
    eq(E('num-upper').textContent, '9,574', 'upper bound rendered');
    has(E('verdict'), 'Within the limit', 'verdict says it fits');
    ok(E('verdict').className.indexOf('ok') >= 0, 'verdict styled as good news');

    /* --- the abstract counts where the journal says so, and only there --- */
    ok(E('breakdown-body').children[1].children[3].innerHTML.indexOf('<b>lower</b>') < 0,
       'AJPS leaves the abstract out');
    pick('Journal of Peace Research');
    ok(E('breakdown-body').children[1].children[3].innerHTML.indexOf('<b>lower</b>') >= 0,
       'JPR counts the abstract');
    eq(E('num-lower').textContent, '11,685', 'JPR lower bound includes the 240-word abstract');

    /* --- a journal with gaps, and a guideline rather than a cap --- */
    pick('American Political Science Review');
    eq(E('num-lower').textContent, '10,056', 'APSR lower bound');
    eq(E('num-upper').textContent, '10,312', 'APSR upper bound is higher');
    has(E('journal-card'), 'guideline 11,000 words', 'card names the guideline');
    has(E('verdict'), 'Within the guideline', 'verdict measures against the guideline');

    /* --- a typed limit overrides the journal's --- */
    limit('9000');
    has(E('verdict'), 'Over the limit', 'a limit below the lower bound reads as over');
    ok(E('verdict').className.indexOf('bad') >= 0, 'verdict styled as bad news');
    limit('10200');
    has(E('verdict'), 'It depends on how the journal counts', 'straddling limit reads as indeterminate');
    limit('');

    /* --- overriding one row changes the figures --- */
    var selectCell = E('breakdown-body').children[6].children[2].children[0];
    eq(selectCell.tagName, 'SELECT', 'each row carries a rule selector');
    selectCell.value = '1';
    selectCell.fire('change');
    eq(E('num-lower').textContent, '11,445', 'counting references raises the lower bound');
    E('reset-rules').fire('click');
    eq(E('num-lower').textContent, '10,056', 'reset restores the journal rule');

    /* --- over a guideline is a warning, not a failure --- */
    pick('Political Psychology');
    has(E('verdict'), 'Over the guideline', 'over a soft figure');
    ok(E('verdict').className.indexOf('warn') >= 0, 'styled as a warning');

    /* --- unverified, contradictory and page-based journals --- */
    pick('Political Research Quarterly');
    has(E('journal-card'), 'No limit could be confirmed', 'unverified journal flagged');
    eq(E('num-lower').textContent, '9,309', 'unknown rules bottom out at the main text');
    eq(E('num-upper').textContent, '11,701', 'and top out at the whole document');
    has(E('verdict'), 'No word limit is set', 'and no target is invented');

    pick('Armed Forces & Society');
    has(E('journal-card'), 'contradict themselves', 'conflicting instructions flagged');
    eq(E('num-lower').textContent, '9,309', 'conflicting rules give the widest bounds');

    pick('The Journal of Politics');
    has(E('journal-card'), '8,750 words', '35 pages converted at 250 words a page');

    /* --- step 2, the other way: choose your own --- */
    E('mode-custom').fire('click');
    eq(E('mode-custom').getAttribute('aria-pressed'), 'true', 'custom button pressed');
    eq(E('mode-journal').getAttribute('aria-pressed'), 'false', 'journal button released');
    eq(E('panel-custom').hidden, false, 'custom panel shown');
    eq(E('panel-journal').hidden, true, 'journal panel hidden');
    eq(E('breakdown-card').hidden, true, 'the checkboxes replace the breakdown table');
    eq(window.history.last, '/', 'address no longer names a journal');
    eq(E('fig-lower').hidden, true, 'one figure for your own rules');
    eq(E('num-best').textContent, '9,574', 'starts from the standard scope');
    has(E('verdict'), 'just the count', 'no limit typed yet');

    var parts = E('parts').children;
    eq(parts.length, 10, 'one checkbox per component');
    has(parts[2], '9,309 words', 'each checkbox shows its word count');
    eq(parts[2].children[0].disabled, true, 'main text cannot be unticked');

    var refsBox = parts[6].children[0];
    refsBox.checked = true;
    refsBox.fire('change');
    eq(E('num-best').textContent, '10,963', 'ticking references adds them');
    limit('10000');
    has(E('verdict'), 'Over the limit', 'over your own limit');
    ok(E('verdict').className.indexOf('bad') >= 0, 'styled as bad news');
    refsBox.checked = false;
    refsBox.fire('change');
    has(E('verdict'), 'Within the limit', 'and within it again without them');
    has(E('verdict'), 'per your limit', 'credited to your figure');

    refsBox.checked = true;
    refsBox.fire('change');
    E('reset-parts').fire('click');
    eq(E('num-best').textContent, '9,574', 'reset restores the standard scope');
    eq(refsBox.checked, false, 'and unticks the box');

    /* --- back to the journal: its selection survives --- */
    E('mode-journal').fire('click');
    eq(E('breakdown-card').hidden, false, 'breakdown table back');
    has(E('verdict'), 'the limit you entered', 'the typed limit still applies');
    limit('');

    /* --- the update request opens an email; nothing is sent from the page --- */
    eq(E('journal-names').children.length, 133, 'the form suggests every journal');
    pick('Political Research Quarterly');
    eq(E('upd-journal').value, 'American Journal of Political Science', 'a typed or earlier journal is not overwritten');
    E('upd-journal').value = 'Political Research Quarterly';
    E('upd-source').value = 'https://example.org/prq';
    E('upd-details').value = 'The limit is now 10,000 words.';
    var prevented = false;
    E('update-form').fire('submit', { preventDefault: function () { prevented = true; } });
    var mail = window.location.href || '';
    ok(prevented, 'the form does not submit anywhere itself');
    eq(mail.indexOf('mailto:michael_cerny@g.harvard.edu?subject='), 0, 'an email to the maintainer');
    ok(mail.indexOf(encodeURIComponent('update for Political Research Quarterly')) > 0, 'the subject names the journal');
    ok(mail.indexOf(encodeURIComponent('Instructions: https://example.org/prq')) > 0, 'the body carries the link');
    ok(mail.indexOf(encodeURIComponent('The limit is now 10,000 words.')) > 0, 'and the request');
    has(E('upd-note'), 'If no email app opened', 'a fallback is offered');

    /* --- bad input --- */
    E('file').files = [{ name: 'old.doc' }];
    E('file').fire('change');
    has(E('status'), 'save as .docx', 'a .doc file is refused with advice');
    E('file').files = [{ name: 'notes.txt' }];
    E('file').fire('change');
    has(E('status'), 'Unsupported file type', 'an unsupported type is refused');
    E('file').files = [{ name: '~$manuscript.docx' }];
    E('file').fire('change');
    has(E('status'), 'lock file', 'a Word lock file is recognised');

    print('\n' + pass + ' passed, ' + fail + ' failed');
    if (fail) throw new Error(fail + ' test(s) failed');
  });
});
