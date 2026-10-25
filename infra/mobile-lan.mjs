// Development only: opens VoiceDesk on your phone over home Wi-Fi (ADR 0024).
//
// An https proxy on this PC's Wi-Fi address (port 8443) that forwards to the web app on
// 127.0.0.1:3000, including live updates (SSE) and websockets. Phones need https for the
// microphone, installing the app and push notifications. It refuses anything that isn't on
// a private home network, and runs only while this command runs. Nothing is exposed to the
// internet, and the services themselves stay bound to 127.0.0.1 (security audit C2).
//
// Usage: pnpm mobile:lan   (needs mkcert once: winget install FiloSottile.mkcert)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const WEB = { host: "127.0.0.1", port: Number(process.env.WEB_PORT ?? 3000) };
const PORT = Number(process.env.MOBILE_LAN_PORT ?? 8443);
const CERT_DIR = join(process.cwd(), ".cache", "mobile-lan");

/** 10/8, 172.16/12, 192.168/16 (also as IPv4-mapped IPv6) and loopback. */
export function isPrivateAddress(address = "") {
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (ip === "127.0.0.1" || ip === "::1") return true;
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function wifiAddress() {
  if (process.env.MOBILE_LAN_HOST) return process.env.MOBILE_LAN_HOST;
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal && isPrivateAddress(net.address)) {
        return net.address;
      }
    }
  }
  return null;
}

function certificates(host) {
  const cert = join(CERT_DIR, `${host}.pem`);
  const key = join(CERT_DIR, `${host}-key.pem`);
  if (!existsSync(cert) || !existsSync(key)) {
    mkdirSync(CERT_DIR, { recursive: true });
    try {
      execFileSync("mkcert", ["-cert-file", cert, "-key-file", key, host, "localhost"], {
        stdio: "inherit",
      });
    } catch {
      console.error(
        "\nmkcert is needed once to make a certificate your phone can trust:\n" +
          "  winget install FiloSottile.mkcert\n  mkcert -install\nthen run pnpm mobile:lan again.",
      );
      process.exit(1);
    }
  }
  return { cert: readFileSync(cert), key: readFileSync(key) };
}

const host = wifiAddress();
if (!host) {
  console.error("No home-network (Wi-Fi) address found. Connect this PC to your Wi-Fi first.");
  process.exit(1);
}
const origin = `https://${host}:${PORT}`;

const server = createServer(certificates(host), (req, res) => {
  if (!isPrivateAddress(req.socket.remoteAddress)) {
    res.writeHead(403).end("Home network only");
    return;
  }
  const upstream = request(
    {
      ...WEB,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        "x-forwarded-proto": "https",
        "x-forwarded-host": `${host}:${PORT}`,
      },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502).end("VoiceDesk isn't running (pnpm dev)");
  });
  req.pipe(upstream);
});

// Websockets (Next's live reload in dev) are passed straight through.
server.on("upgrade", (req, socket, head) => {
  if (!isPrivateAddress(req.socket.remoteAddress)) return socket.destroy();
  const upstream = connect(WEB.port, WEB.host, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on("error", close);
  socket.on("error", close);
});

/** EXTRA_WEB_ORIGINS from the environment or .env (this script doesn't load .env itself). */
function extraOrigins() {
  let raw = process.env.EXTRA_WEB_ORIGINS ?? "";
  const envFile = join(process.cwd(), ".env");
  if (!raw && existsSync(envFile)) {
    const line = /^EXTRA_WEB_ORIGINS=(.*)$/m.exec(readFileSync(envFile, "utf8"));
    raw = line?.[1]?.trim() ?? "";
  }
  return raw.split(",").map((s) => s.trim());
}

server.listen(PORT, host, () => {
  const extra = extraOrigins();
  console.log(`\nVoiceDesk on your phone (same Wi-Fi): ${origin}\n`);
  if (!extra.includes(origin)) {
    console.log(
      "First time: add this line to .env, then restart pnpm dev:\n" +
        `  EXTRA_WEB_ORIGINS=${origin}\n`,
    );
  }
  try {
    const root = execFileSync("mkcert", ["-CAROOT"]).toString().trim();
    console.log(
      "Your phone must trust this PC's certificate once (Help → Install the app on your phone):\n" +
        `  copy ${join(root, "rootCA.pem")} to the phone and install it as a CA certificate.\n`,
    );
  } catch {
    // mkcert was found above; CAROOT is only advice.
  }
  console.log("Press Ctrl+C to stop. Nothing is reachable from the internet.");
});
server.on("error", (error) => {
  console.error(`Couldn't listen on ${host}:${PORT}: ${error.message}`);
  process.exit(1);
});
process.on("SIGINT", () => server.close(() => process.exit(0)));
