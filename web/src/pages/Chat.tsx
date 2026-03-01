import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  api,
  subscribeToChatStream,
  type ChatSession,
  type ChatMessage,
  type ChatStreamEvent,
  type TrainingRun,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Send, Square, Loader2, MessageSquare } from "lucide-react";

export default function Chat() {
  const { id: projectId, sessionId } = useParams<{
    id: string;
    sessionId: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Setup form state
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [inferenceMode, setInferenceMode] = useState<string>("local");

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });

  const { data: runs } = useQuery({
    queryKey: ["training-runs", projectId],
    queryFn: () => api.listTrainingRuns(projectId!),
    enabled: !!projectId,
  });

  const { data: session, refetch: refetchSession } = useQuery({
    queryKey: ["chat-session", projectId, sessionId],
    queryFn: () => api.getChatSession(projectId!, sessionId!),
    enabled: !!projectId && !!sessionId,
    refetchInterval: (query) => {
      const s = query.state.data;
      if (s && (s.status === "pending" || s.status === "loading")) return 2000;
      return false;
    },
  });

  const { data: sessions } = useQuery({
    queryKey: ["chat-sessions", projectId],
    queryFn: () => api.listChatSessions(projectId!),
    enabled: !!projectId && !sessionId,
  });

  // Load messages when session is available
  useEffect(() => {
    if (!projectId || !sessionId) return;
    api.listChatMessages(projectId, sessionId).then(setMessages).catch(() => {});
  }, [projectId, sessionId]);

  // Set up SSE stream when session is ready
  useEffect(() => {
    if (!projectId || !sessionId || !session) return;
    if (session.status !== "ready") return;

    const es = subscribeToChatStream(projectId, sessionId, (event: ChatStreamEvent) => {
      if (event.type === "delta" && event.message_id && event.content !== undefined) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.message_id
              ? { ...m, content: event.content!, status: "streaming" }
              : m
          )
        );
      } else if (event.type === "done" && event.message_id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.message_id
              ? { ...m, content: event.content || m.content, status: "done" }
              : m
          )
        );
        setIsGenerating(false);
      } else if (event.type === "error" && event.message_id) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === event.message_id ? { ...m, status: "error" } : m
          )
        );
        setIsGenerating(false);
      } else if (event.type === "session_closed") {
        refetchSession();
      }
    });

    eventSourceRef.current = es;
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [projectId, sessionId, session?.status, refetchSession]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const createSessionMutation = useMutation({
    mutationFn: () =>
      api.createChatSession(projectId!, {
        training_run_id: selectedRunId,
        inference_mode: inferenceMode,
      }),
    onSuccess: (session: ChatSession) => {
      navigate(`/projects/${projectId}/chat/${session.id}`);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create session");
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: () => api.deleteChatSession(projectId!, sessionId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-sessions", projectId] });
      toast.success("Session stopped");
      navigate(`/projects/${projectId}/chat`);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to stop session");
    },
  });

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !projectId || !sessionId || isGenerating) return;

    const content = input.trim();
    setInput("");
    setIsGenerating(true);

    try {
      const result = await api.sendChatMessage(projectId, sessionId, content);
      setMessages((prev) => [
        ...prev,
        result.user_message,
        result.assistant_message,
      ]);
    } catch (err: unknown) {
      setIsGenerating(false);
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    }
  }, [input, projectId, sessionId, isGenerating]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const completedRuns = runs?.filter(
    (r: TrainingRun) => r.status === "completed"
  );

  // Auto-select first completed run
  useEffect(() => {
    if (completedRuns?.length && !selectedRunId) {
      setSelectedRunId(completedRuns[0].id);
    }
  }, [completedRuns, selectedRunId]);

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

  // --- Setup view (no session selected) ---
  if (!sessionId) {
    return (
      <div>
        <div className="mb-6">
          <Link
            to={`/projects/${projectId}`}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to project
          </Link>
          <h2 className="text-2xl font-mono font-bold">Demo Chat</h2>
          {project && (
            <p className="text-sm text-muted-foreground mt-1">
              {project.name}
            </p>
          )}
        </div>

        {/* New session form */}
        <div className="border border-border p-6 mb-8">
          <h3 className="text-sm font-mono font-medium mb-4">
            Start New Chat Session
          </h3>

          {!completedRuns?.length ? (
            <p className="text-sm text-muted-foreground">
              No completed training runs. Complete a training run first.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-mono text-muted-foreground mb-1.5 block">
                  Training Run
                </label>
                <Select
                  value={selectedRunId}
                  onValueChange={setSelectedRunId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a training run" />
                  </SelectTrigger>
                  <SelectContent>
                    {completedRuns.map((run: TrainingRun) => (
                      <SelectItem key={run.id} value={run.id}>
                        {run.base_model.split("/").pop()}
                        {run.train_loss != null &&
                          ` — Loss: ${run.train_loss.toFixed(4)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-mono text-muted-foreground mb-1.5 block">
                  Inference Mode
                </label>
                <Select
                  value={inferenceMode}
                  onValueChange={setInferenceMode}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">
                      Local (GPU worker)
                    </SelectItem>
                    <SelectItem value="hf_endpoint">
                      HF Inference Endpoint (cloud, paid)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => createSessionMutation.mutate()}
                disabled={
                  !selectedRunId || createSessionMutation.isPending
                }
                className="font-mono text-xs bg-ecole-orange text-white hover:bg-ecole-orange-light"
              >
                {createSessionMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                )}
                Start Chat
              </Button>
            </div>
          )}
        </div>

        {/* Existing sessions */}
        {sessions && sessions.length > 0 && (
          <div>
            <h3 className="text-sm font-mono font-medium mb-3">
              Previous Sessions
            </h3>
            <div className="space-y-2">
              {sessions.map((s: ChatSession) => (
                <Link
                  key={s.id}
                  to={`/projects/${projectId}/chat/${s.id}`}
                  className="flex items-center justify-between border border-border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-mono">
                      {s.inference_mode === "hf_endpoint" ? "HF" : "Local"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(s.created_at).toLocaleString()}
                    </span>
                  </div>
                  {statusBadge(s.status)}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Loading view ---
  if (session && (session.status === "pending" || session.status === "loading")) {
    return (
      <div>
        <div className="mb-6">
          <Link
            to={`/projects/${projectId}/chat`}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sessions
          </Link>
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-mono font-bold">Demo Chat</h2>
            {statusBadge(session.status)}
          </div>
        </div>

        <div className="border border-border p-8 flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-ecole-orange mb-4" />
          <p className="text-sm font-mono">
            {session.inference_mode === "hf_endpoint"
              ? "Deploying HF Inference Endpoint..."
              : "Loading model on worker..."}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            This may take a few minutes
          </p>
          {session.hf_endpoint_status && (
            <p className="text-xs text-muted-foreground mt-1">
              Endpoint status: {session.hf_endpoint_status}
            </p>
          )}
        </div>
      </div>
    );
  }

  // --- Error view ---
  if (session && session.status === "error") {
    return (
      <div>
        <div className="mb-6">
          <Link
            to={`/projects/${projectId}/chat`}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sessions
          </Link>
          <h2 className="text-2xl font-mono font-bold">Demo Chat</h2>
        </div>

        <div className="border border-destructive/50 p-6">
          <p className="text-sm font-mono text-destructive mb-2">
            Session Error
          </p>
          <p className="text-sm text-muted-foreground">
            {session.error_message || "An unknown error occurred"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 font-mono text-xs"
            onClick={() => navigate(`/projects/${projectId}/chat`)}
          >
            Start New Session
          </Button>
        </div>
      </div>
    );
  }

  // --- Chat view (session ready or closed) ---
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Link
            to={`/projects/${projectId}/chat`}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h2 className="text-lg font-mono font-bold">Demo Chat</h2>
          {session && statusBadge(session.status)}
          {session?.inference_mode === "hf_endpoint" && (
            <span className="text-xs text-muted-foreground font-mono">
              HF Endpoint
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {session &&
            session.status !== "closed" &&
            session.inference_mode === "hf_endpoint" && (
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-xs text-destructive border-destructive/50 hover:bg-destructive/10"
                onClick={() => {
                  if (
                    confirm(
                      "Stop this endpoint? HF Inference Endpoints incur costs while running."
                    )
                  ) {
                    deleteSessionMutation.mutate();
                  }
                }}
              >
                <Square className="h-3 w-3 mr-1.5" />
                Stop Endpoint
              </Button>
            )}
          {session &&
            session.status !== "closed" &&
            session.inference_mode === "local" && (
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-xs"
                onClick={() => {
                  if (confirm("Stop this chat session?")) {
                    deleteSessionMutation.mutate();
                  }
                }}
              >
                <Square className="h-3 w-3 mr-1.5" />
                Stop Session
              </Button>
            )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquare className="h-8 w-8 mb-3" />
            <p className="text-sm font-mono">Send a message to start chatting</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] px-4 py-2.5 text-sm ${
                msg.role === "user"
                  ? "bg-ecole-orange text-white"
                  : "border border-border bg-muted/30"
              }`}
            >
              <div className="whitespace-pre-wrap break-words">
                {msg.content || (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="text-xs">Thinking...</span>
                  </span>
                )}
              </div>
              {msg.status === "streaming" && (
                <span className="inline-block w-1.5 h-4 bg-ecole-orange animate-pulse ml-0.5 align-text-bottom" />
              )}
              {msg.status === "error" && (
                <p className="text-xs text-destructive mt-1">
                  Generation failed
                </p>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {session?.status === "ready" && (
        <div className="shrink-0 pt-4 border-t border-border">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={isGenerating}
              rows={1}
              className="flex-1 resize-none border border-border bg-transparent px-3 py-2.5 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:border-ecole-orange disabled:opacity-50"
            />
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || isGenerating}
              className="shrink-0 bg-ecole-orange text-white hover:bg-ecole-orange-light"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 font-mono">
            Press Enter to send, Shift+Enter for newline
          </p>
        </div>
      )}

      {session?.status === "closed" && (
        <div className="shrink-0 pt-4 border-t border-border text-center">
          <p className="text-sm text-muted-foreground font-mono">
            Session closed
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 font-mono text-xs"
            onClick={() => navigate(`/projects/${projectId}/chat`)}
          >
            Start New Session
          </Button>
        </div>
      )}
    </div>
  );
}
