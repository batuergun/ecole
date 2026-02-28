import { useQuery } from "@tanstack/react-query";
import { api, type Benchmark } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function BenchmarkTab({ projectId }: { projectId: string }) {
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
          No benchmarks yet. Complete a training run first.
        </p>
      </div>
    );
  }

  const baseBenchmark = benchmarks.find((b: Benchmark) => b.model_type === "base");
  const ftBenchmark = benchmarks.find((b: Benchmark) => b.model_type === "finetuned");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
              Base Model
            </CardTitle>
          </CardHeader>
          <CardContent>
            {baseBenchmark ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Avg Score</span>
                  <span className="text-2xl font-mono font-bold">
                    {baseBenchmark.avg_score?.toFixed(2) || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Questions</span>
                  <span className="font-mono">{baseBenchmark.total_questions}</span>
                </div>
                <Badge variant="outline">{baseBenchmark.status}</Badge>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not yet evaluated</p>
            )}
          </CardContent>
        </Card>

        <Card className={ftBenchmark ? "border-ecole-orange" : ""}>
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
              Fine-tuned Model
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ftBenchmark ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Avg Score</span>
                  <span className="text-2xl font-mono font-bold text-ecole-orange">
                    {ftBenchmark.avg_score?.toFixed(2) || "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Questions</span>
                  <span className="font-mono">{ftBenchmark.total_questions}</span>
                </div>
                <Badge variant="outline">{ftBenchmark.status}</Badge>
                {baseBenchmark?.avg_score && ftBenchmark.avg_score && (
                  <p className="text-xs font-mono text-ecole-orange">
                    +{((ftBenchmark.avg_score - baseBenchmark.avg_score) / baseBenchmark.avg_score * 100).toFixed(1)}% improvement
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not yet evaluated</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
