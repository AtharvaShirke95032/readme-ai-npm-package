import express, { Express, Request, Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { GeminiService } from "./gemini-service";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });
const app: Express = express();
const PORT = process.env.PORT || 3001;

app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

if (!apiKey) {
  console.error(
    "❌ Error: GOOGLE_GENERATIVE_AI_API_KEY environment variable is required!"
  );
  process.exit(1);
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    error: "Too many requests from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress;
    console.log(
      `🚫 Rate limit exceeded for IP: ${ip} at ${new Date().toISOString()}`
    );
    res.status(429).json({
      error: "Too many requests from this IP, please try again later.",
      retryAfter: "15 minutes",
    });
  },
});

app.use("/api/generate", (req: Request, res: Response, next) => {
  const ip = req.ip || req.socket.remoteAddress;
  console.log(`📥 Request from IP: ${ip} at ${new Date().toISOString()}`);
  next();
});

app.use("/api/generate", limiter);

app.post("/api/generate", async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress;
  const startTime = Date.now();

  try {
    const { projectInfo, sampleCode } = req.body;

    if (!projectInfo) {
      return res.status(400).json({ error: "projectInfo is required" });
    }

    if (!sampleCode) {
      return res.status(400).json({ error: "sampleCode is required" });
    }

    console.log(
      `✅ Processing request for project: ${
        projectInfo.name || "unknown"
      } from IP: ${ip}`
    );

    const geminiService = new GeminiService(apiKey);
    const readmeContent = await geminiService.generateReadme(
      projectInfo,
      sampleCode
    );

    const duration = Date.now() - startTime;
    console.log(`✅ Request completed in ${duration}ms for IP: ${ip}`);

    res.json({
      success: true,
      readme: readmeContent,
      projectInfo: {
        name: projectInfo.name,
        type: projectInfo.type,
        languages: projectInfo.languages,
        fileCount: projectInfo.files?.length || 0,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `❌ Error generating README for IP: ${ip} (${duration}ms):`,
      error
    );
    res.status(500).json({
      error: "Failed to generate README",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", service: "readme-ai" });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 README-AI Server running on port ${PORT}`);
    console.log(`📡 API endpoint: http://localhost:${PORT}/api/generate`);
    console.log(`🔑 API Key configured: ${apiKey ? "✅ Yes" : "❌ No"}`);
    console.log(`🛡️  Rate limit: 10 requests per 15 minutes per IP`);
    console.log(`📊 Request logging: Enabled\n`);
  });
}

export default app;
