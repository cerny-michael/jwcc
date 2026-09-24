var pass = 0, fail = 0;
function eq(got, want, what) {
  if (got === want) pass++;
  else { fail++; print('FAIL ' + what + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
}
function find(name) {
  var hit = DATA.journals.filter(function (j) { return j.name === name; })[0];
  if (!hit) { fail++; print('FAIL missing journal: ' + name); }
  return hit;
}

/* ---- dataset integrity ---- */
eq(DATA.journals.length, 133, 'all journal rows present');
var badRule = 0, badLimit = 0, badUrl = 0;
DATA.journals.forEach(function (j) {
  if (j.rules.body !== 1) badRule++;
  WordCount.COMPONENTS.forEach(function (c) {
    if (!j.rules.hasOwnProperty(c)) badRule++;
    var v = j.rules[c];
    if (v !== 0 && v !== 1 && v !== null) badRule++;
  });
  if (['hard','soft','pages','none','unknown'].indexOf(j.limitKind) < 0) badLimit++;
  if (j.limitKind === 'hard' && !(j.limitWords > 0)) badLimit++;
  if (j.limitKind === 'pages' && !(j.limitPages > 0)) badLimit++;
  if (j.limitKind === 'unknown' && j.limitWords) badLimit++;
  if (!/^https?:\/\//.test(j.url)) badUrl++;
});
eq(badRule, 0, 'every journal has a complete, valid rule set with body counted');
eq(badLimit, 0, 'every limit is internally consistent');
eq(badUrl, 0, 'every journal has a source URL');
eq(DATA.meta.pageWords, 250, 'page conversion rate recorded');

/* ---- rules transcribed as the spreadsheet describes them ---- */
var ajps = find('American Journal of Political Science');
eq(ajps.limitWords, 10000, 'AJPS limit');
eq(ajps.rules.refs, 0, 'AJPS excludes the reference list');
eq(ajps.rules.abstract, 0, 'AJPS excludes the abstract');
eq(ajps.rules.appendix, 1, 'AJPS counts printed appendices');
eq(ajps.rules.notes, 1, 'AJPS counts notes');

var pp = find('Party Politics');
WordCount.COMPONENTS.forEach(function (c) {
  if (pp.rules[c] !== 1) { fail++; print('FAIL Party Politics is all-inclusive but ' + c + ' is ' + pp.rules[c]); }
});
pass++;

var prq = find('Political Research Quarterly');
eq(prq.limitKind, 'unknown', 'PRQ limit not stated');
eq(prq.rules.refs, null, 'PRQ criteria unknown');

var jop = find('The Journal of Politics');
eq(jop.limitKind, 'pages', 'JOP uses a page limit');
eq(jop.limitPages, 35, 'JOP page count');

var afs = find('Armed Forces & Society');
eq(afs.conflicting, true, 'Armed Forces & Society flagged as self-contradictory');

var hpt = find('History of Political Thought');
eq(hpt.limitKind, 'none', 'History of Political Thought states no limit');

/* ---- bounds against a real manuscript ---- */
var counts = {title:16, abstract:240, body:9309, notes:213, captions:52,
              tables:482, refs:1389, appendix:0, acks:0, equations:0};
var sep = {}; WordCount.COMPONENTS.forEach(function (c) { sep[c] = true; });

var b = WordCount.computeBounds(counts, sep, ajps.rules);
eq(b.lower, 9309 + 213 + 52, 'AJPS lower bound');
eq(b.upper, 9309 + 213 + 52, 'AJPS upper bound (only acks unclear, and it is empty)');
eq(b.total, 11701, 'total unchanged by the rule');

var apsr = find('American Political Science Review');
var b2 = WordCount.computeBounds(counts, sep, apsr.rules);
eq(b2.lower, 9309 + 213 + 482 + 52, 'APSR lower bound counts tables and notes');
eq(b2.upper, 9309 + 213 + 482 + 52 + 16 + 240, 'APSR upper bound adds the unaddressed front matter and abstract');
eq(b2.best, 9309 + 213 + 482 + 52, 'APSR best estimate resolves the gaps the standard way');

var b3 = WordCount.computeBounds(counts, sep, pp.rules);
eq(b3.lower, 11701, 'an all-inclusive journal counts everything');
eq(b3.lower, b3.upper, 'and leaves no ambiguity');

var b4 = WordCount.computeBounds(counts, sep, prq.rules);
eq(b4.lower, 9309, 'an unknown rule set bottoms out at the main text');
eq(b4.upper, 11701, 'and tops out at the whole document');

print('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) throw new Error(fail + ' test(s) failed');
