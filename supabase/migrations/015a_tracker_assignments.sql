-- 015A: tracker_assignments
--
-- Файл восстановлен 2026-11-12 из истории миграций базы
-- (supabase_migrations.schema_migrations, версия 20260621102206): миграция была
-- применена, но в репозиторий не попала. Текст ниже — дословно из истории.


CREATE TABLE IF NOT EXISTS public.tracker_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  problem_ids text[] NOT NULL DEFAULT '{}',
  due_date timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tracker_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.tracker_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_id text NOT NULL,
  status text NOT NULL DEFAULT 'not_started',
  notes text,
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(assignment_id, problem_id)
);

ALTER TABLE public.tracker_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers see their assignments"
  ON public.tracker_assignments FOR ALL
  USING (teacher_id = auth.uid());

CREATE POLICY "Students see their assignments"
  ON public.tracker_assignments FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Students manage their progress"
  ON public.tracker_progress FOR ALL
  USING (student_id = auth.uid());

CREATE POLICY "Teachers see student progress"
  ON public.tracker_progress FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tracker_assignments a
      WHERE a.id = assignment_id AND a.teacher_id = auth.uid()
    )
  );
