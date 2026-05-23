import { Link } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "@packages/components";
import { defaultAppPath, PROFILE_PATH } from "../../registry";
import { usePlatformStore } from "@packages/runtime";

export function HomePage() {
  const user = usePlatformStore((state) => state.user);

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>Platform</PageTitle>
          <PageDescription>
            {user ? `${user.displayName}，欢迎回来` : "欢迎使用 Platform"}
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button asChild>
            <Link to={defaultAppPath}>进入应用</Link>
          </Button>
        </PageActions>
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>应用入口</CardTitle>
            <CardDescription>打开默认业务应用</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link to={defaultAppPath}>智能体</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>个人资料</CardTitle>
            <CardDescription>查看当前登录用户信息</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link to={PROFILE_PATH}>打开资料页</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}

export default HomePage;
