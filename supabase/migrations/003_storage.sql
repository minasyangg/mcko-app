-- ============================================================
-- 003_storage.sql — Supabase Storage buckets & policies
-- ============================================================

-- Bucket: test-documents (private, teachers/admins only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'test-documents',
  'test-documents',
  false,
  52428800, -- 50MB
  array['application/pdf']
)
on conflict (id) do nothing;

-- Bucket: task-media (private, served via signed URLs)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-media',
  'task-media',
  false,
  5242880, -- 5MB per image
  array['image/webp','image/jpeg','image/png','image/gif']
)
on conflict (id) do nothing;

-- Bucket: solution-media (private, served via signed URLs with approval check)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'solution-media',
  'solution-media',
  false,
  5242880,
  array['image/webp','image/jpeg','image/png','image/gif']
)
on conflict (id) do nothing;

-- ============================================================
-- Storage policies: test-documents
-- ============================================================
create policy "test-documents: teacher/admin upload"
  on storage.objects for insert
  with check (
    bucket_id = 'test-documents'
    and auth_role() in ('teacher','admin')
  );

create policy "test-documents: teacher/admin read"
  on storage.objects for select
  using (
    bucket_id = 'test-documents'
    and auth_role() in ('teacher','admin')
  );

create policy "test-documents: teacher/admin delete"
  on storage.objects for delete
  using (
    bucket_id = 'test-documents'
    and auth_role() in ('teacher','admin')
  );

-- ============================================================
-- Storage policies: task-media
-- ============================================================
create policy "task-media: teacher/admin manage"
  on storage.objects for all
  using (
    bucket_id = 'task-media'
    and auth_role() in ('teacher','admin')
  );

-- Students access via signed URL generated server-side —
-- the application layer enforces assignment membership.
-- Storage itself allows authenticated read (signed URL already encodes auth).
create policy "task-media: authenticated read"
  on storage.objects for select
  using (
    bucket_id = 'task-media'
    and auth.role() = 'authenticated'
  );

-- ============================================================
-- Storage policies: solution-media
-- ============================================================
create policy "solution-media: teacher/admin manage"
  on storage.objects for all
  using (
    bucket_id = 'solution-media'
    and auth_role() in ('teacher','admin')
  );

-- Signed URL access for solutions is enforced in the API route —
-- only authenticated users get through.
create policy "solution-media: authenticated read"
  on storage.objects for select
  using (
    bucket_id = 'solution-media'
    and auth.role() = 'authenticated'
  );
