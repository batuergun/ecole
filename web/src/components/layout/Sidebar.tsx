import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Settings, Plus, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "Projects", href: "/", icon: LayoutDashboard },
  { label: "New Project", href: "/projects/new", icon: Plus },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const location = useLocation();
  const { user, logout } = useAuth();

  return (
    <aside className="flex w-56 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="font-mono text-lg font-bold tracking-tighter text-foreground">
            ecole
          </span>
          <span className="inline-block h-2 w-2 bg-ecole-orange" />
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              className={`flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        {user && (
          <div className="flex items-center justify-between px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
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
        <div className="px-3 py-1 text-xs text-muted-foreground font-mono">
          v0.1.0
        </div>
      </div>
    </aside>
  );
}
