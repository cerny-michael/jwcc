/* engine.js — document parsing and word counting, all in the browser.
 *
 * Nothing is uploaded anywhere: .docx files are unzipped with JSZip and .pdf
 * files are parsed with pdf.js, both locally.
 *
 * The engine splits a manuscript into ten components and counts each one
 * separately, so that a journal's "what counts" rule can be applied after the
 * fact. Where a rule is silent, the component sits between the lower and the
 * upper bound instead of being silently included or dropped.
 */
(function (global) {
  'use strict';

  var COMPONENTS = ['title', 'abstract', 'body', 'notes', 'captions',
                    'tables', 'refs', 'appendix', 'acks', 'equations'];

  var LABELS = {
    title:     'Title page (title, authors, affiliations, front matter)',
    abstract:  'Abstract and keywords',
    body:      'Main text (including headings and in-text citations)',
    notes:     'Footnotes and endnotes',
    captions:  'Table and figure captions',
    tables:    'Text inside tables',
    refs:      'Reference list / bibliography',
    appendix:  'In-document appendices',
    acks:      'Acknowledgements, funding and declarations',
    equations: 'Display equations'
  };

  /* The scope used for the "best estimate": the modal convention among the
   * journals in the dataset — main text, notes and captions count; front
   * matter, abstract, table contents, references, appendices, acknowledgements
   * and display maths do not. */
  var STANDARD_PROFILE = {
    title: 0, abstract: 0, body: 1, notes: 1, captions: 1,
    tables: 0, refs: 0, appendix: 0, acks: 0, equations: 0
  };

  /* ---------------------------------------------------------------- counting */

  /* Whitespace-delimited token count, matching the convention Microsoft Word
   * and LibreOffice use (and therefore what journal limits assume):
   * hyphenated compounds and comma-grouped numbers count once, dashes separate
   * words, stray punctuation is not a word. */
  function countWords(text) {
    if (!text) return 0;
    var s = String(text)
      .replace(/\u00AD/g, '')                       // soft hyphen
      .replace(/[\u2010\u2011]/g, '-')             // true hyphens join words
      .replace(/[\u2012-\u2015\u2212]/g, ' ')     // figure/en/em dash, minus
      .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')      // zero-width marks, BOM
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return 0;
    var n = 0, parts = s.split(' ');
    for (var i = 0; i < parts.length; i++) {
      if (/[0-9A-Za-z\u00C0-\u024F\u0370-\u1FFF\u2C00-\uD7FF]/.test(parts[i])) n++;
    }
    return n;
  }

  /* ------------------------------------------------------- section detection */

  var RX = {
    abstract:  /^(abstract|summary|executive summary)\b[:.]?$/i,
    keywords:  /^(key\s?words?|jel codes?)\b/i,
    frontmisc: /^(word count|word-count|running head|running title|corresponding author|draft|working paper|prepared for|version of|please do not cite|forthcoming in|e-?mail)\b/i,
    refs:      /^(references?|bibliography|works cited|reference list|literature cited)\b[:.]?$/i,
    appendix:  /^(appendix|appendices|online appendix|supplementary (material|information|appendix)|supporting information|technical appendix)\b/i,
    acks:      /^(acknowledge?ments?|funding|funding statement|conflicts? of interest|competing interests?|declarations?|disclosure statement|data availability|data and code availability|replication|author (bio|biograph|contribution)|about the authors?|ethics statement)\b/i,
    caption:   /^(table|figure|fig\.?|exhibit|map|chart|scheme|plate|appendix table|appendix figure)\s*[a-d]?\.?\s*\d*[a-z]?\s*[:.\u2014\u2013-]/i,
    notesHead: /^(notes?|endnotes?|footnotes?)\b[:.]?$/i,
    /* An abstract whose label sits at the head of the same paragraph. */
    absInline: /^(abstract|summary)\s*[.:\u2014\u2013-]?\s+\S/i,
    /* Headings that open the article proper, used to close the front matter
     * when a manuscript carries no labelled abstract. */
    bodyHead:  /^(introduction|background|motivation|the puzzle|puzzle|literature|theory|theoretical|argument|hypotheses|data|methods?|methodology|research design|empirical|analysis|results|findings|evidence|discussion|conclusions?|implications)\b/i
  };

  /* Drops a leading section number: "3.", "3.1", "IV)". */
  function stripNumber(t) {
    /* The separator is required, so "Introduction" does not lose its "I". */
    return String(t).replace(/^([0-9]+(\.[0-9]+)*|[IVXLC]+)([.)]\s*|\s+)/, '').trim();
  }

  function classifyHeading(t) {
    if (!t || t.length > 80) return null;
    var s = stripNumber(t);
    if (RX.abstract.test(s)) return 'abstract';
    if (RX.refs.test(s)) return 'refs';
    if (RX.appendix.test(s)) return 'appendix';
    if (RX.acks.test(s)) return 'acks';
    if (RX.notesHead.test(s)) return 'notesSection';
    return null;
  }

  /* A block is {text, kind: 'para'|'table'|'caption', heading: bool}.
   * Walks blocks in document order and assigns each to a component. */
  function assignComponents(blocks) {
    var counts = {}, i;
    for (i = 0; i < COMPONENTS.length; i++) counts[COMPONENTS[i]] = 0;

    var section = 'front';
    var frontWords = 0;
    var segments = [];

    for (i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var t = (b.text || '').trim();
      if (!t) continue;
      var words = countWords(t);
      if (!words) continue;

      var target = null;
      var head = classifyHeading(t);

      if (head === 'abstract') {
        section = 'abstract';
        target = 'abstract';
      } else if (head === 'refs' || head === 'appendix' || head === 'acks') {
        section = head;
        target = head;
      } else if (head === 'notesSection') {
        section = 'notesSection';
        target = 'notes';
      } else if (section === 'front') {
        /* Front matter is the short lines before the article proper: title,
         * authors, affiliations, date. It ends at a labelled abstract, at a
         * heading naming a section of the article, at the first paragraph of
         * real prose, or once it has run on implausibly long. */
        if (RX.keywords.test(t)) {
          target = 'abstract';
        } else if (RX.absInline.test(t)) {
          section = 'abstract';
          target = 'abstract';
        } else if (RX.frontmisc.test(t)) {
          target = 'title';
        } else if (b.heading && RX.bodyHead.test(stripNumber(t))) {
          section = 'body';
        } else if (words > 45 || frontWords > 120) {
          section = 'body';
        } else {
          target = 'title';
          frontWords += words;
        }
      } else if (section === 'abstract') {
        if (RX.keywords.test(t) || RX.frontmisc.test(t)) target = 'abstract';
        else if (b.heading || words > 400) section = 'body';
        else target = 'abstract';
      }

      if (target === null) {
        if (section === 'refs' || section === 'appendix' || section === 'acks') {
          target = section;
        } else if (section === 'notesSection') {
          target = 'notes';
        } else if (b.kind === 'caption' || RX.caption.test(t)) {
          /* The extractor flags captions where it can; the pattern is checked
           * here too so every input route gets the same treatment. */
          target = 'captions';
        } else if (b.kind === 'table') {
          target = 'tables';
        } else {
          target = 'body';
          section = 'body';
        }
      }

      counts[target] += words;
      segments.push({ component: target, words: words, preview: t.slice(0, 110) });
    }
    return { counts: counts, segments: segments };
  }

  /* ------------------------------------------------------------ docx parsing */

  function localName(node) {
    return node.localName || (node.nodeName || '').replace(/^.*:/, '');
  }

  /* Visible text of a paragraph. Skips field instructions (Zotero/Mendeley
   * citation payloads), tracked deletions and OMML maths; maths is returned
   * separately so journals excluding "mathematical notation" can drop it. */
  function nodeText(node, out) {
    out = out || { text: [], math: [] };
    var kids = node.childNodes, i;
    for (i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType !== 1) continue;
      var ln = localName(k);
      if (ln === 'instrText' || ln === 'delText' || ln === 'del' ||
          ln === 'fldChar' || ln === 'proofErr' || ln === 'commentReference' ||
          ln === 'commentRangeStart' || ln === 'commentRangeEnd') continue;
      if (ln === 'oMath' || ln === 'oMathPara') { out.math.push(mathText(k)); continue; }
      if (ln === 't') { out.text.push(k.textContent || ''); continue; }
      if (ln === 'tab' || ln === 'br' || ln === 'cr') { out.text.push(' '); continue; }
      nodeText(k, out);
    }
    return out;
  }

  function mathText(node) {
    var kids = node.getElementsByTagName('*'), s = [], i;
    for (i = 0; i < kids.length; i++) {
      if (localName(kids[i]) === 't') s.push(kids[i].textContent || '');
    }
    return s.join(' ');
  }

  function pStyle(p) {
    var kids = p.childNodes, i, ppr = null;
    for (i = 0; i < kids.length; i++) {
      if (kids[i].nodeType === 1 && localName(kids[i]) === 'pPr') { ppr = kids[i]; break; }
    }
    if (!ppr) return '';
    var st = ppr.getElementsByTagName('*');
    for (i = 0; i < st.length; i++) {
      if (localName(st[i]) === 'pStyle') {
        return st[i].getAttribute('w:val') || st[i].getAttribute('val') || '';
      }
    }
    return '';
  }

  /* Flattens w:sdt wrappers and collects paragraphs and tables in order. */
  function collectBlocks(container, blocks, inTable) {
    var kids = container.childNodes, i;
    for (i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType !== 1) continue;
      var ln = localName(k);
      if (ln === 'p') {
        var txt = nodeText(k);
        var style = pStyle(k);
        var text = txt.text.join('');
        var isHeading = /^heading[1-9]?$/i.test(style.replace(/[\s-]/g, '')) ||
                        /^(title|subtitle)$/i.test(style);
        var kind = inTable ? 'table' : 'para';
        if (!inTable && (/caption/i.test(style) || RX.caption.test(text.trim()))) kind = 'caption';
        blocks.push({ text: text, kind: kind, heading: isHeading, math: txt.math.join(' ') });
      } else if (ln === 'tbl') {
        collectBlocks(k, blocks, true);
      } else if (ln === 'sdt' || ln === 'sdtContent' || ln === 'tr' || ln === 'tc' ||
                 ln === 'customXml' || ln === 'smartTag' || ln === 'ins') {
        collectBlocks(k, blocks, inTable);
      }
    }
  }

  function parseXml(str) {
    return new DOMParser().parseFromString(str, 'application/xml');
  }

  function firstByLocal(doc, name) {
    var all = doc.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) if (localName(all[i]) === name) return all[i];
    return null;
  }

  function extractDocx(arrayBuffer) {
    var theZip = null;
    return global.JSZip.loadAsync(arrayBuffer).then(function (zip) {
      theZip = zip;
      var docFile = zip.file('word/document.xml');
      if (!docFile) {
        throw new Error('This does not look like a Word .docx file (no word/document.xml inside). If it is an older .doc file, save it as .docx first.');
      }
      var jobs = [docFile.async('string')];
      ['word/footnotes.xml', 'word/endnotes.xml'].forEach(function (p) {
        var f = zip.file(p);
        jobs.push(f ? f.async('string') : Promise.resolve(null));
      });
      return Promise.all(jobs);
    }).then(function (res) {
      var warnings = [];
      var doc = parseXml(res[0]);
      var body = firstByLocal(doc, 'body');
      if (!body) throw new Error('Could not read the document body.');

      var blocks = [];
      collectBlocks(body, blocks, false);

      var assigned = assignComponents(blocks);
      var counts = assigned.counts;

      var mathWords = 0;
      blocks.forEach(function (b) { if (b.math) mathWords += countWords(b.math); });
      if (mathWords) counts.equations = mathWords;

      /* Footnotes and endnotes live in their own parts of the package. */
      var noteWords = 0, noteCount = 0;
      [res[1], res[2]].forEach(function (xml) {
        if (!xml) return;
        var d = parseXml(xml), all = d.getElementsByTagName('*'), i;
        for (i = 0; i < all.length; i++) {
          var ln = localName(all[i]);
          if (ln !== 'footnote' && ln !== 'endnote') continue;
          if (all[i].getAttribute('w:type') || all[i].getAttribute('type')) continue;
          var id = all[i].getAttribute('w:id') || all[i].getAttribute('id');
          if (id === '-1' || id === '0') continue;
          var w = countWords(nodeText(all[i]).text.join(''));
          if (w) { noteWords += w; noteCount++; }
        }
      });
      counts.notes += noteWords;

      var separable = {};
      COMPONENTS.forEach(function (c) { separable[c] = true; });

      if (mathWords) {
        warnings.push('Display equations were counted separately (' + mathWords +
          ' words of maths). Mathematics typed as ordinary text cannot be told apart from prose.');
      }
      if (!counts.title) {
        warnings.push('No title block was detected. If the title and authors run on into the text without a break, those words are inside the main-text figure.');
      }
      if (!counts.abstract) {
        warnings.push('No abstract was detected — the engine looks for a line reading "Abstract". If yours is unlabelled it has been counted as main text.');
      }
      if (!counts.refs) {
        warnings.push('No reference list was detected (looked for a heading reading "References", "Bibliography" or "Works Cited"). Any references present have been counted as main text.');
      }
      if (theZip.file('word/comments.xml')) {
        warnings.push('The file carries review comments. Comment text is never counted.');
      }
      warnings.push('Tracked deletions are excluded and tracked insertions included, so the count is of the document with all changes accepted.');

      return {
        source: 'docx', counts: counts, separable: separable,
        warnings: warnings, segments: assigned.segments,
        detail: { blocks: blocks.length, notes: noteCount }
      };
    });
  }

  /* ------------------------------------------------------------- pdf parsing */

  function extractPdf(arrayBuffer) {
    var pdfjs = global.pdfjsLib;
    if (!pdfjs) return Promise.reject(new Error('The PDF reader did not load. Check your connection and reload the page.'));
    return pdfjs.getDocument({ data: arrayBuffer }).promise.then(function (pdf) {
      var pages = [];
      var chain = Promise.resolve();
      for (var p = 1; p <= pdf.numPages; p++) {
        (function (pageNo) {
          chain = chain.then(function () {
            return pdf.getPage(pageNo).then(function (page) {
              return page.getTextContent().then(function (tc) {
                pages[pageNo - 1] = buildLines(tc, pageNo);
              });
            });
          });
        })(p);
      }
      return chain.then(function () { return finishPdf(pages, pdf.numPages); });
    });
  }

  /* Groups text items into lines, keeping each line's font size. */
  function buildLines(tc, pageNo) {
    var rows = {}, i;
    for (i = 0; i < tc.items.length; i++) {
      var it = tc.items[i];
      if (!it.str) continue;
      var y = Math.round(it.transform[5] * 2) / 2;
      var size = Math.abs(it.transform[3]) || it.height || 0;
      if (!rows[y]) rows[y] = { y: y, size: 0, parts: [] };
      rows[y].parts.push({ x: it.transform[4], str: it.str });
      if (countWords(it.str) > 0) rows[y].size = Math.max(rows[y].size, size);
    }
    var lines = Object.keys(rows).map(function (k) { return rows[k]; });
    lines.sort(function (a, b) { return b.y - a.y; });
    var out = lines.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      var text = r.parts.map(function (p) { return p.str; }).join('');
      return { text: text.replace(/\s+/g, ' ').trim(), size: r.size, y: r.y, page: pageNo };
    }).filter(function (l) { return l.text.length > 0; });

    /* Flag lines in the top and bottom band of the page. Only these can be
     * running heads or folios, so only these are candidates for removal: a
     * repeated line in the middle of a page is real text. */
    if (out.length) {
      var yMax = out[0].y, yMin = out[out.length - 1].y, range = yMax - yMin;
      out.forEach(function (l) {
        l.edge = range <= 0 || l.y > yMax - range * 0.07 || l.y < yMin + range * 0.07;
      });
    }
    return out;
  }

  function finishPdf(pages, numPages) {
    var warnings = [];
    var all = [], i, j;
    for (i = 0; i < pages.length; i++) {
      if (!pages[i]) continue;
      for (j = 0; j < pages[i].length; j++) all.push(pages[i][j]);
    }

    /* Modal font size, weighted by words, is the body text size. */
    var tally = {};
    all.forEach(function (l) {
      var k = Math.round(l.size * 2) / 2;
      tally[k] = (tally[k] || 0) + countWords(l.text);
    });
    var bodySize = 0, best = -1;
    Object.keys(tally).forEach(function (k) {
      if (tally[k] > best) { best = tally[k]; bodySize = parseFloat(k); }
    });

    /* Drop running heads and folios: short lines repeated across pages, or
     * lines that are nothing but a number. */
    var seen = {};
    all.forEach(function (l) {
      if (l.edge && l.text.length < 90) {
        var key = l.text.replace(/\d+/g, '#');
        seen[key] = (seen[key] || 0) + 1;
      }
    });
    var kept = all.filter(function (l) {
      if (l.edge && /^[ivxlcdm\d]{1,7}$/i.test(l.text)) return false;
      if (l.edge && numPages >= 3 && l.text.length < 90) {
        var key = l.text.replace(/\d+/g, '#');
        if (seen[key] >= Math.max(3, numPages * 0.5)) return false;
      }
      return true;
    });

    /* Merge consecutive lines of the same type size into paragraph blocks, so
     * section and caption detection works on whole units. */
    var blocks = [], cur = null;
    var smallCut = bodySize * 0.93;
    var notesWords = 0, smallSeen = false;

    function flush() { if (cur && cur.text.trim()) blocks.push(cur); cur = null; }

    for (i = 0; i < kept.length; i++) {
      var l = kept[i], t = l.text;
      var isSmall = bodySize > 0 && l.size > 0 && l.size < smallCut;
      var head = classifyHeading(t);
      var isCaption = RX.caption.test(t);
      var looksHeading = head !== null ||
        (t.length < 70 && !/[.;,]$/.test(t) && bodySize > 0 && l.size > bodySize * 1.04);

      if (head !== null || isCaption || looksHeading) {
        flush();
        blocks.push({ text: t, kind: isCaption ? 'caption' : 'para', heading: true, small: isSmall });
        if (isSmall) smallSeen = true;
        continue;
      }
      if (!cur || cur.small !== isSmall) {
        flush();
        cur = { text: t, kind: 'para', heading: false, small: isSmall };
      } else if (/[A-Za-z]-$/.test(cur.text) && /^[a-z]/.test(t)) {
        cur.text = cur.text.replace(/-$/, '') + t;     // de-hyphenate line breaks
      } else {
        cur.text += ' ' + t;
      }
      if (isSmall) smallSeen = true;
    }
    flush();

    /* Small-type blocks are treated as footnotes. */
    var mainBlocks = [];
    blocks.forEach(function (b) {
      if (b.small && !b.heading) notesWords += countWords(b.text);
      else mainBlocks.push(b);
    });

    var assigned = assignComponents(mainBlocks);
    var counts = assigned.counts;
    counts.notes += notesWords;

    var separable = {
      title: true, abstract: true, body: true, notes: smallSeen, captions: true,
      tables: false, refs: true, appendix: true, acks: true, equations: false
    };

    warnings.push('PDF text arrives as a stream of positioned lines, so every figure here is an approximation. For an authoritative count, run the .docx source of the same manuscript.');
    warnings.push('Text inside tables cannot be told apart from running prose in a PDF, so it is counted with the main text.');
    if (smallSeen) {
      warnings.push('Footnotes were identified by type size smaller than the body text (' + notesWords +
        ' words). Endnotes set at body size are counted as main text unless a "Notes" heading precedes them.');
    } else {
      warnings.push('No smaller-than-body type was found, so no notes could be separated out. Any notes are inside the main-text figure.');
    }
    warnings.push('Ligatures, multi-column layouts and display equations can each shift a PDF count by a per cent or two.');

    return {
      source: 'pdf', counts: counts, separable: separable,
      warnings: warnings, segments: assigned.segments,
      detail: { pages: numPages, bodySize: bodySize }
    };
  }

  /* ------------------------------------------------------------------ bounds */

  /* rules: {component: 1|0|null}. Returns the three figures plus, for every
   * component, how it was treated. */
  function computeBounds(counts, separable, rules) {
    var lower = 0, upper = 0, best = 0, total = 0;
    var rows = [], caveats = [];

    COMPONENTS.forEach(function (c) {
      var n = counts[c] || 0;
      total += n;
      var rule = rules && rules[c] !== undefined ? rules[c] : STANDARD_PROFILE[c];
      var sep = separable[c] !== false;
      var inLower, inUpper, inBest;

      if (rule === 1) { inLower = true; inUpper = true; inBest = true; }
      else if (rule === 0) { inLower = false; inUpper = false; inBest = false; }
      else { inLower = false; inUpper = true; inBest = !!STANDARD_PROFILE[c]; }

      /* A component that could not be separated is sitting inside another
       * component's count, so excluding it is not actually possible. */
      if (!sep && rule !== 1) {
        caveats.push(LABELS[c] + ' could not be separated from the main text in this file, so no bound can subtract it. ' +
          (rule === 0 ? 'This journal does not count it, so the figures below are over-estimates.'
                      : 'Its treatment is unclear, and the lower bound therefore cannot go as low as it should.'));
      }

      if (inLower) lower += n;
      if (inUpper) upper += n;
      if (inBest) best += n;
      rows.push({ component: c, label: LABELS[c], words: n, rule: rule,
                  separable: sep, inLower: inLower, inUpper: inUpper, inBest: inBest });
    });

    return { lower: lower, upper: upper, best: best, total: total,
             rows: rows, caveats: caveats };
  }

  global.WordCount = {
    COMPONENTS: COMPONENTS,
    LABELS: LABELS,
    STANDARD_PROFILE: STANDARD_PROFILE,
    countWords: countWords,
    /* exposed so the logic can be exercised without a browser */
    classifyHeading: classifyHeading,
    assignComponents: assignComponents,
    extractDocx: extractDocx,
    extractPdf: extractPdf,
    pdfLinesFromTextContent: buildLines,
    pdfCountsFromPages: finishPdf,
    computeBounds: computeBounds
  };
})(window);
