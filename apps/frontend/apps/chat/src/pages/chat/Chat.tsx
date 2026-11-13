import { ChatSession } from "@repo/ai-elements/conversation";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
export function Chat() {
  const { id } = useParams<{ id: string }>();
  return id ? <CloudChat key={id} id={id} /> : null;
}
function CloudChat({ id }: { id: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [request] = useState<{ id: string; text: string } | undefined>(location.state?.externalRequest);
  useEffect(() => {
    if (location.state?.externalRequest)
      void navigate(location.pathname, { replace: true, state: { refreshConversationHistory: true } });
  }, [location.pathname, location.state, navigate]);
  return id ? <ChatSession key={id} conversationId={id} externalRequest={request} /> : null;
}
