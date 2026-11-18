UPDATE public.model_providers
SET responses_dialect = 'ark_responses'
WHERE provider_kind = 'chat'
  AND responses_dialect IS DISTINCT FROM 'ark_responses';

ALTER TABLE public.model_providers
DROP CONSTRAINT ck_model_providers_responses_dialect;

ALTER TABLE public.model_providers
ADD CONSTRAINT ck_model_providers_responses_dialect
CHECK (responses_dialect IS NULL OR responses_dialect = 'ark_responses');
