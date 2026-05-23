import { Link } from "react-router-dom";
import {
  Button,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "@packages/components";
import { HOME_PATH, LOGIN_PATH } from "../../registry";
import { usePlatformStore } from "@packages/runtime";

export function NotFoundPage() {
  const user = usePlatformStore((state) => state.user);
  const target = user ? HOME_PATH : LOGIN_PATH;

  return (
    <Page className="items-center justify-center text-center">
      <PageHeader className="items-center justify-center">
        <PageHeaderContent className="items-center">
          <PageTitle>404</PageTitle>
          <PageDescription>页面不存在或已被移动</PageDescription>
        </PageHeaderContent>
      </PageHeader>
      <PageActions>
        <Button asChild>
          <Link to={target}>{user ? "返回首页" : "返回登录"}</Link>
        </Button>
      </PageActions>
    </Page>
  );
}

export default NotFoundPage;
