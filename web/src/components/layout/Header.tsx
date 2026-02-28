import { useLocation } from "react-router-dom";

const titleMap: Record<string, string> = {
  "/": "Projects",
  "/projects/new": "New Project",
  "/settings": "Settings",
};

export function Header() {
  const location = useLocation();
  const title =
    titleMap[location.pathname] ||
    (location.pathname.startsWith("/projects/") ? "Project" : "");

  return (
    <header className="flex h-14 items-center border-b border-border px-6">
      <h1 className="text-sm font-mono font-medium text-foreground uppercase tracking-widest">
        {title}
      </h1>
    </header>
  );
}
