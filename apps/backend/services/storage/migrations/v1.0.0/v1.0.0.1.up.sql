ALTER TABLE public.upload_sessions
    ADD COLUMN target_asset_id uuid,
    ADD COLUMN base_revision_id uuid,
    ADD COLUMN claim_owner_type character varying(64),
    ADD COLUMN claim_owner_id character varying(128),
    ADD COLUMN claim_slot character varying(128),
    ADD COLUMN claim_generation bigint;

ALTER TABLE public.upload_sessions
    ADD CONSTRAINT upload_sessions_append_target_fields_check CHECK (
        (target_asset_id IS NULL AND base_revision_id IS NULL AND claim_owner_type IS NULL
            AND claim_owner_id IS NULL AND claim_slot IS NULL AND claim_generation IS NULL)
        OR
        (target_asset_id IS NOT NULL AND base_revision_id IS NOT NULL AND claim_owner_type IS NOT NULL
            AND claim_owner_id IS NOT NULL AND claim_slot IS NOT NULL AND claim_generation > 0)
    ),
    ADD CONSTRAINT upload_sessions_target_asset_id_fkey
        FOREIGN KEY (target_asset_id) REFERENCES public.assets(id),
    ADD CONSTRAINT upload_sessions_base_revision_id_fkey
        FOREIGN KEY (base_revision_id) REFERENCES public.asset_revisions(id);

CREATE INDEX ix_upload_sessions_append_target
    ON public.upload_sessions USING btree (target_asset_id, base_revision_id)
    WHERE target_asset_id IS NOT NULL;
