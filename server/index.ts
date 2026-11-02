import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import chatRouter from "./routes/chat.js";
import githubRouter from "./routes/github.js";
import transcribeRouter from "./routes/transcribe.js";
import { createRateLimiter } from "./rateLimit.js";

const app = express();
const tenMinutes = 10 * 60 * 1000;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use("/api/github/push", express.json({ limit: "4mb" }));
app.use(express.json({ limit: "128kb" }));

app.get("/api/health", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

app.use("/api/chat", createRateLimiter({ limit: 30, windowMs: tenMinutes, message: "Too many chat requests. Please wait before trying again." }), chatRouter);
app.use("/api/transcribe", createRateLimiter({ limit: 10, windowMs: tenMinutes, message: "Too many voice requests. Please wait before trying again." }), transcribeRouter);
app.use("/api/github", githubRouter);

const safeErrorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (response.headersSent) return;

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      response.status(413).json({ error: "Audio upload exceeds the size limit." });
      return;
    }
    response.status(400).json({ error: "Invalid audio upload." });
    return;
  }

  const parserError = error as { type?: string };
  if (parserError?.type === "entity.too.large") {
    response.status(413).json({ error: "Request body is too large." });
    return;
  }

  response.status(500).json({ error: "The request could not be completed." });
};

app.use(safeErrorHandler);

export default app;
