import { useState, useRef, useEffect } from "react";
import { runAgent, type AgentResult } from "../core/agent";
import { allTools } from "../tools";
import VoiceInput from "./VoiceInput";
import type { Message } from "../types";
import { filterText } from "../utils/profanityFilter";

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
  const [contentWarning, setContentWarning] = useState<string | null>(null);
  const [showVoicePanel, setShowVoicePanel] = useState(true);
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
    // Profanity filter
    const filtered = filterText(t);
    setContentWarning(filtered.reason ?? null);
    setInput("");
    setShowVoicePanel(true);
    void sendMessage(filtered.cleaned);
  }

  function handleVoiceTranscript(text: string) {
    const filtered = filterText(text);
    if (filtered.blocked) setContentWarning(filtered.reason ?? null);
    setInput(filtered.cleaned);
    setShowVoicePanel(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
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

        {loading && (() => {
          const TOOL_LABELS: Record<string, { icon: string; label: string; sub: string }> = {
            search_found_persons:   { icon: "🔍", label: "Searching all help centers", sub: "Scanning registry for matching records…" },
            search_missing_persons: { icon: "📋", label: "Checking missing reports",   sub: "Looking through active reports…" },
            register_missing_person:{ icon: "📝", label: "Registering your case",      sub: "Alerting all nearby help centers…" },
            register_found_person:  { icon: "🏥", label: "Logging found person",        sub: "Adding to the shared registry…" },
            get_reunion_point:      { icon: "📍", label: "Finding reunion point",       sub: "Locating nearest safe meetup spot…" },
            get_help_centers:       { icon: "🏥", label: "Fetching help centers",       sub: "Loading center details and capacity…" },
            get_nearest_center:     { icon: "📡", label: "Finding nearest center",      sub: "Calculating walking distance…" },
            verify_handover:        { icon: "🔐", label: "Verifying handover PIN",      sub: "Checking 4-digit code against report…" },
          };
          const currentTool = activeTools.length > 0 ? activeTools[activeTools.length - 1] : null;
          const info = currentTool ? TOOL_LABELS[currentTool] : null;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {info ? (
                <div style={{
                  background: "#fff8f4", border: "1.5px solid #fed7aa",
                  borderRadius: 12, padding: "12px 14px",
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  <span style={{ fontSize: 24, flexShrink: 0 }}>{info.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>{info.label}</div>
                    <div style={{ fontSize: 11, color: "#78716c", marginTop: 2 }}>{info.sub}</div>
                    <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: "#fed7aa", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", background: "#f97316", borderRadius: 2,
                        animation: "progress-slide 1.4s ease-in-out infinite",
                        width: "40%",
                      }} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="chat-msg assistant" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className="spinner" style={{ borderTopColor: "#f97316", borderColor: "#e7e5e4" }} />
                  <span style={{ color: "#78716c", fontSize: 13 }}>Thinking…</span>
                </div>
              )}
            </div>
          );
        })()}

        {error && (
          <div className="chat-msg system" style={{ background: "#fee2e2", color: "#dc2626" }}>
            ⚠️ {error}. Please try again.
          </div>
        )}
        {contentWarning && (
          <div className="chat-msg system" style={{ background: "#fff8e7", color: "#92400e", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>⚠️ {contentWarning}</span>
            <button onClick={() => setContentWarning(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#92400e", fontSize: 14 }}>✕</button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Voice input — replaced by send/re-record after transcript is captured */}
      {showVoice && !loading && (
        <div style={{ borderTop: "1px solid #f5f5f4" }}>
          {showVoicePanel ? (
            <div style={{ padding: "12px 16px 0" }}>
              <VoiceInput langCode={langCode} onTranscript={handleVoiceTranscript} disabled={loading} />
            </div>
          ) : (
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 13, color: "#1c1917", background: "#fff8f4", border: "1.5px solid #f97316", borderRadius: 10, padding: "10px 12px", lineHeight: 1.5 }}>
                🎤 {input}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    const t = input.trim();
                    if (!t) return;
                    const filtered = filterText(t);
                    setContentWarning(filtered.reason ?? null);
                    setInput("");
                    setShowVoicePanel(true);
                    void sendMessage(filtered.cleaned);
                  }}
                  style={{
                    flex: 1, padding: "12px", borderRadius: 10, border: "none",
                    background: "#f97316", color: "white", fontWeight: 700, fontSize: 15, cursor: "pointer",
                  }}
                >
                  ✅ Send
                </button>
                <button
                  onClick={() => { setShowVoicePanel(true); setInput(""); }}
                  style={{
                    padding: "12px 16px", borderRadius: 10, border: "1px solid #e7e5e4",
                    background: "white", color: "#57534e", fontSize: 13, cursor: "pointer",
                  }}
                >
                  🔄 Re-record
                </button>
              </div>
            </div>
          )}
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
