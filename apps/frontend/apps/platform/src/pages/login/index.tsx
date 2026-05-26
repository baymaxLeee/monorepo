import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useShallow } from "zustand/react/shallow";
import { z } from "zod";
import { bootstrapSession, login } from "api";
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
  Form,
  FormControl,
  FormField,
  Input,
  Muted,
  Skeleton,
  toast,
} from "components";
import {
  clearUser as clearObservabilityUser,
  setUser as setObservabilityUser,
} from "observability";
import { usePlatformStore } from "runtime";

const loginSchema = z.object({
  account: z.string().min(1, "请输入账号").max(64, "账号最多 64 位"),
  password: z.string().min(6, "密码至少 6 位"),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { user, setUser } = usePlatformStore(
    useShallow((state) => ({
      user: state.user,
      setUser: state.setUser,
    })),
  );
  const [ready, setReady] = useState(false);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { account: "", password: "" },
  });

  useEffect(() => {
    let alive = true;
    bootstrapSession()
      .then((sessionUser) => {
        if (!alive) return;
        setUser(sessionUser);
        if (sessionUser) {
          setObservabilityUser({
            userId: sessionUser.id,
            username: sessionUser.displayName,
          });
        } else {
          clearObservabilityUser();
        }
      })
      .catch(() => {
        if (alive) {
          setUser(null);
          clearObservabilityUser();
        }
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [setUser]);

  if (!ready) {
    return <LoginLoadingCard />;
  }

  if (user) {
    return <Navigate to="/platform/home" replace />;
  }

  async function onSubmit(values: LoginValues) {
    try {
      const session = await login(values);
      setUser(session.user);
      setObservabilityUser({
        userId: session.user.id,
        username: session.user.displayName,
      });
      toast.success("登录成功");
      navigate("/platform/home", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "登录失败";
      toast.error(message);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>Platform 账号</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <FieldGroup>
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
                          autoComplete="current-password"
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
                  {form.formState.isSubmitting ? "登录中…" : "登录"}
                </Button>
                <div className="text-center text-sm text-muted-foreground">
                  没有账号？
                  <Link
                    to="/register"
                    className="ml-1 font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    创建账号
                  </Link>
                </div>
              </FieldGroup>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

export function LoginLoadingCard() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Muted className="text-center text-xs">正在检查登录状态…</Muted>
        </CardContent>
      </Card>
    </div>
  );
}

export default LoginPage;
