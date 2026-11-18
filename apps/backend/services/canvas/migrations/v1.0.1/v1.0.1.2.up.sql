-- Capture old and new projection dependencies before the base row changes. The
-- setting is local to the transaction and PostgreSQL restores it on savepoint rollback.
CREATE FUNCTION public.capture_canvas_projection_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    pending jsonb := NULLIF(current_setting('canvas.projection_changes', true), '')::jsonb;
    old_id text;
    new_id text;
    candidates text[];
    canvas_key text;
BEGIN
    IF pending IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    CASE TG_TABLE_NAME
    WHEN 'canvases' THEN
        candidates := ARRAY[OLD.id::text, NEW.id::text];
    WHEN 'task_runs' THEN
        SELECT array_agg(DISTINCT n.canvas_id::text) INTO candidates
        FROM public.canvas_nodes n
        JOIN (VALUES (OLD.subject_type, OLD.subject_id, OLD.tenant_id),
                     (NEW.subject_type, NEW.subject_id, NEW.tenant_id)) s(kind, id, tenant)
          ON n.id=s.id::char(36) AND n.tenant_id=s.tenant AND n.deleted_at=0
        WHERE s.kind IN ('CANVAS_NODE','IMAGE_GENERATION') AND length(s.id)=36;
    WHEN 'resources', 'resource_assets' THEN
        old_id := OLD.id::text;
        new_id := NEW.id::text;
        IF TG_TABLE_NAME='resources' THEN
            SELECT array_agg(DISTINCT n.canvas_id::text) INTO candidates FROM public.canvas_nodes n
            WHERE n.deleted_at=0 AND (n.resource_id IN (old_id,new_id)
               OR n.resource_asset_id IN (SELECT id FROM public.resource_assets WHERE resource_id IN (old_id,new_id)));
        ELSE
            SELECT array_agg(DISTINCT n.canvas_id::text) INTO candidates FROM public.canvas_nodes n
            WHERE n.deleted_at=0 AND (n.resource_asset_id IN (old_id,new_id)
               OR n.resource_id IN (SELECT id FROM public.resources WHERE primary_resource_asset_id IN (old_id,new_id)));
        END IF;
    WHEN 'asset_reviews' THEN
        WITH slots AS (
            SELECT id FROM public.resource_assets WHERE deleted_at=0 AND current_asset_id IN (OLD.asset_id,NEW.asset_id)
        )
        SELECT array_agg(DISTINCT n.canvas_id::text) INTO candidates FROM public.canvas_nodes n
        WHERE n.deleted_at=0 AND (n.asset_id IN (OLD.asset_id,NEW.asset_id)
            OR n.selected_asset_id IN (OLD.asset_id,NEW.asset_id)
            OR n.resource_asset_id IN (SELECT id FROM slots)
            OR n.resource_id IN (SELECT id FROM public.resources WHERE deleted_at=0 AND primary_resource_asset_id IN (SELECT id FROM slots)));
    ELSE
        candidates := ARRAY[OLD.canvas_id::text, NEW.canvas_id::text];
    END CASE;

    FOR canvas_key IN SELECT DISTINCT k FROM unnest(candidates) k WHERE k IS NOT NULL AND NOT pending ? k ORDER BY k LOOP
        -- Serialize writers before reading the graph for the commit checkpoint.
        PERFORM p.id FROM public.projects p JOIN public.canvases c ON c.project_id=p.id
        WHERE c.id=canvas_key::char(36) AND p.deleted_at=0 FOR SHARE OF p;
        PERFORM id FROM public.canvases WHERE id=canvas_key::char(36) AND deleted_at=0 FOR UPDATE;
        pending := pending || jsonb_build_object(canvas_key,true);
    END LOOP;
    PERFORM set_config('canvas.projection_changes',pending::text,true);
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER capture_projection_change BEFORE INSERT OR UPDATE OR DELETE ON public.canvases
    FOR EACH ROW EXECUTE FUNCTION public.capture_canvas_projection_change();

CREATE TRIGGER capture_projection_change BEFORE INSERT OR UPDATE OR DELETE ON public.canvas_nodes
    FOR EACH ROW EXECUTE FUNCTION public.capture_canvas_projection_change();

CREATE TRIGGER capture_projection_change BEFORE INSERT OR UPDATE OR DELETE ON public.canvas_node_generations
    FOR EACH ROW EXECUTE FUNCTION public.capture_canvas_projection_change();

CREATE TRIGGER capture_projection_change BEFORE INSERT OR UPDATE OR DELETE ON public.canvas_text_generations
    FOR EACH ROW EXECUTE FUNCTION public.capture_canvas_projection_change();

CREATE TRIGGER capture_projection_change BEFORE INSERT OR UPDATE OR DELETE ON public.task_runs
    FOR EACH ROW EXECUTE FUNCTION public.capture_canvas_projection_change();

CREATE TRIGGER capture_projection_change BEFORE INSERT OR UPDATE OR DELETE ON public.resources
    FOR EACH ROW EXECUTE FUNCTION public.capture_canvas_projection_change();

CREATE TRIGGER capture_projection_change BEFORE INSERT OR UPDATE OR DELETE ON public.resource_assets
    FOR EACH ROW EXECUTE FUNCTION public.capture_canvas_projection_change();

CREATE TRIGGER capture_projection_change BEFORE INSERT OR UPDATE OR DELETE ON public.asset_reviews
    FOR EACH ROW EXECUTE FUNCTION public.capture_canvas_projection_change();

CREATE TRIGGER capture_projection_change BEFORE INSERT OR UPDATE OR DELETE ON public.canvas_video_archive_exports
    FOR EACH ROW EXECUTE FUNCTION public.capture_canvas_projection_change();
