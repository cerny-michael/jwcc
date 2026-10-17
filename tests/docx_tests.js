/* Builds small .docx files with JSZip, the library the page itself uses, and
 * runs each through the real reader: the browser's DOMParser, styles.xml,
 * footnotes.xml and all. The other suites stub these out. */
(function () {
  'use strict';

  var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
    'xmlns:v="urn:schemas-microsoft-com:vml"';
  var HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  var lines = [], pass = 0, fail = 0;
  function eq(got, want, what) {
    if (got === want) pass++;
    else { fail++; lines.push('FAIL ' + what + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
  }
  function ok(cond, what) { eq(!!cond, true, what); }

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  var uid = 0;
  function words(n) {                 /* n distinct words, ending a sentence */
    var w = [];
    for (var i = 0; i < n; i++) w.push('w' + (++uid));
    return w.join(' ') + '.';
  }

  function run(text, bold) {
    return '<w:r>' + (bold ? '<w:rPr><w:b/></w:rPr>' : '') +
      '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
  }

  /* p('text') or p('text', {style, bold, outline}) or p({raw: '<w:r>...'}) */
  function p(content, o) {
    o = o || {};
    var ppr = '';
    if (o.style) ppr += '<w:pStyle w:val="' + o.style + '"/>';
    if (o.breakBefore) ppr += '<w:pageBreakBefore/>';
    if (o.outline !== undefined) ppr += '<w:outlineLvl w:val="' + o.outline + '"/>';
    var inner = typeof content === 'string' ? run(content, o.bold) : content.raw;
    return '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + inner + '</w:p>';
  }

  function docx(parts) {
    var zip = new JSZip();
    zip.file('[Content_Types].xml', HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('word/document.xml', HEAD + '<w:document ' + NS + '><w:body>' +
      parts.body.join('') + '</w:body></w:document>');
    if (parts.footnotes) {
      zip.file('word/footnotes.xml', HEAD + '<w:footnotes ' + NS + '>' +
        parts.footnotes.join('') + '</w:footnotes>');
    }
    if (parts.styles) {
      zip.file('word/styles.xml', HEAD + '<w:styles ' + NS + '>' + parts.styles.join('') + '</w:styles>');
    }
    if (parts.comments) {
      zip.file('word/comments.xml', HEAD + '<w:comments ' + NS + '><w:comment w:id="0">' +
        p('A reviewer comment that must never be counted.') + '</w:comment></w:comments>');
    }
    return zip.generateAsync({ type: 'arraybuffer' }).then(WordCount.extractDocx);
  }

  var tests = [];
  function test(fn) { tests.push(fn); }

  /* Headings set in bold body text, not Word heading styles: the abstract
   * must end at the first one, not run on to the references. */
  test(function () {
    return docx({ body: [
      p('Why Disputes Escalate', { style: 'Title' }), p('Jane Doe'),
      p('Abstract', { bold: true }), p(words(40)), p('Keywords: conflict, bargaining'),
      p('Why Audiences Matter', { bold: true }), p(words(60)), p(words(60)), p(words(60)),
      p('References', { bold: true }), p(words(12)), p(words(12))
    ] }).then(function (r) {
      eq(r.counts.title, 3 + 2, 'bold headings: title and author');
      eq(r.counts.abstract, 1 + 40 + 3, 'bold headings: abstract label, text and keywords only');
      eq(r.counts.body, 3 + 180, 'bold headings: the bold heading and the three paragraphs');
      eq(r.counts.refs, 1 + 24, 'bold headings: references');
    });
  });

  /* A short line that is only partly bold is not a heading. */
  test(function () {
    return docx({ body: [
      p('A Title', { style: 'Title' }), p('Abstract', { bold: true }), p(words(20)),
      p({ raw: run('Bold start', true) + run(' then plain') })
    ] }).then(function (r) {
      eq(r.counts.abstract, 1 + 20 + 4, 'partly bold line stays in the abstract');
    });
  });

  /* Heading styles found through styles.xml: a style ID from German Word, a
   * custom style based on it, a bold paragraph style, and an outline level
   * set on the paragraph itself. */
  var STYLES = [
    '<w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style>',
    '<w:style w:type="paragraph" w:styleId="MyHead"><w:name w:val="My Head"/><w:basedOn w:val="berschrift1"/></w:style>',
    '<w:style w:type="paragraph" w:styleId="BoldPara"><w:name w:val="Bold Para"/><w:rPr><w:b/></w:rPr></w:style>'
  ];
  [['berschrift1', 'a localised heading style ID'],
   ['MyHead', 'a custom style based on a heading style'],
   ['BoldPara', 'a bold paragraph style'],
   [null, 'an outline level on the paragraph']].forEach(function (c) {
    test(function () {
      var head = c[0] ? p('Puzzles of Peace', { style: c[0] }) : p('Puzzles of Peace', { outline: 1 });
      return docx({ styles: STYLES, body: [
        p('A Title', { style: 'Title' }), p('Abstract', { style: 'berschrift1' }), p(words(30)),
        head, p(words(50))
      ] }).then(function (r) {
        eq(r.counts.abstract, 1 + 30, c[1] + ' closes the abstract');
        eq(r.counts.body, 3 + 50, c[1] + ' starts the main text');
      });
    });
  });

  /* A page break the author put after the abstract ends it, in each of the
   * ways Word writes one. No headings follow, so nothing else could. */
  var BR = '<w:r><w:br w:type="page"/></w:r>';
  [['a break in an empty paragraph', function (a) { return [p(a), p({ raw: BR })]; }, null],
   ['a break at the end of the abstract', function (a) { return [p({ raw: run(a) + BR })]; }, null],
   ['"page break before" on the next paragraph', function (a) { return [p(a)]; }, { breakBefore: true }],
   ['a next-page section break', function (a) {
     return ['<w:p><w:pPr><w:sectPr/></w:pPr>' + run(a) + '</w:p>'];
   }, null]
  ].forEach(function (c) {
    test(function () {
      var abs = words(30);
      return docx({ body: [p('A Title', { style: 'Title' }), p('Abstract', { bold: true })]
        .concat(c[1](abs), [p(words(40), c[2] || {}), p(words(40))]) }).then(function (r) {
        eq(r.counts.abstract, 1 + 30, c[0] + ' ends the abstract');
        eq(r.counts.body, 80, c[0] + ': the next page is main text');
      });
    });
  });

  /* A text box is stored twice; it must be read once, and its words must not
   * run into the paragraph around it. */
  test(function () {
    var box = '<w:txbxContent>' + p('one two three four five') + '</w:txbxContent>';
    var shape = '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:wsp><wps:txbx>' +
      box + '</wps:txbx></wps:wsp></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox>' +
      box + '</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>';
    return docx({ body: [
      p({ raw: run(words(20)) + shape })
    ] }).then(function (r) {
      eq(r.counts.body, 20 + 5, 'text box counted once, apart from the sentence before it');
    });
  });

  /* Footnotes: separators skipped, a two-paragraph note not run together. */
  test(function () {
    return docx({
      body: [p('Prose with a note.')],
      footnotes: [
        '<w:footnote w:type="separator" w:id="-1">' + p('separator') + '</w:footnote>',
        '<w:footnote w:type="continuationSeparator" w:id="0">' + p('continuation') + '</w:footnote>',
        '<w:footnote w:id="1">' + p('First paragraph ends here.') + p('Second one starts.') + '</w:footnote>'
      ]
    }).then(function (r) {
      eq(r.counts.notes, 4 + 3, 'footnote paragraphs counted separately, separators skipped');
      eq(r.detail.notes, 1, 'one real footnote');
    });
  });

  /* Tracked changes accepted, citation field codes and comments ignored. */
  test(function () {
    var para = run(words(20) + ' Kept words here ') +
      '<w:del w:id="1"><w:r><w:delText>gone gone</w:delText></w:r></w:del>' +
      '<w:ins w:id="2"><w:r><w:t>added</w:t></w:r></w:ins>' +
      '<w:commentRangeStart w:id="0"/>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> ADDIN ZOTERO_ITEM CSL_CITATION {"citationID":"abc","properties":{}} </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      run(' (Smith 2001)') +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>';
    return docx({ comments: true, body: [p({ raw: para })] }).then(function (r) {
      eq(r.counts.body, 20 + 3 + 1 + 2, 'deletions dropped, insertions kept, field code skipped');
      ok(r.warnings.join(' ').indexOf('review comments') >= 0, 'comments reported, not counted');
    });
  });

  /* Captions by style, table text, and display maths. */
  test(function () {
    var table = '<w:tbl><w:tr><w:tc>' + p('Mean 4.2') + '</w:tc><w:tc>' + p('Median 3') +
      '</w:tc></w:tr></w:tbl>';
    var maths = '<w:p>' + run('where ') + '<m:oMath><m:r><m:t>x</m:t></m:r><m:r><m:t>y</m:t></m:r></m:oMath></w:p>';
    return docx({ body: [
      p(words(30)), p('Summary statistics by country', { style: 'Caption' }), table, maths
    ] }).then(function (r) {
      eq(r.counts.captions, 4, 'caption found by its style');
      eq(r.counts.tables, 4, 'table text');
      eq(r.counts.equations, 2, 'display maths counted apart');
      eq(r.counts.body, 30 + 1, 'body prose, without the maths');
    });
  });

  /* An abstract longer than most journals allow is flagged. */
  test(function () {
    return docx({ body: [
      p('A Title', { style: 'Title' }), p('Abstract', { bold: true }), p(words(175)), p(words(175)),
      p('Introduction', { bold: true }), p(words(50))
    ] }).then(function (r) {
      eq(r.counts.abstract, 1 + 350, 'a long abstract within the cap');
      ok(r.warnings.join(' ').indexOf('longer than most journals allow') >= 0, 'and a warning about its length');
    });
  });

  var out = document.getElementById('out');
  tests.reduce(function (chain, t, i) {
    return chain.then(t).catch(function (e) {
      fail++;
      lines.push('FAIL test ' + (i + 1) + ' threw: ' + (e && e.message ? e.message : e));
    });
  }, Promise.resolve()).then(function () {
    lines.push('', pass + ' passed, ' + fail + ' failed');
    out.textContent = lines.join('\n');
  });
})();
