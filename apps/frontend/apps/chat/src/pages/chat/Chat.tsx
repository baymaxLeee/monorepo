import { ChatSession, type ExternalChatRequest } from "@repo/ai-elements/conversation";
import { buttonVariants } from "@repo/design-system";
import { cn } from "@repo/shared";
import { SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
export function Chat() {
  const { id } = useParams<{ id: string }>();
  return id ? <CloudChat key={id} id={id} /> : null;
}
function CloudChat({ id }: { id: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [request] = useState<ExternalChatRequest | undefined>(location.state?.externalRequest);
  useEffect(() => {
    if (location.state?.externalRequest)
      void navigate(location.pathname, { replace: true, state: { refreshConversationHistory: true } });
  }, [location.pathname, location.state, navigate]);
  return id ? (
    <div className="relative h-full min-h-0">
      <Link
        to={`/platform/chat/conversations/${id}/agent-ui`}
        className={cn(
          buttonVariants({ size: "sm", variant: "outline" }),
          "absolute right-3 top-3 z-20 gap-2 bg-background/90 backdrop-blur",
        )}
      >
        <SparklesIcon className="size-4" aria-hidden="true" />
        Agent UI
      </Link>
      <ChatSession key={id} conversationId={id} externalRequest={request} />
    </div>
  ) : null;
}
