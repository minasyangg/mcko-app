import type { TopicCandidate } from '@/lib/homework-agent/diagnose'

/**
 * Короткое сообщение учителю в Telegram на фазе 1 — диагноз + тема (выбор
 * пользователя из плана project_homework_agent: не просто тема, а с
 * обоснованием). MVP без inline-кнопок (этап 3 плана, отдельно): подтверждение
 * и правка — через ссылку на страницу сайта, здесь только информирование.
 */
export function formatProposalMessage(opts: {
  roadmapTitle: string
  winner: TopicCandidate
  autoConfirmed: boolean
}): string {
  const { roadmapTitle, winner, autoConfirmed } = opts

  const lines: string[] = [`🤖 ДЗ для «${roadmapTitle}»`, '']

  if (winner.wrongCount > 0 && winner.errorRatePct !== null) {
    lines.push(`Слабое место: ${winner.topicName}${winner.fipiCode ? ` (${winner.fipiCode})` : ''}`)
    lines.push(`${winner.wrongCount} ошиб${pluralOshibka(winner.wrongCount)} из ${winner.totalCount} (${winner.errorRatePct}%)`)
  } else {
    lines.push(`Тема: ${winner.topicName}${winner.fipiCode ? ` (${winner.fipiCode})` : ''}`)
  }

  if (winner.isGap) lines.push('Пройдено ранее по программе — стоит подтянуть.')
  if (winner.isCurrent) lines.push('Это текущая тема программы.')

  lines.push('')
  lines.push(
    autoConfirmed
      ? 'ДЗ собирается автоматически (автоподтверждение включено).'
      : 'Подтвердите или отредактируйте тему на сайте, чтобы агент собрал ДЗ.'
  )

  return lines.join('\n')
}

export function pluralOshibka(n: number): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'ка'
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'ки'
  return 'ок'
}
