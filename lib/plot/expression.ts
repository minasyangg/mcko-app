// Безопасный разбор формулы функции для графиков (```graph в MarkdownContent).
// Никакого eval: свой рекурсивный разбор с ограниченным набором операций.
// Понимает школьную запись: «2x», «3(x+1)», «x²», «−x^2», «0,5x», «|x−1|»,
// «√x», «sin x» не поддерживается (нужны скобки: sin(x)).

type Token =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '^' | '(' | ')' | '|' | '√' }

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, tg: Math.tan,
  cot: (v) => 1 / Math.tan(v), ctg: (v) => 1 / Math.tan(v),
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log10, lg: Math.log10,
}
const CONSTS: Record<string, number> = { pi: Math.PI, 'π': Math.PI, e: Math.E }

function tokenize(src: string): Token[] {
  const s = src
    .replace(/[−–—]/g, '-').replace(/[·×]/g, '*').replace(/:/g, '/')
    .replace(/²/g, '^2').replace(/³/g, '^3')
  const out: Token[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch) || (ch === ',' && /[0-9]/.test(s[i - 1] ?? '') && /[0-9]/.test(s[i + 1] ?? ''))) {
      let j = i
      while (j < s.length && (/[0-9.]/.test(s[j]) || (s[j] === ',' && /[0-9]/.test(s[j + 1] ?? '')))) j++
      const v = Number(s.slice(i, j).replace(',', '.'))
      if (!Number.isFinite(v)) throw new Error(`Не понял число «${s.slice(i, j)}»`)
      out.push({ t: 'num', v })
      i = j
      continue
    }
    if (/[a-zA-Zπ]/.test(ch)) {
      let j = i
      while (j < s.length && /[a-zA-Zπ]/.test(s[j])) j++
      const word = s.slice(i, j).toLowerCase()
      // «2xx» или «xsin(x)» — разбиваем слитные буквы на x и известные имена
      let k = 0
      while (k < word.length) {
        const name = Object.keys(FUNCS).concat(Object.keys(CONSTS), ['x'])
          .filter((n) => word.startsWith(n, k))
          .sort((a, b) => b.length - a.length)[0]
        if (!name) throw new Error(`Неизвестное обозначение «${word.slice(k)}» (допустимы x, pi, sqrt, abs, sin, cos…)`)
        out.push({ t: 'id', v: name })
        k += name.length
      }
      i = j
      continue
    }
    if ('+-*/^()|√'.includes(ch)) { out.push({ t: 'op', v: ch as never }); i++; continue }
    throw new Error(`Непонятный символ «${ch}»`)
  }
  return out
}

type Node = (x: number) => number

// expr  := term (('+'|'-') term)*
// term  := unary (('*'|'/'|неявное) unary)*
// unary := '-' unary | '+' unary | power
// power := primary ('^' unary)?
// primary := num | x | const | func '(' expr ')' | '(' expr ')' | '|' expr '|' | '√' power
// Школьная формула укладывается в пару строк; предел — чтобы гигантская
// формула не грузила страницу (она считается в 600 точках на каждый график)
const MAX_FORMULA_CHARS = 300

export function compileExpression(src: string): Node {
  if (src.length > MAX_FORMULA_CHARS) throw new Error(`Формула длиннее ${MAX_FORMULA_CHARS} символов`)
  const tokens = tokenize(src)
  let pos = 0
  let absDepth = 0
  const peek = () => tokens[pos]
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Ожидалось «${v}»`)
    pos++
  }

  function expr(): Node {
    let left = term()
    while (isOp('+') || isOp('-')) {
      const op = (tokens[pos++] as { v: string }).v
      const l = left, r = term()
      left = op === '+' ? (x) => l(x) + r(x) : (x) => l(x) - r(x)
    }
    return left
  }

  // начинает ли следующий токен множитель — для неявного умножения «2x», «3(x+1)»
  function startsFactor(): boolean {
    const tk = peek()
    if (!tk) return false
    if (tk.t === 'num' || tk.t === 'id') return true
    return tk.t === 'op' && (tk.v === '(' || tk.v === '√' || (tk.v === '|' && absDepth === 0))
  }

  function term(): Node {
    let left = unary()
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = (tokens[pos++] as { v: string }).v
        const l = left, r = unary()
        left = op === '*' ? (x) => l(x) * r(x) : (x) => l(x) / r(x)
      } else if (startsFactor()) {
        const l = left, r = unary()
        left = (x) => l(x) * r(x)
      } else break
    }
    return left
  }

  function unary(): Node {
    if (isOp('-')) { pos++; const u = unary(); return (x) => -u(x) }
    if (isOp('+')) { pos++; return unary() }
    return power()
  }

  function power(): Node {
    const base = primary()
    if (isOp('^')) {
      pos++
      const e = unary()
      return (x) => Math.pow(base(x), e(x))
    }
    return base
  }

  function primary(): Node {
    const tk = peek()
    if (!tk) throw new Error('Формула оборвалась')
    if (tk.t === 'num') { pos++; const v = tk.v; return () => v }
    if (tk.t === 'id') {
      pos++
      if (tk.v === 'x') return (x) => x
      if (tk.v in CONSTS) { const v = CONSTS[tk.v]; return () => v }
      const f = FUNCS[tk.v]
      if (!isOp('(')) throw new Error(`После ${tk.v} нужны скобки: ${tk.v}(x)`)
      pos++
      const arg = expr()
      expect(')')
      return (x) => f(arg(x))
    }
    if (tk.v === '(') { pos++; const e = expr(); expect(')'); return e }
    if (tk.v === '|') {
      pos++; absDepth++
      const e = expr()
      absDepth--
      expect('|')
      return (x) => Math.abs(e(x))
    }
    if (tk.v === '√') { pos++; const p = power(); return (x) => Math.sqrt(p(x)) }
    throw new Error(`Неожиданный знак «${tk.v}»`)
  }

  const fn = expr()
  if (pos < tokens.length) throw new Error('Лишние символы в конце формулы')
  return fn
}
