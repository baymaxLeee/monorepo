-- Expand references before the owner-run storage backfill. Legacy text is retained
-- only for data migration; the application reads and writes bytes through Storage.
ALTER TABLE public.file_entries
    ADD COLUMN asset_id uuid,
    ADD COLUMN revision_id uuid,
    ADD COLUMN size_bytes bigint,
    ALTER COLUMN content DROP NOT NULL;
ALTER TABLE public.file_change_set_entries
    ADD COLUMN asset_id uuid,
    ADD COLUMN revision_id uuid,
    ADD COLUMN size_bytes bigint,
    ALTER COLUMN content DROP NOT NULL;
ALTER TABLE public.documents ADD COLUMN editable_source boolean NOT NULL DEFAULT false;
UPDATE public.documents SET editable_source=true WHERE kind='artifact' AND asset_id IS NULL;
