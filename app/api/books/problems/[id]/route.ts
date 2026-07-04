import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeAnchors } from '@/lib/books/anchors'
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

  // Правка текста задания: пишем в prompt_md и в markdown страницы
  if (typeof body.prompt_md === 'string' && body.prompt_md.trim() !== '') {
    const newPrompt = body.prompt_md.trim()
    update.prompt_md = newPrompt

    if (problem.md_start !== null && problem.md_end !== null) {
      const { data: page } = await admin
        .from('book_pages')
        .select('id, markdown')
        .eq('book_id', problem.book_id)
        .eq('page_index', problem.page_index)
        .single()

      if (page && problem.md_end <= page.markdown.length) {
        const inPageLen = problem.md_end - problem.md_start
        const continuation = problem.prompt_md.length > inPageLen + 2
          ? problem.prompt_md.slice(inPageLen).trim()
          : ''

        const newPageMd =
          page.markdown.slice(0, problem.md_start) +
          newPrompt +
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
          .select('id, task_number')
          .eq('book_id', problem.book_id)
          .eq('page_index', problem.page_index)
        const anchors = computeAnchors(newPageMd, (pageProblems ?? []).map(p => p.task_number))
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
