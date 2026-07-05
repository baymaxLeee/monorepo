import { Navigate, type RouteObject, useParams } from "react-router-dom";
import { Chat } from "../pages/Chat";
import { ChatLayout } from "../pages/ChatLayout";
import { ConversationListPage } from "../pages/ConversationListPage";

function ConversationChatRoute() {
  const { id } = useParams<{ id: string }>();
  return <Chat key={id} />;
}

/**
 * Mounted by platform at `/platform/chat/*`.
 * chat owns its local rail (conversation list) + outlet (chat room).
 */
export const routes: RouteObject[] = [
  {
    element: <ChatLayout />,
    children: [
      { index: true, element: <Navigate to="conversations" replace /> },
      { path: "conversations", element: <ConversationListPage /> },
      { path: "conversations/:id", element: <ConversationChatRoute /> },
    ],
  },
  { path: "*", element: <Navigate to="/404" replace /> },
];
