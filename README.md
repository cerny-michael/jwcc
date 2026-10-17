# Journal Word Count Checker

**Live site: [cerny-michael.github.io/jwcc](https://cerny-michael.github.io/jwcc/)**

Journals impose word limits but disagree about what counts toward them, and
word processors disagree about what a word is. This tool checks a manuscript,
as a `.docx` or a PDF, against the published rules of 133 political science
journals, or against rules you set yourself. Rather than a single number, it
splits the document into ten parts (main text, notes, references, appendices,
and so on) and reports a lower bound, counting only what the journal clearly
includes; an upper bound, counting everything it does not clearly exclude; and
a best estimate in between. When the two bounds are far apart, it is the
journal's instructions that are ambiguous, not the document, and the page
shows exactly where it drew each boundary so that you can check it.

The tool is privacy-aware because your manuscript never leaves your browser.
The site is static, with no server of its own: Word files are unzipped with
[JSZip](https://stuk.github.io/jszip/) and PDFs are read with
[pdf.js](https://mozilla.github.io/pdf.js/), both running on your own
computer, and the page's only request of its own is for the list of journals.
Your file is not uploaded, stored, or logged, and the site has no analytics or
tracking. Loading the page does contact GitHub, which hosts it, and
Cloudflare, which serves the two libraries; like any website, they can see
that the page was visited, but never the file.

Programmed with assistance from [Claude Code](https://claude.com/claude-code),
Anthropic's AI coding tool, which also helped check the journal data. Always
confirm a journal's current limit against its own instructions before
submitting. Maintained by Michael Cerny (Department of Government, Harvard
University).
