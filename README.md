# Journal Word Count Checker

A static web page that estimates whether a manuscript fits a political science
journal's word limit. It reports three figures rather than one:

- a **lower bound** — only the parts the journal explicitly counts,
- an **upper bound** — every part the journal has not explicitly excluded,
- a **best estimate** — the journal's own rule, with anything it leaves
  unaddressed resolved by a documented standard scope.

When the two bounds are far apart, the journal's instructions are ambiguous,
not the document.

The page runs in three steps: add the manuscript; then either choose a journal,
or choose your own limit and tick the parts to count, which gives a single
figure; then read the result. A link ending `?journal=<name>` opens with that
journal chosen, so a coauthor can be sent the same view.

The page runs entirely in the browser. Documents are never uploaded: `.docx`
files are unzipped with [JSZip](https://stuk.github.io/jszip/) and `.pdf` files
are read with [pdf.js](https://mozilla.github.io/pdf.js/), both client side.

## Layout

```
index.html            the page
css/styles.css        styling, light and dark
js/engine.js          parsing, word counting, component bounds — no DOM
js/app.js             file intake, the journal picker and custom rules, rendering
data/journals.json    133 journals: limits, guidelines, criteria, per-component rules
data/source/          the spreadsheet the JSON is generated from
tools/build_journals.py   regenerates data/journals.json from that spreadsheet
tools/docx_blocks.py      dumps a .docx block stream, for debugging a count
tests/                the test suite (no Node required)
```

## Running it locally

Any static server will do; `file://` will not, because the page fetches
`data/journals.json`.

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Publishing it

Push to GitHub and turn on Pages (Settings → Pages → deploy from branch
`main`, folder `/`). There is no build step.

## Tests

```sh
bash tests/run.sh
```

300 assertions across five suites: the word counter and section segmentation,
the PDF code path against synthetic `pdf.js` output, the journal dataset and
the bounds arithmetic, the page wiring against a small shimmed DOM, and the
real `.docx` and PDF readers. The first four run under the JavaScriptCore interpreter
that ships with macOS — no Node, no npm. Set `JSC` to another interpreter
elsewhere.

The fifth suite, `tests/docx_tests.html`, runs the real readers in headless
Chrome. It builds small `.docx` files with JSZip (heading styles and bold
headings, page breaks, text boxes, footnotes, tracked changes and moves, field
codes, tables, captions, maths, and broken files) and reads the PDFs in
`tests/fixtures` with pdf.js: a two-column journal layout printed by Chrome,
a PDF with no text, and a password-protected one. It needs Chrome (set
`CHROME` if it is not in `/Applications`) and a connection to fetch JSZip and
pdf.js; without Chrome it is skipped.

## How the count is defined

**A word** is a whitespace-delimited token containing at least one letter or
digit — the convention word processors such as Microsoft Word and LibreOffice
broadly follow, and the one journal limits assume. Hyphenated compounds count
once, comma-grouped numbers count once, em and en dashes separate words (as
LibreOffice treats them by default), and stray punctuation counts for nothing. In a
`.docx`, tracked deletions are dropped and tracked insertions kept, so the
figure is the document with all changes accepted (text moved with tracking on
counts once, where it now stands); reviewer comments and
reference-manager field codes are never counted, and a text box, which Word
stores twice, is counted once.

**What to count** is decided per component. A document is split into ten:
front matter, abstract and keywords, main text, footnotes and endnotes,
captions, text inside tables, references, in-document appendices,
acknowledgements, and display equations. Each journal's published rule marks
every component as counted, not counted, or unaddressed — the third case is
the common one, and it is what the two bounds are for.

**Finding the parts.** Sections are found from headings: Word heading styles
(read from `styles.xml`, so Word in any language works), short lines set
entirely in bold, and lines that name a section, such as "Introduction" or
"Data and Methods". In a `.docx`, a page break the author inserted after the
abstract also ends it, and an abstract that runs past about 450 words is
closed regardless. The page lists every run of paragraphs and where it went,
under "How the document was split".

**The standard scope**, used before a journal is chosen and to fill gaps in a
journal's rule, counts the text of the manuscript proper: main text, notes
and captions count; front matter, abstract, table contents, references,
appendices, acknowledgements and display equations do not. This is a choice,
not the dataset's majority view: among journals that address them, more count
the reference list (51 to 20), table text (34 to 19) and the abstract (18 to
15) than exclude them. Where a journal is silent on those parts they stay in
the upper bound. Every row is overridable in the results table.

**Guidelines.** Where a journal states no hard cap but names a length to aim
for (APSR, International Security, Journal of Theoretical Politics, Human
Rights Quarterly), or gives only a soft figure (Political Psychology, Ethics),
the result is measured against that figure as a guideline: going over it is
a warning, not a failure. For a page limit, a PDF's own page count is shown
beside the words-per-page conversion.

## Caveats worth keeping in mind

- A `.docx` gives a far more reliable breakdown than a PDF. Word marks its own
  footnotes, tables and captions; in a PDF, table text cannot be told apart
  from running prose, and notes are guessed at from type size.
- Section boundaries are found from headings. An unlabelled abstract or a
  reference list with an unusual heading will be counted as main text, and the
  page says so in its caveats. Check "How the document was split" when a
  figure looks wrong.
- Several entries in the dataset are flagged unverified, incomplete, outdated
  or self-contradictory. The page shows the flag and links the journal's own
  instructions. Check them before submitting — a limit can change the week
  after a dataset is compiled. Readers can ask for a correction through the
  form at the foot of the page, which opens an email to the maintainer in their
  own mail app; nothing is sent from the page itself.
