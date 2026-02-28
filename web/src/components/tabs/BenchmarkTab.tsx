import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Benchmark } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface BenchmarkResult {
  question: string;
  expected: string;
  answer: string;
  score: number;
  reason: string;
}

export function BenchmarkTab({ projectId }: { projectId: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: benchmarks, isLoading } = useQuery({
    queryKey: ["benchmarks", projectId],
    queryFn: () => api.listBenchmarks(projectId),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return <div className="h-32 animate-pulse bg-muted" />;
  }

  if (!benchmarks || benchmarks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No benchmarks yet. Complete a training run and click "Benchmark" to evaluate.
        </p>
      </div>
    );
  }

  const baseBenchmark = benchmarks.find((b: Benchmark) => b.model_type === "base" && b.status === "completed");
  const ftBenchmark = benchmarks.find((b: Benchmark) => b.model_type === "finetuned" && b.status === "completed");
  const pendingBenchmarks = benchmarks.filter((b: Benchmark) => b.status === "pending" || b.status === "running");

  return (
    <div className="space-y-6">
      {pendingBenchmarks.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-ecole-orange animate-pulse" />
              <p className="text-sm font-mono">Benchmark running...</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
      </div>

      {/* Per-question results */}
      {benchmarks
        .filter((b: Benchmark) => b.status === "completed" && b.results)
        .map((b: Benchmark) => (
          <div key={b.id}>
            <button
              onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
              className="w-full text-left"
            >
              <h3 className="text-sm font-mono tracking-wide text-muted-foreground mb-2 hover:text-foreground transition-colors">
                {b.model_type === "base" ? "Base" : "Fine-tuned"} — Per-Question Results
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
    </div>
  );
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
