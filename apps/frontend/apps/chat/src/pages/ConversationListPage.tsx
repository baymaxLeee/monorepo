import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InlineCode,
  Muted,
  Page,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "components";
import { MessageCircleIcon } from "lucide-react";

export function ConversationListPage() {
  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>对话</PageTitle>
          <PageDescription>
            接入 OpenAI 兼容大模型；数据来自{" "}
            <InlineCode>GET /api/chat-server/conversations</InlineCode>
          </PageDescription>
        </PageHeaderContent>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircleIcon aria-hidden="true" className="size-5" />
            开启第一个会话
          </CardTitle>
          <CardDescription>
            点击左侧「新建」创建会话，发消息后即会通过 SSE 流式渲染助手回复。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            后端服务：<InlineCode>chat svc :8009</InlineCode>，外部入口经
            gateway 暴露为 <InlineCode>/api/chat-server/*</InlineCode>。
          </p>
          <p>
            未配置 <InlineCode>OPENAI_API_KEY</InlineCode>{" "}
            时，服务会自动切到内置 echo mock，保证 demo 始终可用。
          </p>
          <Muted>
            正式接入：在{" "}
            <InlineCode>apps/backend/services/chat/.env</InlineCode> 中设置{" "}
            <InlineCode>OPENAI_BASE_URL</InlineCode> /{" "}
            <InlineCode>OPENAI_API_KEY</InlineCode> /{" "}
            <InlineCode>OPENAI_MODEL</InlineCode>。
          </Muted>
        </CardContent>
      </Card>
    </Page>
  );
}
