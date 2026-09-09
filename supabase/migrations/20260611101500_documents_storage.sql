-- Documents storage — private bucket + org-scoped RLS for /documents uploads.
--
-- Objects live at `<organization_id>/<uuid>-<filename>` so the first path
-- segment scopes every storage policy via public.current_user_org_id()
-- (the same helper every table policy uses). The bucket is private; the
-- dashboard reads objects through these org-scoped policies (or signed URLs).
--
-- Also adds documents.uploaded_by so the registry row records who uploaded
-- the file (nullable: pre-existing rows and system imports have no uploader).

INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Org-scoped storage CRUD, matching the table-policy convention. The path's
-- first folder is the organization id, compared as text against the helper.
CREATE POLICY documents_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = public.current_user_org_id()::text
  );

CREATE POLICY documents_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = public.current_user_org_id()::text
  );

CREATE POLICY documents_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = public.current_user_org_id()::text
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = public.current_user_org_id()::text
  );

CREATE POLICY documents_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = public.current_user_org_id()::text
  );
