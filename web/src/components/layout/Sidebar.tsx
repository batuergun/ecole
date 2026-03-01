import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Project } from "@/lib/api";
import { Settings, Plus, LogOut, Activity, MessageSquare } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

function getStepProgress(status: string): {
  completed: number;
  inProgress: boolean;
} {
  switch (status) {
    case "processing":
      return { completed: 1, inProgress: true };
    case "dataset_ready":
      return { completed: 2, inProgress: false };
    case "training":
      return { completed: 2, inProgress: true };
    case "trained":
      return { completed: 3, inProgress: false };
    case "benchmarked":
      return { completed: 4, inProgress: false };
    default:
      return { completed: 0, inProgress: false };
  }
}

export function Sidebar() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const activeProjectId = location.pathname.match(
    /\/projects\/([^/]+)/
  )?.[1];

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    refetchInterval: 10000,
  });

  return (
    <aside className="flex w-56 flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-border px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="font-mono text-lg font-bold tracking-tighter text-foreground">
            ecole
          </span>
          <span className="inline-block h-2 w-2 bg-ecole-orange" />
        </Link>
      </div>

      {/* Models */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
            Models
          </span>
          <Link to="/projects/new">
            <button
              type="button"
              className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-ecole-orange transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {projects && projects.length > 0 ? (
            <div className="space-y-0.5">
              {projects.map((project: Project) => {
                const isActive = activeProjectId === project.id;
                const progress = getStepProgress(project.status);

                return (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className={`block px-3 py-2.5 transition-colors border-l-2 ${
                      isActive
                        ? "border-ecole-orange bg-secondary"
                        : "border-transparent hover:bg-secondary/50"
                    }`}
                  >
                    <span
                      className={`text-sm font-mono truncate block ${
                        isActive
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      {project.name}
                    </span>
                    {/* Pipeline progress — 4 segments for the 4 steps */}
                    <div className="flex gap-0.5 mt-1.5">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 transition-colors ${
                            i < progress.completed
                              ? "bg-foreground/25"
                              : i === progress.completed && progress.inProgress
                                ? "bg-ecole-orange animate-pulse"
                                : "bg-border"
                          }`}
                        />
                      ))}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : projects?.length === 0 ? (
            <div className="px-3 py-4">
              <p className="text-xs text-muted-foreground">No models yet</p>
              <Link
                to="/projects/new"
                className="mt-2 inline-flex text-xs text-ecole-orange hover:underline font-mono"
              >
                Create your first model
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      {/* Bottom */}
      <div className="border-t border-border">
        <Link
          to="/chats"
          className={`flex items-center gap-3 mx-2 px-3 py-2.5 text-sm font-medium transition-colors ${
            location.pathname === "/chats"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Chats
        </Link>
        <Link
          to="/jobs"
          className={`flex items-center gap-3 mx-2 px-3 py-2.5 text-sm font-medium transition-colors ${
            location.pathname === "/jobs"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          <Activity className="h-4 w-4" />
          Jobs
        </Link>
        <Link
          to="/settings"
          className={`flex items-center gap-3 mx-2 px-3 py-2.5 text-sm font-medium transition-colors ${
            location.pathname === "/settings"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>

        {user && (
          <div className="flex items-center justify-between px-5 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {user.email}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="shrink-0 h-7 w-7 p-0"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        <div className="px-5 py-1 pb-3 text-[10px] text-muted-foreground/50 font-mono">
          v0.1.0
        </div>
      </div>
    </aside>
  );
}
