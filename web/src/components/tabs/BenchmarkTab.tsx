import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, type Benchmark, type TrainingRun } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3,
  AlertTriangle,
  RotateCcw,
  Cloud,
  Monitor,
  Cpu,
  Settings,
} from "lucide-react";

interface BenchmarkResult {
  question: string;
  expected: string;
  answer: string;
  score: number;
  reason: string;
  semantic_similarity: number | null;
  rouge_l: number | null;
}

const IS_CLOUD = import.meta.env.VITE_CLOUD_MODE === "true";

const ALL_COMPUTE_OPTIONS = [
  { value: "local", label: "Local GPU", icon: Monitor, description: "Run on your own GPU" },
  { value: "hf_jobs", label: "HF Jobs", icon: Cloud, description: "Run on HuggingFace infrastructure" },
];

const COMPUTE_OPTIONS = IS_CLOUD
  ? ALL_COMPUTE_OPTIONS.filter((o) => o.value === "hf_jobs")
  : ALL_COMPUTE_OPTIONS;

const HF_FLAVOR_OPTIONS = [
  { value: "a10g-small", label: "A10G Small", vram: "24 GB", description: "1x NVIDIA A10G" },
  { value: "a10g-large", label: "A10G Large", vram: "24 GB", description: "1x A10G + more CPU/RAM" },
  { value: "l4x1", label: "L4 x1", vram: "24 GB", description: "1x NVIDIA L4" },
  { value: "l4x4", label: "L4 x4", vram: "96 GB", description: "4x NVIDIA L4" },
  { value: "a100-large", label: "A100 Large", vram: "80 GB", description: "1x NVIDIA A100" },
];

