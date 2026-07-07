import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeAnchors, visibleTaskNumber } from '@/lib/books/anchors'
import { NextRequest } from 'next/server'
import type { Database } from '@/types/database'

type BookProblemUpdate = Database['public']['Tables']['book_problems']['Update']

const GRADING_METHODS = ['exact', 'normalized', 'numeric_tolerance', 'set_match', 'contains', 'regex', 'manual', 'sequence']

// PATCH /api/books/problems/[id]
// Body: { prompt_md?, correct_answer?, grading_method? }
// Правка текста задания и/или ответа. Только владелец книги (created_by) или admin.
// Текст синхронизируется со страницей читалки, якоря страницы пересчитываются.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: problem } = await admin
    .from('book_problems')
    .select('*, books!book_id(created_by)')
    .eq('id', id)
    .single()
  if (!problem) return Response.json({ error: 'Not found' }, { status: 404 })

  const bookOwner = (problem.books as unknown as { created_by: string | null } | null)?.created_by
  if (profile.role !== 'admin' && bookOwner !== user.id) {
    return Response.json({ error: 'Редактировать может только владелец книги или администратор' }, { status: 403 })
  }

  const body = await request.json() as {
    prompt_md?: string
    correct_answer?: string | null
    grading_method?: string
  }
  if ((body.prompt_md?.length ?? 0) > 20_000 || (body.correct_answer?.length ?? 0) > 2_000) {
    return Response.json({ error: 'Слишком длинный текст' }, { status: 400 })
  }

  const update: BookProblemUpdate = {}

  if (typeof body.grading_method === 'string') {
    if (!GRADING_METHODS.includes(body.grading_method)) {
      return Response.json({ error: 'Неизвестный метод проверки' }, { status: 400 })
    }
    update.grading_method = body.grading_method
  }

  if (body.correct_answer !== undefined) {
    const text = (body.correct_answer ?? '').trim()
    if (text === '') {
      update.correct_answer = null
      update.answer_source = 'none'
    } else {
      update.correct_answer = { text }
      update.answer_source = 'manual'
    }
  }

  // Правка текста задания: пишем в prompt_md и в markdown страницы.
  // Клиент присылает текст БЕЗ номера (номер не редактируется — по нему
  // строятся привязки и поиск); сервер восстанавливает номер сам,
  // сохраняя значок перед ним (○/∞/⑤) из текущего текста страницы.
  if (typeof body.prompt_md === 'string' && body.prompt_md.trim() !== '') {
    // в тексте книги ДКР-задание напечатано видимым номером («3.»), а не «к1.2.3»
    const visible = visibleTaskNumber(problem.task_number)
    const esc = visible.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // группа 1 — глиф перед номером (символ вплотную: ○/∞/⑤/OCR-кружок, или
    // буква категории через пробел — Петерсон: К/П/Д/С); группа 2 —
    // необязательный терминатор после номера (Петерсон печатает номер вообще
    // без знака препинания: «23 Найди…»)
    const headRe = new RegExp(`^[ \\t]*((?:(?:[^0-9A-Za-zА-Яа-яЁё#<\\s$([{]|[oOоОοΟ0])[ \\t]*|[КПДСKPDCπ][ \\t]+))?${esc}[*°]?([.)]?)[*°]?[ \\t]*`)
    const bodyText = body.prompt_md.trim().replace(headRe, '')
    if (bodyText === '') return Response.json({ error: 'Текст задания пуст' }, { status: 400 })

    let page: { id: string; markdown: string } | null = null
    if (problem.md_start !== null && problem.md_end !== null) {
      const res = await admin
        .from('book_pages')
        .select('id, markdown')
        .eq('book_id', problem.book_id)
        .eq('page_index', problem.page_index)
        .single()
      page = res.data
    }

    const curSlice = page && problem.md_end !== null && problem.md_end <= page.markdown.length && problem.md_start !== null
      ? page.markdown.slice(problem.md_start, problem.md_end)
      : ''
    const headMatch = curSlice.match(headRe)
    const glyph = headMatch?.[1] ?? ''
    // терминатор сохраняется как в исходном тексте: «.», «)» или его отсутствие
    // (Петерсон печатает номер без знака препинания — «23 Найди…»); если
    // определить не удалось (новый/безъякорный текст) — по умолчанию точка
    const terminator = headMatch ? headMatch[2] : '.'
    const newPrompt = `${glyph}${visible}${terminator} ${bodyText}`
    update.prompt_md = newPrompt

    if (problem.md_start !== null && problem.md_end !== null) {
      if (page && problem.md_end <= page.markdown.length) {
        const inPageLen = problem.md_end - problem.md_start
        const continuation = problem.prompt_md.length > inPageLen + 2
          ? problem.prompt_md.slice(inPageLen).trim()
          : ''

        // Заменяемый диапазон включает разделитель перед следующим заданием,
        // а newPrompt приходит без него — сохраняем перенос строки, иначе
        // номер следующего задания приклеится к тексту и потеряет якорь
        const trailingWs = page.markdown.slice(problem.md_start, problem.md_end).match(/\s*$/)?.[0] ?? ''
        const sep = problem.md_end >= page.markdown.length
          ? trailingWs
          : trailingWs.includes('\n') ? trailingWs : '\n\n'

        const newPageMd =
          page.markdown.slice(0, problem.md_start) +
          newPrompt + sep +
          page.markdown.slice(problem.md_end)

        // Задание продолжалось на следующей странице — убираем там старый хвост,
        // иначе он останется дублем (новый текст записан целиком на этой странице)
        if (continuation) {
          const { data: nextPage } = await admin
            .from('book_pages')
            .select('id, markdown')
            .eq('book_id', problem.book_id)
            .eq('page_index', problem.page_index + 1)
            .single()
          if (nextPage) {
            const trimmed = nextPage.markdown.trimStart()
            if (trimmed.startsWith(continuation)) {
              await admin
                .from('book_pages')
                .update({ markdown: trimmed.slice(continuation.length).trimStart() })
                .eq('id', nextPage.id)
            }
          }
        }

        await admin.from('book_pages').update({ markdown: newPageMd }).eq('id', page.id)

        // Пересчёт якорей всех заданий этой страницы (смещения сдвинулись)
        const { data: pageProblems } = await admin
          .from('book_problems')
          .select('id, task_number, task_number_sort')
          .eq('book_id', problem.book_id)
          .eq('page_index', problem.page_index)
        const anchors = computeAnchors(newPageMd, (pageProblems ?? []).map(p => p.task_number),
          new Map((pageProblems ?? []).map(p => [p.task_number, p.task_number_sort ?? 0])))
        for (const p of pageProblems ?? []) {
          const a = anchors.get(p.task_number) ?? null
          await admin.from('book_problems').update({
            md_start: a?.start ?? null,
            md_end: a?.end ?? null,
          }).eq('id', p.id)
        }
      }
    }
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'Нет изменений' }, { status: 400 })
  }
  update.updated_at = new Date().toISOString()

  const { error: updErr } = await admin.from('book_problems').update(update).eq('id', id)
  if (updErr) return Response.json({ error: updErr.message }, { status: 500 })

  return Response.json({ ok: true })
}

