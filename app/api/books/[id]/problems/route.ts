import { authorizeBookEdit } from '@/lib/books/authorize'
import { computeAnchors } from '@/lib/books/anchors'
import { NextRequest } from 'next/server'

const GRADING_METHODS = ['normalized', 'numeric_tolerance', 'set_match', 'contains', 'regex', 'manual', 'sequence']

// POST /api/books/[id]/problems
// Body: { page_index, task_number, prompt_md, correct_answer?, grading_method? }
// Ручное создание задания: OCR иногда склеивает несколько задач в один атом —
// учитель вырезает текст из соседнего задания и создаёт пропущенное.
// Текст вставляется в markdown страницы по порядку номера, якоря пересчитываются.
// Владелец книги, учитель с грантом или admin.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookId } = await params

  const auth = await authorizeBookEdit(bookId, 'Создавать задания может только владелец книги, учитель с доступом или администратор')
  if (auth.error) return auth.error
  const admin = auth.admin

  const body = await request.json() as {
    page_index?: number
    task_number?: string
    prompt_md?: string
    correct_answer?: string | null
    grading_method?: string
  }

  const pageIndex = body.page_index
  if (typeof pageIndex !== 'number' || pageIndex < 0) {
    return Response.json({ error: 'page_index required' }, { status: 400 })
  }
  if ((body.prompt_md?.length ?? 0) > 20_000 || (body.correct_answer?.length ?? 0) > 2_000) {
    return Response.json({ error: 'Слишком длинный текст' }, { status: 400 })
  }
  const taskNumber = (body.task_number ?? '').trim()
  // сквозной «735» или по параграфам «5.30» — как в книгах
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(taskNumber)) {
    return Response.json({ error: 'Номер задания: «735» или «5.30» (цифры и точка)' }, { status: 400 })
  }
  // текст без номера — номер добавит сервер (как в редактировании)
  const esc = taskNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const promptText = (body.prompt_md ?? '').trim()
    .replace(new RegExp(`^[ \\t]*${esc}\\.[ \\t]*`), '')
  if (!promptText) return Response.json({ error: 'Текст задания пуст' }, { status: 400 })

  const gradingMethod = body.grading_method ?? 'manual'
  if (!GRADING_METHODS.includes(gradingMethod)) {
    return Response.json({ error: 'Неизвестный метод проверки' }, { status: 400 })
  }

  const { data: existing } = await admin
    .from('book_problems')
    .select('id').eq('book_id', bookId).eq('task_number', taskNumber).maybeSingle()
  if (existing) return Response.json({ error: `Задание № ${taskNumber} уже есть в книге` }, { status: 409 })

  const { data: page } = await admin
    .from('book_pages')
    .select('id, markdown')
    .eq('book_id', bookId)
    .eq('page_index', pageIndex)
    .single()
  if (!page) return Response.json({ error: 'Page not found' }, { status: 404 })

  // сортировочный ключ — как в импортёре
  const parts = taskNumber.split('.')
  const sort = parts.length === 2 ? parseInt(parts[0]) * 1000 + parseInt(parts[1]) : parseInt(parts[0])

  const { data: pageProblems } = await admin
    .from('book_problems')
    .select('id, task_number, task_number_sort, section_id, md_start, md_end')
    .eq('book_id', bookId)
    .eq('page_index', pageIndex)

  // место вставки: после конца последнего задания с меньшим номером;
  // если таких нет — перед первым заданием; если заданий нет — в конец страницы
  const anchored = (pageProblems ?? []).filter(p => p.md_start !== null && p.md_end !== null)
  const before = anchored
    .filter(p => (p.task_number_sort ?? 0) < sort)
    .sort((a, b) => (b.task_number_sort ?? 0) - (a.task_number_sort ?? 0))[0]
  const after = anchored
    .filter(p => (p.task_number_sort ?? 0) >= sort)
    .sort((a, b) => (a.task_number_sort ?? 0) - (b.task_number_sort ?? 0))[0]
  const insertAt = before ? before.md_end! : after ? after.md_start! : page.markdown.length

  const block = `${taskNumber}. ${promptText}`
  const pre = page.markdown.slice(0, insertAt)
  const post = page.markdown.slice(insertAt)
  const newPageMd =
    pre + (pre === '' || pre.endsWith('\n\n') ? '' : pre.endsWith('\n') ? '\n' : '\n\n') +
    block + '\n\n' + post.replace(/^\s*\n/, '')

  const answerText = (body.correct_answer ?? '').trim()

  const { data: created, error: insErr } = await admin
    .from('book_problems')
    .insert({
      book_id: bookId,
      section_id: (pageProblems ?? []).find(p => p.section_id)?.section_id ?? null,
      task_number: taskNumber,
      task_number_sort: sort,
      page_index: pageIndex,
      md_start: null, // проставит пересчёт якорей ниже
      md_end: null,
      prompt_md: block,
      task_type: 'short_text',
      grading_method: gradingMethod,
      correct_answer: answerText ? { text: answerText } : null,
      answer_source: answerText ? 'manual' : 'none',
      difficulty: 'standard',
      has_images: /<img\s/.test(promptText),
    })
    .select('id')
    .single()
  if (insErr) return Response.json({ error: insErr.message }, { status: 500 })

  const { error: pageErr } = await admin
    .from('book_pages').update({ markdown: newPageMd }).eq('id', page.id)
  if (pageErr) return Response.json({ error: pageErr.message }, { status: 500 })

  // пересчёт якорей всей страницы (включая новое задание)
  const { data: allProblems } = await admin
    .from('book_problems')
    .select('id, task_number, task_number_sort')
    .eq('book_id', bookId)
    .eq('page_index', pageIndex)
  const anchors = computeAnchors(newPageMd, (allProblems ?? []).map(p => p.task_number),
          new Map((allProblems ?? []).map(p => [p.task_number, p.task_number_sort ?? 0])))
  for (const p of allProblems ?? []) {
    const a = anchors.get(p.task_number) ?? null
    await admin.from('book_problems').update({
      md_start: a?.start ?? null,
      md_end: a?.end ?? null,
    }).eq('id', p.id)
  }

  return Response.json({ ok: true, id: created.id })
}
