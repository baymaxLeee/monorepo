import { Button } from "@repo/design-system";
import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";

type AsyncButtonProps = ComponentProps<typeof Button> & { loading?: boolean };

/** Keeps async actions readable without changing the shared button contract. */
export function AsyncButton({ children, disabled, loading = false, ...props }: AsyncButtonProps) {
  return (
    <Button aria-busy={loading || undefined} disabled={disabled || loading} {...props}>
      {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
      {children}
    </Button>
  );
}
