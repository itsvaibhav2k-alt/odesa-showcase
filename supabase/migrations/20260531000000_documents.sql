-- Documents — portfolio document registry powering the /documents page.
--
-- Org-scoped via public.current_user_org_id() (the same helper every other
-- table uses). A document optionally references a property / unit / tenant /
-- vendor so the list view can render drill-through links and the row's
-- "related" label. file_key points at storage (not enforced here); the v1
-- list view only needs the metadata.

CREATE TABLE IF NOT EXISTS public.documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id     uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id         uuid REFERENCES public.units(id)      ON DELETE SET NULL,
  tenant_id       uuid REFERENCES public.tenants(id)    ON DELETE SET NULL,
  vendor_id       uuid REFERENCES public.vendors(id)    ON DELETE SET NULL,
  type            text NOT NULL CHECK (type IN ('lease','inspection','insurance','notice','tax','hoa')),
  title           text NOT NULL,
  file_key        text,
  expiry_date     date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_org_idx      ON public.documents(organization_id);
CREATE INDEX IF NOT EXISTS documents_property_idx ON public.documents(property_id);
CREATE INDEX IF NOT EXISTS documents_tenant_idx   ON public.documents(tenant_id);
CREATE INDEX IF NOT EXISTS documents_vendor_idx   ON public.documents(vendor_id);
CREATE INDEX IF NOT EXISTS documents_expiry_idx   ON public.documents(expiry_date);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Org-scoped CRUD, matching the project's RLS convention.
CREATE POLICY documents_select ON public.documents
  FOR SELECT USING (organization_id = public.current_user_org_id());

CREATE POLICY documents_insert ON public.documents
  FOR INSERT WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY documents_update ON public.documents
  FOR UPDATE USING      (organization_id = public.current_user_org_id())
             WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY documents_delete ON public.documents
  FOR DELETE USING (organization_id = public.current_user_org_id());
