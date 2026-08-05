import { zodResolver } from "@hookform/resolvers/zod";
import type { VideoShotPlan } from "@repo/api";
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
} from "@repo/design-system";
import { SaveIcon } from "lucide-react";
import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";

const shotFormSchema = z.object({
  shots: z
    .array(
      z.object({
        narrativeBeat: z.string().trim().min(1).max(500),
        action: z.string().trim().min(1).max(1_000),
        seconds: z.number().int().min(4).max(15),
        shotSize: z.string().trim().min(1).max(80),
        movement: z.string().trim().min(1).max(160),
        focus: z.string().trim().max(160),
        environment: z.string().trim().min(1).max(500),
        lightingPalette: z.string().trim().min(1).max(300),
        audioDirection: z.string().trim().max(500),
        subjectAnchors: z.string().max(2000),
        continuityContract: z.string().max(4000),
        acceptanceCriteria: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(12),
});

type ShotFormValues = z.infer<typeof shotFormSchema>;

function defaults(plan: VideoShotPlan): ShotFormValues {
  return {
    shots: plan.shots.map((shot) => ({
      narrativeBeat: shot.narrativeBeat,
      action: shot.action,
      seconds: shot.seconds,
      shotSize: shot.camera.shotSize,
      movement: shot.camera.movement,
      focus: shot.camera.focus ?? "",
      environment: shot.environment,
      lightingPalette: shot.lightingPalette,
      audioDirection: shot.audioDirection,
      subjectAnchors: shot.subjectAnchors.join("\n"),
      continuityContract: shot.continuityContract.join("\n"),
      acceptanceCriteria: shot.acceptanceCriteria.join("\n"),
    })),
  };
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function VideoStoryboardEditor({
  plan,
  disabled,
  onSave,
}: {
  plan: VideoShotPlan;
  disabled: boolean;
  onSave: (plan: VideoShotPlan) => Promise<void>;
}) {
  const form = useForm<ShotFormValues>({
    resolver: zodResolver(shotFormSchema),
    defaultValues: defaults(plan),
  });
  const { fields } = useFieldArray({ control: form.control, name: "shots" });

  useEffect(() => form.reset(defaults(plan)), [form, plan]);

  return (
    <Form {...form}>
      <form
        className="space-y-3"
        onSubmit={form.handleSubmit(async (values) => {
          await onSave({
            version: plan.version,
            shots: plan.shots.map((shot, index) => {
              const value = values.shots[index]!;
              return {
                ...shot,
                narrativeBeat: value.narrativeBeat,
                action: value.action,
                seconds: value.seconds,
                camera: {
                  shotSize: value.shotSize,
                  movement: value.movement,
                  ...(value.focus ? { focus: value.focus } : {}),
                },
                environment: value.environment,
                lightingPalette: value.lightingPalette,
                audioDirection: value.audioDirection,
                subjectAnchors: lines(value.subjectAnchors),
                continuityContract: lines(value.continuityContract),
                acceptanceCriteria: lines(value.acceptanceCriteria),
              };
            }),
          });
        })}
      >
        {fields.map((field, index) => (
          <article key={field.id} className="space-y-3 rounded-lg border p-3">
            <div className="text-xs font-medium">镜头 {index + 1}</div>
            <FormField
              control={form.control}
              name={`shots.${index}.narrativeBeat`}
              render={({ field }) => (
                <Field>
                  <FieldLabel>剧情节拍</FieldLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                  <FieldError errors={[form.formState.errors.shots?.[index]?.narrativeBeat]} />
                </Field>
              )}
            />
            <FormField
              control={form.control}
              name={`shots.${index}.action`}
              render={({ field }) => (
                <Field>
                  <FieldLabel>连续动作</FieldLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                  <FieldError errors={[form.formState.errors.shots?.[index]?.action]} />
                </Field>
              )}
            />
            <div className="grid grid-cols-3 gap-2">
              <FormField
                control={form.control}
                name={`shots.${index}.seconds`}
                render={({ field }) => (
                  <Field>
                    <FieldLabel>秒数</FieldLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={4}
                        max={15}
                        onChange={(event) => field.onChange(event.currentTarget.valueAsNumber)}
                      />
                    </FormControl>
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name={`shots.${index}.shotSize`}
                render={({ field }) => (
                  <Field>
                    <FieldLabel>景别</FieldLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name={`shots.${index}.movement`}
                render={({ field }) => (
                  <Field>
                    <FieldLabel>运镜</FieldLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </Field>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name={`shots.${index}.focus`}
              render={({ field }) => (
                <Field>
                  <FieldLabel>焦点（可选）</FieldLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </Field>
              )}
            />
            <FormField
              control={form.control}
              name={`shots.${index}.environment`}
              render={({ field }) => (
                <Field>
                  <FieldLabel>环境</FieldLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                </Field>
              )}
            />
            <FormField
              control={form.control}
              name={`shots.${index}.lightingPalette`}
              render={({ field }) => (
                <Field>
                  <FieldLabel>灯光与色彩</FieldLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </Field>
              )}
            />
            <FormField
              control={form.control}
              name={`shots.${index}.audioDirection`}
              render={({ field }) => (
                <Field>
                  <FieldLabel>声音</FieldLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                </Field>
              )}
            />
            {(["subjectAnchors", "continuityContract", "acceptanceCriteria"] as const).map((name) => (
              <FormField
                key={name}
                control={form.control}
                name={`shots.${index}.${name}`}
                render={({ field }) => (
                  <Field>
                    <FieldLabel>
                      {name === "subjectAnchors"
                        ? "主体锚点"
                        : name === "continuityContract"
                          ? "连续性约束"
                          : "验收标准"}
                      （每行一项）
                    </FieldLabel>
                    <FormControl>
                      <Textarea {...field} rows={2} />
                    </FormControl>
                  </Field>
                )}
              />
            ))}
          </article>
        ))}
        <Button type="submit" variant="outline" className="w-full" disabled={disabled || form.formState.isSubmitting}>
          <SaveIcon className="mr-2 size-4" />
          保存新分镜版本
        </Button>
      </form>
    </Form>
  );
}
