package handler

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/batuhanergun/ecole/api/internal/config"
	"github.com/batuhanergun/ecole/api/internal/crypto"
	"github.com/batuhanergun/ecole/api/internal/middleware"
	"github.com/batuhanergun/ecole/api/internal/model"
	"github.com/batuhanergun/ecole/api/internal/queue"
	"github.com/batuhanergun/ecole/api/internal/store"
	"github.com/gin-gonic/gin"
)

type ChatHandler struct {
	store *store.Store
	queue *queue.Queue
	cfg   *config.Config
}

func NewChatHandler(s *store.Store, q *queue.Queue, cfg *config.Config) *ChatHandler {
	return &ChatHandler{store: s, queue: q, cfg: cfg}
}

type createChatSessionRequest struct {
	TrainingRunID string `json:"training_run_id" binding:"required"`
	InferenceMode string `json:"inference_mode" binding:"required"`
}

func (h *ChatHandler) CreateSession(c *gin.Context) {
	var req createChatSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.InferenceMode != "local" && req.InferenceMode != "hf_endpoint" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "inference_mode must be 'local' or 'hf_endpoint'"})
		return
	}

	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	run, err := h.store.GetTrainingRun(c.Request.Context(), req.TrainingRunID, projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "training run not found"})
		return
	}
	if run.Status != "completed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "training run is not completed"})
		return
	}

	session, err := h.store.CreateChatSession(c.Request.Context(), projectID, req.TrainingRunID, req.InferenceMode)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create chat session"})
		return
	}

	if req.InferenceMode == "local" {
		payload, _ := json.Marshal(map[string]string{
			"project_id":      projectID,
			"session_id":      session.ID,
			"training_run_id": req.TrainingRunID,
		})
		job, err := h.queue.Enqueue(c.Request.Context(), "chat_session", projectID, payload)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enqueue chat job"})
			return
		}
		h.store.SetChatSessionJobID(c.Request.Context(), session.ID, job.ID)
		session.JobID = &job.ID
	} else {
		go h.createHFEndpoint(session.ID, projectID, run.BaseModel, run.HFRepoID)
	}

	c.JSON(http.StatusCreated, session)
}

func (h *ChatHandler) ListAllSessions(c *gin.Context) {
	userID := middleware.GetUserID(c)

	sessions, err := h.store.ListAllUserChatSessions(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list sessions"})
		return
	}
	if sessions == nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	c.JSON(http.StatusOK, sessions)
}

func (h *ChatHandler) ListSessions(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	sessions, err := h.store.ListChatSessions(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list sessions"})
		return
	}
	if sessions == nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	c.JSON(http.StatusOK, sessions)
}

func (h *ChatHandler) GetSession(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")
	sessionID := c.Param("sid")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	session, err := h.store.GetChatSession(c.Request.Context(), sessionID, projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}
	c.JSON(http.StatusOK, session)
}

func (h *ChatHandler) DeleteSession(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")
	sessionID := c.Param("sid")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	session, err := h.store.GetChatSession(c.Request.Context(), sessionID, projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	if session.InferenceMode == "hf_endpoint" && session.HFEndpointName != nil {
		go h.deleteHFEndpoint(session.ProjectID, *session.HFEndpointName)
	}

	h.store.UpdateChatSessionStatus(c.Request.Context(), sessionID, "closed")
	if err := h.store.DeleteChatSession(c.Request.Context(), sessionID, projectID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete session"})
		return
	}
	c.Status(http.StatusNoContent)
}

type sendMessageRequest struct {
	Content string `json:"content" binding:"required"`
}

func (h *ChatHandler) SendMessage(c *gin.Context) {
	var req sendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := middleware.GetUserID(c)
	projectID := c.Param("id")
	sessionID := c.Param("sid")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	session, err := h.store.GetChatSession(c.Request.Context(), sessionID, projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	if session.Status != "ready" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session is not ready"})
		return
	}

	userMsg, err := h.store.CreateChatMessage(c.Request.Context(), sessionID, "user", req.Content, "done")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create message"})
		return
	}

	assistantMsg, err := h.store.CreateChatMessage(c.Request.Context(), sessionID, "assistant", "", "pending")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create assistant message"})
		return
	}

	if session.InferenceMode == "hf_endpoint" && session.HFEndpointURL != nil {
		go h.callTGI(session, assistantMsg.ID)
	}

	c.JSON(http.StatusCreated, gin.H{
		"user_message":      userMsg,
		"assistant_message": assistantMsg,
	})
}

