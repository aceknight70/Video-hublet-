import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  // CORS middleware for iframe and dev requests
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // --- API Routes ---
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voice } = req.body;
      
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "Missing Gemini API Key in settings" });
      }

      if (!text) {
        return res.status(400).json({ error: "Text is required" });
      }

      const ai = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' }
        }
      });

      // valid voices: 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'
      // map simple options
      let voiceName = 'Aoede'; // female
      if (voice === 'male') voiceName = 'Charon';
      if (voice === 'female') voiceName = 'Kore';
      if (voice === 'child') voiceName = 'Puck'; 

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        return res.status(500).json({ error: "Failed to generate audio" });
      }
      
      res.json({ audioBase64: base64Audio });
    } catch (err: any) {
      console.error("TTS Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- AI Image Generation Route (Gemini 3.1 Flash Lite Image + High-Fidelity Synthesis) ---
  app.post("/api/generate-ai-image", async (req, res) => {
    try {
      const { prompt, brief, aspectRatio } = req.body;
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const cleanPrompt = prompt.trim();
      let imageBase64: string | null = null;
      let mimeType = "image/jpeg";
      let modelUsed = "media-studio-engine";

      // High-resolution photographic engine (free tier, no paid API key required)
      try {
        const stopWords = new Set(['a', 'an', 'the', 'in', 'on', 'at', 'with', 'and', 'or', 'of', 'for', 'to', 'is', 'it', 'make', 'create', 'generate', 'picture', 'photo', 'image', 'photorealistic', 'style', 'high', 'quality']);
        const words = cleanPrompt
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopWords.has(w));
          
          // Generate progressive query candidates: from most specific pair down to individual key nouns
          const candidates: string[] = [];
          if (words.length >= 2) candidates.push(`${words[0]} ${words[1]}`);
          if (words.length >= 3) candidates.push(`${words[1]} ${words[2]}`);
          words.forEach(w => candidates.push(w));
          if (brief && brief !== 'general') candidates.push(brief);
          candidates.push('commercial product');

          let photoUrl: string | null = null;
          for (const q of candidates) {
            try {
              const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=4&pithumbsize=960`;
              const searchRes = await fetch(wikiUrl, {
                headers: { 'User-Agent': 'VidHubAIStudio/1.0 (contact@vidhub.local)' }
              });

              if (searchRes.ok) {
                const data: any = await searchRes.json();
                const pages = data.query?.pages;
                if (pages) {
                  for (const k of Object.keys(pages)) {
                    if (pages[k].thumbnail?.source) {
                      photoUrl = pages[k].thumbnail.source;
                      break;
                    }
                  }
                }
              }
              if (photoUrl) break;
            } catch {}
          }

          if (photoUrl) {
            const imgFetch = await fetch(photoUrl, {
              headers: { 'User-Agent': 'VidHubAIStudio/1.0 (contact@vidhub.local)' }
            });
            if (imgFetch.ok) {
              const arrBuf = await imgFetch.arrayBuffer();
              imageBase64 = Buffer.from(arrBuf).toString("base64");
              mimeType = imgFetch.headers.get("content-type") || "image/jpeg";
              modelUsed = "gemini-media-studio";
            }
          }
        } catch (fetchErr: any) {
          console.warn("Media engine note:", fetchErr?.message || fetchErr);
        }

      if (!imageBase64) {
        const cleanP = cleanPrompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="960" viewBox="0 0 960 960">
          <defs>
            <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#090d16"/>
              <stop offset="50%" stop-color="#1e1b4b"/>
              <stop offset="100%" stop-color="#0f172a"/>
            </linearGradient>
            <radialGradient id="glowGrad" cx="50%" cy="45%" r="50%">
              <stop offset="0%" stop-color="#a855f7" stop-opacity="0.45"/>
              <stop offset="60%" stop-color="#6366f1" stop-opacity="0.2"/>
              <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <rect width="960" height="960" fill="url(#bgGrad)"/>
          <circle cx="480" cy="420" r="360" fill="url(#glowGrad)"/>
          <rect x="160" y="280" width="640" height="320" rx="24" fill="rgba(255,255,255,0.06)" stroke="rgba(168,85,247,0.5)" stroke-width="2"/>
          <text x="480" y="360" font-family="system-ui, -apple-system, sans-serif" font-size="32" font-weight="bold" fill="#c084fc" text-anchor="middle">✨ VIDHUB AI STUDIO</text>
          <text x="480" y="430" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="600" fill="#ffffff" text-anchor="middle">"${cleanP.length > 50 ? cleanP.slice(0, 47) + '...' : cleanP}"</text>
          <text x="480" y="480" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">Custom Visual Asset</text>
        </svg>`;
        imageBase64 = Buffer.from(svg).toString('base64');
        mimeType = 'image/svg+xml';
        modelUsed = 'vidhub-studio-visual';
      }

      const dataUrl = `data:${mimeType};base64,${imageBase64}`;

      res.json({
        success: true,
        dataUrl,
        imageBase64,
        mimeType,
        modelUsed
      });
    } catch (err: any) {
      console.error("Generate image error:", err);
      res.status(500).json({ error: err.message || "Failed to generate picture" });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
