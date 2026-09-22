// DFS-порядок тем программы + каскадная видимость (092) — общая логика,
// используемая и в кабинете ученика (app/student/page.tsx, для сортировки
// TimelineTopic), и в форме "Назначить" (app/teacher/assignments/new,
// выбор темы программы — там же нужна глубина узла для отступов и полный
// путь по дереву для подсказки).
//
// sort_order уникален только СРЕДИ ДЕТЕЙ ОДНОГО РОДИТЕЛЯ (миграция 085,
// дерево тем: глава → подтема → деталь) — плоская глобальная сортировка по
// этому полю перемешивает ветки дерева между собой. Правильный порядок —
// обход в глубину: все дети одного родителя по sort_order, для каждого
// сразу его поддерево, потом следующий sibling. Тот же порядок, что
// учитель видит "сверху вниз" в развёрнутом дереве RoadmapEditor.

export interface RoadmapTopicRow {
  id: string
  roadmap_id: string
  parent_id: string | null
  title: string
  sort_order: number
  visible_to_students: boolean
}

export interface TopicTreeEntry {
  topic: RoadmapTopicRow
  depth: number
  /** Заголовки предков от корня до этой темы (не включая её саму) — для
   *  подсказки-пути "Глава → Подтема" в выпадающих списках. */
  ancestorTitles: string[]
}

/** DFS-обход тем ОДНОЙ программы (roadmapId) — только видимые ученикам
 *  (эффективная видимость = AND по цепочке предков: скрытие главы прячет
 *  все подтемы, даже если у них самих visible_to_students=true). */
export function visibleTopicsInTreeOrder(allTopics: RoadmapTopicRow[], roadmapId: string): TopicTreeEntry[] {
  const own = allTopics.filter(t => t.roadmap_id === roadmapId)
  const ownIds = new Set(own.map(t => t.id))

  const byParent = new Map<string | null, RoadmapTopicRow[]>()
  for (const t of own) {
    // "Осиротевшая" тема (parent_id вне тем этой программы) — трактуется
    // как root, не отбрасывается молча (см. app/student/page.tsx).
    const key = t.parent_id && ownIds.has(t.parent_id) ? t.parent_id : null
    const arr = byParent.get(key) ?? []
    arr.push(t)
    byParent.set(key, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sort_order - b.sort_order)

  const result: TopicTreeEntry[] = []
  function visit(parentId: string | null, hiddenAncestor: boolean, depth: number, ancestorTitles: string[]) {
    for (const t of byParent.get(parentId) ?? []) {
      const hidden = hiddenAncestor || !t.visible_to_students
      if (!hidden) result.push({ topic: t, depth, ancestorTitles })
      visit(t.id, hidden, depth + 1, hidden ? ancestorTitles : [...ancestorTitles, t.title])
    }
  }
  visit(null, false, 0, [])
  return result
}
