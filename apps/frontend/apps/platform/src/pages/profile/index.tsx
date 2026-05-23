import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Page,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "@packages/components";
import { usePlatformStore } from "@packages/runtime";

function getUserInitials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "U";
}

export function ProfilePage() {
  const user = usePlatformStore((state) => state.user);

  if (!user) return null;

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>个人资料</PageTitle>
          <PageDescription>当前登录账号的基础信息</PageDescription>
        </PageHeaderContent>
      </PageHeader>
      <Card className="max-w-2xl">
        <CardHeader className="flex-row items-center gap-4">
          <Avatar className="size-12">
            <AvatarImage src={user.avatarUrl} alt={user.displayName} />
            <AvatarFallback>{getUserInitials(user.displayName)}</AvatarFallback>
          </Avatar>
          <div>
            <CardTitle>{user.displayName}</CardTitle>
            <CardDescription>{user.email || user.account}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="profile-account">账号</FieldLabel>
              <Input id="profile-account" value={user.account} readOnly />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-email">邮箱</FieldLabel>
              <Input id="profile-email" value={user.email} readOnly />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-name">显示名称</FieldLabel>
              <Input id="profile-name" value={user.displayName} readOnly />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-timezone">时区</FieldLabel>
              <Input id="profile-timezone" value={user.timezone} readOnly />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </Page>
  );
}

export default ProfilePage;
