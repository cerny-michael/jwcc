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
WordCount.extractDocx = function () {
  return Promise.resolve({ source: 'docx', counts: COUNTS, separable: SEP,
    warnings: ['A canned warning.'], segments: [], detail: { blocks: 431, notes: 6 } });
};

function flush(n, fn) {                 /* let the promise chain settle */
  var p = Promise.resolve();
  for (var i = 0; i < n; i++) p = p.then(function () {});
  return p.then(fn);
}

flush(6, function () {
  /* --- the journal list loaded --- */
  ok(E('journal').children.length > 5, 'the select was populated with optgroups');
  has(E('journal-count'), '133 journals', 'journal tally reported');

  var groups = E('journal').children.filter(function (c) { return c.tagName === 'OPTGROUP'; });
  ok(groups.length >= 10, 'one group per subfield');
  var names = groups.map(function (g) {
    return g.children.map(function (o) { return o.textContent; }).join('|');
  }).join('|');
  ok(names.indexOf('Journal of Peace Research') >= 0, 'a journal from one subfield is listed');
  ok(names.indexOf('American Political Science Review') >= 0, 'and one from another');
  var optionCount = groups.reduce(function (n, g) { return n + g.children.length; }, 0);
  eq(optionCount, 133, 'every journal is an option, none filtered away');

  /* --- pick a journal --- */
  E('journal').value = 'American Journal of Political Science';
  E('journal').fire('change');
  eq(E('journal-card').hidden, false, 'journal card shown');
  has(E('journal-card'), 'American Journal of Political Science', 'card names the journal');
  has(E('journal-card'), '10,000 words', 'card states the limit');
  has(E('journal-card'), 'Verified', 'card shows the verification badge');

  /* --- feed it a document --- */
  E('file').files = [{ name: 'manuscript.docx' }];
  E('file').fire('change');
  return flush(8, function () {
    eq(E('results').hidden, false, 'results revealed');
    eq(E('num-lower').textContent, '9,574', 'AJPS lower bound rendered');
    eq(E('num-best').textContent, '9,574', 'best estimate rendered');
    eq(E('num-upper').textContent, '9,574', 'upper bound rendered');
    eq(E('num-total').textContent, '11,701', 'whole-document total rendered');
    eq(E('breakdown-body').children.length, 10, 'one table row per component');
    has(E('verdict'), 'Within the limit', 'verdict says it fits');
    ok(E('verdict').className.indexOf('ok') >= 0, 'verdict styled as good news');
    has(E('warnings'), 'A canned warning.', 'engine warnings surfaced');

    /* --- a journal whose rules leave gaps --- */
    E('journal').value = 'American Political Science Review';
    E('journal').fire('change');
    eq(E('num-lower').textContent, '10,056', 'APSR lower bound');
    eq(E('num-upper').textContent, '10,312', 'APSR upper bound is higher');

    /* --- a tighter custom limit flips the verdict --- */
    E('custom-limit').value = '9000';
    E('custom-limit').fire('input');
    has(E('verdict'), 'Over the limit', 'a limit below the lower bound reads as over');
    ok(E('verdict').className.indexOf('bad') >= 0, 'verdict styled as bad news');

    /* --- a limit inside the bounds is reported as indeterminate --- */
    E('custom-limit').value = '10200';
    E('custom-limit').fire('input');
    has(E('verdict'), 'It depends on how the journal counts', 'straddling limit reads as indeterminate');

    /* --- overriding one row changes the figures --- */
    E('custom-limit').value = '';
    E('custom-limit').fire('input');
    var beforeUpper = E('num-upper').textContent;
    var refsRow = E('breakdown-body').children[6];
    var selectCell = refsRow.children[2].children[0];
    eq(selectCell.tagName, 'SELECT', 'each row carries a rule selector');
    selectCell.value = '1';
    selectCell.fire('change');
    eq(E('num-lower').textContent, '11,445', 'counting references raises the lower bound');
    ok(E('num-upper').textContent !== beforeUpper, 'and the upper bound with it');

    /* --- reset --- */
    E('reset-rules').fire('click');
    eq(E('num-lower').textContent, '10,056', 'reset restores the journal rule');

    /* --- no journal, no limit --- */
    E('journal').value = '';
    E('journal').fire('change');
    eq(E('journal-card').hidden, true, 'card hidden again');
    has(E('verdict'), 'No word limit is set', 'verdict explains there is no target');
    eq(E('num-best').textContent, '9,574', 'standard scope applied with no journal');

    /* --- an unverified journal warns instead of inventing a limit --- */
    E('journal').value = 'Political Research Quarterly';
    E('journal').fire('change');
    has(E('journal-card'), 'No limit could be confirmed', 'unverified journal flagged');
    eq(E('num-lower').textContent, '9,309', 'unknown rules bottom out at the main text');
    eq(E('num-upper').textContent, '11,701', 'and top out at the whole document');

    /* --- a self-contradictory journal is treated as wholly unclear --- */
    E('journal').value = 'Armed Forces & Society';
    E('journal').fire('change');
    has(E('journal-card'), 'contradict themselves', 'conflicting instructions flagged');
    eq(E('num-lower').textContent, '9,309', 'conflicting rules give the widest bounds');

    /* --- a page-based limit is converted --- */
    E('journal').value = 'The Journal of Politics';
    E('journal').fire('change');
    has(E('journal-card'), '8,750 words', '35 pages converted at 250 words a page');

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
