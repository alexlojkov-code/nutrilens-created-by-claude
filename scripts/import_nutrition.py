"""Собирает data/food_catalog/nutrition.json из частей data/food_catalog/nutrition_parts/*.txt.

Части — состав позиций каталога по типовому рецепту (оценка ИИ), по строке на позицию:
  индекс|английское название|порция и единица|ккал|белки|жиры|углеводы|клетчатка|сахар|нас.жиры|натрий мг|холестерин мг|спирт г|аллергены|пометки|уверенность
  индекс — номер позиции в catalog.json (с нуля); значения — на 100 г, для напитков (ед. ml) — на 100 мл.
  аллергены — буквы: G глютен, M молоко, E яйца, F рыба, C ракообразные, L моллюски, N арахис,
                     T орехи, S соя, Z кунжут, Y сельдерей, U горчица, X сульфиты
  пометки — буквы: v вегетарианское, V веганское, P свинина, A алкоголь в составе; «-» — нет
  уверенность — 1..9 (десятые доли)
Строки, начинающиеся с #, — комментарии.

Запуск: python3 -I scripts/import_nutrition.py   (затем python3 -I scripts/build_catalog.py)
Формат nutrition.json тот же, что пишет scripts/enrich_catalog.mjs.
"""
import json
import pathlib
import re
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
CAT = ROOT / 'data' / 'food_catalog' / 'catalog.json'
PARTS = ROOT / 'data' / 'food_catalog' / 'nutrition_parts'
OUT = ROOT / 'data' / 'food_catalog' / 'nutrition.json'

NUTRIENTS = ['kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'sugar_g', 'sat_fat_g', 'sodium_mg', 'cholesterol_mg', 'alcohol_g']
ALLERGENS = {'G': 'gluten', 'M': 'milk', 'E': 'eggs', 'F': 'fish', 'C': 'crustaceans', 'L': 'molluscs', 'N': 'peanuts',
             'T': 'tree_nuts', 'S': 'soy', 'Z': 'sesame', 'Y': 'celery', 'U': 'mustard', 'X': 'sulphites'}

items = json.loads(CAT.read_text(encoding='utf-8'))['items']
out, problems, dup = {}, [], 0


def check(n, item):
    issues = []
    if n['kcal'] > 900:
        issues.append('ккал > 900')
    if not 5 <= n['portion'] <= 2500:
        issues.append(f"порция {n['portion']}")
    calc = 4 * n['protein_g'] + 9 * n['fat_g'] + 4 * n['carbs_g'] + 7 * n['alcohol_g']
    if n['kcal'] > 30 and abs(calc - n['kcal']) / n['kcal'] > 0.2:
        issues.append(f"ккал {n['kcal']} ≠ по БЖУ {round(calc)}")
    if n['sugar_g'] > n['carbs_g'] + 0.5 or n['sat_fat_g'] > n['fat_g'] + 0.3:
        issues.append('сахар/нас.жиры больше углеводов/жиров')
    if n['vegan'] and not n['vegetarian']:
        issues.append('веган без вег')
    if n['vegetarian'] and n['contains_pork']:
        issues.append('вег со свининой')
    if (item['is_alcoholic'] or item['age_restricted']) and not n['contains_alcohol']:
        issues.append('алкогольная позиция без пометки A')
    if item['type'] == 'drinks' and n['unit'] != 'ml':
        issues.append('напиток не в мл')
    return issues


for f in sorted(PARTS.glob('*.txt')):
    for ln, line in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        p = line.split('|')
        where = f'{f.name}:{ln}'
        if len(p) != 16:
            problems.append(f'{where}: {len(p)} полей вместо 16')
            continue
        try:
            idx = int(p[0])
            m = re.fullmatch(r'(\d+)(g|ml)', p[2])
            vals = [float(x) for x in p[3:13]]
            conf = int(p[15]) / 10
        except ValueError as e:
            problems.append(f'{where}: {e}')
            continue
        if not m or not 0 <= idx < len(items) or not 0.1 <= conf <= 0.9:
            problems.append(f'{where}: индекс, порция или уверенность')
            continue
        item = items[idx]
        flags = p[14]
        bad = [c for c in p[13] if c not in ALLERGENS] + [c for c in flags if c not in 'vVPA-']
        if bad:
            problems.append(f'{where}: неизвестные буквы {bad}')
            continue
        n = {'name_en': p[1].strip(), 'unit': m.group(2), 'portion': int(m.group(1)),
             **dict(zip(NUTRIENTS, vals)),
             'allergens': [ALLERGENS[c] for c in p[13]],
             'vegetarian': 'v' in flags or 'V' in flags, 'vegan': 'V' in flags,
             'contains_pork': 'P' in flags, 'contains_alcohol': 'A' in flags, 'confidence': conf}
        n['issues'] = check(n, item)
        if item['id'] in out:
            dup += 1
        out[item['id']] = n

flagged = {k: v['issues'] for k, v in out.items() if v['issues']}
OUT.write_text(json.dumps({
    'meta': {'model': 'claude-opus-5-5 (Claude Code, без API)', 'prompt_version': 'catalog-nutrition-v1',
             'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'total': len(out), 'of': len(items)},
    'items': out,
}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

print(f'nutrition.json: {len(out)}/{len(items)} позиций · повторов {dup} · с замечаниями {len(flagged)} · ошибок разбора {len(problems)}')
for s in problems[:40]:
    print('  ✗', s)
id2i = {x['id']: i for i, x in enumerate(items)}
for k, v in list(flagged.items())[:60]:
    print(f"  ⚠ {id2i[k]} {items[id2i[k]]['name']}: {'; '.join(v)}")
