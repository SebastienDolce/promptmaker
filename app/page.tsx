'use client'
// pages/index.tsx
import React, { useEffect, useMemo, useState } from "react";

/**
 * Single-file Next.js page that implements:
 * - Insert Prompt mode
 * - Start from Scratch wizard
 * - Client-side chips & suggestions UI
 * - Calls /api/analyze (Netlify function or Next API route) which should proxy to OpenAI
 *
 * NOTE:
 * - Add Tailwind to your Next.js project (postcss, tailwind.config.js)
 * - On Netlify, set OPENAI_API_KEY in the site env vars.
 * - Example Netlify function code included at bottom of this file (in comments).
 */

/* ----------------------
   Types
   ----------------------*/
type ModelName = "gpt-4o" | "gpt-4" | "gpt-3.5";

type PartKey =
  | "role"
  | "context"
  | "input"
  | "task"
  | "constraints"
  | "style"
  | "format";

type Part = {
  key: PartKey;
  label: string;
  text: string; // user text / content
  suggestions?: string[]; // concrete suggestions user can pick from
};

type AnalyzeResponse = {
  parts: Part[];
  // a canonical assembled prompt (best-effort by model)
  assembled_prompt?: string;
};

/* ----------------------
   Constants & helpers
   ----------------------*/

const PARTS_ORDER: PartKey[] = [
  "role",
  "context",
  "input",
  "task",
  "constraints",
  "style",
  "format",
];

const PART_LABELS: Record<PartKey, string> = {
  role: "Role / Persona",
  context: "Context / Background",
  input: "Input Data",
  task: "Task / Instruction",
  constraints: "Constraints / Requirements",
  style: "Style / Tone",
  format: "Output Format",
};

const MODEL_OPTIONS: ModelName[] = ["gpt-4o", "gpt-4", "gpt-3.5"];

const CHIP_COLORS: Record<PartKey, string> = {
  role: "bg-indigo-100 text-indigo-800",
  context: "bg-amber-100 text-amber-800",
  input: "bg-emerald-100 text-emerald-800",
  task: "bg-rose-100 text-rose-800",
  constraints: "bg-sky-100 text-sky-800",
  style: "bg-fuchsia-100 text-fuchsia-800",
  format: "bg-lime-100 text-lime-800",
};

const DEFAULT_SUGGESTIONS: Record<PartKey, string[]> = {
  role: ["A beginner", "A student", "An expert", "A senior engineer", "A friendly mentor"],
  context: ["History of the topic", "Real-world applications", "Math foundations", "Company-specific context"],
  input: ["An article (URL)", "A dataset", "Personal notes", "This exact paragraph"],
  task: ["Summarize", "Explain step-by-step", "Generate code", "Compare alternatives", "Create an outline"],
  constraints: ["Short (200 words)", "Medium (500 words)", "Long (1000+ words)", "Bullet points", "Include references"],
  style: ["Casual", "Professional", "Technical", "Storytelling", "Concise"],
  format: ["Paragraph", "Bullet points", "JSON object", "Lesson plan", "Slide outline"],
};

/* ----------------------
   Local heuristic analyzer (fallback)
   ----------------------*/
function localHeuristicAnalyze(prompt: string): AnalyzeResponse {
  // Very simple heuristics: look for keywords and split sentences into parts.
  // This is a fallback when the /api/analyze endpoint isn't available.
  const lower = prompt.toLowerCase();

  const parts: Part[] = PARTS_ORDER.map((k) => ({
    key: k,
    label: PART_LABELS[k],
    text: "",
    suggestions: DEFAULT_SUGGESTIONS[k],
  }));

  // heuristics
  if (lower.includes("explain") || lower.includes("explain:")) {
    parts.find((p) => p.key === "task")!.text = "Explain the topic";
  }
  if (lower.includes("summarize") || lower.includes("summary")) {
    parts.find((p) => p.key === "task")!.text = "Summarize the text";
  }
  // role guesses
  if (lower.includes("beginner") || lower.includes("novice")) {
    parts.find((p) => p.key === "role")!.text = "A beginner";
  }
  // constraints
  const m = prompt.match(/(\d+)\s*(words|word|chars|sentences)/i);
  if (m) {
    parts.find((p) => p.key === "constraints")!.text = `About ${m[1]} words`;
  }

  // if it's multiple sentences, place the first as context
  const sentences = prompt.split(/[.?!]\s+/).filter(Boolean);
  if (sentences.length) {
    parts.find((p) => p.key === "context")!.text = sentences[0].slice(0, 200);
    if (sentences.length > 1) {
      parts.find((p) => p.key === "input")!.text = sentences.slice(1, 3).join(". ").slice(0, 400);
    }
  }

  const assembled = [
    parts.find((p) => p.key === "role")!.text,
    parts.find((p) => p.key === "context")!.text,
    parts.find((p) => p.key === "input")!.text,
    parts.find((p) => p.key === "task")!.text,
    parts.find((p) => p.key === "constraints")!.text,
    parts.find((p) => p.key === "style")!.text,
    parts.find((p) => p.key === "format")!.text,
  ]
    .filter(Boolean)
    .join(" | ");

  return { parts, assembled_prompt: assembled };
}