func (h *ChatHandler) ListMessages(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")
	sessionID := c.Param("sid")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if _, err := h.store.GetChatSession(c.Request.Context(), sessionID, projectID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	messages, err := h.store.ListChatMessages(c.Request.Context(), sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list messages"})
		return
	}
	if messages == nil {
		c.JSON(http.StatusOK, []any{})
		return
	}
	c.JSON(http.StatusOK, messages)
}

func (h *ChatHandler) Stream(c *gin.Context) {
	userID := middleware.GetUserID(c)
	projectID := c.Param("id")
	sessionID := c.Param("sid")

	if _, err := h.store.GetProject(c.Request.Context(), projectID, userID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
		return
	}

	if _, err := h.store.GetChatSession(c.Request.Context(), sessionID, projectID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
		return
	}

	lastContent := ""
	lastMsgID := ""
	ticker := time.NewTicker(300 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			messages, err := h.store.ListChatMessages(c.Request.Context(), sessionID)
			if err != nil {
				continue
			}

			// Find the latest active assistant message
			var active *model.ChatMessage
			for i := len(messages) - 1; i >= 0; i-- {
				m := messages[i]
				if m.Role == "assistant" && (m.Status == "streaming" || m.Status == "pending" || m.Status == "done" || m.Status == "error") {
					active = &messages[i]
					break
				}
			}

			if active == nil {
				continue
			}

			// Reset tracking when message changes
			if active.ID != lastMsgID {
				lastContent = ""
				lastMsgID = active.ID
			}

			if active.Content != lastContent {
				delta := active.Content[len(lastContent):]
				data, _ := json.Marshal(gin.H{
					"type":       "delta",
					"message_id": active.ID,
					"delta":      delta,
					"content":    active.Content,
				})
				fmt.Fprintf(c.Writer, "data: %s\n\n", data)
				flusher.Flush()
				lastContent = active.Content
			}

			if active.Status == "done" && lastMsgID == active.ID {
				data, _ := json.Marshal(gin.H{
					"type":       "done",
					"message_id": active.ID,
					"content":    active.Content,
				})
				fmt.Fprintf(c.Writer, "data: %s\n\n", data)
				flusher.Flush()
				lastContent = ""
				lastMsgID = ""
			}

			if active.Status == "error" {
				data, _ := json.Marshal(gin.H{
					"type":       "error",
					"message_id": active.ID,
				})
				fmt.Fprintf(c.Writer, "data: %s\n\n", data)
				flusher.Flush()
				lastContent = ""
				lastMsgID = ""
			}

			// Check if session is closed
			sess, err := h.store.GetChatSessionByID(c.Request.Context(), sessionID)
			if err != nil || sess.Status == "closed" || sess.Status == "error" {
				data, _ := json.Marshal(gin.H{"type": "session_closed"})
				fmt.Fprintf(c.Writer, "data: %s\n\n", data)
				flusher.Flush()
				return
			}
		}
	}
}

// --- HF Inference Endpoint management ---

func (h *ChatHandler) getHFTokenForProject(projectID string) (string, error) {
	ctx := context.Background()
	userID, err := h.store.GetProjectOwner(ctx, projectID)
	if err != nil {
		return "", err
	}
	hfEnc, err := h.store.GetHFToken(ctx, userID)
	if err != nil || len(hfEnc) == 0 {
		return "", fmt.Errorf("no HF token found")
	}
	dec, err := crypto.Decrypt(hfEnc, h.cfg.EncryptionKey)
	if err != nil {
		return "", err
	}
	return string(dec), nil
}

