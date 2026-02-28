import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2">
          <span className="font-mono text-lg font-bold tracking-tighter text-foreground">
            ecole
          </span>
          <span className="inline-block h-2 w-2 bg-ecole-orange animate-pulse" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
