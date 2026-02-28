import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type ActivityTrainingRun, type ActivityJob } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Cloud, Monitor, ExternalLink, Clock, AlertCircle, Terminal, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { toast } from "sonner";

function formatStatus(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(start: string, end: string | null): string {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const secs = Math.floor((e - s) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-primary text-primary-foreground";
    case "failed":
      return "bg-destructive text-white";
    case "training":
    case "claimed":
    case "downloading":
      return "bg-ecole-orange text-white";
    case "pending":
    case "queued":
      return "bg-muted text-muted-foreground";
    default:
      return "";
  }
}

function jobTypeLabel(t: string): string {
  switch (t) {
    case "harness":
      return "Dataset Generation";
    case "training":
      return "Training";
    case "hf_upload":
      return "HF Upload";
    case "benchmark":
      return "Benchmark";
    default:
      return t;
  }
}

function LogViewer({ projectId, runId }: { projectId: string; runId: string }) {
  const [logs, setLogs] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const fetchLogs = async () => {
      try {
        const result = await api.getTrainingLogs(projectId, runId);
        if (active && result.logs) {
          setLogs(result.logs);
        }
      } catch {
        // Silently ignore fetch errors
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [projectId, runId]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      ref={containerRef}
      className="mt-2 ml-7 bg-zinc-950 text-zinc-300 text-[11px] font-mono p-3 max-h-64 overflow-y-auto border border-zinc-800"
    >
      {logs ? (
        <pre className="whitespace-pre-wrap break-words">{logs}</pre>
      ) : (
        <span className="text-zinc-600">Waiting for logs...</span>
      )}
    </div>
  );
}

function StepProgress({ run }: { run: ActivityTrainingRun }) {
  if (run.current_step > 0 && run.total_steps) {
    return (
      <span className="text-xs font-mono text-muted-foreground">
        Step {run.current_step}/{run.total_steps}
        {run.train_loss != null && ` · ${run.train_loss.toFixed(4)}`}
      </span>
    );
  }
  if (run.current_epoch > 0) {
    return (
      <span className="text-xs font-mono text-muted-foreground">
        {run.current_epoch}/{run.total_epochs || "?"}
        {run.train_loss != null && ` · ${run.train_loss.toFixed(4)}`}
      </span>
    );
  }
  return null;
}

export default function Jobs() {
  const [advancedMode, setAdvancedMode] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const deleteTrainingMutation = useMutation({
    mutationFn: ({ projectId, runId }: { projectId: string; runId: string }) =>
      api.deleteTrainingRun(projectId, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      toast.success("Training run deleted");
    },
    onError: () => toast.error("Failed to delete training run"),
  });

  const deleteJobMutation = useMutation({
    mutationFn: ({ projectId, jobId }: { projectId: string; jobId: string }) =>
      api.deleteJob(projectId, jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      toast.success("Job deleted");
    },
    onError: () => toast.error("Failed to delete job"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["activity"],
    queryFn: api.getActivity,
    refetchInterval: 5000,
  });

  const trainingRuns = data?.training_runs ?? [];
  const jobs = data?.jobs ?? [];

  // Merge into a unified list sorted by created_at desc
  type UnifiedItem =
    | { kind: "training"; data: ActivityTrainingRun }
    | { kind: "job"; data: ActivityJob };

  const items: UnifiedItem[] = [
    ...trainingRuns.map((r) => ({ kind: "training" as const, data: r })),
    ...jobs
      .filter((j) => j.job_type !== "training") // training queue jobs duplicate training runs
      .map((j) => ({ kind: "job" as const, data: j })),
  ].sort(
    (a, b) =>
      new Date(b.data.created_at).getTime() -
      new Date(a.data.created_at).getTime()
  );

  const activeCount = items.filter((i) => {
    const s = i.data.status;
    return s !== "completed" && s !== "failed";
  }).length;

  const toggleLogs = (id: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-mono font-bold">Jobs</h2>
        <div className="flex items-center gap-3">
          {activeCount > 0 && (
            <span className="text-xs font-mono text-ecole-orange flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-ecole-orange animate-pulse" />
              {activeCount} active
            </span>
          )}
          <button
            onClick={() => setAdvancedMode(!advancedMode)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono border transition-colors ${
              advancedMode
                ? "border-ecole-orange bg-ecole-orange/10 text-ecole-orange"
                : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            <Terminal className="h-3 w-3" />
            Advanced
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse bg-muted border border-border" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-muted-foreground font-mono">No jobs yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Jobs will appear here when you generate datasets, train models, or run benchmarks.
          </p>
        </div>
      ) : (
        <div className="border border-border divide-y divide-border">
          {items.map((item) => {
            if (item.kind === "training") {
              const run = item.data;
              const isActive =
                run.status === "training" ||
                run.status === "queued" ||
                run.status === "downloading";
              const hasStepProgress = run.total_steps && run.current_step > 0;
              const progressPct = hasStepProgress
                ? (run.current_step / run.total_steps!) * 100
                : run.total_epochs && run.current_epoch > 0
                  ? (run.current_epoch / run.total_epochs) * 100
                  : 0;

              return (
                <div key={`tr-${run.id}`} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      {run.compute_mode === "hf_jobs" ? (
                        <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-medium truncate">
                            {run.base_model.split("/").pop()}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
                            training
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Link
                            to={`/projects/${run.project_id}`}
                            className="text-xs font-mono text-muted-foreground hover:text-ecole-orange transition-colors"
                          >
                            {run.project_name}
                          </Link>
                          <span className="text-muted-foreground/30">·</span>
                          <span className="text-xs text-muted-foreground/60 font-mono flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatRelativeTime(run.created_at)}
                          </span>
                          {(run.started_at || run.completed_at) && (
                            <>
                              <span className="text-muted-foreground/30">·</span>
                              <span className="text-xs text-muted-foreground/60 font-mono">
                                {formatDuration(
                                  run.started_at || run.created_at,
                                  run.completed_at
                                )}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <StepProgress run={run} />
                      <Badge className={statusColor(run.status)}>
                        {formatStatus(run.status)}
                      </Badge>
                      {(run.status === "completed" || run.status === "failed") && (
                        <button
                          onClick={() => deleteTrainingMutation.mutate({ projectId: run.project_id, runId: run.id })}
                          disabled={deleteTrainingMutation.isPending}
                          className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Advanced metrics */}
                  {advancedMode && (run.grad_norm != null || run.learning_rate_current != null) && (
                    <div className="mt-1.5 ml-7 flex items-center gap-3">
                      {run.grad_norm != null && (
                        <span className="text-[11px] font-mono text-muted-foreground/70">
                          grad_norm: {run.grad_norm.toFixed(4)}
                        </span>
                      )}
                      {run.learning_rate_current != null && (
                        <span className="text-[11px] font-mono text-muted-foreground/70">
                          lr: {run.learning_rate_current.toExponential(2)}
                        </span>
                      )}
                    </div>
                  )}

                  {isActive && (
                    <div className="mt-2 ml-7 h-1 bg-muted overflow-hidden">
                      {progressPct > 0 ? (
                        <div
                          className="h-full bg-ecole-orange transition-all"
                          style={{ width: `${progressPct}%` }}
                        />
                      ) : (
                        <div className="h-full bg-ecole-orange/40 animate-pulse w-full" />
                      )}
                    </div>
                  )}

                  {isActive && run.compute_mode === "hf_jobs" && run.hf_job_id && (
                    <a
                      href={run.hf_job_id}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 ml-7 inline-flex items-center gap-1 text-xs text-ecole-orange hover:underline font-mono"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View on HuggingFace
                    </a>
                  )}

                  {/* Log viewer toggle (advanced mode) */}
                  {advancedMode && (
                    <button
                      onClick={() => toggleLogs(run.id)}
                      className="mt-1.5 ml-7 inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {expandedLogs.has(run.id) ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      Raw Logs
                    </button>
                  )}

                  {advancedMode && expandedLogs.has(run.id) && (
                    <LogViewer projectId={run.project_id} runId={run.id} />
                  )}

                  {run.status === "failed" && run.error_message && (
                    <div className="mt-1.5 ml-7 flex items-start gap-1.5">
                      <AlertCircle className="h-3 w-3 shrink-0 text-destructive mt-0.5" />
                      <p className="text-xs text-destructive font-mono truncate">
                        {run.error_message}
                      </p>
                    </div>
                  )}
                </div>
              );
            }

            // Queue job
            const job = item.data;
            const isActive = job.status !== "completed" && job.status !== "failed";

            return (
              <div key={`job-${job.id}`} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-medium">
                          {jobTypeLabel(job.job_type)}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
                          {job.job_type}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Link
                          to={`/projects/${job.project_id}`}
                          className="text-xs font-mono text-muted-foreground hover:text-ecole-orange transition-colors"
                        >
                          {job.project_name}
                        </Link>
                        <span className="text-muted-foreground/30">·</span>
                        <span className="text-xs text-muted-foreground/60 font-mono flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(job.created_at)}
                        </span>
                        {job.completed_at && job.claimed_at && (
                          <>
                            <span className="text-muted-foreground/30">·</span>
                            <span className="text-xs text-muted-foreground/60 font-mono">
                              {formatDuration(job.claimed_at, job.completed_at)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge className={statusColor(job.status)}>
                      {formatStatus(job.status)}
                    </Badge>
                    {(job.status === "completed" || job.status === "failed") && (
                      <button
                        onClick={() => deleteJobMutation.mutate({ projectId: job.project_id, jobId: job.id })}
                        disabled={deleteJobMutation.isPending}
                        className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {isActive && (
                  <div className="mt-2 ml-7 h-1 bg-muted overflow-hidden">
                    <div className="h-full bg-ecole-orange/40 animate-pulse w-full" />
                  </div>
                )}

                {job.status === "failed" && job.error && (
                  <div className="mt-1.5 ml-7 flex items-start gap-1.5">
                    <AlertCircle className="h-3 w-3 shrink-0 text-destructive mt-0.5" />
                    <p className="text-xs text-destructive font-mono truncate">
                      {job.error}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