// DELETE /api/books/problems/[id]
// Полное удаление атома: текст вырезается из страницы читалки, строка — из БД.
// Только владелец книги или admin. В тестах, куда задание уже добавлено,
// его копия сохраняется (test_tasks.book_problem_id → set null).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['teacher', 'admin'].includes(profile.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: problem } = await admin
    .from('book_problems')
    .select('*, books!book_id(created_by)')
    .eq('id', id)
    .single()
  if (!problem) return Response.json({ error: 'Not found' }, { status: 404 })

  const bookOwner = (problem.books as unknown as { created_by: string | null } | null)?.created_by
  if (profile.role !== 'admin' && bookOwner !== user.id) {
    return Response.json({ error: 'Удалять может только владелец книги или администратор' }, { status: 403 })
  }

  // вырезаем текст задания из страницы (диапазон включает разделитель
  // до следующего задания — вырез чистый) и пересчитываем якоря остальных
  if (problem.md_start !== null && problem.md_end !== null) {
    const { data: page } = await admin
      .from('book_pages')
      .select('id, markdown')
      .eq('book_id', problem.book_id)
      .eq('page_index', problem.page_index)
      .single()

    if (page && problem.md_end <= page.markdown.length) {
      const newPageMd =
        page.markdown.slice(0, problem.md_start) +
        page.markdown.slice(problem.md_end)
      const { error: pageErr } = await admin
        .from('book_pages').update({ markdown: newPageMd }).eq('id', page.id)
      if (pageErr) return Response.json({ error: pageErr.message }, { status: 500 })

      const { data: pageProblems } = await admin
        .from('book_problems')
        .select('id, task_number, task_number_sort')
        .eq('book_id', problem.book_id)
        .eq('page_index', problem.page_index)
        .neq('id', id)
      const anchors = computeAnchors(newPageMd, (pageProblems ?? []).map(p => p.task_number),
          new Map((pageProblems ?? []).map(p => [p.task_number, p.task_number_sort ?? 0])))
      for (const p of pageProblems ?? []) {
        const a = anchors.get(p.task_number) ?? null
        await admin.from('book_problems').update({
          md_start: a?.start ?? null,
          md_end: a?.end ?? null,
        }).eq('id', p.id)
      }
    }
  }

  const { error: delErr } = await admin.from('book_problems').delete().eq('id', id)
  if (delErr) return Response.json({ error: delErr.message }, { status: 500 })

  return Response.json({ ok: true })
}
