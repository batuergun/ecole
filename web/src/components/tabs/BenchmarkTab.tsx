import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Benchmark, type TrainingRun } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3 } from "lucide-react";

interface BenchmarkResult {
  question: string;
  expected: string;
  answer: string;
  score: number;
  reason: string;
  semantic_similarity: number | null;
  rouge_l: number | null;
}

export function BenchmarkTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: benchmarks, isLoading } = useQuery({
    queryKey: ["benchmarks", projectId],
    queryFn: () => api.listBenchmarks(projectId),
    refetchInterval: 5000,
  });

  const { data: runs } = useQuery({
    queryKey: ["training-runs", projectId],
    queryFn: () => api.listTrainingRuns(projectId),
  });

  const evaluateMutation = useMutation({
    mutationFn: (runId: string) => api.triggerBenchmark(projectId, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benchmarks", projectId] });
      toast.success("Evaluation started");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to start evaluation");
    },
  });

  const completedRuns = runs?.filter((r: TrainingRun) => r.status === "completed") ?? [];
  const pendingBenchmarks = benchmarks?.filter((b: Benchmark) => b.status === "pending" || b.status === "running") ?? [];
  const hasAnyCompleted = benchmarks?.some((b: Benchmark) => b.status === "completed") ?? false;

  // Find the most recent completed run that hasn't been evaluated yet
  const evaluatedRunIds = new Set(benchmarks?.map((b: Benchmark) => b.training_run_id) ?? []);
  const unevaluatedRuns = completedRuns.filter((r) => !evaluatedRunIds.has(r.id));

  if (isLoading) {
    return <div className="h-32 animate-pulse bg-muted" />;
  }

  // Empty state — no benchmarks and no pending ones
  if (!hasAnyCompleted && pendingBenchmarks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
        <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            See how your model performs
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Run an evaluation to compare your fine-tuned model against the base model and see the improvement.
          </p>
        </div>
        {completedRuns.length > 0 && (
          <Button
            onClick={() => evaluateMutation.mutate(completedRuns[0].id)}
            disabled={evaluateMutation.isPending}
            className="bg-ecole-orange text-white hover:bg-ecole-orange-light"
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            {evaluateMutation.isPending ? "Starting..." : "Evaluate Model"}
          </Button>
        )}
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
      {pendingBenchmarks.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-ecole-orange animate-pulse" />
              <p className="text-sm font-mono">Evaluating model...</p>
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
      {hasAnyCompleted && unevaluatedRuns.length > 0 && pendingBenchmarks.length === 0 && (
        <div className="pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => evaluateMutation.mutate(unevaluatedRuns[0].id)}
            disabled={evaluateMutation.isPending}
            className="font-mono text-xs"
          >
            <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
            Evaluate Another Run
          </Button>
        </div>
      )}
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
