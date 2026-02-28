import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTab } from "@/components/tabs/DataTab";
import { DatasetTab } from "@/components/tabs/DatasetTab";
import { TrainingTab } from "@/components/tabs/TrainingTab";
import { BenchmarkTab } from "@/components/tabs/BenchmarkTab";
import { Trash2 } from "lucide-react";

const STATUS_FLOW = ["created", "processing", "dataset_ready", "training", "trained", "benchmarked"];

const statusLabels: Record<string, string> = {
  created: "Created",
  processing: "Processing",
  dataset_ready: "Dataset Ready",
  training: "Training",
  trained: "Trained",
  benchmarked: "Benchmarked",
};

function StatusFlow({ current }: { current: string }) {
  const currentIdx = STATUS_FLOW.indexOf(current);

  return (
    <div className="flex items-center gap-1">
      {STATUS_FLOW.map((status, i) => {
        const isDone = i < currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <div key={status} className="flex items-center gap-1">
            <div
              className={`h-1.5 w-8 transition-colors ${
                isDone
                  ? "bg-foreground"
                  : isCurrent
                    ? "bg-ecole-orange"
                    : "bg-border"
              }`}
              title={statusLabels[status]}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id!),
    enabled: !!id,
    refetchInterval: 10000,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteProject(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted");
      navigate("/");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete project");
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse bg-muted" />
        <div className="h-4 w-64 animate-pulse bg-muted" />
        <div className="h-1.5 w-56 animate-pulse bg-muted mt-2" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground mb-4">Project not found</p>
        <Button variant="outline" onClick={() => navigate("/")}>
          Back to Projects
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-mono font-bold">{project.name}</h2>
            <Badge variant="outline">{statusLabels[project.status] || project.status}</Badge>
            {project.context?.llm_provider && project.context.llm_provider !== "anthropic" && (
              <Badge variant="secondary" className="text-xs">
                {project.context.llm_provider === "mistral" ? "Mistral" : project.context.llm_provider}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Delete this project? This cannot be undone.")) {
                deleteMutation.mutate();
              }
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        {project.description && (
          <p className="mt-1 text-sm text-muted-foreground">
            {project.description}
          </p>
        )}
        <div className="mt-3">
          <StatusFlow current={project.status} />
        </div>
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
