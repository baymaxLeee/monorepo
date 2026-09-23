import { zodResolver } from "@hookform/resolvers/zod";
import { login } from "@repo/api";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  toast,
} from "@repo/design-system";
import { setUser as setObservabilityUser } from "@repo/observability";
import { usePlatformStore } from "@repo/runtime";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { landingPath } from "../../onboarding";

const loginSchema = z.object({
  account: z.string().min(1, "请输入账号").max(64, "账号最多 64 位"),
  password: z.string().min(6, "密码至少 6 位"),
});

type LoginValues = z.infer<typeof loginSchema>;

function LoginPage() {
  const navigate = useNavigate();
  const setUser = usePlatformStore((state) => state.setUser);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema as never),
    defaultValues: { account: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    try {
      const session = await login(values);
      setUser(session.user);
      setObservabilityUser({
        userId: session.user.id,
        username: session.user.displayName,
      });
      toast.add({ type: "success", title: "登录成功" });
      navigate(landingPath(session.user), { replace: true });
    } catch {}
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>Platform 账号</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <Controller
                control={form.control}
                name="account"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="account">账号</FieldLabel>
                    <Input id="account" aria-invalid={fieldState.invalid} autoComplete="username" {...field} />
                    <FieldError errors={[form.formState.errors.account]} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="password">密码</FieldLabel>
                    <Input
                      id="password"
                      aria-invalid={fieldState.invalid}
                      type="password"
                      autoComplete="current-password"
                      {...field}
                    />
                    <FieldError errors={[form.formState.errors.password]} />
                  </Field>
                )}
              />
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "登录中…" : "登录"}
              </Button>
              <div className="text-center text-sm text-muted-foreground">
                没有账号？
                <Link to="/register" className="ml-1 font-medium text-foreground underline-offset-4 hover:underline">
                  创建账号
                </Link>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export { LoginPage as Component };
