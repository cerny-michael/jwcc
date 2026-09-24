# Journal Word Count Checker

A static web page that estimates whether a manuscript fits a political science
journal's word limit. It reports three figures rather than one:

- a **lower bound** — only the parts the journal explicitly counts,
- an **upper bound** — every part the journal has not explicitly excluded,
- a **best estimate** — the journal's own rule, with anything it leaves
  unaddressed resolved by a documented standard scope.

When the two bounds are far apart, the journal's instructions are ambiguous,
not the document.

The page runs entirely in the browser. Documents are never uploaded: `.docx`
files are unzipped with [JSZip](https://stuk.github.io/jszip/) and `.pdf` files
are read with [pdf.js](https://mozilla.github.io/pdf.js/), both client side.

## Layout

```
index.html            the page
css/styles.css        styling, light and dark
js/engine.js          parsing, word counting, component bounds — no DOM
js/app.js             the journal picker, file intake and rendering
data/journals.json    133 journals: limits, criteria, per-component rules
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

135 assertions across four suites: the word counter and section segmentation,
the PDF code path against synthetic `pdf.js` output, the journal dataset and
the bounds arithmetic, and the page wiring against a small shimmed DOM. They
run under the JavaScriptCore interpreter that ships with macOS — no Node, no
npm, no browser. Set `JSC` to another interpreter elsewhere.

What the suite does *not* cover: the `.docx` and `.pdf` readers end to end,
since those need `JSZip`, `pdf.js` and a real `DOMParser`. Check those by
opening the page and dropping in a file whose count you already know.

## How the count is defined

**A word** is a whitespace-delimited token containing at least one letter or
digit — the convention Microsoft Word and LibreOffice implement, and the one
journal limits assume, since that is the number authors read off their own
status bar. Hyphenated compounds count once, comma-grouped numbers count once,
em and en dashes separate words, and stray punctuation counts for nothing. In a
`.docx`, tracked deletions are dropped and tracked insertions kept, so the
figure is the document with all changes accepted; reviewer comments and
reference-manager field codes are never counted.

**What to count** is decided per component. A document is split into ten:
front matter, abstract and keywords, main text, footnotes and endnotes,
captions, text inside tables, references, in-document appendices,
acknowledgements, and display equations. Each journal's published rule marks
every component as counted, not counted, or unaddressed — the third case is
the common one, and it is what the two bounds are for.

**The standard scope**, used with no journal selected and to fill gaps in a
journal's rule, is the modal convention across the dataset: main text, notes
and captions count; front matter, abstract, table contents, references,
appendices, acknowledgements and display equations do not. Every row is
overridable in the results table.

## Caveats worth keeping in mind

- A `.docx` gives a far more reliable breakdown than a PDF. Word marks its own
  footnotes, tables and captions; in a PDF, table text cannot be told apart
  from running prose, and notes are guessed at from type size.
- Section boundaries are found from headings. An unlabelled abstract or a
  reference list with an unusual heading will be counted as main text, and the
  page says so in its caveats.
- Several entries in the dataset are flagged unverified, incomplete, outdated
  or self-contradictory. The page shows the flag and links the journal's own
  instructions. Check them before submitting — a limit can change the week
  after a dataset is compiled.
