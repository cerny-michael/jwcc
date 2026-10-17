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

  /* The scope used for the "best estimate" wherever a journal's rule is
   * silent: the text of the manuscript proper. Main text, notes and captions
   * count; front matter, abstract, table contents, references, appendices,
   * acknowledgements and display maths do not. This is a choice, not the
   * dataset's majority view: among journals that address them, more count
   * references, table text and the abstract than exclude them. Those parts
   * stay inside the upper bound. */
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

  var SECTION_NAMES = '(introduction|background|motivation|literature( review)?|' +
    'related (literature|work)|theory|theoretical framework|argument|hypothes[ie]s|' +
    'data|methods?|methodology|research design|empirical strategy|analysis|' +
    'results|findings|evidence|discussion|conclusions?)';

  var RX = {
    /* A line that is nothing but the name of a section ("Introduction",
     * "Data and Methods"). Recognised whatever its styling, since many
     * manuscripts set their headings in bold body text. */
    bareHead:  new RegExp('^' + SECTION_NAMES + '(\\s*(and|&)\\s*' + SECTION_NAMES + ')?:?$', 'i'),
    abstract:  /^(abstract|summary|executive summary)\b[:.]?$/i,
    keywords:  /^(key\s?words?|jel codes?)\b/i,
    frontmisc: /^(word count|word-count|running head|running title|corresponding author|draft|working paper|prepared for|version of|please do not cite|forthcoming in|e-?mail)\b/i,
    refs:      /^(references?( cited)?|bibliography|works cited|sources cited|reference list|literature cited)\b[:.]?$/i,
    appendix:  /^(appendix|appendices|online appendix|technical appendix|supporting information|supplementa(ry|l) (materials?|information|appendix|appendices)|online supplement(ary)?( (materials?|information|appendix))?)\b/i,
    acks:      /^(acknowledge?ments?|funding|funding statement|conflicts? of interest|competing interests?|declarations?|disclosure statement|data availability|data and code availability|replication|author (bio|biograph|contribution)|about the authors?|ethics statement)\b/i,
    caption:   /^(table|figure|fig\.?|exhibit|map|chart|scheme|plate|appendix table|appendix figure)\s*[a-d]?\.?\s*\d*[a-z]?\s*[:.\u2014\u2013-]/i,
    notesHead: /^(notes?|endnotes?|footnotes?)\b[:.]?$/i,
    /* A starred or daggered note on the first page: an author note, which is
     * an acknowledgement rather than part of the abstract. */
    starNote:  /^[*\u2217\u2020\u2021\u00A7]\s*\S/,
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

  /* A capitalised line naming a section of the article proper. */
  function namesSection(t) {
    var s = stripNumber(t);
    return /^[A-Z]/.test(s) && RX.bareHead.test(s);
  }

  /* A block is {text, kind: 'para'|'table'|'caption'|'note', heading: bool};
   * 'note' is small type in a PDF.
   * Walks blocks in document order and assigns each to a component. */
  function assignComponents(blocks) {
    var counts = {}, i;
    for (i = 0; i < COMPONENTS.length; i++) counts[COMPONENTS[i]] = 0;

    var section = 'front';
    var frontWords = 0, absWords = 0;
    var pageBreak = false;            // an explicit page break since the last block
    var opening = null;               // the body's first paragraphs, while they may be an abstract
    var segments = [];

    for (i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.breakBefore) pageBreak = true;
      var t = (b.text || '').trim();
      var words = t ? countWords(t) : 0;
      if (!words) {                   // an empty paragraph can still carry the break
        if (b.breakAfter) pageBreak = true;
        continue;
      }
      var newPage = pageBreak;
      pageBreak = !!b.breakAfter;

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
          absWords += words;
        } else if (RX.starNote.test(t)) {
          target = 'acks';
        } else if (RX.frontmisc.test(t)) {
          target = 'title';
        } else if ((b.heading && frontWords > 0 && RX.bodyHead.test(stripNumber(t))) ||
                   namesSection(t)) {
          /* A heading only closes the front matter once a title has been
           * seen, so a bold title beginning "Theory..." stays a title. */
          section = 'body';
        } else if (words > 45 || frontWords > 120 ||
                   (words > 15 && /[.!?]["'\u201D\u2019)]?(\s|$)/.test(t))) {
          /* A title or affiliation is short and rarely contains a finished
           * sentence; a block of prose that does is the article proper. */
          section = 'body';
        } else {
          target = 'title';
          frontWords += words;
        }
      } else if (section === 'abstract') {
        /* The abstract ends at a page break the author inserted, at a
         * heading, at a line naming a section, or once it has run on longer
         * than any journal lets an abstract run. */
        if (RX.starNote.test(t)) target = 'acks';
        else if (RX.keywords.test(t) || RX.frontmisc.test(t)) target = 'abstract';
        else if (newPage || b.heading || namesSection(t) || words > 400 ||
                 absWords + words > 450) section = 'body';
        else { target = 'abstract'; absWords += words; }
      } else if (section === 'body' && opening && RX.keywords.test(t)) {
        /* A keywords line straight after the opening paragraphs shows that
         * they were an abstract with no label. */
        for (var s = opening.from; s < segments.length; s++) segments[s].component = 'abstract';
        counts.body -= opening.words;
        counts.abstract += opening.words;
        opening = false;
        target = 'abstract';
      }

      if (target === null) {
        if (section === 'refs' || section === 'appendix' || section === 'acks') {
          target = section;
        } else if (section === 'notesSection' || b.kind === 'note') {
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

      /* Up to two paragraphs that open the body, before any heading and with
       * no abstract found, stay open to being reassigned as one. */
      if (target === 'body' && opening !== false && !counts.abstract) {
        if (b.heading || namesSection(t)) {
          opening = false;
        } else {
          if (!opening) opening = { from: segments.length, words: 0, blocks: 0 };
          opening.words += words;
          if (++opening.blocks > 2 || opening.words > 450) opening = false;
        }
      } else if (target !== 'body' && target !== 'notes' && opening) {
        opening = false;
      }

      counts[target] += words;
      segments.push({ component: target, words: words, preview: t.slice(0, 110) });
    }
    return { counts: counts, segments: segments };
  }

  /* Warnings about what the segmenter could not find. Applies to both readers:
   * a component that was never detected has been counted as something else. */
  function structureWarnings(counts, source) {
    var w = [];
    if (!counts.abstract) {
      w.push('No abstract was detected \u2014 the engine looks for a line reading "Abstract". ' +
        'If yours is unlabelled it has been counted as main text.');
    } else if (counts.abstract > 300) {
      w.push('The abstract came to ' + counts.abstract + ' words, longer than most journals allow. ' +
        'If the article proper begins sooner than the engine judged, open ‘How the document was split’ ' +
        'to see where it drew the line.');
    }
    if (!counts.refs) {
      w.push('No reference list was detected (the engine looks for a heading reading "References", ' +
        '"Bibliography" or "Works Cited"). Any references present have been counted as main text' +
        (source === 'pdf' ? ', or as notes if they are set in smaller type.' : '.'));
    }
    if (!counts.title) {
      w.push('No title block was detected. If the title and authors run on into the text without a ' +
        'break, those words are inside the main-text figure.');
    }
    return w;
  }

  /* ------------------------------------------------------------ docx parsing */

  function localName(node) {
    return node.localName || (node.nodeName || '').replace(/^.*:/, '');
  }

  function childByLocal(node, name) {
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].nodeType === 1 && localName(kids[i]) === name) return kids[i];
    }
    return null;
  }

  function attrVal(el) {
    return el ? (el.getAttribute('w:val') || el.getAttribute('val') || '') : '';
  }

  /* A toggle such as <w:b/> is on unless its value says otherwise. */
  function isOn(el) { return !/^(0|false|off)$/i.test(attrVal(el)); }

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
      /* moveFrom holds the old copy of text moved with tracking on; the new
       * copy, in moveTo, is the one that counts. */
      if (ln === 'instrText' || ln === 'delText' || ln === 'del' || ln === 'moveFrom' ||
          ln === 'fldChar' || ln === 'proofErr' || ln === 'commentReference' ||
          ln === 'commentRangeStart' || ln === 'commentRangeEnd') continue;
      if (ln === 'oMath' || ln === 'oMathPara') { out.math.push(mathText(k)); continue; }
      if (ln === 't') { out.text.push(k.textContent || ''); continue; }
      if (ln === 'tab' || ln === 'br' || ln === 'cr') {
        if (ln === 'br' && out.pageBreakAt === undefined &&
            /^page$/i.test(k.getAttribute('w:type') || k.getAttribute('type') || '')) {
          out.pageBreakAt = out.text.join('').length;
        }
        out.text.push(' ');
        continue;
      }
      if (ln === 'AlternateContent') {
        /* Word stores a text box twice, once for current readers and once as
         * a fallback for old ones. Read one copy, not both. */
        var alt = childByLocal(k, 'Choice') || childByLocal(k, 'Fallback');
        if (alt) nodeText(alt, out);
        continue;
      }
      if (ln === 'p') {
        /* A paragraph inside a text box, or one of several in a footnote:
         * keep it from running into its neighbours. */
        out.text.push(' ');
        nodeText(k, out);
        out.text.push(' ');
        continue;
      }
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
    var ppr = childByLocal(p, 'pPr');
    return ppr ? attrVal(childByLocal(ppr, 'pStyle')) : '';
  }

  /* Paragraph and character styles from word/styles.xml: which are headings
   * (an outline level, or a built-in heading name, which Word stores in
   * English whatever the interface language) and which are bold, following
   * each style's basedOn chain. */
  function readStyles(xml) {
    var raw = {}, out = {}, none = { heading: false, bold: false };
    if (!xml) return out;
    var all = parseXml(xml).getElementsByTagName('*'), i;
    for (i = 0; i < all.length; i++) {
      if (localName(all[i]) !== 'style') continue;
      var s = all[i];
      var ppr = childByLocal(s, 'pPr'), rpr = childByLocal(s, 'rPr');
      var lvl = ppr ? childByLocal(ppr, 'outlineLvl') : null;
      var b = rpr ? childByLocal(rpr, 'b') : null;
      raw[s.getAttribute('w:styleId') || s.getAttribute('styleId') || ''] = {
        name: attrVal(childByLocal(s, 'name')),
        basedOn: attrVal(childByLocal(s, 'basedOn')),
        level: lvl ? parseInt(attrVal(lvl), 10) : null,
        bold: b ? isOn(b) : null
      };
    }
    function resolve(id, depth) {
      if (out[id]) return out[id];
      var r = raw[id];
      if (!r || depth > 20) return none;
      var parent = r.basedOn ? resolve(r.basedOn, depth + 1) : none;
      out[id] = {
        heading: r.level !== null ? r.level < 9
               : (/^(heading [1-9]|title|subtitle)$/i.test(r.name) || parent.heading),
        bold: r.bold !== null ? r.bold : parent.bold
      };
      return out[id];
    }
    Object.keys(raw).forEach(function (id) { resolve(id, 0); });
    return out;
  }

  /* True when every run of visible text in the paragraph is bold. */
  function allBold(p, paraBold, styles) {
    var all = p.getElementsByTagName('*'), any = false, i, j;
    for (i = 0; i < all.length; i++) {
      var r = all[i];
      if (localName(r) !== 'r') continue;
      var txt = '';
      for (j = 0; j < r.childNodes.length; j++) {
        var c = r.childNodes[j];
        if (c.nodeType === 1 && localName(c) === 't') txt += c.textContent || '';
      }
      if (!/\S/.test(txt)) continue;
      any = true;
      var bold = paraBold, rpr = childByLocal(r, 'rPr');
      if (rpr) {
        var b = childByLocal(rpr, 'b'), rs = styles[attrVal(childByLocal(rpr, 'rStyle'))];
        if (b) bold = isOn(b);
        else if (rs && rs.bold) bold = true;
      }
      if (!bold) return false;
    }
    return any;
  }

  /* A heading is a paragraph in a heading style, one given an outline level
   * directly, or (outside tables) a short line set entirely in bold, which is
   * how many manuscripts mark their headings. */
  function isHeadingPara(p, text, style, styles, inTable) {
    var st = styles[style];
    if (/^heading[1-9]?$/i.test(style.replace(/[\s-]/g, '')) ||
        /^(title|subtitle)$/i.test(style) || (st && st.heading)) return true;
    var ppr = childByLocal(p, 'pPr');
    var lvl = ppr ? childByLocal(ppr, 'outlineLvl') : null;
    if (lvl && parseInt(attrVal(lvl), 10) < 9) return true;
    if (inTable) return false;
    var n = countWords(text);
    if (n < 1 || n > 15 || /[.,;:]["'”’)]?$/.test(text.trim())) return false;
    return allBold(p, !!(st && st.bold), styles);
  }

  /* Flattens w:sdt wrappers and collects paragraphs and tables in order. */
  function collectBlocks(container, blocks, inTable, styles) {
    var kids = container.childNodes, i;
    for (i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType !== 1) continue;
      var ln = localName(k);
      if (ln === 'p') {
        var txt = nodeText(k);
        var style = pStyle(k);
        var text = txt.text.join('');
        var kind = inTable ? 'table' : 'para';
        if (!inTable && (/caption/i.test(style) || RX.caption.test(text.trim()))) kind = 'caption';

        /* Page breaks the author inserted: a manual break, "page break
         * before", or a section break that starts a new page. Breaks Word
         * merely rendered are ignored; they move with the layout. */
        var ppr = childByLocal(k, 'pPr');
        var pbb = ppr ? childByLocal(ppr, 'pageBreakBefore') : null;
        var sect = ppr ? childByLocal(ppr, 'sectPr') : null;
        var breakBefore = !!(pbb && isOn(pbb)), breakAfter = false;
        if (txt.pageBreakAt !== undefined) {
          if (/\S/.test(text.slice(0, txt.pageBreakAt))) breakAfter = true;
          else breakBefore = true;
        }
        if (sect && attrVal(childByLocal(sect, 'type')) !== 'continuous') breakAfter = true;

        blocks.push({ text: text, kind: kind, heading: isHeadingPara(k, text, style, styles, inTable),
                      math: txt.math.join(' '), breakBefore: breakBefore, breakAfter: breakAfter });
      } else if (ln === 'tbl') {
        collectBlocks(k, blocks, true, styles);
      } else if (ln === 'sdt' || ln === 'sdtContent' || ln === 'tr' || ln === 'tc' ||
                 ln === 'customXml' || ln === 'smartTag' || ln === 'ins') {
        collectBlocks(k, blocks, inTable, styles);
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

  /* Says what a file is when it is not a .docx, from its first bytes. */
  function notDocx(arrayBuffer) {
    if (!arrayBuffer.byteLength) return 'The file is empty.';
    var b = new Uint8Array(arrayBuffer, 0, Math.min(4, arrayBuffer.byteLength));
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) {
      return 'This is an older Word .doc file with a .docx name. Open it in Word and save it as .docx.';
    }
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
      return 'This is a PDF with a .docx name. Rename it to end in .pdf and add it again.';
    }
    if (b[0] !== 0x50 || b[1] !== 0x4B) {
      return 'This is not a Word .docx file. It may be damaged, or another kind of file renamed to .docx.';
    }
    return null;
  }

  function extractDocx(arrayBuffer) {
    var theZip = null;
    var wrong = notDocx(arrayBuffer);
    if (wrong) return Promise.reject(new Error(wrong));
    return global.JSZip.loadAsync(arrayBuffer).then(null, function () {
      throw new Error('This .docx could not be opened. It may be damaged or incomplete; try saving it again in Word.');
    }).then(function (zip) {
      theZip = zip;
      var docFile = zip.file('word/document.xml');
      if (!docFile) {
        throw new Error('This does not look like a Word .docx file (no word/document.xml inside). If it is an older .doc file, save it as .docx first.');
      }
      var jobs = [docFile.async('string')];
      ['word/footnotes.xml', 'word/endnotes.xml', 'word/styles.xml'].forEach(function (p) {
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
      collectBlocks(body, blocks, false, readStyles(res[3]));

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
      structureWarnings(counts, 'docx').forEach(function (w) { warnings.push(w); });
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
    return pdfjs.getDocument({ data: arrayBuffer }).promise.then(null, function (e) {
      if (e && e.name === 'PasswordException') {
        throw new Error('This PDF is password-protected. Save a copy without the password and add that instead.');
      }
      throw new Error('This PDF could not be read. It may be damaged or incomplete; try exporting it again.');
    }).then(function (pdf) {
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

  /* Joins one line's text items left to right. Where two items sit apart
   * with no space between them, a space is put back, so that words set as
   * separate items do not run together. */
  function joinParts(parts) {
    var text = '', end = null, size = 0;
    parts.forEach(function (p) {
      if (end !== null && p.x - end > (p.size || 10) * 0.2 &&
          !/\s$/.test(text) && !/^\s/.test(p.str)) text += ' ';
      text += p.str;
      end = p.w ? p.x + p.w : null;
      if (countWords(p.str) > 0) size = Math.max(size, p.size);
    });
    return { text: text.replace(/\s+/g, ' ').trim(), size: size };
  }

  /* A two-column page has an upright strip near the middle of its text that
   * few lines cross (a full-width title and abstract above the columns
   * do), with a fair share of lines wholly on each side of it. The two columns' lines need not share baselines, so sides are
   * counted line by line. Returns the strip's x position, or null for a
   * single column. */
  function findGutter(rows) {
    var lo = Infinity, hi = -Infinity;
    var lines = rows.map(function (r) {
      return r.parts.filter(function (p) { return p.w > 0 && /\S/.test(p.str); });
    }).filter(function (ps) { return ps.length; });
    lines.forEach(function (ps) {
      ps.forEach(function (p) { lo = Math.min(lo, p.x); hi = Math.max(hi, p.x + p.w); });
    });
    if (lines.length < 6 || !(hi > lo)) return null;
    var best = null;
    for (var x = lo + (hi - lo) * 0.35; x <= lo + (hi - lo) * 0.65; x += 2) {
      var crossing = 0, left = 0, right = 0;
      lines.forEach(function (ps) {
        var l = false, r = false, cross = false;
        ps.forEach(function (p) {
          if (p.x < x && p.x + p.w > x) cross = true;
          else if (p.x + p.w <= x) l = true;
          else r = true;
        });
        if (cross) crossing++;
        if (l) left++;
        if (r) right++;
      });
      var side = Math.min(left, right);
      if (!best || crossing < best.crossing || (crossing === best.crossing && side > best.side)) {
        best = { x: x, crossing: crossing, side: side };
      }
    }
    return best.crossing <= lines.length * 0.4 && best.side >= lines.length * 0.15 ? best.x : null;
  }

  /* Groups text items into lines, keeping each line's font size. On a page
   * set in two columns, each run of lines between full-width ones is read
   * down the left column and then down the right. */
  function buildLines(tc, pageNo) {
    var rows = {}, i;
    for (i = 0; i < tc.items.length; i++) {
      var it = tc.items[i];
      if (!it.str) continue;
      var y = Math.round(it.transform[5] * 2) / 2;
      var size = Math.abs(it.transform[3]) || it.height || 0;
      if (!rows[y]) rows[y] = { y: y, parts: [] };
      rows[y].parts.push({ x: it.transform[4], w: it.width || 0, str: it.str, size: size });
    }
    var list = Object.keys(rows).map(function (k) { return rows[k]; });
    list.sort(function (a, b) { return b.y - a.y; });
    list.forEach(function (r) { r.parts.sort(function (a, b) { return a.x - b.x; }); });

    var gutter = findGutter(list);
    var out = [], left = [], right = [];
    function line(parts, y) {
      var j = joinParts(parts);
      return { text: j.text, size: j.size, y: y, page: pageNo };
    }
    function flushColumns() { out = out.concat(left, right); left = []; right = []; }
    list.forEach(function (r) {
      if (gutter === null) { out.push(line(r.parts, r.y)); return; }
      var L = [], R = [], spans = false;
      r.parts.forEach(function (p) {
        if (p.x < gutter && p.x + p.w > gutter && /\S/.test(p.str)) spans = true;
        (p.x + p.w / 2 < gutter ? L : R).push(p);
      });
      if (spans) { flushColumns(); out.push(line(r.parts, r.y)); return; }
      if (L.length) left.push(line(L, r.y));
      if (R.length) right.push(line(R, r.y));
    });
    flushColumns();
    out = out.filter(function (l) { return l.text.length > 0; });

    /* Flag lines in the top and bottom band of the page. Only these can be
     * running heads or folios, so only these are candidates for removal: a
     * repeated line in the middle of a page is real text. */
    if (out.length) {
      var yMax = -Infinity, yMin = Infinity;
      out.forEach(function (l) { yMax = Math.max(yMax, l.y); yMin = Math.min(yMin, l.y); });
      var range = yMax - yMin;
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

    /* Drop running heads and folios: lines at the top or bottom edge that
     * repeat across pages, however long (a download stamp or a browser's
     * printed URL), or that are nothing but a page number. */
    var FOLIO = /^(page\s+)?[ivxlcdm\d]{1,7}(\s*(\/|of)\s*\d{1,5})?$/i;
    /* An edge line is matched by its own text and by its whole row, so a
     * header the column gutter splits on some pages but not others still
     * matches. Each key is counted once per page. */
    var rowText = {}, seen = {}, onPage = {};
    all.forEach(function (l) {
      if (!l.edge) return;
      var r = l.page + '@' + l.y;
      rowText[r] = rowText[r] ? rowText[r] + ' ' + l.text : l.text;
    });
    function keys(l) {
      return [l.text, rowText[l.page + '@' + l.y]].map(function (t) { return t.replace(/\d+/g, '#'); });
    }
    all.forEach(function (l) {
      if (!l.edge) return;
      keys(l).forEach(function (k) {
        if (onPage[l.page + '|' + k]) return;
        onPage[l.page + '|' + k] = true;
        seen[k] = (seen[k] || 0) + 1;
      });
    });
    var repeats = Math.max(2, Math.ceil(numPages * 0.5));
    var kept = all.filter(function (l) {
      if (l.edge && FOLIO.test(l.text)) return false;
      if (l.edge && numPages >= 2 &&
          keys(l).some(function (k) { return seen[k] >= repeats; })) return false;
      return true;
    });

    /* A PDF with pages but next to no text, once running heads and stamps
     * are set aside, is a scan or a picture of the pages. */
    var totalWords = 0;
    kept.forEach(function (l) { totalWords += countWords(l.text); });
    if (totalWords < numPages * 5) {
      throw new Error('This PDF has no readable text: it looks like a scan or a picture of the pages. ' +
        'Run text recognition (OCR) on it first, or add the .docx instead.');
    }

    /* The prevailing leading, i.e. the usual distance between one line and the
     * next. A gap noticeably wider than that is a paragraph break, which is
     * what separates a byline from the opening paragraph. */
    var gaps = {}, leading = 0, bestGap = -1;
    for (i = 1; i < kept.length; i++) {
      if (kept[i].page !== kept[i - 1].page) continue;
      var g = Math.round((kept[i - 1].y - kept[i].y) * 2) / 2;
      if (g > 0 && g < 60) gaps[g] = (gaps[g] || 0) + 1;
    }
    Object.keys(gaps).forEach(function (k) {
      if (gaps[k] > bestGap) { bestGap = gaps[k]; leading = parseFloat(k); }
    });

    /* Merge consecutive lines of the same type size into paragraph blocks, so
     * section and caption detection works on whole units. */
    var blocks = [], cur = null;
    var smallCut = bodySize * 0.93;
    var notesWords = 0, smallSeen = false;

    function flush() { if (cur && cur.text.trim()) blocks.push(cur); cur = null; }

    for (i = 0; i < kept.length; i++) {
      var l = kept[i], t = l.text;
      var prev = i ? kept[i - 1] : null;
      var gapBreak = !!prev && prev.page === l.page && leading > 0 &&
                     (prev.y - l.y) > leading * 1.45;
      var isSmall = bodySize > 0 && l.size > 0 && l.size < smallCut;
      /* A note marker set as a superscript sits on a line of its own. Word
       * counts it as part of the word it follows, so it adds nothing. */
      if (isSmall && /^[\d*\u2020\u2021\u00A7\u00B6]{1,3}$/.test(t)) continue;
      var head = classifyHeading(t);
      var isCaption = RX.caption.test(t);
      var looksHeading = head !== null || namesSection(t) ||
        (t.length < 70 && !/[.;,]$/.test(t) && bodySize > 0 && l.size > bodySize * 1.04);

      if (head !== null || isCaption || looksHeading) {
        flush();
        blocks.push({ text: t, kind: isCaption ? 'caption' : 'para', heading: true, small: isSmall });
        if (isSmall) smallSeen = true;
        continue;
      }
      if (!cur || cur.small !== isSmall || gapBreak) {
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

    /* Small type is footnotes, unless its section says otherwise: typeset
     * articles often set the abstract, references, appendices and
     * acknowledgements smaller than the body. */
    blocks.forEach(function (b) { if (b.small && !b.heading) b.kind = 'note'; });

    var assigned = assignComponents(blocks);
    var counts = assigned.counts;
    notesWords = counts.notes;

    var separable = {
      title: true, abstract: true, body: true, notes: smallSeen, captions: true,
      tables: false, refs: true, appendix: true, acks: true, equations: false
    };

    warnings.push('PDF text arrives as a stream of positioned lines, so every figure here is an approximation. For an authoritative count, run the .docx source of the same manuscript.');
    warnings.push('Text inside tables cannot be told apart from running prose in a PDF, so it is counted with the main text.');
    if (smallSeen) {
      warnings.push('Footnotes were identified by type size smaller than the body text (' + notesWords +
        ' words). Endnotes set at body size are counted as main text unless a "Notes" heading precedes them. ' +
        'Small type after a References, Appendix or Acknowledgements heading is counted with that section instead.');
    } else {
      warnings.push('No smaller-than-body type was found, so no notes could be separated out. Any notes are inside the main-text figure.');
    }
    structureWarnings(counts, 'pdf').forEach(function (w) { warnings.push(w); });
    warnings.push('On a typeset PDF the front matter can swallow the first line or two of the article, ' +
      'because a drop capital or a wide opening indent looks like another title line.');
    warnings.push('Pages set in two columns are read column by column, but an unusual layout, ligatures or display ' +
      'equations can each shift a PDF count by a per cent or two.');

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
