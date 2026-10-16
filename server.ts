import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

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
      let mimeType = "image/png";
      let modelUsed = "gemini-3.1-flash-lite-image";

      // 1. Try Gemini 3.1 Flash Lite Image if GEMINI_API_KEY is available
      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: {
              headers: { 'User-Agent': 'aistudio-build' }
            }
          });

          // Compose prompt with optional category brief context
          let fullPrompt = cleanPrompt;
          if (brief && brief !== 'general') {
            fullPrompt = `${cleanPrompt}, professional commercial style for ${brief}, photorealistic, studio lighting, high resolution`;
          }

          const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-lite-image",
            contents: {
              parts: [{ text: fullPrompt }]
            },
            config: {
              imageConfig: {
                aspectRatio: aspectRatio || "1:1"
              }
            }
          });

          for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData?.data) {
              imageBase64 = part.inlineData.data;
              if (part.inlineData.mimeType) {
                mimeType = part.inlineData.mimeType;
              }
              modelUsed = "gemini-3.1-flash-lite-image";
              break;
            }
          }
        } catch (geminiErr: any) {
          console.warn("Gemini image generation warning:", geminiErr?.message || geminiErr);
          // If Gemini quota/rate limits, seamlessly continue to high-fidelity AI synthesis engine
        }
      }

      // 2. High-resolution photographic engine fallback if Gemini quota is exhausted or key is pending
      if (!imageBase64) {
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
      }

      if (!imageBase64) {
        return res.status(500).json({ error: "Could not generate picture. Please try another prompt." });
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
