import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function Dashboard() {
  const navigate = useNavigate();

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  // Auto-redirect to most recent project
  useEffect(() => {
    if (!isLoading && projects && projects.length > 0) {
      navigate(`/projects/${projects[0].id}`, { replace: true });
    }
  }, [isLoading, projects, navigate]);

  // Loading or will redirect
  if (isLoading || (projects && projects.length > 0)) {
    return null;
  }

  // No projects — welcome screen
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-8rem)]">
      <div className="text-center space-y-4">
        <h2 className="text-2xl font-mono font-bold">Welcome to ecole</h2>
        <p className="text-sm text-muted-foreground">
          Fine-tune and distill models with your own data
        </p>
        <Link to="/projects/new">
          <Button className="bg-ecole-orange text-white hover:bg-ecole-orange-light">
            <Plus className="mr-2 h-4 w-4" />
            Create your first model
          </Button>
        </Link>
      </div>
    </div>
  );
}
