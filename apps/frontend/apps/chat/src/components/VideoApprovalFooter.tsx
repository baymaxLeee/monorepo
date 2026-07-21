import { zodResolver } from "@hookform/resolvers/zod";
import type { VideoProduction } from "api";
import {
  Button,
  Field,
  FieldError,
  FieldLabel,
  Form,
  FormControl,
  FormField,
  Input,
  Textarea,
} from "components";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const approvalSchema = z.object({
  budgetUnits: z.number().nonnegative(),
  waiverReason: z.string().max(1000),
});

type ApprovalValues = z.infer<typeof approvalSchema>;

function needsWaiver(production: VideoProduction): boolean {
  if (!production.qaReport || typeof production.qaReport !== "object")
    return false;
  const semantic = Reflect.get(production.qaReport, "semantic");
  return Boolean(
    semantic &&
      typeof semantic === "object" &&
      Reflect.get(semantic, "status") === "human_review_required",
  );
}

export function VideoApprovalFooter({
  production,
  disabled,
  onDecision,
}: {
  production: VideoProduction;
  disabled: boolean;
  onDecision: (
    approved: boolean,
    input: { budgetLimitMicros?: number; waiverReason?: string },
  ) => Promise<void>;
}) {
  const estimate = production.cost.estimatedMicros ?? 0;
  const form = useForm<ApprovalValues>({
    resolver: zodResolver(approvalSchema),
    defaultValues: {
      budgetUnits: estimate / 1_000_000,
      waiverReason: "",
    },
  });

  useEffect(() => {
    form.reset({ budgetUnits: estimate / 1_000_000, waiverReason: "" });
  }, [estimate, form]);

  const submit = form.handleSubmit(async (values) => {
    if (production.awaitingAction === "storyboard_approval") {
      const budgetLimitMicros = Math.round(values.budgetUnits * 1_000_000);
      if (budgetLimitMicros < estimate) {
        form.setError("budgetUnits", { message: "预算上限不能低于预计成本" });
        return;
      }
      await onDecision(true, { budgetLimitMicros });
      return;
    }
    const waiverReason = values.waiverReason.trim();
    if (needsWaiver(production) && !waiverReason) {
      form.setError("waiverReason", { message: "请填写语义质检豁免理由" });
      return;
    }
    await onDecision(true, { waiverReason: waiverReason || undefined });
  });

  return (
    <footer className="shrink-0 border-t p-3">
      <Form {...form}>
        <form className="space-y-2" onSubmit={submit}>
          {production.awaitingAction === "storyboard_approval" ? (
            <FormField
              control={form.control}
              name="budgetUnits"
              render={({ field }) => (
                <Field>
                  <FieldLabel>
                    预算上限（{production.cost.currency ?? "币种"}）
                  </FieldLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={estimate / 1_000_000}
                      step="0.01"
                      disabled={disabled}
                      onChange={(event) =>
                        field.onChange(event.currentTarget.valueAsNumber)
                      }
                    />
                  </FormControl>
                  <FieldError errors={[form.formState.errors.budgetUnits]} />
                  <p className="text-xs text-muted-foreground">
                    提高预算上限后才有余量进行局部重拍。
                  </p>
                </Field>
              )}
            />
          ) : null}
          {production.awaitingAction === "publish_approval" &&
          needsWaiver(production) ? (
            <FormField
              control={form.control}
              name="waiverReason"
              render={({ field }) => (
                <Field>
                  <FieldLabel>语义质检豁免理由</FieldLabel>
                  <FormControl>
                    <Textarea {...field} maxLength={1000} disabled={disabled} />
                  </FormControl>
                  <FieldError errors={[form.formState.errors.waiverReason]} />
                </Field>
              )}
            />
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={disabled}
              onClick={() => void onDecision(false, {})}
            >
              <XIcon className="mr-2 size-4" />
              拒绝
            </Button>
            <Button type="submit" className="flex-1" disabled={disabled}>
              {disabled ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <CheckIcon className="mr-2 size-4" />
              )}
              {production.awaitingAction === "publish_approval"
                ? "批准发布"
                : "批准分镜并开始生成"}
            </Button>
          </div>
        </form>
      </Form>
    </footer>
  );
}
