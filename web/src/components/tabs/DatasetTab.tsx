import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type DatasetItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Sparkles } from "lucide-react";

export function DatasetTab({ projectId, projectStatus }: { projectId: string; projectStatus: string }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["dataset", projectId],
    queryFn: () => api.listDataset(projectId),
    refetchInterval: projectStatus === "processing" ? 5000 : false,
  });

  const harnessMutation = useMutation({
    mutationFn: () => api.triggerHarness(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
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
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete item");
    },
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const isProcessing = projectStatus === "processing";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {total} Q&A pairs generated
            {isProcessing && (
              <span className="ml-2 inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 bg-ecole-orange animate-pulse" />
                generating...
              </span>
            )}
          </p>
        </div>
        <Button
          onClick={() => harnessMutation.mutate()}
          disabled={isProcessing || harnessMutation.isPending}
          className="bg-ecole-orange text-white hover:bg-ecole-orange-light"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {isProcessing ? "Generating..." : "Generate Dataset"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse bg-muted" />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono text-xs">Question</TableHead>
                <TableHead className="font-mono text-xs">Answer</TableHead>
                <TableHead className="font-mono text-xs w-20">Type</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: DatasetItem) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm max-w-xs truncate">
                    {item.question}
                  </TableCell>
                  <TableCell className="text-sm max-w-xs truncate">
                    {item.answer}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {item.is_eval ? "eval" : "train"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(item.id)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No dataset generated yet. Upload data first, then click "Generate Dataset".
          </p>
        </div>
      )}
    </div>
  );
}