/* ----------------------
   UI components
   ----------------------*/

function Chip({
  part,
  onOpenSuggestions,
  onUpdate,
}: {
  part: Part;
  onOpenSuggestions: (p: PartKey) => void;
  onUpdate: (key: PartKey, newText: string) => void;
}) {
  const color = CHIP_COLORS[part.key];
  return (
    <div className="flex items-center space-x-2 m-1">
      <div
        className={`px-3 py-1 rounded-full shadow-inner cursor-pointer select-none ${color} border border-white/30`}
        onClick={() => onOpenSuggestions(part.key)}
        title={part.label}
      >
        <span className="text-sm font-medium">{part.text || part.label}</span>
      </div>
      <input
        className="w-48 px-2 py-1 rounded-md border border-slate-200 text-sm"
        value={part.text}
        placeholder={`Edit ${part.label.toLowerCase()}`}
        onChange={(e) => onUpdate(part.key, e.target.value)}
      />
    </div>
  );
}

/* ----------------------
   Main Page
   ----------------------*/

export default function PromptBuilderPage() {
  const [mode, setMode] = useState<"insert" | "scratch">("insert");
  const [model, setModel] = useState<ModelName>("gpt-4o");
  const [rawPrompt, setRawPrompt] = useState<string>(""); // user-entered prompt (insert mode)
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResponse | null>(null);
  const [loadingAnalyze, setLoadingAnalyze] = useState(false);
  const [openSuggestionFor, setOpenSuggestionFor] = useState<PartKey | null>(null);
  const [confirmedPrompt, setConfirmedPrompt] = useState<string | null>(null);

  // wizard state for 'start from scratch'
  const [wizardAnswers, setWizardAnswers] = useState<Record<string, string>>({});
  const wizardQuestions: { key: PartKey; q: string; suggestions: string[] }[] = [
    { key: "role", q: "Who should the AI be?", suggestions: DEFAULT_SUGGESTIONS.role },
    { key: "context", q: "What background/context matters?", suggestions: DEFAULT_SUGGESTIONS.context },
    { key: "input", q: "What input will you give the model?", suggestions: DEFAULT_SUGGESTIONS.input },
    { key: "task", q: "What is the main task?", suggestions: DEFAULT_SUGGESTIONS.task },
    { key: "constraints", q: "Any constraints (length, format)?", suggestions: DEFAULT_SUGGESTIONS.constraints },
    { key: "style", q: "Preferred tone/style?", suggestions: DEFAULT_SUGGESTIONS.style },
    { key: "format", q: "Desired output format?", suggestions: DEFAULT_SUGGESTIONS.format },
  ];

  // local parts state (mirrors analyzeResult.parts editable)
  const parts = useMemo(() => {
    if (analyzeResult) {
      // ensure consistent order
      const found: Part[] = PARTS_ORDER.map((k) => {
        const p = analyzeResult.parts.find((x) => x.key === k);
        return (
          p || {
            key: k,
            label: PART_LABELS[k],
            text: "",
            suggestions: DEFAULT_SUGGESTIONS[k],
          }
        );
      });
      return found;
    }
    // empty baseline
    return PARTS_ORDER.map((k) => ({
      key: k,
      label: PART_LABELS[k],
      text: "",
      suggestions: DEFAULT_SUGGESTIONS[k],
    }));
  }, [analyzeResult]);

  // editable copy of parts
  const [editableParts, setEditableParts] = useState<Part[]>(parts);

  useEffect(() => {
    setEditableParts(parts.map((p) => ({ ...p })));
  }, [analyzeResult]);

  // When model changes, we may want to tweak the system instructions used during analysis.
  // This is handled on the server (see server code below) by including model-specific modifiers.
  const analyzePrompt = async (prompt: string) => {
    setLoadingAnalyze(true);
    setAnalyzeResult(null);
    setConfirmedPrompt(null);
    setOpenSuggestionFor(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model }),
      });

      if (res.ok) {
        const json = (await res.json()) as AnalyzeResponse;
        // ensure suggestions exist
        const partsWithSuggestions = PARTS_ORDER.map((k) => {
          const p = json.parts.find((x) => x.key === k);
          if (p) return { ...p, suggestions: p.suggestions ?? DEFAULT_SUGGESTIONS[k] };
          return { key: k, label: PART_LABELS[k], text: "", suggestions: DEFAULT_SUGGESTIONS[k] };
        });
        setAnalyzeResult({ parts: partsWithSuggestions, assembled_prompt: json.assembled_prompt });
      } else {
        // fallback local analyze
        console.warn("analyze endpoint failed, using local heuristic");
        setAnalyzeResult(localHeuristicAnalyze(prompt));
      }
    } catch (e) {
      console.warn("analyze error, using local heuristic", e);
      setAnalyzeResult(localHeuristicAnalyze(prompt));
    } finally {
      setLoadingAnalyze(false);
    }
  };

  const handleOpenSuggestions = (key: PartKey) => {
    setOpenSuggestionFor((prev) => (prev === key ? null : key));
  };

  const updatePartText = (key: PartKey, newText: string) => {
    setEditableParts((prev) => prev.map((p) => (p.key === key ? { ...p, text: newText } : p)));
  };

  const pickSuggestion = (key: PartKey, suggestion: string) => {
    updatePartText(key, suggestion);
    setOpenSuggestionFor(null);
  };

  const confirmAssemble = () => {
    const ordered = editableParts
      .map((p) => (p.text?.trim() ? `${p.label}: ${p.text.trim()}` : ""))
      .filter(Boolean);
    const final = ordered.join("\n\n");
    setConfirmedPrompt(final);
  };

  const runWizardBuild = async () => {
    // build a prompt text from wizard answers, then analyze it
    const built = wizardQuestions
      .map((q) => {
        const a = wizardAnswers[q.key] || "";
        return a ? `${PART_LABELS[q.key]}: ${a}` : "";
      })
      .filter(Boolean)
      .join("\n");
    setRawPrompt(built);
    await analyzePrompt(built);
    setMode("insert");
  };

  // small UI helper to color chips
  const getChipColorClass = (k: PartKey) => CHIP_COLORS[k];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 flex items-start justify-center p-8">
      <div className="w-full max-w-4xl">
        <div className="p-6 rounded-2xl shadow-2xl bg-white/60 backdrop-blur-sm border border-white/40">
          <h1 className="text-2xl font-semibold mb-2">Prompt Builder & Analyzer</h1>
          <p className="text-sm text-slate-600 mb-6">
            Two modes: <strong>Insert Prompt</strong> — paste a prompt to analyze; or{" "}
            <strong>Start from Scratch</strong> — answer guided questions to build a prompt. Uses a model analysis endpoint that returns a JSON
            prompt breakdown.
          </p>

          <div className="flex gap-4 items-center mb-6">
            <div className="rounded-full bg-white/40 p-1 border border-white/30 shadow-inner flex">
              <button
                className={`px-4 py-2 rounded-full ${mode === "insert" ? "bg-white text-slate-900" : "text-slate-600"}`}
                onClick={() => setMode("insert")}
              >
                Insert Prompt
              </button>
              <button
                className={`px-4 py-2 rounded-full ${mode === "scratch" ? "bg-white text-slate-900" : "text-slate-600"}`}
                onClick={() => setMode("scratch")}
              >
                Start from Scratch
              </button>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <label className="text-sm text-slate-700">Model</label>
              <select
                className="px-3 py-2 rounded-md border"
                value={model}
                onChange={(e) => setModel(e.target.value as ModelName)}
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                className="px-3 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                onClick={() => {
                  if (mode === "insert") analyzePrompt(rawPrompt);
                  else runWizardBuild();
                }}
                disabled={loadingAnalyze}
              >
                {loadingAnalyze ? "Analyzing..." : "Analyze / Build"}
              </button>
            </div>
          </div>

          {/* Mode panels */}
          {mode === "insert" ? (
            <div>
              <textarea
                className="w-full p-4 rounded-xl border min-h-[120px] text-sm shadow-inner"
                placeholder="Paste or type a prompt here..."
                value={rawPrompt}
                onChange={(e) => setRawPrompt(e.target.value)}
              />
            </div>
          ) : (
            // wizard
            <div className="space-y-4">
              {wizardQuestions.map((q) => (
                <div key={q.key} className="p-3 bg-white rounded-lg border">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-full ${getChipColorClass(q.key)} text-xs font-semibold`}>{PART_LABELS[q.key]}</div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{q.q}</div>
                      <div className="mt-2 flex gap-2 flex-wrap">
                        {q.suggestions.map((s) => {
                          const active = wizardAnswers[q.key] === s;
                          return (
                            <button
                              key={s}
                              className={`px-3 py-1 rounded-full text-sm border ${active ? "bg-slate-100" : "bg-white"}`}
                              onClick={() => setWizardAnswers((prev) => ({ ...prev, [q.key]: s }))}
                            >
                              {s}
                            </button>
                          );
                        })}
                      </div>
                      <textarea
                        className="w-full p-2 mt-2 rounded-md border"
                        placeholder="Or type your own answer..."
                        value={wizardAnswers[q.key] || ""}
                        onChange={(e) => setWizardAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex justify-end">
                <button
                  className="px-4 py-2 rounded-md bg-emerald-600 text-white"
                  onClick={runWizardBuild}
                >
                  Build Prompt from Answers
                </button>
              </div>
            </div>
          )}

          {/* analysis result */}
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">Analysis</h2>

            {!analyzeResult && !loadingAnalyze && (
              <div className="p-4 rounded-md bg-white/60 border">No analysis yet — click Analyze / Build.</div>
            )}

            {loadingAnalyze && <div className="p-4 rounded-md bg-white/60 border">Analyzing prompt...</div>}

            {analyzeResult && (
              <div className="p-4 rounded-2xl bg-slate-50 border">
                <div className="mb-3">
                  <div className="text-sm text-slate-600">Editable parts — click a chip to see suggestions</div>
                </div>

                <div className="flex flex-wrap items-center">
                  {editableParts.map((p) => (
                    <div key={p.key} className="relative">
                      <Chip
                        part={p}
                        onOpenSuggestions={handleOpenSuggestions}
                        onUpdate={(k, newText) => updatePartText(k, newText)}
                      />

                      {/* dropdown */}
                      {openSuggestionFor === p.key && (
                        <div className="absolute z-30 mt-2 left-0 w-72 bg-white border rounded-lg shadow-lg p-3">
                          <div className="text-xs text-slate-500 mb-2">Suggestions</div>
                          <div className="flex flex-col gap-2 max-h-40 overflow-auto">
                            {(p.suggestions || []).map((s) => (
                              <button
                                key={s}
                                className="text-sm text-left px-3 py-2 rounded hover:bg-slate-100"
                                onClick={() => pickSuggestion(p.key, s)}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex gap-3">
                  <button className="px-4 py-2 rounded-md bg-sky-600 text-white" onClick={confirmAssemble}>
                    Confirm & Assemble Prompt
                  </button>
                  <button
                    className="px-4 py-2 rounded-md bg-white border"
                    onClick={() => {
                      // reset to analyzed
                      setEditableParts(analyzeResult.parts.map((p) => ({ ...p })));
                      setConfirmedPrompt(null);
                    }}
                  >
                    Reset Edits
                  </button>
                </div>

                {analyzeResult.assembled_prompt && (
                  <div className="mt-4 text-xs text-slate-500">Model-suggested assembled prompt (from analysis)</div>
                )}

                {analyzeResult.assembled_prompt && (
                  <pre className="mt-2 p-3 bg-white rounded-md border text-sm overflow-auto">{analyzeResult.assembled_prompt}</pre>
                )}

                {confirmedPrompt && (
                  <div className="mt-4">
                    <div className="text-sm text-slate-700 mb-2">Final Prompt (copy & use):</div>
                    <textarea className="w-full p-3 rounded-md border" rows={8} value={confirmedPrompt} readOnly />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* footer */}
          <div className="mt-6 text-xs text-slate-500">
            <div>Server analyze endpoint: <code>/api/analyze</code> — it should forward to your AI provider using the server-side env var <code>OPENAI_API_KEY</code>.</div>
            <div className="mt-2">Tip: Add small model-specific modifiers in the server function so the returned JSON matches the model's behaviour/limits.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------
   Server-side: Example Netlify Function (or Next API route)
   ----------------------
   Place this as a Netlify function at:
   - netlify/functions/analyze.js

   Or as Next.js API route at:
   - pages/api/analyze.ts

   The function must read process.env.OPENAI_API_KEY (set in Netlify site settings)
   and call an LLM. The code below uses OpenAI Chat Completions v1 as an example.

   Example (Node.js, CommonJS) for Netlify Functions:
   --------------------------------------------------
   // netlify/functions/analyze.js
   const fetch = require("node-fetch");

   exports.handler = async function (event, context) {
     try {
       const body = JSON.parse(event.body || "{}");
       const prompt = body.prompt || "";
       const model = body.model || "gpt-4o";

       // Adjust system prompt based on model
       let modelHint = "";
       if (model === "gpt-3.5") {
         modelHint = "You are using a faster, cheaper model; focus on concise JSON.";
       } else if (model === "gpt-4") {
         modelHint = "You are using a capable model; be thorough but return strict JSON.";
       } else {
         modelHint = "You are using the latest model. Return a detailed JSON breakdown.";
       }

       const system = `You are a prompt analyzer. Analyze the user's prompt and return a strict JSON object with the following shape:
       {
         "parts": [
           { "key": "role", "label": "Role / Persona", "text": "...", "suggestions": ["...","..."] },
           ...
         ],
         "assembled_prompt": "..."
       }
       Do not include any prose. Return only valid JSON. If some parts are missing, provide empty strings and suggestions arrays.
       Model hint: ${modelHint}
       User prompt: """${prompt}"""
       `;

       const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
         method: "POST",
         headers: {
           "Content-Type": "application/json",
           Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
         },
         body: JSON.stringify({
           model: model === "gpt-3.5" ? "gpt-3.5-turbo" : model === "gpt-4" ? "gpt-4" : "gpt-4o",
           messages: [
             { role: "system", content: system },
             { role: "user", content: prompt },
           ],
           max_tokens: 800,
           temperature: 0.0,
         }),
       });

       const data = await openaiRes.json();
       const text = data?.choices?.[0]?.message?.content ?? "{}";

       // Sometimes API returns code fences — try to strip them and parse JSON:
       const clean = text.replace(/^```json/, "").replace(/```$/g, "").trim();
       let parsed = {};
       try {
         parsed = JSON.parse(clean);
       } catch (err) {
         // fallback: return a minimal structure
         parsed = {
           parts: [
             { key: "role", label: "Role / Persona", text: "", suggestions: ["A beginner", "A student"] },
             { key: "context", label: "Context / Background", text: "", suggestions: ["Real-world applications"] },
             { key: "input", label: "Input Data", text: "", suggestions: ["An article", "Personal notes"] },
             { key: "task", label: "Task / Instruction", text: prompt, suggestions: ["Summarize", "Explain"] },
             { key: "constraints", label: "Constraints / Requirements", text: "", suggestions: ["Short (200 words)"] },
             { key: "style", label: "Style / Tone", text: "", suggestions: ["Casual"] },
             { key: "format", label: "Output Format", text: "", suggestions: ["Paragraph"] }
           ],
           assembled_prompt: prompt
         };
       }

       return {
         statusCode: 200,
         body: JSON.stringify(parsed),
       };
     } catch (err) {
       console.error(err);
       return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
     }
   };

   --------------------------------------------------
   Notes:
   - Ensure the server returns a strict JSON object (no surrounding prose).
   - You can swap the OpenAI endpoint for any provider that takes a system/user messages style.
   - Keep temperature low to get stable JSON.
*/

/* ----------------------
   End of file
   ----------------------*/
