import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type Upload } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload as UploadIcon, Trash2, FileText } from "lucide-react";

export function DataTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();

  const { data: uploads, isLoading } = useQuery({
    queryKey: ["uploads", projectId],
    queryFn: () => api.listUploads(projectId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadFile(projectId, file),
    onSuccess: (_data, file) => {
      queryClient.invalidateQueries({ queryKey: ["uploads", projectId] });
      toast.success(`Uploaded ${file.name}`);
    },
    onError: (_err: Error, file) => {
      toast.error(`Failed to upload ${file.name}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (uploadId: string) => api.deleteUpload(projectId, uploadId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uploads", projectId] });
      toast.success("File deleted");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete file");
    },
  });

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      files.forEach((file) => uploadMutation.mutate(file));
    },
    [uploadMutation]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      files.forEach((file) => uploadMutation.mutate(file));
    },
    [uploadMutation]
  );

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center border-2 border-dashed border-border p-8 transition-colors hover:border-ecole-orange"
      >
        <UploadIcon className="mb-3 h-8 w-8 text-muted-foreground" />
        <p className="mb-2 text-sm font-medium">Drop files here or click to upload</p>
        <p className="mb-4 text-xs text-muted-foreground">PDF, TXT, or any text-based file</p>
        <label>
          <input
            type="file"
            multiple
            accept=".pdf,.txt,.md,.csv,.json,.jsonl"
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            className="pointer-events-none"
          >
            {uploadMutation.isPending ? "Uploading..." : "Select Files"}
          </Button>
        </label>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse bg-muted" />
          ))}
        </div>
      ) : uploads && uploads.length > 0 ? (
        <div className="space-y-2">
          {uploads.map((upload: Upload) => (
            <Card key={upload.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium font-mono">{upload.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {(upload.size_bytes / 1024).toFixed(1)} KB
                    {upload.page_count && ` / ${upload.page_count} pages`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {upload.status}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(upload.id)}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground py-4">
          No files uploaded yet
        </p>
      )}
    </div>
  );
}
