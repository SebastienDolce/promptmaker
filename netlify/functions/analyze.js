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