func (h *ChatHandler) createHFEndpoint(sessionID, projectID, baseModel string, hfRepoID *string) {
	ctx := context.Background()

	hfToken, err := h.getHFTokenForProject(projectID)
	if err != nil {
		h.store.UpdateChatSessionError(ctx, sessionID, "Failed to get HF token: "+err.Error())
		return
	}

	h.store.UpdateChatSessionStatus(ctx, sessionID, "loading")

	modelRepo := baseModel
	if hfRepoID != nil && *hfRepoID != "" {
		modelRepo = *hfRepoID
	}

	namespace, err := h.getHFNamespace(hfToken)
	if err != nil {
		h.store.UpdateChatSessionError(ctx, sessionID, "Failed to get HF namespace: "+err.Error())
		return
	}

	endpointName := fmt.Sprintf("ecole-chat-%s", sessionID[:8])

	body, _ := json.Marshal(map[string]any{
		"name": endpointName,
		"type": "protected",
		"model": map[string]any{
			"repository": modelRepo,
			"task":       "text-generation",
			"framework":  "pytorch",
			"image": map[string]any{
				"huggingface": map[string]any{},
			},
		},
		"provider": map[string]any{
			"vendor": "aws",
			"region": "us-east-1",
		},
		"compute": map[string]any{
			"accelerator":  "gpu",
			"instanceType": "nvidia-a10g",
			"instanceSize": "x1",
			"scaling": map[string]any{
				"minReplica": 1,
				"maxReplica": 1,
			},
		},
	})

	req, _ := http.NewRequest("POST",
		fmt.Sprintf("https://api.endpoints.huggingface.cloud/v2/endpoint/%s", namespace),
		bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+hfToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.store.UpdateChatSessionError(ctx, sessionID, "Failed to create HF endpoint: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		h.store.UpdateChatSessionError(ctx, sessionID, fmt.Sprintf("HF endpoint creation failed (%d): %s", resp.StatusCode, string(respBody)))
		return
	}

	var epResp struct {
		Name   string `json:"name"`
		Status struct {
			State string `json:"state"`
			URL   string `json:"url"`
		} `json:"status"`
	}
	json.NewDecoder(resp.Body).Decode(&epResp)

	h.store.UpdateChatSessionEndpoint(ctx, sessionID, endpointName, epResp.Status.URL, epResp.Status.State)

	// Poll until running (max 10 minutes)
	for i := 0; i < 120; i++ {
		time.Sleep(5 * time.Second)

		epStatus, url, err := h.pollHFEndpoint(hfToken, namespace, endpointName)
		if err != nil {
			continue
		}

		h.store.UpdateChatSessionEndpoint(ctx, sessionID, endpointName, url, epStatus)

		if epStatus == "running" {
			h.store.UpdateChatSessionStatus(ctx, sessionID, "ready")
			return
		}
		if epStatus == "failed" {
			h.store.UpdateChatSessionError(ctx, sessionID, "HF endpoint failed to start")
			return
		}
	}

	h.store.UpdateChatSessionError(ctx, sessionID, "HF endpoint timed out waiting to become ready")
}

func (h *ChatHandler) getHFNamespace(hfToken string) (string, error) {
	req, _ := http.NewRequest("GET", "https://huggingface.co/api/whoami-v2", nil)
	req.Header.Set("Authorization", "Bearer "+hfToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var info struct {
		Name string `json:"name"`
	}
	json.NewDecoder(resp.Body).Decode(&info)
	if info.Name == "" {
		return "", fmt.Errorf("could not determine HF namespace")
	}
	return info.Name, nil
}

func (h *ChatHandler) pollHFEndpoint(hfToken, namespace, name string) (string, string, error) {
	req, _ := http.NewRequest("GET",
		fmt.Sprintf("https://api.endpoints.huggingface.cloud/v2/endpoint/%s/%s", namespace, name),
		nil)
	req.Header.Set("Authorization", "Bearer "+hfToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	var epResp struct {
		Status struct {
			State string `json:"state"`
			URL   string `json:"url"`
		} `json:"status"`
	}
	json.NewDecoder(resp.Body).Decode(&epResp)
	return epResp.Status.State, epResp.Status.URL, nil
}

func (h *ChatHandler) deleteHFEndpoint(projectID, endpointName string) {
	hfToken, err := h.getHFTokenForProject(projectID)
	if err != nil {
		return
	}

	namespace, err := h.getHFNamespace(hfToken)
	if err != nil {
		return
	}

	req, _ := http.NewRequest("DELETE",
		fmt.Sprintf("https://api.endpoints.huggingface.cloud/v2/endpoint/%s/%s", namespace, endpointName),
		nil)
	req.Header.Set("Authorization", "Bearer "+hfToken)
	http.DefaultClient.Do(req)
}

func (h *ChatHandler) callTGI(session *model.ChatSession, assistantMsgID string) {
	ctx := context.Background()

	hfToken, err := h.getHFTokenForProject(session.ProjectID)
	if err != nil {
		h.store.UpdateChatMessage(ctx, assistantMsgID, "", "error")
		return
	}

	messages, err := h.store.ListChatMessages(ctx, session.ID)
	if err != nil {
		h.store.UpdateChatMessage(ctx, assistantMsgID, "", "error")
		return
	}

	var chatMessages []map[string]string
	for _, m := range messages {
		if m.Status == "done" {
			chatMessages = append(chatMessages, map[string]string{
				"role":    m.Role,
				"content": m.Content,
			})
		}
	}

	body, _ := json.Marshal(map[string]any{
		"model":      "tgi",
		"messages":   chatMessages,
		"stream":     true,
		"max_tokens": 1024,
	})

	endpointURL := *session.HFEndpointURL
	if !strings.HasSuffix(endpointURL, "/") {
		endpointURL += "/"
	}

	req, _ := http.NewRequest("POST", endpointURL+"v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+hfToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		h.store.UpdateChatMessage(ctx, assistantMsgID, "Error calling model: "+err.Error(), "error")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		h.store.UpdateChatMessage(ctx, assistantMsgID, fmt.Sprintf("Model error (%d): %s", resp.StatusCode, string(respBody)), "error")
		return
	}

	h.store.UpdateChatMessage(ctx, assistantMsgID, "", "streaming")

	scanner := bufio.NewScanner(resp.Body)
	var accumulated strings.Builder
	tokenCount := 0

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			accumulated.WriteString(chunk.Choices[0].Delta.Content)
			tokenCount++

			if tokenCount%10 == 0 {
				h.store.UpdateChatMessage(ctx, assistantMsgID, accumulated.String(), "streaming")
			}
		}
	}

	h.store.UpdateChatMessage(ctx, assistantMsgID, accumulated.String(), "done")
}
