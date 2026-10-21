"""Собирает js/catalog-data.js из data/food_catalog/catalog.json.

Запуск: python3 scripts/build_catalog.py
В файл попадают только нужные сайту поля, в компактном виде:
  CATALOG.groups — [id, название, регион, тип]
  CATALOG.cats   — названия категорий
  CATALOG.tags   — список тегов (в позиции — битовая маска)
  CATALOG.items  — [индекс группы, индекс категории, название, флаги, маска тегов, id]
     флаги: 1 — алкоголь (18+)
  CATALOG.nut    — состав из nutrition.json (scripts/enrich_catalog.mjs), параллельно items; 0 — нет данных:
     [ккал, белки, жиры, углеводы, клетчатка, сахар, нас. жиры, натрий, холестерин,
      порция, флаги, маска аллергенов, уверенность %, английское название]
     флаги: 1 — мл, 2 — вегетарианское, 4 — веганское, 8 — свинина, 16 — алкоголь в составе
  CATALOG.allergens — список аллергенов для маски
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'food_catalog' / 'catalog.json'
OUT = ROOT / 'js' / 'catalog-data.js'
NUT = ROOT / 'data' / 'food_catalog' / 'nutrition.json'
KEYS = ['kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'sugar_g', 'sat_fat_g', 'sodium_mg', 'cholesterol_mg']
ALLERGENS = ['gluten', 'milk', 'eggs', 'fish', 'crustaceans', 'molluscs', 'peanuts', 'tree_nuts', 'soy', 'sesame', 'celery', 'mustard', 'sulphites']

data = json.loads(SRC.read_text(encoding='utf-8'))
items = data['items']

groups, group_idx = [], {}
cats, cat_idx = [], {}
tags = []
for it in items:
    if it['cuisine_id'] not in group_idx:
        group_idx[it['cuisine_id']] = len(groups)
        groups.append([it['cuisine_id'], it['cuisine'], it['region'], it['type']])
    if it['category'] not in cat_idx:
        cat_idx[it['category']] = len(cats)
        cats.append(it['category'])
    for t in it['tags']:
        if t not in tags:
            tags.append(t)

rows = []
for it in items:
    mask = 0
    for t in it['tags']:
        mask |= 1 << tags.index(t)
    flags = 1 if (it['is_alcoholic'] or it['age_restricted']) else 0
    short_id = it['id'].split('__', 1)[1] if '__' in it['id'] else it['id']
    rows.append([group_idx[it['cuisine_id']], cat_idx[it['category']], it['name'], flags, mask, short_id])

nut_src = json.loads(NUT.read_text(encoding='utf-8'))['items'] if NUT.exists() else {}


def num(v):
    v = round(float(v), 1)
    return int(v) if v == int(v) else v


nut = []
for it in items:
    n = nut_src.get(it['id'])
    if not n:
        nut.append(0)
        continue
    fl = (1 if n['unit'] == 'ml' else 0) | (2 if n['vegetarian'] else 0) | (4 if n['vegan'] else 0) \
        | (8 if n['contains_pork'] else 0) | (16 if n['contains_alcohol'] else 0)
    am = 0
    for a in n['allergens']:
        if a in ALLERGENS:
            am |= 1 << ALLERGENS.index(a)
    nut.append([num(n[k]) for k in KEYS] + [round(n['portion']), fl, am, round(n['confidence'] * 100), n['name_en']])

payload = {
    'version': data['meta'].get('version', '1.0'),
    'groups': groups,
    'cats': cats,
    'tags': tags,
    'items': rows,
    'allergens': ALLERGENS,
    'nut': nut,
}
body = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
OUT.write_text(
    '/* Сгенерировано scripts/build_catalog.py из data/food_catalog/catalog.json — не править вручную. */\n'
    f'const CATALOG = {body};\n',
    encoding='utf-8',
)
print(f'{OUT.relative_to(ROOT)}: {len(rows)} позиций, с составом {sum(1 for n in nut if n)}, {len(groups)} групп, {len(cats)} категорий, {OUT.stat().st_size // 1024} КБ')
