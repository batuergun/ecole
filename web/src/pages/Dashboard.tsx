import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Project } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const statusColors: Record<string, string> = {
  created: "bg-secondary text-secondary-foreground",
  processing: "bg-ecole-orange text-white",
  dataset_ready: "bg-primary text-primary-foreground",
  training: "bg-ecole-orange text-white",
  trained: "bg-primary text-primary-foreground",
  benchmarked: "bg-primary text-primary-foreground",
};

export default function Dashboard() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-mono font-bold">Your Projects</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fine-tune and distill models for your use case
          </p>
        </div>
        <Link to="/projects/new">
          <Button className="bg-ecole-orange text-white hover:bg-ecole-orange-light">
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-5 w-32 bg-muted" />
                <div className="mt-2 h-4 w-48 bg-muted" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project: Project) => (
            <Link key={project.id} to={`/projects/${project.id}`}>
              <Card className="transition-colors hover:border-ecole-orange cursor-pointer">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-mono">
                      {project.name}
                    </CardTitle>
                    <Badge className={statusColors[project.status] || ""}>
                      {project.status.replace("_", " ")}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {project.description || "No description"}
                  </CardDescription>
                  <p className="mt-2 text-xs text-muted-foreground font-mono">
                    {new Date(project.created_at).toLocaleDateString()}
                  </p>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center p-12">
          <p className="mb-4 text-muted-foreground">No projects yet</p>
          <Link to="/projects/new">
            <Button className="bg-ecole-orange text-white hover:bg-ecole-orange-light">
              Create your first project
            </Button>
          </Link>
        </Card>
      )}
    </div>
  );
}
