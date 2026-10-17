"""Mirror of engine.js collectBlocks()/nodeText() so the real JS section logic
can be exercised on a real .docx outside a browser."""
import zipfile, json, sys, re
from xml.etree import ElementTree as ET
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
M = '{http://schemas.openxmlformats.org/officeDocument/2006/math}'
SKIP = {'instrText','delText','del','fldChar','proofErr','commentReference',
        'commentRangeStart','commentRangeEnd'}
CAPTION = re.compile(r'^(table|figure|fig\.?|exhibit|map|chart|scheme|plate|appendix table|appendix figure)\s*[a-d]?\.?\s*\d*[a-z]?\s*[:.—–-]', re.I)
NONE = {'heading': False, 'bold': False}

def ln(e): return e.tag.split('}')[-1]

def child(e, name):
    if e is None: return None
    return next((c for c in e if ln(c) == name), None)

def val(e): return '' if e is None else e.get(W+'val', '')

def is_on(e): return val(e).lower() not in ('0', 'false', 'off')

def node_text(node, out=None):
    if out is None: out = {'text': [], 'math': [], 'break_at': None}
    for k in list(node):
        n = ln(k)
        if n in SKIP: continue
        if n in ('oMath','oMathPara'):
            out['math'].append(' '.join(t.text or '' for t in k.iter() if ln(t)=='t'))
            continue
        if n == 't': out['text'].append(k.text or ''); continue
        if n in ('tab','br','cr'):
            if n == 'br' and out['break_at'] is None and k.get(W+'type', '').lower() == 'page':
                out['break_at'] = len(''.join(out['text']))
            out['text'].append(' '); continue
        if n == 'AlternateContent':         # a text box, stored twice: read one copy
            alt = child(k, 'Choice')
            if alt is None: alt = child(k, 'Fallback')
            if alt is not None: node_text(alt, out)
            continue
        if n == 'p':                        # nested paragraph: keep it apart
            out['text'].append(' '); node_text(k, out); out['text'].append(' ')
            continue
        node_text(k, out)
    return out

def pstyle(p):
    return val(child(child(p, 'pPr'), 'pStyle'))

def read_styles(xml):
    raw, out = {}, {}
    if xml is None: return out
    for s in ET.fromstring(xml).iter():
        if ln(s) != 'style': continue
        lvl = child(child(s, 'pPr'), 'outlineLvl')
        b = child(child(s, 'rPr'), 'b')
        raw[s.get(W+'styleId', '')] = {
            'name': val(child(s, 'name')), 'based': val(child(s, 'basedOn')),
            'level': int(val(lvl)) if lvl is not None and val(lvl).isdigit() else None,
            'bold': is_on(b) if b is not None else None}
    def resolve(i, depth=0):
        if i in out: return out[i]
        r = raw.get(i)
        if r is None or depth > 20: return NONE
        parent = resolve(r['based'], depth + 1) if r['based'] else NONE
        out[i] = {
            'heading': r['level'] < 9 if r['level'] is not None else
                       bool(re.match(r'^(heading [1-9]|title|subtitle)$', r['name'], re.I)) or parent['heading'],
            'bold': r['bold'] if r['bold'] is not None else parent['bold']}
        return out[i]
    for i in raw: resolve(i)
    return out

def all_bold(p, para_bold, styles):
    seen = False
    for r in p.iter():
        if ln(r) != 'r': continue
        if not ''.join(c.text or '' for c in r if ln(c) == 't').strip(): continue
        seen = True
        bold, rpr = para_bold, child(r, 'rPr')
        if rpr is not None:
            b, rs = child(rpr, 'b'), styles.get(val(child(rpr, 'rStyle')))
            if b is not None: bold = is_on(b)
            elif rs and rs['bold']: bold = True
        if not bold: return False
    return seen

def word_count(text):
    return sum(1 for w in text.split() if re.search(r'[0-9A-Za-zÀ-ɏͰ-῿Ⰰ-퟿]', w))

def is_heading(p, text, style, styles, in_table):
    st = styles.get(style, NONE)
    if (re.match(r'^heading[1-9]?$', re.sub(r'[\s-]', '', style), re.I) or
            re.match(r'^(title|subtitle)$', style, re.I) or st['heading']):
        return True
    lvl = child(child(p, 'pPr'), 'outlineLvl')
    if lvl is not None and val(lvl).isdigit() and int(val(lvl)) < 9: return True
    if in_table: return False
    n = word_count(text)
    if n < 1 or n > 15 or re.search(r'[.,;:]["\'”’)]?$', text.strip()): return False
    return all_bold(p, st['bold'], styles)

def collect(container, blocks, styles, in_table=False):
    for k in list(container):
        n = ln(k)
        if n == 'p':
            t = node_text(k); style = pstyle(k); text = ''.join(t['text'])
            kind = 'table' if in_table else 'para'
            if not in_table and (re.search('caption', style, re.I) or CAPTION.match(text.strip())):
                kind = 'caption'
            ppr = child(k, 'pPr')
            pbb, sect = child(ppr, 'pageBreakBefore'), child(ppr, 'sectPr')
            before, after = pbb is not None and is_on(pbb), False
            if t['break_at'] is not None:
                if text[:t['break_at']].strip(): after = True
                else: before = True
            if sect is not None and val(child(sect, 'type')) != 'continuous': after = True
            blocks.append({'text': text, 'kind': kind,
                           'heading': is_heading(k, text, style, styles, in_table),
                           'math': ' '.join(t['math']), 'breakBefore': before, 'breakAfter': after})
        elif n == 'tbl':
            collect(k, blocks, styles, True)
        elif n in ('sdt','sdtContent','tr','tc','customXml','smartTag','ins'):
            collect(k, blocks, styles, in_table)

def part(z, name):
    try: return z.read(name)
    except KeyError: return None

z = zipfile.ZipFile(sys.argv[1])
root = ET.fromstring(z.read('word/document.xml'))
blocks = []
collect(root.find(W+'body'), blocks, read_styles(part(z, 'word/styles.xml')))

notes = []
for name in ('word/footnotes.xml','word/endnotes.xml'):
    xml = part(z, name)
    if xml is None: continue
    d = ET.fromstring(xml)
    for e in d.iter():
        if ln(e) not in ('footnote','endnote'): continue
        if e.get(W+'type'): continue
        if e.get(W+'id') in ('-1','0'): continue
        notes.append(''.join(node_text(e)['text']))

json.dump({'blocks': blocks, 'notes': notes}, open(sys.argv[2],'w'))
print('blocks', len(blocks), 'notes', len(notes), file=sys.stderr)
