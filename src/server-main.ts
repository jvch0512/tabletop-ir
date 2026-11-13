import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 8700);
createServer().listen(port, "127.0.0.1", () => {
  console.log(`tabletop-ir listening on http://127.0.0.1:${port}`);
});
