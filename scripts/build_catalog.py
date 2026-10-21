"""Собирает js/catalog-data.js из data/food_catalog/catalog.json.

Запуск: python3 scripts/build_catalog.py
В файл попадают только нужные сайту поля, в компактном виде:
  CATALOG.groups — [id, название, регион, тип]
  CATALOG.cats   — названия категорий
  CATALOG.tags   — список тегов (в позиции — битовая маска)
  CATALOG.items  — [индекс группы, индекс категории, название, флаги, маска тегов, id]
     флаги: 1 — алкоголь (18+)
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'food_catalog' / 'catalog.json'
OUT = ROOT / 'js' / 'catalog-data.js'

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

payload = {
    'version': data['meta'].get('version', '1.0'),
    'groups': groups,
    'cats': cats,
    'tags': tags,
    'items': rows,
}
body = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
OUT.write_text(
    '/* Сгенерировано scripts/build_catalog.py из data/food_catalog/catalog.json — не править вручную. */\n'
    f'const CATALOG = {body};\n',
    encoding='utf-8',
)
print(f'{OUT.relative_to(ROOT)}: {len(rows)} позиций, {len(groups)} групп, {len(cats)} категорий, {OUT.stat().st_size // 1024} КБ')
