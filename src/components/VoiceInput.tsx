import { useState, useRef, useEffect } from "react";
import { startSpeech, isSpeechSupported, type SpeechState } from "../services/speech";

interface Props {
  langCode: string;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceInput({ langCode, onTranscript, disabled }: Props) {
  const [state, setState] = useState<SpeechState>("idle");
  const [interim, setInterim] = useState("");
  const [volume, setVolume] = useState(0);
  const sessionRef = useRef<{ stop: () => void } | null>(null);
  const supported = isSpeechSupported();

  // Cleanup on unmount
  useEffect(() => () => { sessionRef.current?.stop(); }, []);

  function handlePress() {
    if (disabled) return;

    if (state === "listening") {
      sessionRef.current?.stop();
      setState("idle");
      setInterim("");
      return;
    }

    setInterim("");
    setState("listening");

    const session = startSpeech({
      langCode,
      onInterim: setInterim,
      onFinal: (text) => {
        setInterim("");
        onTranscript(text);
      },
      onStateChange: setState,
      onVolume: setVolume,
    });
    sessionRef.current = session;
  }

  const isListening = state === "listening";

  if (!supported) {
    return (
      <p style={{ fontSize: 12, color: "#a8a29e", textAlign: "center" }}>
        Voice not supported in this browser. Please type your message.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      {/* Waveform / idle icon */}
      {isListening ? (
        <div className="waveform">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="waveform-bar"
              style={{ height: 6 + (volume / 100) * 22 * Math.sin(i * 1.2) + "px" }}
            />
          ))}
        </div>
      ) : (
        <div style={{ height: 32, display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#a8a29e" }}>
            {state === "error" ? "⚠️ Try again" : "Tap to speak"}
          </span>
        </div>
      )}

      {/* Big mic button */}
      <button
        onClick={handlePress}
        disabled={disabled || state === "processing"}
        className={`voice-btn${isListening ? " listening" : ""}`}
        title={isListening ? "Tap to stop" : "Tap to speak"}
        aria-label={isListening ? "Stop recording" : "Start recording"}
      >
        {state === "processing" ? (
          <span className="spinner" style={{ borderTopColor: "white", borderColor: "rgba(255,255,255,.3)" }} />
        ) : isListening ? (
          "⏹"
        ) : (
          "🎤"
        )}
      </button>

      {/* Interim text */}
      {interim && (
        <div
          style={{
            background: "#fff8f4",
            border: "1.5px solid #f97316",
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 14,
            color: "#1c1917",
            maxWidth: "100%",
            wordBreak: "break-word",
          }}
        >
          {interim}
          <span style={{ animation: "cursor-blink 1s infinite", marginLeft: 2 }}>|</span>
        </div>
      )}

      {/* Volume indicator */}
      {isListening && (
        <div style={{ width: "100%", display: "flex", gap: 3, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#a8a29e", flexShrink: 0 }}>Volume:</span>
          <div style={{ flex: 1, height: 6, background: "#e7e5e4", borderRadius: 3, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${volume}%`,
                background: volume > 60 ? "#16a34a" : volume > 20 ? "#f97316" : "#dc2626",
                borderRadius: 3,
                transition: "width .1s",
              }}
            />
          </div>
          {volume < 15 && isListening && (
            <span style={{ fontSize: 11, color: "#dc2626" }}>Speak louder</span>
          )}
        </div>
      )}

      <p style={{ fontSize: 11, color: "#a8a29e", textAlign: "center" }}>
        {isListening
          ? "Listening… tap ⏹ to stop"
          : "Tap the mic and speak clearly. Works in noisy environments."}
      </p>
    </div>
  );
}
