# -*- coding: utf-8 -*-
"""Convert Political_Science_Journal_Word_Limits.xlsx -> data/journals.json

Each journal gets a `rules` object mapping the ten document components to
  1  = counted toward the limit
  0  = not counted
  null = the instructions do not say (ambiguous)
derived by hand from the spreadsheet's "What is included / excluded" prose.
"""
import json, re, openpyxl

SRC = '/Users/gov/Downloads/Political_Science_Journal_Word_Limits.xlsx'
OUT = '/Users/gov/Documents/GitHub/journal-word-count/data/journals.json'

COMPONENTS = ['title','abstract','body','notes','captions','tables','refs','appendix','acks','equations']

# Mini-DSL: "+x" include, "-x" exclude. Anything unnamed stays null, except
# `body`, which is 1 unless explicitly set. Keys are exact journal names.
RULES = {
 'American Political Science Review': '+notes +tables +captions -refs -appendix',
 'American Journal of Political Science': '-title -abstract +notes +captions -tables -refs +appendix -equations',
 'The Journal of Politics': '+notes +refs +tables +captions',
 'British Journal of Political Science': '+title +abstract +notes +captions +tables -refs -appendix +acks +equations',
 'Perspectives on Politics': '-title -abstract +notes -captions -tables -refs -appendix -equations',
 'Political Science Research and Methods': '+notes +tables +captions +refs +appendix',
 'European Journal of Political Research': '-abstract +notes +tables +captions -refs -appendix',
 'Political Studies': '+notes -refs',
 'European Political Science Review': '-abstract +notes +tables +captions -refs -appendix',
 'International Political Science Review': '+refs +notes +tables +captions',
 'Canadian Journal of Political Science': '+notes +tables +captions -refs',
 'Australian Journal of Political Science': '+refs -appendix',
 'Comparative Politics': '-abstract -tables -captions -appendix',
 'World Politics': '+notes +refs -tables -captions -appendix',
 'Party Politics': '+title +abstract +notes +captions +tables +refs +appendix +acks +equations',
 'International Organization': '+tables +captions +notes -refs',
 'International Studies Quarterly': '+tables +captions +notes +refs -abstract -appendix',
 'European Journal of International Relations': '+notes +refs',
 'International Theory': '-refs',
 'Review of International Studies': '+notes +refs -abstract -title',
 'International Studies Review': '+refs',
 'International Relations': '+notes +abstract',
 'Foreign Policy Analysis': '+refs +tables +captions',
 'International Security': '+notes',
 'Security Studies': '+tables +captions +notes +appendix',
 'Journal of Conflict Resolution': '+title +abstract +notes +captions +tables +refs +appendix +acks +equations',
 'Journal of Peace Research': '+abstract +notes +tables +captions +refs',
 'Journal of Global Security Studies': '+notes +refs +tables +captions -appendix',
 'Security Dialogue': '+abstract +notes +refs',
 'Armed Forces & Society': '',
 'Politics & Society': '-notes -refs -appendix',
 'Socio-Economic Review': '+refs -abstract -tables -captions -appendix',
 'Regulation & Governance': '+abstract +refs +notes +tables +captions +appendix',
 'American Politics Research': '',
 'Legislative Studies Quarterly': '',
 'Congress & the Presidency': '+abstract +tables +refs +captions +notes',
 'Presidential Studies Quarterly': '+tables +captions +refs',
 'State Politics & Policy Quarterly': '+tables +captions +notes +refs',
 'Political Behavior': '-title -abstract +notes +captions -tables -refs -appendix',
 'Public Opinion Quarterly': '+notes -tables -captions -refs -appendix',
 'Political Psychology': '-tables -captions -refs -title -abstract',
 'Political Theory': '+notes -abstract',
 'The Review of Politics': '+abstract +notes',
 'Contemporary Political Theory': '+title +abstract +notes +captions +tables +refs +appendix +acks +equations',
 'European Journal of Political Theory': '+notes +refs',
 'History of Political Thought': '',
 'Ethics': '+notes +refs',
 'Journal of Political Philosophy': '+title +abstract +notes +captions +tables +refs +appendix +acks +equations',
 'Political Analysis': '+abstract +captions +notes -title -tables -refs -appendix',
 'Journal of Experimental Political Science': '',
 'Research & Politics': '+notes +refs -tables -captions -appendix',
 'Journal of Theoretical Politics': '+notes +refs',
 'Public Choice': '+notes +refs +tables +captions -appendix',
 'Journal of Public Administration Research and Theory': '+abstract +tables +captions +refs -appendix',
 'Public Administration Review': '+abstract +notes +refs -tables -captions -appendix',
 'Public Administration': '',
 'Governance': '',
 'Journal of Public Policy': '-abstract -refs -tables -captions -appendix',
 'Policy Studies Journal': '-refs',
 'Journal of European Public Policy': '+refs +notes +tables +captions',
 'Policy Sciences': '+title +abstract +notes +captions +tables +refs +appendix +acks +equations',
 'Policy & Politics': '+refs',
 'Journal of Law and Courts': '',
 'Law & Society Review': '-refs -appendix -tables',
 'Law & Social Inquiry': '+notes',
 'International Journal of Constitutional Law': '+notes',
 'Journal of Race, Ethnicity, and Politics': '+tables +captions +refs +appendix',
 'Politics and Governance': '+title +abstract +tables +captions +refs -appendix',
 'Social Politics': '',
 'Nations and Nationalism': '+notes +refs',
 'Mobilization': '+refs -tables -captions',
 'Social Forces': '+notes +refs -tables -captions -appendix',
 'Theory and Society': '+refs -tables',
 'Environmental Policy and Governance': '',
 'Urban Affairs Review': '+notes +refs +tables +captions',
 'International Journal of Urban and Regional Research': '+refs',
 'Publius: The Journal of Federalism': '+refs +tables +captions +notes +appendix',
 'Politics and Religion': '+notes +refs -tables -captions -appendix',
 'Journal for the Scientific Study of Religion': '+refs -abstract -appendix',
 'Human Rights Quarterly': '',
 'Journal of Human Rights': '+notes +refs +appendix',
 'PS: Political Science & Politics': '+title +abstract +tables +captions +notes +refs -appendix',
 'Journal of Political Science Education': '',
 'European Political Science': '+abstract +notes +refs -tables -captions',
}

