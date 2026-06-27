import { useState, useRef, useEffect } from "react";
import { runAgent, type AgentResult } from "../core/agent";
import { allTools } from "../tools";
import VoiceInput from "./VoiceInput";
import type { Message } from "../types";

export interface ChatAgentProps {
  langCode: string;
  initialPrompt?: string;            // Inject first message automatically
  photoBase64?: string | null;       // Attach photo to first message
  onResult?: (result: AgentResult) => void;
  onToolCall?: (name: string) => void;
  placeholder?: string;
  showVoice?: boolean;
}

interface DisplayMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

export default function ChatAgent({
  langCode,
  initialPrompt,
  photoBase64,
  onResult,
  onToolCall,
  placeholder = "Type or use voice...",
  showVoice = true,
}: ChatAgentProps) {
  const [displayMsgs, setDisplayMsgs] = useState<DisplayMessage[]>([]);
  const [apiMsgs, setApiMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const didInitRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMsgs, loading]);

  // Fire initial prompt once
  useEffect(() => {
    if (initialPrompt && !didInitRef.current) {
      didInitRef.current = true;
      void sendMessage(initialPrompt, photoBase64 ?? undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendMessage(text: string, photo?: string) {
    if (loading) return;
    setError(null);
    setActiveTools([]);

    const userDisplay: DisplayMessage = { role: "user", text };
    setDisplayMsgs((prev) => [...prev, userDisplay]);

    // Build user message content (text + optional image)
    const userContent = photo
      ? ([
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo } },
          { type: "text", text },
        ] as Message["content"])
      : text;

    const newApiMsgs: Message[] = [...apiMsgs, { role: "user", content: userContent }];
    setApiMsgs(newApiMsgs);
    setLoading(true);

    try {
      const result = await runAgent(allTools, newApiMsgs, (toolName) => {
        setActiveTools((prev) => [...prev, toolName]);
        onToolCall?.(toolName);
        setDisplayMsgs((prev) => [
          ...prev,
          { role: "system", text: `🔧 Calling: ${toolName.replace(/_/g, " ")}` },
        ]);
      });

      setDisplayMsgs((prev) => [...prev, { role: "assistant", text: result.finalText }]);
      setApiMsgs((prev) => [
        ...prev,
        { role: "assistant", content: result.finalText },
      ]);
      setActiveTools([]);
      onResult?.(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = input.trim();
    if (!t || loading) return;
    setInput("");
    void sendMessage(t);
  }

  function handleVoiceTranscript(text: string) {
    setInput(text);
    // Auto-send voice input
    void sendMessage(text);
  }

  // Auto-resize textarea
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 100) + "px";
  }

  return (
    <div className="chat-container">
      {/* Messages */}
      <div className="chat-messages">
        {displayMsgs.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#a8a29e" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🙏</div>
            <p>Type or speak to describe the missing person or your situation.</p>
          </div>
        )}

        {displayMsgs.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.role}`}>
            {msg.role === "assistant"
              ? msg.text.split("\n").map((line, j) => (
                  <span key={j}>
                    {line}
                    {j < msg.text.split("\n").length - 1 && <br />}
                  </span>
                ))
              : msg.text}
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {activeTools.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "0 4px" }}>
                {activeTools.map((t, i) => (
                  <span key={i} className="tool-pill">
                    <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
                    {t.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
            <div className="chat-msg assistant" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span className="spinner" style={{ borderTopColor: "#f97316", borderColor: "#e7e5e4" }} />
              <span style={{ color: "#78716c", fontSize: 13 }}>
                {activeTools.length > 0
                  ? `Running ${activeTools[activeTools.length - 1].replace(/_/g, " ")}…`
                  : "Thinking…"}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="chat-msg system" style={{ background: "#fee2e2", color: "#dc2626" }}>
            ⚠️ {error}. Please try again.
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Voice input (above the text input, when enabled) */}
      {showVoice && !loading && (
        <div style={{ padding: "12px 16px 0", borderTop: "1px solid #f5f5f4" }}>
          <VoiceInput langCode={langCode} onTranscript={handleVoiceTranscript} disabled={loading} />
        </div>
      )}

      {/* Text input row */}
      <form onSubmit={handleSubmit} className="chat-input-row">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
          }}
          placeholder={placeholder}
          disabled={loading}
          rows={1}
          className="chat-textarea"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          style={{
            width: 44, height: 44,
            borderRadius: "50%",
            background: input.trim() && !loading ? "#f97316" : "#e7e5e4",
            color: input.trim() && !loading ? "white" : "#a8a29e",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
            flexShrink: 0,
            transition: "all .15s",
          }}
          aria-label="Send"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
