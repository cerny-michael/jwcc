/* Feeds pdf.js-shaped text content for a synthetic article through the real
 * PDF code path: line grouping, running-head removal, note detection by type
 * size, section segmentation. */
var pass = 0, fail = 0;
function ok(cond, what) { eq(!!cond, true, what); }
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
/* Each line is [text, fontSize, extraLeadingBefore]. */
function page(no, lines) {
  var items = [], y = 700;
  lines.forEach(function (l) {
    y -= (l[2] || 0);
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

/* A typeset article with no abstract: front matter must stop at the first
 * finished sentence rather than swallowing the opening paragraph. */
var typeset = [page(1, [
  ['COMMENTS AND REPLIES', HEAD],
  ['Comment on a Theory of Yes Men', HEAD],
  ['A. Scholar', BODY, 10],
  ['Prendergast has discovered a new effect, and this comment argues that', BODY, 14],
  ['the result does not hold in general.', BODY],
  [ten(), BODY]
])];
var res5 = WordCount.pdfCountsFromPages(typeset, 1);
eq(res5.counts.title, 3 + 7 + 2, 'heads and byline are front matter');
eq(res5.counts.body, 18 + 10, 'the opening sentence starts the body');

/* The gap rule must not chop an ordinary paragraph into pieces. */
var flow = [page(1, [
  ['Introduction', HEAD, 10],
  ['one two three four five six seven eight nine ten', BODY, 12],
  ['eleven twelve thirteen fourteen fifteen sixteen', BODY],
  ['seventeen eighteen nineteen twenty.', BODY]
])];
var res6 = WordCount.pdfCountsFromPages(flow, 1);
eq(res6.segments.length, 2, 'a heading and one merged paragraph');
eq(res6.counts.body, 1 + 20, 'the paragraph was not split by the gap rule');

/* A heading at body size, with no extra space around it, still ends the
 * abstract: it is recognised by what it says. */
var sameSize = [page(1, [
  ['A Title', HEAD],
  ['Abstract', HEAD],
  [ten(), BODY], [ten(), BODY],
  ['Introduction', BODY],
  [ten(), BODY], [ten(), BODY], [ten(), BODY]
])];
var res7 = WordCount.pdfCountsFromPages(sameSize, 1);
eq(res7.counts.abstract, 1 + 20, 'a body-size Introduction line closes the abstract');
eq(res7.counts.body, 1 + 30, 'and the text after it is main text');

/* ---- layouts built from positioned items, with widths as pdf.js gives them ---- */
function item(str, x, y, size, w) {
  return { str: str, transform: [size, 0, 0, size, x, y], width: w, height: size };
}
function lay(no, items) { return WordCount.pdfLinesFromTextContent({ items: items }, no); }

/* Two columns under a full-width title and abstract. The right column holds
 * the references; read line by line across both columns, the References
 * heading would land halfway down the left column and take its text. */
var two = [item('A Two Column Article', 200, 760, 16, 220), item('Abstract', 72, 730, 13, 70)];
[716, 702, 688, 674].forEach(function (y) { two.push(item(ten(), 72, y, 11, 460)); });
two.push(item('Introduction', 72, 640, 13, 90));
[624, 610, 596, 582, 568, 554, 540, 526].forEach(function (y) { two.push(item(ten(), 72, y, 11, 228)); });
two.push(item('Conclusion', 320, 643, 13, 80));
[627, 613, 599, 585].forEach(function (y) { two.push(item(ten(), 320, y, 11, 228)); });
two.push(item('References', 320, 565, 13, 80));
[549, 535].forEach(function (y) { two.push(item(ten(), 320, y, 11, 228)); });
var res8 = WordCount.pdfCountsFromPages([lay(1, two)], 1);
eq(res8.counts.title, 4, 'two columns: the full-width title');
eq(res8.counts.abstract, 1 + 40, 'two columns: the full-width abstract');
eq(res8.counts.body, 1 + 80 + 1 + 40, 'two columns: left column, then the right');
eq(res8.counts.refs, 1 + 20, 'two columns: the references at the foot of the right column');

/* A single column with a centred heading and a right-aligned date is not
 * mistaken for two. */
var one = [item('A Centred Heading', 250, 760, 13, 110), item('16 October 2026', 470, 745, 11, 80)];
[720, 706, 692, 678, 664, 650, 636].forEach(function (y) { one.push(item(ten(), 72, y, 11, 470)); });
var oneLines = lay(1, one);
eq(oneLines.length, 9, 'single column: one line per row');

/* Items set apart with no space between them are separate words; items
 * that touch are one. */
var gaps = lay(1, [item('state', 72, 700, 11, 30), item('building', 110, 700, 11, 45),
                   item('cross', 72, 680, 11, 28), item('-national', 100, 680, 11, 50)]);
eq(gaps[0].text, 'state building', 'a gap between items becomes a space');
eq(gaps[1].text, 'cross-national', 'touching items stay one word');

/* A superscript note marker sits on a line of its own; it is not a word. */
var sup = [item('Markers', 72, 760, 16, 80), item('Introduction', 72, 730, 13, 90)];
[700, 686, 672, 658].forEach(function (y) { sup.push(item(ten(), 72, y, 11, 470)); });
sup.push(item('1', 300, 690, 7, 4));
sup.push(item('1 A note at the foot of the page', 72, 100, 8, 200));
var res9 = WordCount.pdfCountsFromPages([lay(1, sup)], 1);
eq(res9.counts.body, 1 + 40, 'the superscript marker adds nothing to the body');
eq(res9.counts.notes, 9, 'the note itself, with its own number, is a note');

/* References set smaller than the body belong to the references. */
var small = [item('Small Type References', 72, 760, 16, 200), item('Introduction', 72, 730, 13, 90)];
[700, 686, 672, 658, 644].forEach(function (y) { small.push(item(ten(), 72, y, 11, 470)); });
small.push(item('References', 72, 610, 13, 80));
[592, 582, 572].forEach(function (y) { small.push(item(ten(), 72, y, 8.5, 400)); });
var res10 = WordCount.pdfCountsFromPages([lay(1, small)], 1);
eq(res10.counts.refs, 1 + 30, 'small-type references are references');
eq(res10.counts.notes, 0, 'not notes');

/* Two pages: a running head on both, and "Page n of 2" folios. */
function runPage(no) {
  var its = [item('Journal of Tests 12 (2026)', 200, 770, 9, 150), item('Page ' + no + ' of 2', 280, 30, 9, 50)];
  [740, 726, 712, 698, 684].forEach(function (y) { its.push(item(ten(), 72, y, 11, 470)); });
  return lay(no, its);
}
var res11 = WordCount.pdfCountsFromPages([runPage(1), runPage(2)], 2);
var kept11 = res11.segments.map(function (s) { return s.preview; }).join(' | ');
eq(kept11.indexOf('Journal of Tests'), -1, 'a running head on both pages of a two-page PDF is dropped');
eq(kept11.indexOf('Page 1 of 2'), -1, 'and so is "Page 1 of 2"');
eq(res11.counts.notes, 0, 'neither is left behind as small-type notes');

/* No text at all: a scan. */
var scanned = null;
try { WordCount.pdfCountsFromPages([[], []], 2); } catch (e) { scanned = e.message; }
ok(scanned && scanned.indexOf('no readable text') >= 0, 'a PDF with no text is refused as a scan');

/* Structural warnings must reach the PDF reader too, not only the .docx one. */
var warned = res6.warnings.join(' ');
ok(warned.indexOf('No abstract was detected') >= 0, 'a PDF with no abstract says so');
ok(warned.indexOf('No reference list was detected') >= 0, 'a PDF with no reference list says so');
ok(warned.indexOf('front matter can swallow') >= 0, 'the typeset front-matter caveat is stated');
ok(res.warnings.join(' ').indexOf('No abstract was detected') < 0,
   'and it stays quiet when the abstract was found');

print('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) throw new Error(fail + ' test(s) failed');
