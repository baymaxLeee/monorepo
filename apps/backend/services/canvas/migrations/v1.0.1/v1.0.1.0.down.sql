-- Stop Canvas writers before downgrade. Never discard persisted events.
LOCK TABLE public.canvas_events, public.canvas_event_heads IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.canvas_events)
     OR EXISTS (SELECT 1 FROM public.canvas_event_heads) THEN
    RAISE EXCEPTION 'Canvas DOWN refused: persisted events/checkpoints exist; retain schema and roll back the application or use a forward repair';
  END IF;
END
$guard$;
DROP TABLE public.canvas_events;
DROP TABLE public.canvas_event_heads;
