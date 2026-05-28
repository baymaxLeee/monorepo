import { Navigate, type RouteObject } from "react-router-dom";
import { ChatLayout } from "../pages/ChatLayout";
import { ChatRoomPage } from "../pages/ChatRoomPage";
import { ConversationListPage } from "../pages/ConversationListPage";

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
      { path: "conversations/:id", element: <ChatRoomPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/404" replace /> },
];
