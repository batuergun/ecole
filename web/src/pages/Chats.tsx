import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, type ChatSessionWithDetails } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, Loader2, Trash2 } from "lucide-react";

export default function Chats() {
  const queryClient = useQueryClient();

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["all-chat-sessions"],
    queryFn: () => api.listAllChatSessions(),
    refetchInterval: 10000,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ projectId, sessionId }: { projectId: string; sessionId: string }) =>
      api.deleteChatSession(projectId, sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-chat-sessions"] });
      toast.success("Chat session deleted");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete chat session");
    },
  });

  const statusBadge = (status: string) => {
    const variants: Record<string, string> = {
      pending: "bg-muted text-muted-foreground",
      loading: "bg-ecole-orange/10 text-ecole-orange",
      ready: "bg-green-500/10 text-green-600",
      error: "bg-destructive/10 text-destructive",
      closed: "bg-muted text-muted-foreground",
    };
    return (
      <Badge
        variant="outline"
        className={`font-mono text-xs ${variants[status] || ""}`}
      >
        {status === "loading" && (
          <Loader2 className="h-3 w-3 animate-spin mr-1" />
        )}
        {status}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-mono font-bold">Chats</h2>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-mono font-bold">Chats</h2>
      <p className="text-sm text-muted-foreground">
        All chat sessions across your projects.
      </p>

      {!sessions?.length ? (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
          <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No chat sessions yet. Start one from a project's Chat tab.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {sessions.map((s: ChatSessionWithDetails) => {
            const modelName = s.base_model
              ? s.base_model.split("/").pop()
              : "Unknown";
            return (
              <Link
                key={s.id}
                to={`/projects/${s.project_id}/chat/${s.id}`}
                className="flex items-center justify-between border border-border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-mono font-medium truncate">
                    {s.project_name}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    Fine-tuned · {modelName}
                  </span>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {s.inference_mode === "hf_endpoint" ? "HF" : "Local"}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground font-mono">
                    {new Date(s.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {statusBadge(s.status)}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteMutation.mutate({ projectId: s.project_id, sessionId: s.id });
                    }}
                    className="text-muted-foreground hover:text-destructive h-7 w-7 p-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
