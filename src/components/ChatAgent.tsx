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

// Inline: **bold**, `code`
function renderInline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={i} style={{ background: "#f1f0ef", padding: "1px 4px", borderRadius: 3, fontFamily: "monospace", fontSize: "0.88em" }}>{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}

// Full markdown renderer: ##, ---, |tables|, - lists, 1. lists, **bold**, `code`
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Headings
    if (trimmed.startsWith("## ")) {
      nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: 15, color: "#1e293b", marginTop: 10, marginBottom: 2 }}>{renderInline(trimmed.slice(3))}</div>);
    } else if (trimmed.startsWith("### ")) {
      nodes.push(<div key={i} style={{ fontWeight: 700, fontSize: 13, color: "#374151", marginTop: 6, marginBottom: 2 }}>{renderInline(trimmed.slice(4))}</div>);
    // Horizontal rule
    } else if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      nodes.push(<hr key={i} style={{ border: "none", borderTop: "1px solid #e7e5e4", margin: "6px 0" }} />);
    // Table separator row — skip
    } else if (/^\|[-:\s|]+\|$/.test(trimmed)) {
      // skip
    // Table data row
    } else if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed.split("|").slice(1, -1);
      nodes.push(
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0", borderBottom: "1px solid #f1f0ef" }}>
          {cells.map((cell, j) => <div key={j} style={{ flex: 1 }}>{renderInline(cell.trim())}</div>)}
        </div>
      );
    // Bullet list
    } else if (/^[-*•]\s+/.test(trimmed)) {
      nodes.push(
        <div key={i} style={{ display: "flex", gap: 6, fontSize: 14, lineHeight: 1.55, marginTop: 1 }}>
          <span style={{ color: "#f97316", flexShrink: 0, marginTop: 1 }}>•</span>
          <span>{renderInline(trimmed.replace(/^[-*•]\s+/, ""))}</span>
        </div>
      );
    // Numbered list
    } else if (/^\d+\.\s+/.test(trimmed)) {
      const m = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (m) nodes.push(
        <div key={i} style={{ display: "flex", gap: 6, fontSize: 14, lineHeight: 1.55, marginTop: 1 }}>
          <span style={{ color: "#f97316", flexShrink: 0, fontWeight: 700, minWidth: 16 }}>{m[1]}.</span>
          <span>{renderInline(m[2])}</span>
        </div>
      );
    // Empty line
    } else if (trimmed === "") {
      nodes.push(<div key={i} style={{ height: 4 }} />);
    // Normal paragraph
    } else {
      nodes.push(<div key={i} style={{ fontSize: 14, lineHeight: 1.6 }}>{renderInline(line)}</div>);
    }
  }
  return <>{nodes}</>;
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

      // Only fire onResult when Claude has taken a completing action (not just asked a question)
      const completingTools = ["register_missing_person", "register_found_person", "get_reunion_point"];
      if (result.toolCallsMade.some((tc) => completingTools.includes(tc.name))) {
        onResult?.(result);
      }
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
            {msg.role === "assistant" ? renderMarkdown(msg.text) : msg.text}
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
