// Development only: lets WhatsApp (Meta) deliver webhooks to this computer.
//
// Starts a local gateway that forwards ONLY /api/webhooks/* to the API and refuses everything
// else, then opens a free Cloudflare quick tunnel (temporary https address, no account) to the
// gateway. The rest of VoiceDesk stays unreachable from the internet.
//
// Usage: pnpm tunnel   (needs cloudflared: winget install --id Cloudflare.cloudflared)
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";

const API = { host: "127.0.0.1", port: Number(process.env.API_PORT ?? 4000) };
const GATEWAY_PORT = Number(process.env.TUNNEL_GATEWAY_PORT ?? 4300);

const gateway = createServer((req, res) => {
  if (!req.url?.startsWith("/api/webhooks/")) {
    res.writeHead(404).end("Not found");
    return;
  }
  const upstream = request(
    {
      ...API,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${API.host}:${API.port}` },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => res.writeHead(502).end("API not running"));
  req.pipe(upstream);
});

gateway.listen(GATEWAY_PORT, "127.0.0.1", () => {
  console.log(`Webhook gateway on http://127.0.0.1:${GATEWAY_PORT} (only /api/webhooks/*)`);
  if (process.env.TUNNEL_GATEWAY_ONLY === "1") return; // testing the gateway alone
  const tunnel = spawn("cloudflared", ["tunnel", "--url", `http://127.0.0.1:${GATEWAY_PORT}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const announce = (chunk) => {
    const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString());
    if (match) {
      console.log("\nPublic webhook address (changes each time you run this):");
      console.log(`  WhatsApp callback URL: ${match[0]}/api/webhooks/whatsapp\n`);
    }
  };
  tunnel.stdout.on("data", announce);
  tunnel.stderr.on("data", announce);
  tunnel.on("error", () => {
    console.error("cloudflared not found. Install it: winget install --id Cloudflare.cloudflared");
    process.exit(1);
  });
  tunnel.on("exit", (code) => process.exit(code ?? 0));
  const stop = () => {
    tunnel.kill();
    gateway.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
});
