import { describe, expect, it } from 'vitest';
import { PYTHON } from './pythonRules';
import { SCRIPT } from './scriptRules';
import { LanguageRules, MAX_RULES, buildHint, pickCards } from './ruleCards';

// For each card: code it must apply to, and similar-looking code it must leave alone.
type Cases = Record<string, { yes: string[]; no: string[] }>;

const PYTHON_CASES: Cases = {
  'divide-by-length': {
    yes: ['return total / len(products)', 'avg = s /len(xs)'],
    no: ['return total // 2', 'n = len(xs)', 'return total / count']
  },
  'off-by-one': {
    yes: ['end = start + page_size + 1\nreturn items[start:end]', 'return items[i + 1]', 'while i <= len(items):'],
    no: ['end = start + page_size', 'count += 1', 'for i in range(len(xs)):', 'counts[k] = counts.get(k, 0) + 1', 'n = total + 1']
  },
  'unclosed-file': {
    yes: ['f = open(path, "w")', 'self.conn = sqlite3.connect(db_path)', 'data = urlopen(url).read()'],
    no: ['with open(path) as f:', '    with open(path, "w") as out:', '# open(path) is safe here']
  },
  'swallowed-exception': {
    yes: ['except:\n    return None', 'except Exception as e:\n    print(e)', 'except KeyError: pass', 'except ValueError:\n        continue'],
    no: ['except KeyError:\n    raise', 'except ValueError as e:\n    log.error(e); raise', 'except Exception:\n    return default_value']
  },
  'unchecked-response': {
    yes: ['r = requests.post(URL, json=p)\nif r.status_code == 200:\n    return r.json()'],
    no: ['r = requests.get(URL, timeout=5)\nr.raise_for_status()', 'import requests']
  },
  'float-equality': {
    yes: ['return total == expected', 'if price != 0.1:', 'assert amount == other'],
    no: ['return total > expected', 'if name == other:', 'is_total = True']
  },
  'none-result-used': {
    yes: ['cfg.get("db")["host"]', 'user = users.get(id).name'],
    no: ['return value', 'x = cfg.get("db")', '    return None']
  },
  'shared-default-state': {
    yes: ['cache = {}', '_cache = dict()', '    registry = []'],
    no: ['self.cache = {}', 'cache = load()', 'results = []']
  }
};

const SCRIPT_CASES: Cases = {
  'unawaited-promise': {
    yes: ["const response = fetch('/api');", 'axios.post(url, body);', "  fetch('/log', { method: 'POST' });"],
    no: ["const response = await fetch('/api');", "return fetch('/api');", '// fetch( is mocked below']
  },
  'unchecked-response': {
    yes: ["const r = await fetch('/api');\nreturn r.json();"],
    no: ["const r = await fetch('/api');\nif (!r.ok) throw new Error();", "const r = await fetch('/x');\nif (r.status !== 200) return;"]
  },
  'off-by-one': {
    yes: ['for (let i = 0; i <= this.items.length; i++) {', 'while (i <= arr.length) {'],
    no: ['for (let i = 0; i < this.items.length; i++) {', 'if (a.length <= 3) {', 'for (let i = 0; i <= 10; i++)']
  },
  'splice-in-loop': {
    yes: ['for (let i = 0; i < items.length; i++) {\n  if (x) items.splice(i, 1);\n}'],
    no: ['for (let i = items.length - 1; i >= 0; i--) {\n  items.splice(i, 1);\n}', 'items.splice(0, 1);']
  },
  'divide-by-count': {
    yes: ['return Math.round(this.total() / people);', 'const avg = sum / values.length;', 'x / count'],
    no: ['const half = total / 2;', 'const url = base + "/" + path;', '// people / places']
  },
  'sort-in-place': {
    yes: ['return this.items.sort((a, b) => a.price - b.price);', 'const sorted = this.items.sort();'],
    no: ['return [...this.items].sort((a, b) => a - b);', 'items.sort();']
  },
  'state-changed-before-await': {
    yes: ['async checkout() {\n  const r = fetch(u);\n  this.items = [];\n}'],
    no: ['checkout() {\n  this.items = [];\n}', 'async load() {\n  this.items = await get();\n}']
  },
  'json-parse': {
    yes: ['const data = JSON.parse(body);'],
    no: ['const body = JSON.stringify(data);']
  },
  'token-in-storage': {
    yes: ["localStorage.setItem('token', t);", "sessionStorage.setItem('authHeader', h);"],
    no: ["localStorage.setItem('theme', 'dark');", "const token = localStorage.getItem('token');"]
  }
};

describe.each([
  ['Python', PYTHON, PYTHON_CASES],
  ['JavaScript/TypeScript', SCRIPT, SCRIPT_CASES]
] as [string, LanguageRules, Cases][])('%s rule cards', (name, rules, cases) => {
  const card = (id: string) => rules.cards.find((c) => c.id === id)!;

  it('are all covered by the cases', () => {
    expect(Object.keys(cases).sort()).toEqual(rules.cards.map((c) => c.id).sort());
  });

  it('give no general reminders: with them, correct files got invented findings', () => {
    expect(rules.generalIds).toEqual([]);
  });

  it.each(rules.cards.map((c) => [c.id, c.hint]))('%s has a one-line hint of a sensible length', (_id, hint) => {
    expect(hint).not.toMatch(/\n/);
    expect(hint.length).toBeGreaterThan(20);
    expect(hint.length).toBeLessThan(260);
  });

  it('keep the prompt short', () => {
    const longest = Math.max(...rules.cards.map((c) => c.hint.length));
    expect(MAX_RULES * longest).toBeLessThan(1600);
  });

  describe.each(Object.entries(cases))('card %s', (id, { yes, no }) => {
    it.each(yes.map((code) => [code]))('applies to: %s', (code) => {
      expect(card(id).applies(code)).toBe(true);
    });

    it.each(no.map((code) => [code]))('leaves alone: %s', (code) => {
      expect(card(id).applies(code)).toBe(false);
    });
  });

  it('gives no reminders when nothing matches', () => {
    expect(pickCards('x = 1', rules)).toEqual([]);
  });

  it('names the language in the hint', () => {
    expect(buildHint(name, rules.cards.slice(0, 1))).toMatch(new RegExp(`^Also check for these ${name.replace('/', '\\/')} problems:`));
  });
});

describe('pickCards', () => {
  it('never picks more than MAX_RULES', () => {
    const everything = Object.values(SCRIPT_CASES).flatMap((c) => c.yes).join('\n');
    expect(pickCards(everything, SCRIPT)).toHaveLength(MAX_RULES);
  });

  it('takes the cards in the order of the list', () => {
    const code = "x = total / len(xs)\nf = open(p)\n";
    expect(pickCards(code, PYTHON).map((c) => c.id)).toEqual(['divide-by-length', 'unclosed-file']);
  });

  it('returns no hint for an empty selection', () => {
    expect(buildHint('Python', [])).toBeUndefined();
  });
});
