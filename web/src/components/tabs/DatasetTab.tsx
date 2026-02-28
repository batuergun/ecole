import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type DatasetItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Trash2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Search,
  AlertCircle,
  Clock,
} from "lucide-react";

const PAGE_SIZE = 25;

function formatDuration(start: string, end?: string | null): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.floor((endMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function QAStream({ projectId }: { projectId: string }) {
  const [visible, setVisible] = useState<DatasetItem | null>(null);
  const [fading, setFading] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<DatasetItem[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const { data } = useQuery({
    queryKey: ["dataset-stream", projectId],
    queryFn: () => api.listDataset(projectId, 50, 0),
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (!data?.items) return;
    for (const item of data.items) {
      if (!seenRef.current.has(item.id)) {
        seenRef.current.add(item.id);
        queueRef.current.push(item);
      }
    }
  }, [data]);

  useEffect(() => {
    const cycle = () => {
      const items = data?.items || [];
      if (items.length === 0) return;

      // Pick from queue of unseen items first, otherwise random
      const next = queueRef.current.shift() || items[Math.floor(Math.random() * items.length)];

      setFading(false);
      setVisible(next);

      // Fade out after 2.5s
      timerRef.current = setTimeout(() => {
        setFading(true);
        // Swap after fade completes
        timerRef.current = setTimeout(cycle, 600);
      }, 2500);
    };

    cycle();
    return () => clearTimeout(timerRef.current);
  }, [data]);

  if (!visible) return null;

  return (
    <div
      className={`transition-opacity duration-500 ${fading ? "opacity-0" : "opacity-100"}`}
    >
      <div className="border-l-2 border-ecole-orange/40 pl-3 py-1 space-y-1">
        <p className="text-xs text-muted-foreground font-mono truncate">
          Q: {visible.question}
        </p>
        <p className="text-xs text-muted-foreground/70 font-mono truncate">
          A: {visible.answer}
        </p>
      </div>
    </div>
  );
}

function GenerationProgress({
  projectId,
  onComplete,
}: {
  projectId: string;
  onComplete: () => void;
}) {
  const [elapsed, setElapsed] = useState("");

  const { data: job } = useQuery({
    queryKey: ["harness-status", projectId],
    queryFn: () => api.harnessStatus(projectId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "completed" || status === "failed") return false;
      return 2000;
    },
  });

  useEffect(() => {
    if (!job?.claimed_at) return;
    if (job.status === "completed" || job.status === "failed") {
      setElapsed(formatDuration(job.claimed_at, job.completed_at));
      return;
    }
    const update = () => setElapsed(formatDuration(job.claimed_at!));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [job?.claimed_at, job?.completed_at, job?.status]);

  useEffect(() => {
    if (job?.status === "completed") onComplete();
  }, [job?.status, onComplete]);

  if (!job) return null;

  const progress = job.progress_data || {};
  const processedFiles = (progress.processed_files as number) || 0;
  const totalFiles = (progress.total_files as number) || 0;
  const totalQaPairs = (progress.total_qa_pairs as number) || 0;
  const pct = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;

  const isFailed = job.status === "failed";
  const isComplete = job.status === "completed";
  const isRunning = !isFailed && !isComplete;

  if (isComplete) return null;

  return (
    <div
      className={`border p-4 space-y-3 ${
        isFailed ? "border-destructive bg-destructive/5" : "border-ecole-orange/30 bg-ecole-orange/5"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isFailed ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : (
            <span className="h-2 w-2 bg-ecole-orange animate-pulse" />
          )}
          <span className="text-sm font-mono font-medium">
            {isFailed ? "Generation Failed" : "Generating Dataset..."}
          </span>
        </div>
        {elapsed && (
          <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {elapsed}
          </span>
        )}
      </div>

      {isFailed && job.error && (
        <p className="text-xs text-destructive font-mono">{job.error}</p>
      )}

      {isRunning && (
        <>
          <div className="h-1.5 w-full bg-muted overflow-hidden">
            {totalFiles > 0 ? (
              <div
                className="h-full bg-ecole-orange transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            ) : (
              <div className="h-full bg-ecole-orange animate-pulse w-full opacity-30" />
            )}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground font-mono">
            <span>
              {totalFiles > 0
                ? `${processedFiles} / ${totalFiles} files`
                : "Processing files..."}
            </span>
            <span>{totalQaPairs > 0 ? `${totalQaPairs} Q&A pairs` : "Extracting Q&A pairs..."}</span>
          </div>
          <QAStream projectId={projectId} />
        </>
      )}
    </div>
  );
}

function StatsBar({ projectId }: { projectId: string }) {
  const { data: stats } = useQuery({
    queryKey: ["dataset-stats", projectId],
    queryFn: () => api.datasetStats(projectId),
  });

  if (!stats || stats.total === 0) return null;

  return (
    <p className="text-sm text-muted-foreground font-mono">
      {stats.total} pairs
      <span className="text-muted-foreground/60">
        {" "}({stats.train_count} train / {stats.eval_count} eval)
      </span>
    </p>
  );
}

export function DatasetTab({
  projectId,
  projectStatus,
}: {
  projectId: string;
  projectStatus: string;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const offset = page * PAGE_SIZE;

  const { data, isLoading } = useQuery({
    queryKey: ["dataset", projectId, page],
    queryFn: () => api.listDataset(projectId, PAGE_SIZE, offset),
  });

  const harnessMutation = useMutation({
    mutationFn: () => api.triggerHarness(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["harness-status", projectId] });
      toast.success("Dataset generation started");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to start generation");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => api.deleteDatasetItem(projectId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dataset", projectId] });
      queryClient.invalidateQueries({ queryKey: ["dataset-stats", projectId] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete item");
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.batchDeleteDatasetItems(projectId, ids),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["dataset", projectId] });
      queryClient.invalidateQueries({ queryKey: ["dataset-stats", projectId] });
      toast.success(`Deleted ${result.deleted} items`);
      setSelected(new Set());
      setShowDeleteDialog(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to batch delete");
    },
  });

  const handleGenerationComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["dataset", projectId] });
    queryClient.invalidateQueries({ queryKey: ["dataset-stats", projectId] });
    queryClient.invalidateQueries({ queryKey: ["project", projectId] });
  }, [queryClient, projectId]);

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const isProcessing = projectStatus === "processing";

  const filteredItems = search
    ? items.filter(
        (item) =>
          item.question.toLowerCase().includes(search.toLowerCase()) ||
          item.answer.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const allVisibleSelected =
    filteredItems.length > 0 &&
    filteredItems.every((item) => selected.has(item.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      const next = new Set(selected);
      filteredItems.forEach((item) => next.delete(item.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filteredItems.forEach((item) => next.add(item.id));
      setSelected(next);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  // Reset selection when page changes
  useEffect(() => {
    setSelected(new Set());
  }, [page]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <StatsBar projectId={projectId} />
        <Button
          onClick={() => harnessMutation.mutate()}
          disabled={isProcessing || harnessMutation.isPending}
          className="bg-ecole-orange text-white hover:bg-ecole-orange-light"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {isProcessing ? "Generating..." : "Generate Dataset"}
        </Button>
      </div>

      {/* Generation Progress */}
      {isProcessing && (
        <GenerationProgress
          projectId={projectId}
          onComplete={handleGenerationComplete}
        />
      )}

      {/* Search + Batch Actions */}
      {total > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search Q&A..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs font-mono"
            />
          </div>
          {selected.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/30 hover:bg-destructive/10 h-8"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete {selected.size} selected
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse bg-muted" />
          ))}
        </div>
      ) : filteredItems.length > 0 ? (
        <div className="border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    className="accent-[#FF6B00]"
                  />
                </TableHead>
                <TableHead className="font-mono text-xs">Question</TableHead>
                <TableHead className="font-mono text-xs">Answer</TableHead>
                <TableHead className="font-mono text-xs w-20">Type</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item: DatasetItem) => (
                <>
                  <TableRow
                    key={item.id}
                    className={`cursor-pointer ${
                      expanded === item.id ? "bg-muted/50" : ""
                    }`}
                    onClick={() =>
                      setExpanded(expanded === item.id ? null : item.id)
                    }
                  >
                    <TableCell
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        className="accent-[#FF6B00]"
                      />
                    </TableCell>
                    <TableCell className="text-sm max-w-xs truncate font-mono">
                      {item.question}
                    </TableCell>
                    <TableCell className="text-sm max-w-xs truncate font-mono">
                      {item.answer}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {item.is_eval ? "eval" : "train"}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(item.id)}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expanded === item.id && (
                    <TableRow key={`${item.id}-expanded`}>
                      <TableCell colSpan={5} className="bg-muted/30 p-4">
                        <div className="space-y-3">
                          <div>
                            <p className="text-xs font-mono text-muted-foreground mb-1">
                              Question
                            </p>
                            <p className="text-sm whitespace-pre-wrap">
                              {item.question}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-mono text-muted-foreground mb-1">
                              Answer
                            </p>
                            <p className="text-sm whitespace-pre-wrap">
                              {item.answer}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2">
              <span className="text-xs text-muted-foreground font-mono">
                {offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs font-mono px-2">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : items.length === 0 && !isProcessing ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No dataset generated yet. Upload data first, then click "Generate
            Dataset".
          </p>
        </div>
      ) : search && filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No results for "{search}"
          </p>
        </div>
      ) : null}

      {/* Batch Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selected.size} items?</DialogTitle>
            <DialogDescription>
              This will soft-delete the selected dataset items. This action
              cannot be undone from the UI.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                batchDeleteMutation.mutate(Array.from(selected))
              }
              disabled={batchDeleteMutation.isPending}
            >
              {batchDeleteMutation.isPending
                ? "Deleting..."
                : `Delete ${selected.size} items`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