function formatRunLabel(run: TrainingRun): string {
  const name = run.base_model.split("/").pop() ?? run.base_model;
  const loss = run.train_loss != null ? ` — Loss: ${run.train_loss.toFixed(4)}` : "";
  return `${name}${loss}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BenchmarkTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showLaunchDialog, setShowLaunchDialog] = useState(false);

  // Launch modal state
  const [computeMode, setComputeMode] = useState(IS_CLOUD ? "hf_jobs" : "local");
  const [hfFlavor, setHfFlavor] = useState("a10g-small");
  const [hfNamespace, setHfNamespace] = useState("");

  const { data: benchmarks, isLoading } = useQuery({
    queryKey: ["benchmarks", projectId],
    queryFn: () => api.listBenchmarks(projectId),
    refetchInterval: 5000,
  });

  const { data: runs } = useQuery({
    queryKey: ["training-runs", projectId],
    queryFn: () => api.listTrainingRuns(projectId),
  });

  const { data: benchmarkJob } = useQuery({
    queryKey: ["benchmark-job", projectId],
    queryFn: () => api.benchmarkJobStatus(projectId).catch(() => null),
    refetchInterval: 5000,
  });

  const { data: keys } = useQuery({
    queryKey: ["settings-keys"],
    queryFn: () => api.getKeys(),
  });

  const hasHfToken = !!keys?.hf_token;

  const evaluateMutation = useMutation({
    mutationFn: () => {
      if (!effectiveSelectedId) throw new Error("No run selected");
      return api.triggerBenchmark(projectId, {
        training_run_id: effectiveSelectedId,
        compute_mode: computeMode,
        ...(computeMode === "hf_jobs" ? { hf_flavor: hfFlavor } : {}),
        ...(computeMode === "hf_jobs" && hfNamespace ? { hf_namespace: hfNamespace } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benchmarks", projectId] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-job", projectId] });
      setShowLaunchDialog(false);
      setSelectedRunId(null);
      toast.success(
        computeMode === "hf_jobs"
          ? "Evaluation dispatched to HF Jobs"
          : "Evaluation started"
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to start evaluation");
    },
  });

  const completedRuns = runs?.filter((r: TrainingRun) => r.status === "completed") ?? [];
  const pendingBenchmarks = benchmarks?.filter((b: Benchmark) => b.status === "pending" || b.status === "running") ?? [];
  const failedBenchmarks = benchmarks?.filter((b: Benchmark) => b.status === "failed") ?? [];
  const hasAnyCompleted = benchmarks?.some((b: Benchmark) => b.status === "completed") ?? false;

  // Check if a benchmark job is actively running
  const jobIsActive = benchmarkJob != null &&
    ["pending", "claimed", "running"].includes(benchmarkJob.status);
  const jobFailed = benchmarkJob != null && benchmarkJob.status === "failed";

  // Parse HF job URL from the progress_data if available
  const hfJobUrl = benchmarkJob?.progress_data?.hf_job_url as string | undefined;
  const jobComputeMode = benchmarkJob?.progress_data?.compute_mode as string | undefined;

  const successfullyEvaluatedRunIds = new Set(
    (benchmarks ?? [])
      .filter((b: Benchmark) => b.status === "completed" || b.status === "pending" || b.status === "running")
      .map((b) => b.training_run_id)
  );
  const unevaluatedRuns = completedRuns.filter((r) => !successfullyEvaluatedRunIds.has(r.id));

  const availableRuns = hasAnyCompleted ? unevaluatedRuns : completedRuns;
  const effectiveSelectedId = selectedRunId ?? (availableRuns.length === 1 ? availableRuns[0].id : null);
  const selectedRun = availableRuns.find((r) => r.id === effectiveSelectedId);

  const pendingRunId = pendingBenchmarks[0]?.training_run_id;
  const pendingRun = completedRuns.find((r) => r.id === pendingRunId);
  const isEvaluating = pendingBenchmarks.length > 0 || jobIsActive;

  // Failed state: check both benchmark records and the job itself
  const failedRunIds = new Set(failedBenchmarks.map((b) => b.training_run_id));
  const failedOnlyRunIds = [...failedRunIds].filter((id) => !successfullyEvaluatedRunIds.has(id));
  const failedRunFromBenchmarks = failedOnlyRunIds.length > 0 ? completedRuns.find((r) => failedOnlyRunIds.includes(r.id)) : null;
  const failedRun = failedRunFromBenchmarks ?? (jobFailed && !isEvaluating ? completedRuns[0] : null);

  const handleEvaluateClick = () => {
    if (!effectiveSelectedId) return;
    setShowLaunchDialog(true);
  };

  if (isLoading) {
    return <div className="h-32 animate-pulse bg-muted" />;
  }

  // Empty state — no benchmarks and nothing running
  if (!hasAnyCompleted && !isEvaluating) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
        {failedRun ? (
          <>
            <AlertTriangle className="h-8 w-8 text-destructive/60" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Evaluation failed</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                The evaluation for {formatRunLabel(failedRun)} did not complete. You can retry it below.
              </p>
              {benchmarkJob?.error && (
                <p className="text-xs text-destructive font-mono mt-1">{benchmarkJob.error}</p>
              )}
            </div>
            <Button
              onClick={() => {
                setSelectedRunId(failedRun.id);
                setShowLaunchDialog(true);
              }}
              className="bg-ecole-orange text-white hover:bg-ecole-orange-light"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Retry Evaluation
            </Button>
          </>
        ) : (
          <>
            <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                See how your model performs
              </p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Run an evaluation to compare your fine-tuned model against the base model and see the improvement.
              </p>
            </div>
            {availableRuns.length > 0 && (
              <RunSelector
                runs={availableRuns}
                selectedRunId={effectiveSelectedId}
                selectedRun={selectedRun}
                onSelect={setSelectedRunId}
                onEvaluate={handleEvaluateClick}
                isPending={evaluateMutation.isPending}
              />
            )}
          </>
        )}

        <LaunchDialog
          open={showLaunchDialog}
          onOpenChange={setShowLaunchDialog}
          computeMode={computeMode}
          setComputeMode={setComputeMode}
          hfFlavor={hfFlavor}
          setHfFlavor={setHfFlavor}
          hfNamespace={hfNamespace}
          setHfNamespace={setHfNamespace}
          hasHfToken={hasHfToken}
          isPending={evaluateMutation.isPending}
          onLaunch={() => evaluateMutation.mutate()}
          navigate={navigate}
        />
      </div>
    );
  }

  const baseBenchmark = benchmarks?.find((b: Benchmark) => b.model_type === "base" && b.status === "completed");
  const ftBenchmark = benchmarks?.find((b: Benchmark) => b.model_type === "finetuned" && b.epoch == null && b.status === "completed");
  const teacherBenchmark = benchmarks?.find((b: Benchmark) => b.model_type === "teacher" && b.status === "completed");
  const epochBenchmarks = (benchmarks ?? [])
    .filter((b: Benchmark) => b.model_type === "finetuned" && b.epoch != null && b.status === "completed")
    .sort((a, b) => (a.epoch ?? 0) - (b.epoch ?? 0));

  return (
    <div className="space-y-6">
      {isEvaluating && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-ecole-orange animate-pulse" />
              <div className="text-sm font-mono">
                <span>Evaluating</span>
                {pendingRun && (
                  <span className="text-muted-foreground">
                    {" "}— {formatRunLabel(pendingRun)}
                  </span>
                )}
              </div>
              {jobComputeMode === "hf_jobs" && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Cloud className="h-3 w-3" />
                  HF Jobs
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 ml-5">
              Comparing base, fine-tuned, and teacher models on your eval set
            </p>
            {hfJobUrl && (
              <a
                href={hfJobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-ecole-orange hover:underline font-mono mt-2 ml-5"
              >
                <Cloud className="h-3 w-3" />
                View job on HuggingFace
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {failedRun && !isEvaluating && (
        <Card className="border-destructive/30">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 text-destructive/70" />
                <div>
                  <p className="text-sm font-mono">Evaluation failed</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatRunLabel(failedRun)}
                  </p>
                  {benchmarkJob?.error && (
                    <p className="text-xs text-destructive font-mono mt-1">{benchmarkJob.error}</p>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedRunId(failedRun.id);
                  setShowLaunchDialog(true);
                }}
                className="font-mono text-xs"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {hasAnyCompleted && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <ScoreCard
              title="Base Model"
              benchmark={baseBenchmark}
              isHighlighted={false}
            />
            <ScoreCard
              title="Fine-tuned Model"
              benchmark={ftBenchmark}
              isHighlighted={true}
              improvement={
                baseBenchmark?.avg_score && ftBenchmark?.avg_score
                  ? ((ftBenchmark.avg_score - baseBenchmark.avg_score) / baseBenchmark.avg_score) * 100
                  : undefined
              }
            />
            <ScoreCard
              title="Teacher Model"
              benchmark={teacherBenchmark}
              isHighlighted={false}
            />
          </div>

          {/* Per-epoch learning curve */}
          {epochBenchmarks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-mono tracking-wide text-muted-foreground">
                  Learning Curve — Per-Epoch
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-mono font-medium">Epoch</th>
                        <th className="py-2 pr-4 font-mono font-medium">Avg Score</th>
                        <th className="py-2 pr-4 font-mono font-medium">Accuracy</th>
                        <th className="py-2 pr-4 font-mono font-medium">Sem. Sim.</th>
                        <th className="py-2 font-mono font-medium">ROUGE-L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {epochBenchmarks.map((b) => (
                        <tr key={b.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono">{b.epoch}</td>
                          <td className="py-2 pr-4 font-mono">{b.avg_score?.toFixed(2) ?? "—"}</td>
                          <td className="py-2 pr-4 font-mono">
                            {b.accuracy != null ? `${(b.accuracy * 100).toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-2 pr-4 font-mono">
                            {b.semantic_similarity != null ? b.semantic_similarity.toFixed(3) : "—"}
                          </td>
                          <td className="py-2 font-mono">
                            {b.rouge_l != null ? b.rouge_l.toFixed(3) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Per-question results */}
          {(benchmarks ?? [])
            .filter((b: Benchmark) => b.status === "completed" && b.results)
            .map((b: Benchmark) => (
              <div key={b.id}>
                <button
                  onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                  className="w-full text-left"
                >
                  <h3 className="text-sm font-mono tracking-wide text-muted-foreground mb-2 hover:text-foreground transition-colors">
                    {modelTypeLabel(b)} — Per-Question Results
                    {b.epoch != null && ` (Epoch ${b.epoch})`}
                    <span className="ml-2 text-xs">
                      {expandedId === b.id ? "[-]" : "[+]"}
                    </span>
                  </h3>
                </button>
                {expandedId === b.id && (
                  <div className="space-y-2">
                    {(b.results as unknown as BenchmarkResult[])?.map((r, i) => (
                      <Card key={i} className="p-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0 space-y-1">
                            <p className="text-sm font-medium">{r.question}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              Model: {r.answer?.slice(0, 120)}...
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge
                              variant="outline"
                              className={
                                r.score >= 4
                                  ? "border-ecole-orange text-ecole-orange"
                                  : r.score >= 3
                                    ? "border-yellow-500 text-yellow-600"
                                    : "border-destructive text-destructive"
                              }
                            >
                              {r.score}/5
                            </Badge>
                            {r.semantic_similarity != null && (
                              <Badge variant="outline" className="text-xs">
                                Sim {r.semantic_similarity.toFixed(2)}
                              </Badge>
                            )}
                            {r.rouge_l != null && (
                              <Badge variant="outline" className="text-xs">
                                RL {r.rouge_l.toFixed(2)}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {r.reason && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{r.reason}</p>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            ))}
        </>
      )}

      {/* Re-evaluate with a different run */}
      {hasAnyCompleted && unevaluatedRuns.length > 0 && !isEvaluating && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground mb-3 font-mono">Evaluate another training run</p>
          <RunSelector
            runs={unevaluatedRuns}
            selectedRunId={effectiveSelectedId}
            selectedRun={selectedRun}
            onSelect={setSelectedRunId}
            onEvaluate={handleEvaluateClick}
            isPending={evaluateMutation.isPending}
            compact
          />
        </div>
      )}

      <LaunchDialog
        open={showLaunchDialog}
        onOpenChange={setShowLaunchDialog}
        computeMode={computeMode}
        setComputeMode={setComputeMode}
        hfFlavor={hfFlavor}
        setHfFlavor={setHfFlavor}
        hfNamespace={hfNamespace}
        setHfNamespace={setHfNamespace}
        hasHfToken={hasHfToken}
        isPending={evaluateMutation.isPending}
        onLaunch={() => evaluateMutation.mutate()}
        navigate={navigate}
      />
    </div>
  );
}

function LaunchDialog({
  open,
  onOpenChange,
  computeMode,
  setComputeMode,
  hfFlavor,
  setHfFlavor,
  hfNamespace,
  setHfNamespace,
  hasHfToken,
  isPending,
  onLaunch,
  navigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  computeMode: string;
  setComputeMode: (v: string) => void;
  hfFlavor: string;
  setHfFlavor: (v: string) => void;
  hfNamespace: string;
  setHfNamespace: (v: string) => void;
  hasHfToken: boolean;
  isPending: boolean;
  onLaunch: () => void;
  navigate: (path: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">Evaluate Model</DialogTitle>
          <DialogDescription>
            Choose where to run the evaluation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Compute Mode */}
          <div>
            <Label>Compute</Label>
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              {COMPUTE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setComputeMode(opt.value)}
                  className={`flex items-center gap-3 border p-3 text-left text-sm transition-colors ${
                    computeMode === opt.value
                      ? "border-ecole-orange bg-ecole-orange/5"
                      : "border-input hover:border-muted-foreground"
                  }`}
                >
                  <opt.icon className={`h-4 w-4 shrink-0 ${
                    computeMode === opt.value ? "text-ecole-orange" : "text-muted-foreground"
                  }`} />
                  <div>
                    <p className="font-medium font-mono text-xs">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* HF Jobs options */}
          {computeMode === "hf_jobs" && (
            <>
              <div>
                <Label className="flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5" />
                  Hardware
                </Label>
                <div className="grid grid-cols-1 gap-1.5 mt-1.5">
                  {HF_FLAVOR_OPTIONS.map((opt) => {
                    const isSelected = hfFlavor === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setHfFlavor(opt.value)}
                        className={`flex items-center justify-between border p-2.5 text-left text-sm transition-colors ${
                          isSelected
                            ? "border-ecole-orange bg-ecole-orange/5"
                            : "border-input hover:border-muted-foreground"
                        }`}
                      >
                        <span className="font-mono text-xs font-medium">{opt.label}</span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{opt.description}</span>
                          <span className="font-mono">{opt.vram}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label>Organization Namespace</Label>
                <Input
                  value={hfNamespace}
                  onChange={(e) => setHfNamespace(e.target.value)}
                  placeholder="Leave empty for personal account"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Org name to run the job under. Leave empty to use your personal account.
                </p>
              </div>
            </>
          )}

          {computeMode === "hf_jobs" && !hasHfToken && (
            <div className="flex items-start gap-2.5 border border-yellow-500/30 bg-yellow-500/5 p-3">
              <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-medium text-yellow-600 dark:text-yellow-400">HuggingFace token required</p>
                <p className="text-muted-foreground mt-0.5">
                  Add your HF token in{" "}
                  <button
                    type="button"
                    onClick={() => navigate("/settings")}
                    className="text-ecole-orange hover:underline font-mono inline-flex items-center gap-0.5"
                  >
                    <Settings className="h-3 w-3" />
                    Settings
                  </button>
                  {" "}before launching HF Jobs.
                </p>
              </div>
            </div>
          )}

          <Button
            onClick={onLaunch}
            disabled={isPending || (computeMode === "hf_jobs" && !hasHfToken)}
            className="w-full bg-ecole-orange text-white hover:bg-ecole-orange-light"
          >
            {computeMode === "hf_jobs" ? (
              <Cloud className="mr-2 h-4 w-4" />
            ) : (
              <BarChart3 className="mr-2 h-4 w-4" />
            )}
            {isPending
              ? "Launching..."
              : computeMode === "hf_jobs"
                ? "Evaluate on HF Jobs"
                : "Evaluate Model"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RunSelector({
  runs,
  selectedRunId,
  selectedRun,
  onSelect,
  onEvaluate,
  isPending,
  compact,
}: {
  runs: TrainingRun[];
  selectedRunId: string | null;
  selectedRun: TrainingRun | undefined;
  onSelect: (id: string) => void;
  onEvaluate: () => void;
  isPending: boolean;
  compact?: boolean;
}) {
  const showSelect = runs.length > 1;

  return (
    <div className={`space-y-3 ${compact ? "" : "w-full max-w-sm"}`}>
      {showSelect ? (
        <Select value={selectedRunId ?? ""} onValueChange={onSelect}>
          <SelectTrigger className={`font-mono text-xs ${compact ? "w-[280px]" : "w-full"}`}>
            <SelectValue placeholder="Select a training run" />
          </SelectTrigger>
          <SelectContent>
            {runs.map((run) => (
              <SelectItem key={run.id} value={run.id} className="font-mono text-xs">
                <div className="flex flex-col gap-0.5">
                  <span>{formatRunLabel(run)}</span>
                  <span className="text-muted-foreground">
                    {formatDate(run.completed_at ?? run.created_at)}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : selectedRun ? (
        <div className={`flex items-center gap-2 text-xs font-mono text-muted-foreground ${compact ? "" : "justify-center"}`}>
          <div className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
          <span>{formatRunLabel(selectedRun)}</span>
          <span className="text-muted-foreground/60">
            {formatDate(selectedRun.completed_at ?? selectedRun.created_at)}
          </span>
        </div>
      ) : null}

      <Button
        onClick={onEvaluate}
        disabled={isPending || !selectedRunId}
        size={compact ? "sm" : "default"}
        className={compact
          ? "font-mono text-xs"
          : "bg-ecole-orange text-white hover:bg-ecole-orange-light"
        }
        variant={compact ? "outline" : "default"}
      >
        <BarChart3 className={compact ? "mr-1.5 h-3.5 w-3.5" : "mr-2 h-4 w-4"} />
        {isPending ? "Starting..." : "Evaluate Model"}
      </Button>
    </div>
  );
}

function modelTypeLabel(b: Benchmark): string {
  if (b.model_type === "base") return "Base";
  if (b.model_type === "teacher") return "Teacher";
  return "Fine-tuned";
}

function ScoreCard({
  title,
  benchmark,
  isHighlighted,
  improvement,
}: {
  title: string;
  benchmark: Benchmark | undefined;
  isHighlighted: boolean;
  improvement?: number;
}) {
  return (
    <Card className={isHighlighted && benchmark ? "border-ecole-orange" : ""}>
      <CardHeader>
        <CardTitle className="text-sm font-mono tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {benchmark ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">Avg Score</span>
              <span
                className={`text-2xl font-mono font-bold ${isHighlighted ? "text-ecole-orange" : ""}`}
              >
                {benchmark.avg_score?.toFixed(2) || "—"}
                <span className="text-xs text-muted-foreground"> / 5</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Accuracy (4+/5)</span>
              <span className="font-mono">
                {benchmark.accuracy != null ? `${(benchmark.accuracy * 100).toFixed(1)}%` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Semantic Sim.</span>
              <span className="font-mono">
                {benchmark.semantic_similarity != null ? benchmark.semantic_similarity.toFixed(3) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">ROUGE-L</span>
              <span className="font-mono">
                {benchmark.rouge_l != null ? benchmark.rouge_l.toFixed(3) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Questions</span>
              <span className="font-mono">{benchmark.total_questions}</span>
            </div>
            {improvement !== undefined && (
              <p className="text-xs font-mono text-ecole-orange mt-1">
                {improvement >= 0 ? "+" : ""}
                {improvement.toFixed(1)}% vs base
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Not yet evaluated</p>
        )}
      </CardContent>
    </Card>
  );
}
