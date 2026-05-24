import { useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useShallow } from "zustand/react/shallow";
import { z } from "zod";
import { checkAccountAvailability, register } from "@packages/api";
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
  toast,
} from "@packages/components";
import { usePlatformStore } from "@packages/runtime";

const registerSchema = z.object({
  name: z
    .string()
    .min(1, "请输入名称")
    .max(64, "名称最多 64 位")
    .regex(/^[^\s@]+$/, "名称不能包含空格或 @"),
  password: z.string().min(6, "密码至少 6 位"),
  avatar: z.string().url("请输入有效头像 URL").optional().or(z.literal("")),
  email: z.string().email("请输入有效邮箱"),
  phoneNumber: z
    .string()
    .regex(/^[0-9+\-\s()]{6,32}$/, "请输入有效手机号")
    .optional()
    .or(z.literal("")),
});

type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const { user, setUser } = usePlatformStore(
    useShallow((state) => ({
      user: state.user,
      setUser: state.setUser,
    })),
  );
  const lastCheckedName = useRef<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      password: "",
      avatar: "",
      email: "",
      phoneNumber: "",
    },
    mode: "onBlur",
  });

  if (user) {
    return <Navigate to="/platform/home" replace />;
  }

  async function validateNameAvailable(name: string) {
    const normalized = name.trim().toLowerCase();
    const parsedName = registerSchema.shape.name.safeParse(name);
    if (!parsedName.success) {
      form.setError("name", {
        message: parsedName.error.issues[0]?.message ?? "名称格式不正确",
      });
      return false;
    }

    try {
      const result = await checkAccountAvailability(normalized);
      lastCheckedName.current = normalized;
      if (!result.available) {
        form.setError("name", { message: "名称已被使用" });
        return false;
      }
      form.clearErrors("name");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "名称校验失败";
      form.setError("name", { message });
      return false;
    }
  }

  async function onSubmit(values: RegisterValues) {
    const normalizedName = values.name.trim().toLowerCase();
    if (lastCheckedName.current !== normalizedName) {
      const available = await validateNameAvailable(values.name);
      if (!available) return;
    }

    try {
      const session = await register({
        account: normalizedName,
        password: values.password,
        displayName: values.name.trim(),
        avatarUrl: values.avatar || undefined,
        email: values.email,
        phoneNumber: values.phoneNumber || undefined,
      });
      setUser(session.user);
      toast.success("注册成功");
      navigate("/platform/home", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "注册失败";
      toast.error(message);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>注册账号</CardTitle>
          <CardDescription>创建 Platform 账号</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <FieldGroup>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="name">Name</FieldLabel>
                      <FormControl>
                        <Input
                          id="name"
                          autoComplete="username"
                          {...field}
                          onBlur={(event) => {
                            field.onBlur();
                            void validateNameAvailable(event.target.value);
                          }}
                          onChange={(event) => {
                            lastCheckedName.current = null;
                            field.onChange(event);
                          }}
                        />
                      </FormControl>
                      <FieldError errors={[form.formState.errors.name]} />
                    </Field>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <FormControl>
                        <Input
                          id="password"
                          type="password"
                          autoComplete="new-password"
                          {...field}
                        />
                      </FormControl>
                      <FieldError errors={[form.formState.errors.password]} />
                    </Field>
                  )}
                />
                <FormField
                  control={form.control}
                  name="avatar"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="avatar">Avatar</FieldLabel>
                      <FormControl>
                        <Input
                          id="avatar"
                          type="url"
                          placeholder="https://example.com/avatar.png"
                          {...field}
                        />
                      </FormControl>
                      <FieldError errors={[form.formState.errors.avatar]} />
                    </Field>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <FormControl>
                        <Input
                          id="email"
                          type="email"
                          autoComplete="email"
                          {...field}
                        />
                      </FormControl>
                      <FieldError errors={[form.formState.errors.email]} />
                    </Field>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phoneNumber"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="phoneNumber">
                        Phone Number
                      </FieldLabel>
                      <FormControl>
                        <Input
                          id="phoneNumber"
                          type="tel"
                          autoComplete="tel"
                          {...field}
                        />
                      </FormControl>
                      <FieldError
                        errors={[form.formState.errors.phoneNumber]}
                      />
                    </Field>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? "创建中…" : "创建账号"}
                </Button>
                <div className="text-center text-sm text-muted-foreground">
                  已有账号？
                  <Link
                    to="/login"
                    className="ml-1 font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    去登录
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

export default RegisterPage;
