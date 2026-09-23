import { zodResolver } from "@hookform/resolvers/zod";
import { checkAccountAvailability, fetchPublicWorkspaces, type WorkspaceSummary, register } from "@repo/api";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@repo/design-system";
import { setUser as setObservabilityUser } from "@repo/observability";
import { usePlatformStore } from "@repo/runtime";
import { getErrorMessage } from "@repo/shared";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { landingPath } from "../../onboarding";

const registerSchema = z.object({
  name: z
    .string()
    .min(1, "请输入名称")
    .max(64, "名称最多 64 位")
    .regex(/^[^\s@]+$/, "名称不能包含空格或 @"),
  password: z.string().min(6, "密码至少 6 位"),
  workspaceId: z.string().optional(),
  avatar: z.string().url("请输入有效头像 URL").optional().or(z.literal("")),
  email: z.string().email("请输入有效邮箱"),
  phoneNumber: z
    .string()
    .regex(/^[0-9+\-\s()]{6,32}$/, "请输入有效手机号")
    .optional()
    .or(z.literal("")),
});

type RegisterValues = z.infer<typeof registerSchema>;

function RegisterPage() {
  const navigate = useNavigate();
  const setUser = usePlatformStore((state) => state.setUser);
  const lastCheckedName = useRef<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema as never),
    defaultValues: {
      name: "",
      password: "",
      workspaceId: "guest-only",
      avatar: "",
      email: "",
      phoneNumber: "",
    },
    mode: "onBlur",
  });

  useEffect(() => {
    let alive = true;
    fetchPublicWorkspaces({ skipErrorNotify: true })
      .then((list) => {
        if (alive) {
          setWorkspaces(list);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setWorkspacesError(getErrorMessage(err, "无法加载工作空间列表"));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

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
      form.setError("name", { message: getErrorMessage(err, "名称校验失败") });
      return false;
    }
  }

  async function onSubmit(values: RegisterValues) {
    const normalizedName = values.name.trim().toLowerCase();
    if (lastCheckedName.current !== normalizedName) {
      const available = await validateNameAvailable(values.name);
      if (!available) {
        return;
      }
    }

    try {
      const session = await register({
        account: normalizedName,
        password: values.password,
        workspaceId: values.workspaceId === "guest-only" ? undefined : values.workspaceId,
        displayName: values.name.trim(),
        avatarUrl: values.avatar || undefined,
        email: values.email,
        phoneNumber: values.phoneNumber || undefined,
      });
      setUser(session.user);
      setObservabilityUser({
        userId: session.user.id,
        username: session.user.displayName,
      });
      toast.add({
        type: "success",
        title:
          values.workspaceId === "guest-only"
            ? "注册成功，已进入游客工作空间"
            : "注册成功，已进入游客工作空间；目标工作空间等待审批",
      });
      navigate(landingPath(session.user), { replace: true });
    } catch {}
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>注册账号</CardTitle>
          <CardDescription>创建 Platform 账号</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <FieldGroup>
              <Controller
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="name">Name</FieldLabel>
                    <Input
                      id="name"
                      aria-invalid={fieldState.invalid}
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
                    <FieldError errors={[form.formState.errors.name]} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <Input
                      id="password"
                      aria-invalid={fieldState.invalid}
                      type="password"
                      autoComplete="new-password"
                      {...field}
                    />
                    <FieldError errors={[form.formState.errors.password]} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="workspaceId"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="workspaceId">申请加入其他工作空间（可选）</FieldLabel>
                    <Select
                      name={field.name}
                      value={field.value}
                      onValueChange={(value) => value !== null && field.onChange(value)}
                    >
                      <SelectTrigger id="workspaceId" aria-invalid={fieldState.invalid} className="w-full">
                        <SelectValue placeholder={workspacesError ? "工作空间列表加载失败" : "选择目标工作空间"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="guest-only">暂不申请，直接体验</SelectItem>
                        {workspaces.map((workspace) => (
                          <SelectItem key={workspace.id} value={workspace.id}>
                            {workspace.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={[form.formState.errors.workspaceId]} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="avatar"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="avatar">Avatar</FieldLabel>
                    <Input
                      id="avatar"
                      aria-invalid={fieldState.invalid}
                      type="url"
                      placeholder="https://example.com/avatar.png"
                      {...field}
                    />
                    <FieldError errors={[form.formState.errors.avatar]} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input id="email" aria-invalid={fieldState.invalid} type="email" autoComplete="email" {...field} />
                    <FieldError errors={[form.formState.errors.email]} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="phoneNumber"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="phoneNumber">Phone Number</FieldLabel>
                    <Input
                      id="phoneNumber"
                      aria-invalid={fieldState.invalid}
                      type="tel"
                      autoComplete="tel"
                      {...field}
                    />
                    <FieldError errors={[form.formState.errors.phoneNumber]} />
                  </Field>
                )}
              />
              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "创建中…" : "创建账号"}
              </Button>
              <div className="text-center text-sm text-muted-foreground">
                已有账号？
                <Link to="/login" className="ml-1 font-medium text-foreground underline-offset-4 hover:underline">
                  去登录
                </Link>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export { RegisterPage as Component };
