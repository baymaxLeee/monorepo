import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { login, register, type AuthSession } from "@packages/auth-client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldLabel,
  FieldGroup,
  Form,
  FormControl,
  FormField,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@packages/components";

type Mode = "login" | "register";

const authSchema = z.object({
  account: z.string().min(1, "请输入账号").max(64, "账号最多 64 位"),
  email: z.string().email("请输入有效邮箱").optional().or(z.literal("")),
  password: z.string().min(6, "密码至少 6 位"),
  displayName: z.string().optional(),
});

type AuthValues = z.infer<typeof authSchema>;

type AuthPageProps = {
  onAuthenticated: (session: AuthSession) => void;
};

export function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<Mode>("login");

  const form = useForm<AuthValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { account: "", email: "", password: "", displayName: "" },
  });

  useEffect(() => {
    form.clearErrors();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps -- form ref is unstable

  async function onSubmit(values: AuthValues) {
    if (mode === "register" && !values.displayName?.trim()) {
      form.setError("displayName", { message: "请输入显示名称" });
      return;
    }
    try {
      const session =
        mode === "login"
          ? await login({ account: values.account, password: values.password })
          : await register({
              account: values.account,
              email: values.email || undefined,
              password: values.password,
              displayName: values.displayName!.trim(),
            });
      toast.success(mode === "login" ? "登录成功" : "注册成功");
      onAuthenticated(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      toast.error(message);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{mode === "login" ? "登录" : "注册账号"}</CardTitle>
          <CardDescription>Platform 账号</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">登录</TabsTrigger>
              <TabsTrigger value="register">注册</TabsTrigger>
            </TabsList>
            <TabsContent value="login" className="mt-4">
              <AuthForm
                form={form}
                mode="login"
                onSubmit={onSubmit}
              />
            </TabsContent>
            <TabsContent value="register" className="mt-4">
              <AuthForm
                form={form}
                mode="register"
                onSubmit={onSubmit}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function AuthForm({
  form,
  mode,
  onSubmit,
}: {
  form: UseFormReturn<AuthValues>;
  mode: Mode;
  onSubmit: (values: AuthValues) => Promise<void>;
}) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FieldGroup>
          {mode === "register" ? (
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="displayName">显示名称</FieldLabel>
                  <FormControl>
                    <Input id="displayName" autoComplete="name" {...field} />
                  </FormControl>
                  <FieldError errors={[form.formState.errors.displayName]} />
                </Field>
              )}
            />
          ) : null}
          <FormField
            control={form.control}
            name="account"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="account">账号</FieldLabel>
                <FormControl>
                  <Input
                    id="account"
                    autoComplete="username"
                    {...field}
                  />
                </FormControl>
                <FieldError errors={[form.formState.errors.account]} />
              </Field>
            )}
          />
          {mode === "register" ? (
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="email">邮箱</FieldLabel>
                  <FormControl>
                    <Input id="email" type="email" autoComplete="email" {...field} />
                  </FormControl>
                  <FieldError errors={[form.formState.errors.email]} />
                </Field>
              )}
            />
          ) : null}
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <FormControl>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    {...field}
                  />
                </FormControl>
                <FieldError errors={[form.formState.errors.password]} />
              </Field>
            )}
          />
          <Button
            type="submit"
            className="w-full"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting
              ? "处理中…"
              : mode === "login"
                ? "登录"
                : "创建账号"}
          </Button>
        </FieldGroup>
      </form>
    </Form>
  );
}
