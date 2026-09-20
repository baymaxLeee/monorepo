import { ChatSession } from "@repo/chat";
import { useParams } from "react-router-dom";
export function Chat() {
  const { id } = useParams<{ id: string }>();
  return id ? <ChatSession key={id} conversationId={id} /> : null;
}
