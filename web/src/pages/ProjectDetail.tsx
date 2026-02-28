import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type TrainingRun, type Benchmark } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTab } from "@/components/tabs/DataTab";
import { DatasetTab } from "@/components/tabs/DatasetTab";
import { TrainingTab } from "@/components/tabs/TrainingTab";
import { BenchmarkTab } from "@/components/tabs/BenchmarkTab";
import { Trash2, Check, ChevronDown, Lock, ArrowRight } from "lucide-react";

type StepId = "upload" | "dataset" | "training" | "benchmark";

const STEPS: { id: StepId; number: number; title: string }[] = [
  { id: "upload", number: 1, title: "Upload Data" },
  { id: "dataset", number: 2, title: "Generate Dataset" },
  { id: "training", number: 3, title: "Train Model" },
  { id: "benchmark", number: 4, title: "Evaluate" },
];

const LOCK_MESSAGES: Record<StepId, string> = {
  upload: "",
  dataset: "Upload data first",
  training: "Generate a dataset first",
  benchmark: "Complete a training run first",
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Set<StepId>>(new Set(["upload"]));
  const initializedRef = useRef(false);
  const stepRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id!),
    enabled: !!id,
    refetchInterval: 10000,
  });

  const { data: uploads } = useQuery({
    queryKey: ["uploads", id],
    queryFn: () => api.listUploads(id!),
    enabled: !!id,
  });

  const { data: datasetStats } = useQuery({
    queryKey: ["dataset-stats", id],
    queryFn: () => api.datasetStats(id!),
    enabled: !!id,
  });

  const { data: runs } = useQuery({
    queryKey: ["training-runs", id],
    queryFn: () => api.listTrainingRuns(id!),
    enabled: !!id,
  });

  const { data: benchmarks } = useQuery({
    queryKey: ["benchmarks", id],
    queryFn: () => api.listBenchmarks(id!),
    enabled: !!id,
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

  // Step state computation
  const isProcessing = project?.status === "processing";
  const hasUploads = (uploads?.length ?? 0) > 0;
  const hasDataset = (datasetStats?.total ?? 0) > 0;
  const hasCompletedRun =
    runs?.some((r: TrainingRun) => r.status === "completed") ?? false;
  const hasCompletedBenchmark =
    benchmarks?.some((b: Benchmark) => b.status === "completed") ?? false;

  const complete: Record<StepId, boolean> = {
    upload: hasUploads,
    dataset: hasDataset && !isProcessing,
    training: hasCompletedRun,
    benchmark: hasCompletedBenchmark,
  };

  const unlocked: Record<StepId, boolean> = {
    upload: true,
    dataset: hasUploads || hasDataset,
    training: (hasDataset && !isProcessing) || hasCompletedRun,
    benchmark: hasCompletedRun || hasCompletedBenchmark,
  };

  type State = "completed" | "current" | "upcoming" | "locked";
  const getState = (stepId: StepId): State => {
    if (!unlocked[stepId]) return "locked";
    if (complete[stepId]) return "completed";
    const first = STEPS.find((s) => unlocked[s.id] && !complete[s.id]);
    return first?.id === stepId ? "current" : "upcoming";
  };

  // Auto-expand the active step once queries resolve
  useEffect(() => {
    if (initializedRef.current) return;
    if (uploads === undefined || datasetStats === undefined || runs === undefined)
      return;

    let activeId: StepId = "upload";
    const _u = (uploads?.length ?? 0) > 0;
    const _d = (datasetStats?.total ?? 0) > 0 && !isProcessing;
    const _r =
      runs?.some((r: TrainingRun) => r.status === "completed") ?? false;

    if (_r) activeId = "benchmark";
    else if (_d) activeId = "training";
    else if (_u) activeId = "dataset";

    setExpanded(new Set([activeId]));
    initializedRef.current = true;
  }, [uploads, datasetStats, runs, isProcessing]);

  const getSummary = (stepId: StepId): string | null => {
    switch (stepId) {
      case "upload":
        return uploads?.length
          ? `${uploads.length} file${uploads.length !== 1 ? "s" : ""}`
          : null;
      case "dataset":
        if (!datasetStats?.total) return null;
        return `${datasetStats.total} pairs (${datasetStats.train_count} train / ${datasetStats.eval_count} eval)`;
      case "training": {
        const done = runs?.find(
          (r: TrainingRun) => r.status === "completed"
        );
        if (!done) return null;
        const name = done.base_model.split("/").pop();
        return `${name}${done.train_loss != null ? ` — Loss: ${done.train_loss.toFixed(4)}` : ""}`;
      }
      case "benchmark": {
        const ft = benchmarks?.find(
          (b: Benchmark) =>
            b.model_type === "finetuned" && b.status === "completed"
        );
        if (!ft?.avg_score) return null;
        return `Score: ${ft.avg_score.toFixed(2)}/5`;
      }
    }
  };

  const toggleStep = (stepId: StepId) => {
    if (!unlocked[stepId]) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const goToNext = (from: StepId) => {
    const idx = STEPS.findIndex((s) => s.id === from);
    const next = STEPS[idx + 1];
    if (!next || !unlocked[next.id]) return;
    setExpanded((prev) => {
      const n = new Set(prev);
      n.delete(from);
      n.add(next.id);
      return n;
    });
    setTimeout(() => {
      stepRefs.current[next.id]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse bg-muted" />
        <div className="h-4 w-64 animate-pulse bg-muted" />
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
      {/* Project header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-mono font-bold">{project.name}</h2>
            {project.context?.llm_provider &&
              project.context.llm_provider !== "anthropic" && (
                <Badge variant="secondary" className="text-xs">
                  {project.context.llm_provider === "mistral"
                    ? "Mistral"
                    : project.context.llm_provider}
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
      </div>

      {/* Stepper */}
      <div>
        {STEPS.map((step, idx) => {
          const state = getState(step.id);
          const isExp = expanded.has(step.id);
          const summary = getSummary(step.id);
          const isLast = idx === STEPS.length - 1;
          const nextStep = STEPS[idx + 1];
          const showContinue =
            complete[step.id] && nextStep && unlocked[nextStep.id] && isExp;

          return (
            <div
              key={step.id}
              className="flex"
              ref={(el) => {
                stepRefs.current[step.id] = el;
              }}
            >
              {/* Rail: circle + connector */}
              <div className="flex flex-col items-center mr-4">
                <div
                  className={`flex items-center justify-center h-7 w-7 shrink-0 text-xs font-mono font-bold transition-colors ${
                    state === "completed"
                      ? "bg-foreground text-background"
                      : state === "current"
                        ? "bg-ecole-orange text-white"
                        : "border border-border text-muted-foreground"
                  }`}
                >
                  {state === "completed" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : state === "locked" ? (
                    <Lock className="h-3 w-3" />
                  ) : (
                    step.number
                  )}
                </div>
                {!isLast && (
                  <div
                    className={`flex-1 w-px min-h-[16px] ${
                      complete[step.id] ? "bg-foreground/20" : "bg-border"
                    }`}
                  />
                )}
              </div>

              {/* Step content */}
              <div className={`flex-1 min-w-0 ${isLast ? "" : "pb-6"}`}>
                {/* Header row */}
                <button
                  onClick={() => toggleStep(step.id)}
                  disabled={state === "locked"}
                  className={`flex items-center gap-2 w-full text-left py-0.5 ${
                    state === "locked" ? "cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  <span
                    className={`text-sm font-mono font-medium ${
                      state === "locked" ? "text-muted-foreground/50" : ""
                    }`}
                  >
                    {step.title}
                  </span>

                  {summary && state !== "locked" && (
                    <span className="text-xs text-muted-foreground font-mono">
                      — {summary}
                    </span>
                  )}

                  {state === "locked" && (
                    <span className="text-xs text-muted-foreground/50">
                      — {LOCK_MESSAGES[step.id]}
                    </span>
                  )}

                  <div className="flex-1" />

                  {state !== "locked" && (
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${
                        isExp ? "" : "-rotate-90"
                      }`}
                    />
                  )}
                </button>

                {/* Expanded content */}
                {isExp && state !== "locked" && (
                  <div className="mt-3">
                    {step.id === "upload" && (
                      <DataTab projectId={project.id} />
                    )}
                    {step.id === "dataset" && (
                      <DatasetTab
                        projectId={project.id}
                        projectStatus={project.status}
                      />
                    )}
                    {step.id === "training" && (
                      <TrainingTab projectId={project.id} />
                    )}
                    {step.id === "benchmark" && (
                      <BenchmarkTab projectId={project.id} />
                    )}

                    {showContinue && (
                      <div className="mt-4 pt-4 border-t border-border flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            goToNext(step.id);
                          }}
                          className="font-mono text-xs gap-1.5"
                        >
                          Continue to {nextStep!.title}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
