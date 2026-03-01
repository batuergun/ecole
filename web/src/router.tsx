import { createBrowserRouter } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import { AuthGuard } from "@/components/AuthGuard";
import Dashboard from "@/pages/Dashboard";
import NewProject from "@/pages/NewProject";
import ProjectDetail from "@/pages/ProjectDetail";
import Settings from "@/pages/Settings";
import Jobs from "@/pages/Jobs";
import Chat from "@/pages/Chat";
import Chats from "@/pages/Chats";
import Login from "@/pages/Login";

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/",
    element: (
      <AuthGuard>
        <Shell />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: "projects/new", element: <NewProject /> },
      { path: "projects/:id", element: <ProjectDetail /> },
      { path: "projects/:id/chat", element: <Chat /> },
      { path: "projects/:id/chat/:sessionId", element: <Chat /> },
      { path: "chats", element: <Chats /> },
      { path: "jobs", element: <Jobs /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);
