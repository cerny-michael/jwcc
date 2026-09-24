/* Feeds pdf.js-shaped text content for a synthetic article through the real
 * PDF code path: line grouping, running-head removal, note detection by type
 * size, section segmentation. */
var pass = 0, fail = 0;
function eq(got, want, what) {
  if (got === want) pass++;
  else { fail++; print('FAIL ' + what + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
}
var BODY = 11, NOTE = 8.5, HEAD = 14;
var uid = 0;
function ten() {                      /* ten distinct words, as real prose is */
  var w = [];
  for (var i = 0; i < 10; i++) w.push('w' + (++uid));
  return w.join(' ');
}
function page(no, lines) {
  var items = [], y = 700;
  lines.forEach(function (l) {
    items.push({ str: l[0], transform: [l[1], 0, 0, l[1], 72, y], height: l[1] });
    y -= 16;
  });
  return WordCount.pdfLinesFromTextContent({ items: items }, no);
}

var pages = [
  page(1, [
    ['Pressure and Preference Change in Foreign Policy Elites', HEAD],
    ['Jane Q. Author and A. N. Other', BODY],
    ['Abstract', HEAD],
    [ten(), BODY], [ten(), BODY],
    ['Keywords: elites, pressure, surveys', BODY],
    ['Introduction', HEAD],
    [ten(), BODY], [ten(), BODY], [ten(), BODY],
    ['1 A footnote running to exactly nine words here', NOTE],
    ['Pressure and Preference Change 1', BODY]
  ]),
  page(2, [
    [ten(), BODY], [ten(), BODY], [ten(), BODY], [ten(), BODY],
    ['Table 1: Sample characteristics of the elite survey', BODY],
    [ten(), BODY],
    ['2 Another footnote of seven words', NOTE],
    ['Pressure and Preference Change 2', BODY]
  ]),
  page(3, [
    ['Methods', HEAD],
    [ten(), BODY], [ten(), BODY], [ten(), BODY], [ten(), BODY], [ten(), BODY],
    ['Pressure and Preference Change 3', BODY]
  ]),
  page(4, [
    ['References', HEAD],
    [ten(), BODY], [ten(), BODY],
    ['Appendix A: Question wording', HEAD],
    [ten(), BODY],
    ['Pressure and Preference Change 4', BODY]
  ])
];

eq(pages[0].length, 12, 'every line survived grouping');
eq(pages[0][0].text, 'Pressure and Preference Change in Foreign Policy Elites', 'first line text');
eq(pages[0][0].edge, true, 'top line flagged as page edge');
eq(pages[0][5].edge, false, 'a mid-page line is not an edge line');

var res = WordCount.pdfCountsFromPages(pages, 4);
print('--- synthetic PDF ---');
WordCount.COMPONENTS.forEach(function (c) { print('  ' + c + ': ' + res.counts[c]); });

eq(res.counts.title, 8 + 7, 'title line and author line are front matter');
eq(res.counts.abstract, 1 + 20 + 4, 'the Abstract heading, its paragraph and the keywords line');
eq(res.counts.notes, 9 + 6, 'both footnotes found by type size');
eq(res.counts.captions, 8, 'the table caption');
eq(res.counts.body, 130 + 2, 'thirteen body lines plus the Introduction and Methods headings');
eq(res.counts.refs, 1 + 20, 'the References heading and two reference lines');
eq(res.counts.appendix, 4 + 10, 'the appendix heading and the text under it');
eq(res.counts.tables, 0, 'table contents are never separable in a PDF');
eq(res.separable.tables, false, 'tables flagged inseparable');
eq(res.separable.notes, true, 'notes were separable here');
eq(res.detail.bodySize, 11, 'modal body size detected');

var joined = res.segments.map(function (s) { return s.preview; }).join(' | ');
eq(joined.indexOf('Pressure and Preference Change 1'), -1, 'running head dropped');

/* No small type: the engine must say so rather than invent notes. */
var flat = [page(1, [['Title Here Now', HEAD], ['Abstract', HEAD], [ten(), BODY],
                     ['Introduction', HEAD], [ten(), BODY]])];
var res2 = WordCount.pdfCountsFromPages(flat, 1);
eq(res2.separable.notes, false, 'no small type means notes are not separable');
eq(res2.counts.notes, 0, 'and no notes are claimed');

/* A published article with no labelled abstract: front matter must still end. */
var noAbs = [page(1, [['An Article Without A Labelled Abstract', HEAD],
                      ['Some Author', BODY],
                      ['Introduction', HEAD],
                      [ten(), BODY], [ten(), BODY]])];
var res3 = WordCount.pdfCountsFromPages(noAbs, 1);
eq(res3.counts.body, 1 + 20, 'body found without an abstract marker');
eq(res3.counts.title, 6 + 2, 'front matter closed at the Introduction heading');

/* An inline "Abstract. ..." paragraph, as typeset journals often set it. */
var inline = [page(1, [['A Title', HEAD],
                       ['Abstract. ' + ten(), BODY],
                       ['Introduction', HEAD],
                       [ten(), BODY]])];
var res4 = WordCount.pdfCountsFromPages(inline, 1);
eq(res4.counts.abstract, 11, 'inline abstract label recognised');
eq(res4.counts.body, 1 + 10, 'and the body is not polluted by it');

/* Section numbers are stripped, ordinary words beginning I/V/X are not. */
eq(WordCount.classifyHeading('IV. References'), 'refs', 'roman-numbered heading');
eq(WordCount.classifyHeading('7.2 Appendix B'), 'appendix', 'decimal-numbered heading');
eq(WordCount.classifyHeading('Introduction'), null, 'Introduction keeps its I');
eq(WordCount.classifyHeading('Variation in Elite Views'), null, 'a V-word heading survives');

print('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) throw new Error(fail + ' test(s) failed');
