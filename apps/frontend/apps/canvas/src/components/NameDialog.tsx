import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Form,
  FormField,
  FormItem,
  FormControl,
  FormMessage,
  Input,
} from "@repo/design-system";
import { useForm } from "react-hook-form";

export function NameDialog({
  title,
  open,
  onClose,
  onSubmit,
  initialName = "",
}: {
  title: string;
  initialName?: string;
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const form = useForm({ defaultValues: { name: initialName } });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async ({ name }) => {
              try {
                await onSubmit(name.trim());
                form.reset();
                onClose();
              } catch {
                /* The API layer displays the error; preserve the draft. */
              }
            })}
          >
            <FormField
              control={form.control}
              name="name"
              rules={{
                required: "请输入名称",
                maxLength: { value: 50, message: "最多 50 字" },
                validate: (v) => v.trim().length > 0 || "请输入名称",
              }}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input {...field} aria-label="名称" placeholder="输入名称" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {initialName ? "保存" : "创建"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
