import { createBrowserRouter } from "react-router-dom";
import { Shell } from "@/components/layout/Shell";
import Dashboard from "@/pages/Dashboard";
import NewProject from "@/pages/NewProject";
import ProjectDetail from "@/pages/ProjectDetail";
import Settings from "@/pages/Settings";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "projects/new", element: <NewProject /> },
      { path: "projects/:id", element: <ProjectDetail /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);
