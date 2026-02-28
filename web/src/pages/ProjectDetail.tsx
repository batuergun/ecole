import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { DataTab } from "@/components/tabs/DataTab";
import { DatasetTab } from "@/components/tabs/DatasetTab";
import { TrainingTab } from "@/components/tabs/TrainingTab";
import { BenchmarkTab } from "@/components/tabs/BenchmarkTab";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse bg-muted" />
        <div className="h-4 w-64 animate-pulse bg-muted" />
      </div>
    );
  }

  if (!project) {
    return <p className="text-muted-foreground">Project not found</p>;
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-mono font-bold">{project.name}</h2>
          <Badge variant="outline">{project.status.replace("_", " ")}</Badge>
        </div>
        {project.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {project.description}
          </p>
        )}
      </div>

      <Tabs defaultValue="data">
        <TabsList className="border border-border bg-transparent">
          <TabsTrigger value="data" className="font-mono text-xs uppercase data-[state=active]:bg-secondary">
            Data
          </TabsTrigger>
          <TabsTrigger value="dataset" className="font-mono text-xs uppercase data-[state=active]:bg-secondary">
            Dataset
          </TabsTrigger>
          <TabsTrigger value="training" className="font-mono text-xs uppercase data-[state=active]:bg-secondary">
            Training
          </TabsTrigger>
          <TabsTrigger value="benchmark" className="font-mono text-xs uppercase data-[state=active]:bg-secondary">
            Benchmark
          </TabsTrigger>
        </TabsList>

        <TabsContent value="data" className="mt-4">
          <DataTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="dataset" className="mt-4">
          <DatasetTab projectId={project.id} projectStatus={project.status} />
        </TabsContent>
        <TabsContent value="training" className="mt-4">
          <TrainingTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="benchmark" className="mt-4">
          <BenchmarkTab projectId={project.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
