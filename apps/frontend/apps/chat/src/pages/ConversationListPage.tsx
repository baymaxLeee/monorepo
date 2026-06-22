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
            点击左侧「新建」创建会话，后续消息默认通过 chat agent runtime 处理。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            后端服务：<InlineCode>chat svc :8009</InlineCode>，外部入口经
            gateway 暴露为 <InlineCode>/api/chat-server/*</InlineCode>。
          </p>
          <p>
            默认发送入口会调用{" "}
            <InlineCode>
              POST /api/chat-server/conversations/:id/agents/run
            </InlineCode>
            ，由 agent 判断是否需要读取附件、调用工具并写入会话 artifact。
          </p>
          <Muted>
            模型 Provider 在 Admin「模型管理」中配置，chat-server 只在服务端读取
            已配置的 OpenAI 兼容端点。
          </Muted>
        </CardContent>
      </Card>
    </Page>
  );
}
