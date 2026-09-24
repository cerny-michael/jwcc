"""Mirror of engine.js collectBlocks()/nodeText() so the real JS section logic
can be exercised on a real .docx outside a browser."""
import zipfile, json, sys, re
from xml.etree import ElementTree as ET
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
M = '{http://schemas.openxmlformats.org/officeDocument/2006/math}'
SKIP = {'instrText','delText','del','fldChar','proofErr','commentReference',
        'commentRangeStart','commentRangeEnd'}
CAPTION = re.compile(r'^(table|figure|fig\.?|exhibit|map|chart|scheme|plate|appendix table|appendix figure)\s*[a-d]?\.?\s*\d*[a-z]?\s*[:.—–-]', re.I)

def ln(e): return e.tag.split('}')[-1]

def node_text(node, out=None):
    if out is None: out = {'text': [], 'math': []}
    for k in list(node):
        n = ln(k)
        if n in SKIP: continue
        if n in ('oMath','oMathPara'):
            out['math'].append(' '.join(t.text or '' for t in k.iter() if ln(t)=='t'))
            continue
        if n == 't': out['text'].append(k.text or ''); continue
        if n in ('tab','br','cr'): out['text'].append(' '); continue
        node_text(k, out)
    return out

def pstyle(p):
    ppr = p.find(W+'pPr')
    if ppr is None: return ''
    st = ppr.find(W+'pStyle')
    return st.get(W+'val','') if st is not None else ''

def collect(container, blocks, in_table=False):
    for k in list(container):
        n = ln(k)
        if n == 'p':
            t = node_text(k); style = pstyle(k); text = ''.join(t['text'])
            heading = bool(re.match(r'^heading[1-9]?$', re.sub(r'[\s-]','',style), re.I) or
                           re.match(r'^(title|subtitle)$', style, re.I))
            kind = 'table' if in_table else 'para'
            if not in_table and (re.search('caption', style, re.I) or CAPTION.match(text.strip())):
                kind = 'caption'
            blocks.append({'text': text, 'kind': kind, 'heading': heading,
                           'math': ' '.join(t['math'])})
        elif n == 'tbl':
            collect(k, blocks, True)
        elif n in ('sdt','sdtContent','tr','tc','customXml','smartTag','ins'):
            collect(k, blocks, in_table)

z = zipfile.ZipFile(sys.argv[1])
root = ET.fromstring(z.read('word/document.xml'))
blocks = []
collect(root.find(W+'body'), blocks)

notes = []
for part in ('word/footnotes.xml','word/endnotes.xml'):
    try: xml = z.read(part)
    except KeyError: continue
    d = ET.fromstring(xml)
    for e in d.iter():
        if ln(e) not in ('footnote','endnote'): continue
        if e.get(W+'type'): continue
        if e.get(W+'id') in ('-1','0'): continue
        notes.append(''.join(node_text(e)['text']))

json.dump({'blocks': blocks, 'notes': notes}, open(sys.argv[2],'w'))
print('blocks', len(blocks), 'notes', len(notes), file=sys.stderr)
