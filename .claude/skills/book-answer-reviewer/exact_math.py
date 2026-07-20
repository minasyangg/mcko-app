"""Точное форматирование результата вычисления sympy.Rational в ответ.

Школьное правило: конечная десятичная дробь (знаменатель раскладывается
только на 2 и 5) -> десятичная строка; иначе (период) -> оставить точной
обыкновенной дробью "num/den", НЕ округлять/приближать десятичной записью.

Импортировать из временного calc-скрипта (см. SKILL.md, шаг 5.3):
    import sys; sys.path.insert(0, '.claude/skills/book-answer-reviewer')
    from exact_math import to_answer_str
"""

from sympy import Rational, factorint


def to_answer_str(rat) -> str:
    r = Rational(rat)
    num, den = r.p, r.q
    factors = factorint(den) if den != 1 else {}
    if set(factors.keys()) - {2, 5}:
        # период — школьная норма: точная дробь, не десятичное приближение
        return f"{num}/{den}"
    p2 = factors.get(2, 0)
    p5 = factors.get(5, 0)
    k = max(p2, p5)
    if k == 0:
        return str(num)
    num2 = num * (2 ** (k - p2)) * (5 ** (k - p5))
    sign = '-' if num2 < 0 else ''
    num2 = abs(num2)
    s = str(num2).rjust(k + 1, '0')
    return f"{sign}{s[:-k]}.{s[-k:]}"


if __name__ == '__main__':
    import sys
    print(to_answer_str(sys.argv[1]))
