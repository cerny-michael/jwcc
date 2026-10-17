/* ---- unit tests: tokenisation ---- */
var pass=0, fail=0;
function eq(got, want, what){
  if (got === want) { pass++; }
  else { fail++; print('FAIL ' + what + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
}
var cw = WordCount.countWords;
eq(cw('hello world'), 2, 'two words');
eq(cw('state-building matters'), 2, 'hyphenated counts once');
eq(cw('1,254 observations'), 2, 'comma number counts once');
eq(cw('a—b'), 2, 'em dash separates');
eq(cw('a–b'), 2, 'en dash separates');
eq(cw('—'), 0, 'lone dash is not a word');
eq(cw('e.g. Smith (2001) argues'), 4, 'citation tokens');
eq(cw(''), 0, 'empty');
eq(cw(null), 0, 'null');
eq(cw('a b'), 2, 'nbsp separates');
eq(cw('   spaced   out   '), 2, 'collapses whitespace');
eq(cw('- ; : )'), 0, 'punctuation only');
eq(cw('état régime'), 2, 'accented letters');

/* ---- unit tests: heading classifier ---- */
var ch = WordCount.classifyHeading;
eq(ch('Abstract'), 'abstract', 'abstract heading');
eq(ch('References'), 'refs', 'references heading');
eq(ch('Bibliography'), 'refs', 'bibliography heading');
eq(ch('7. References'), 'refs', 'numbered references heading');
eq(ch('Appendix A: Survey Instrument'), 'appendix', 'appendix heading');
eq(ch('Acknowledgements'), 'acks', 'acks heading');
eq(ch('Funding'), 'acks', 'funding heading');
eq(ch('Introduction'), null, 'ordinary heading');
eq(ch('We refer to references throughout the argument here'), null, 'prose is not a heading');

/* ---- bounds arithmetic ---- */
var counts = {title:50, abstract:150, body:8000, notes:600, captions:120,
              tables:400, refs:1800, appendix:900, acks:60, equations:30};
var sepAll = {}; WordCount.COMPONENTS.forEach(function(c){sepAll[c]=true;});
var b = WordCount.computeBounds(counts, sepAll, {title:0,abstract:0,body:1,notes:1,
        captions:1,tables:0,refs:0,appendix:1,acks:null,equations:0});
eq(b.lower, 8000+600+120+900, 'lower = explicit includes');
eq(b.upper, 8000+600+120+900+60, 'upper adds the unclear component');
eq(b.best, 8000+600+120+900, 'best resolves unclear acks by standard scope (excluded)');
eq(b.total, 12110, 'total is everything');

var bAll = WordCount.computeBounds(counts, sepAll, null);
eq(bAll.lower, 8000+600+120, 'standard scope lower');
eq(bAll.upper, 8000+600+120, 'standard scope has no unclear rows');

var sepNoTables = {}; WordCount.COMPONENTS.forEach(function(c){sepNoTables[c]=true;});
sepNoTables.tables = false;
var b3 = WordCount.computeBounds(counts, sepNoTables, {body:1, tables:0});
eq(b3.caveats.length > 0, true, 'inseparable excluded component raises a caveat');

/* ---- segmentation over a synthetic manuscript block stream ---- */
function blk(text, opts) {
  opts = opts || {};
  return { text: text, kind: opts.kind || 'para', heading: !!opts.heading, math: opts.math || '' };
}
var manuscript = [
  blk('Hawks and Doves in the Bureaucracy'),
  blk('A. Author and B. Author'),
  blk('September 2026'),
  blk('Abstract'),
  blk('We show that professional pressure reshapes the foreign policy advice elites give, ' +
      'using a survey of several hundred officials and a set of open-ended reports.'),
  blk('Keywords: elites, bureaucracy, pressure'),
  blk('\u2217We thank seminar audiences for helpful comments on this draft.'),
  blk('Introduction', { heading: true }),
  blk('The first paragraph of the article proper runs to some length and says something.'),
  blk('Table 1: Coping strategies among officials'),
  blk('Strategy Frequency Share Exit 12 four per cent', { kind: 'table' }),
  blk('Theory', { heading: true }),
  blk('More prose in the body of the article, with an in-text citation (Smith 2001).'),
  blk('References', { heading: true }),
  blk('Smith, J. 2001. A Book About Things. Princeton: Princeton University Press.'),
  blk('Appendix A: Question wording', { heading: true }),
  blk('The full wording of every question is reproduced here for completeness.'),
  blk('Acknowledgements', { heading: true }),
  blk('We thank two anonymous reviewers.')
];
var seg = WordCount.assignComponents(manuscript);
eq(seg.counts.title, 6 + 5 + 2, 'title, authors and date are front matter');
eq(seg.counts.abstract, 1 + 25 + 4, 'abstract heading, body and keywords');
eq(seg.counts.body, 1 + 14 + 1 + 14, 'both body headings and both body paragraphs');
eq(seg.counts.captions, 6, 'the caption is recognised from its text alone');
eq(seg.counts.tables, 8, 'the table contents');
eq(seg.counts.refs, 1 + 11, 'the references heading and the entry');
eq(seg.counts.appendix, 4 + 11, 'the appendix heading and its text');
eq(seg.counts.acks, 10 + 1 + 5, 'the author note and the acknowledgements section');
eq(seg.counts.notes, 0, 'no notes in this stream');

/* ---- headings set in plain bold text: the abstract must still end ---- */
var uid = 0;
function words(n) {                   /* n distinct words, ending a sentence */
  var w = [];
  for (var i = 0; i < n; i++) w.push('w' + (++uid));
  return w.join(' ') + '.';
}
var plain = WordCount.assignComponents([
  blk('Why Disputes Escalate'), blk('Jane Doe'),
  blk('Abstract'), blk(words(30)),
  blk('Introduction'), blk(words(40)), blk(words(40)),
  blk('2. Data and Methods'), blk(words(40)),
  blk('References'), blk(words(10))
]);
eq(plain.counts.abstract, 1 + 30, 'an unstyled "Introduction" line closes the abstract');
eq(plain.counts.body, 1 + 40 + 40 + 4 + 40, 'and everything after it is main text');

var capped = WordCount.assignComponents([
  blk('A Title'), blk('Abstract'), blk(words(200)), blk(words(200)),
  blk(words(100)), blk(words(100))
]);
eq(capped.counts.abstract, 1 + 400, 'an abstract with no heading after it stops near 450 words');
eq(capped.counts.body, 200, 'the rest is main text');

var lower = WordCount.assignComponents([
  blk('A Title'), blk('Abstract'), blk(words(20)), blk('results'), blk(words(20))
]);
eq(lower.counts.abstract, 1 + 20 + 1 + 20, 'a lower-case word alone is not a section heading');

var paged = WordCount.assignComponents([
  blk('A Title'), blk('Abstract'), blk(words(30)),
  { text: words(40), kind: 'para', heading: false, breakBefore: true }, blk(words(40))
]);
eq(paged.counts.abstract, 1 + 30, 'a page break after the abstract ends it');
eq(paged.counts.body, 80, 'and the next page is main text');

var pagedEmpty = WordCount.assignComponents([
  blk('A Title'), blk('Abstract'), blk(words(30)),
  { text: '', kind: 'para', heading: false, breakAfter: true }, blk(words(40))
]);
eq(pagedEmpty.counts.body, 40, 'a break carried by an empty paragraph still counts');

var boldTitle = WordCount.assignComponents([
  blk('Theory of Yes Men', { heading: true }), blk('A. Author'),
  blk('Introduction', { heading: true }), blk(words(30))
]);
eq(boldTitle.counts.title, 4 + 2, 'a bold title that begins "Theory" stays front matter');
eq(boldTitle.counts.body, 1 + 30, 'and the body starts at Introduction');

/* Section numbers are stripped; ordinary words beginning I/V/X are not. */
eq(WordCount.classifyHeading('IV. References'), 'refs', 'roman-numbered heading');
eq(WordCount.classifyHeading('7.2 Appendix B'), 'appendix', 'decimal-numbered heading');
eq(WordCount.classifyHeading('Introduction'), null, 'Introduction keeps its I');
eq(WordCount.classifyHeading('Variation in Elite Views'), null, 'a V-word heading survives');

print('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) throw new Error(fail + ' engine test(s) failed');