# Journals whose prose is internally inconsistent -> every component left
# ambiguous on purpose, with a warning surfaced in the UI.
CONFLICTING = {
 'Armed Forces & Society', 'Governance', 'Journal for the Scientific Study of Religion',
 'International Relations',
}

def parse_rules(spec):
    r = {c: None for c in COMPONENTS}
    r['body'] = 1
    for tok in spec.split():
        sign, name = tok[0], tok[1:]
        assert name in COMPONENTS, name
        r[name] = 1 if sign == '+' else 0
    return r

def parse_limit(raw):
    """-> (kind, words, pages, text)  kind in hard|soft|pages|none|unknown"""
    if raw is None:
        return ('unknown', None, None, 'Not stated')
    if isinstance(raw, (int, float)):
        return ('hard', int(raw), None, f'{int(raw):,} words')
    s = str(raw).strip()
    low = s.lower()
    if low in ('not verified', 'not stated', 'title not verified'):
        return ('unknown', None, None, s)
    if low in ('no fixed cap', 'no word limit', 'no absolute cap', 'no hard cap stated'):
        return ('none', None, None, s)
    m = re.match(r'^(?:about|approximately)?\s*(\d+)\s*pages$', low)
    if m:
        return ('pages', None, int(m.group(1)), s)
    m = re.search(r'fewer than\s*([\d,]+)', low)
    if m:
        return ('soft', int(m.group(1).replace(',', '')), None, s)
    if '/' in s:  # "7,000 / 9,000"
        nums = [int(n.replace(',', '')) for n in re.findall(r'[\d,]{3,}', s)]
        if nums:
            return ('soft', max(nums), None, s)
    nums = [int(n.replace(',', '')) for n in re.findall(r'[\d,]{3,}', s)]
    if nums:
        return ('soft', max(nums), None, s)
    return ('unknown', None, None, s)

wb = openpyxl.load_workbook(SRC)
ws = wb['Journal limits']
rows = list(ws.iter_rows(values_only=True))
header_idx = next(i for i, r in enumerate(rows) if r[0] == 'Journal')

journals = []
unmatched = []
for r in rows[header_idx + 1:]:
    if not r[0]:
        continue
    name = str(r[0]).strip()
    spec = RULES.get(name)
    if spec is None:
        unmatched.append(name)
        spec = ''
    kind, words, pages, ltext = parse_limit(r[2])
    fields = [f.strip() for f in str(r[1] or '').split('\n') if f.strip()]
    journals.append({
        'name': name,
        'fields': fields,
        'limitKind': kind,
        'limitWords': words,
        'limitPages': pages,
        'limitText': ltext,
        'included': (r[3] or '').strip(),
        'note': (r[4] or '').strip(),
        'status': (r[5] or '').strip(),
        'url': (r[6] or '').strip(),
        'rules': parse_rules(spec),
        'conflicting': name in CONFLICTING,
    })

meta = {
    'source': 'Political_Science_Journal_Word_Limits.xlsx',
    'sourceNote': str(rows[2][0] or ''),
    'caveat': str(rows[3][0] or ''),
    'components': COMPONENTS,
    'pageWords': 250,
}
with open(OUT, 'w') as f:
    json.dump({'meta': meta, 'journals': journals}, f, indent=1, ensure_ascii=False)

print('journals:', len(journals))
print('no explicit rule spec (all-ambiguous):', len(unmatched))
for u in unmatched: print('  ', u)
from collections import Counter
print(Counter(j['limitKind'] for j in journals))
