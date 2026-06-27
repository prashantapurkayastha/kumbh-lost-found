import type { AgentTool, Message } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Agent loop — tool-use agentic execution, NOT simple chat
// All Claude calls go through the Express proxy at /api/claude
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a reunification assistant at the Kumbh Mela in Nashik, India.

Your role is to help pilgrims find separated family members and to help volunteers register found persons. You operate at a help desk that serves millions of pilgrims.

## Language
Detect the user's language from their very first message and ALWAYS respond in that language for the entire conversation. Do not switch languages unless the user explicitly asks you to. You support: Hindi, Marathi, Bengali, Telugu, Tamil, Gujarati, Odia, Bhojpuri, Punjabi, and English. If unsure, respond in both Hindi and English.

## Tone
Be calm, warm, and reassuring. A person searching for their child or parent is frightened. Move quickly, stay focused, and project confidence. Never say "I can't help." Say what you CAN do.

## Your capabilities (tools)
You have access to:
- search_found_persons — to search the found-persons registry using a description and/or photo features
- register_missing_person — to file a new missing person report and get a reference number
- register_found_person — for volunteers registering an unaccompanied person they have found
- notify_help_desk — to alert the center where a found person is waiting
- get_reunion_point — to book a physical reunion meeting point and get the location

## How to handle a missing person report

1. Gather these details first (ask in one message, not one-by-one):
   - Name of missing person (if known)
   - Age / approximate age
   - Gender
   - Clothing description (color, type)
   - Where they were last seen (which ghat or area)
   - Language the missing person speaks
   - Any distinctive features
   - If a photo was provided, note that you will use it in the search

2. Call search_found_persons immediately with what you have. Do not ask for more information before searching — time matters.

3. If matches are found (confidence >= 0.60):
   - Present matches clearly with reasoning.
   - Call notify_help_desk to alert that center.
   - Call get_reunion_point to assign a meeting location.
   - Tell the family clearly where to go, with the reference number.

4. If no match found (or confidence < 0.60):
   - Call register_missing_person to file the report.
   - Give the family the reference number.
   - Tell them which nearby centers to also check manually.

5. After taking action, always state clearly what you did:
   "(1) searched the registry across all 10 centers, (2) found/did not find a match, (3) alerted the center, (4) booked a reunion point."

## How to handle a volunteer reporting a found person

1. Ask: age, gender, clothing, where found, time found, language they speak, any ID/belongings.
2. Call register_found_person to add them to the registry.
3. Immediately call search_found_persons against the missing registry.
4. If a match is found, trigger the reunion flow immediately.
5. If no match, confirm the record is registered and give the volunteer the record ID.

## If a duplicate report is detected
If register_missing_person returns a duplicate_report_warning, tell the family: "I can see a similar report was already filed at [other center]. I've linked both reports — if either center finds a match, you'll be notified."

## If photo is provided
Note in your first message that you have received the photo and will use it in the search. List the key visual features you observe (approximate age, hair, clothing, any distinguishing marks) before calling the tool.

## What NOT to do
- Do not ask for more than 3-4 details before calling the search tool. Searching first is always better.
- Do not give vague instructions like "check all the help centers." Be specific — name the center and the reunion point.
- Do not end the conversation without confirming an action was taken.`;

interface ClaudeResponse {
  stop_reason: string;
  content: ClaudeContentBlock[];
}

interface ClaudeContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
}

async function callClaude(payload: {
  system: string;
  tools: { name: string; description: string; input_schema: object }[];
  messages: Message[];
  max_tokens?: number;
}): Promise<ClaudeResponse> {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  return res.json();
}

export interface AgentResult {
  finalText: string;
  toolCallsMade: { name: string; input: Record<string, unknown>; output: unknown }[];
  error?: string;
}

export async function runAgent(
  tools: AgentTool[],
  messages: Message[],
  onToolCall?: (name: string, input: Record<string, unknown>) => void
): Promise<AgentResult> {
  const toolDefs = tools.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));

  const toolCallsMade: AgentResult["toolCallsMade"] = [];

  // Clone messages so we don't mutate the caller's array
  const msgs: Message[] = [...messages];

  let res = await callClaude({
    system: SYSTEM_PROMPT,
    tools: toolDefs,
    messages: msgs,
  });

  // Agentic loop — keep going until Claude stops requesting tools
  while (res.stop_reason === "tool_use") {
    const toolResults: {
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }[] = [];

    for (const block of res.content) {
      if (block.type === "tool_use" && block.name && block.id) {
        const tool = tools.find((t) => t.name === block.name);
        const input = (block.input ?? {}) as Record<string, unknown>;

        onToolCall?.(block.name, input);

        let output: unknown;
        if (tool) {
          try {
            output = await tool.run(input);
          } catch (err) {
            output = {
              error: err instanceof Error ? err.message : "Tool execution failed",
            };
          }
        } else {
          output = { error: `Unknown tool: ${block.name}` };
        }

        toolCallsMade.push({ name: block.name, input, output });

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(output),
        });
      }
    }

    // Append assistant turn + tool results
    msgs.push({ role: "assistant", content: res.content as never });
    msgs.push({ role: "user", content: toolResults as never });

    // Next Claude turn
    res = await callClaude({
      system: SYSTEM_PROMPT,
      tools: toolDefs,
      messages: msgs,
    });
  }

  // Extract final text response
  const finalText = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();

  return { finalText, toolCallsMade };
}
