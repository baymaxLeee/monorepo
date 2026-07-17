import { useParams } from "react-router-dom";
import { Chat } from "./Chat";

export function Component() {
  const { id } = useParams<{ id: string }>();
  return <Chat key={id} />;
}
