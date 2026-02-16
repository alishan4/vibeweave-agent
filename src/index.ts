import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket
} from "@whiskeysockets/baileys";

import pino from "pino";
import { Boom } from "@hapi/boom";
import fs from "fs";
import path from "path";
import qrcode from "qrcode-terminal";

const logger = pino({ level: "info" });

const MY_NUMBER = "923245400743";
const AUTH_FOLDER = path.join(process.cwd(), "auth");
const RECONNECT_DELAY_MS = 3000;

let socket: WASocket | null = null;
let isReconnecting = false;

function log(level: "info" | "error" | "warn", message: string, data?: unknown) {
  if (level === "error") {
    logger.error(data || {}, message);
  } else if (level === "warn") {
    logger.warn(data || {}, message);
  } else {
    logger.info(data || {}, message);
  }
}

async function startBot() {
  if (isReconnecting) {
    log("warn", "⚠️ Already reconnecting, skipping duplicate startBot call");
    return;
  }

  try {
    if (!fs.existsSync(AUTH_FOLDER)) {
      fs.mkdirSync(AUTH_FOLDER, { recursive: true });
      log("info", "📁 Created auth folder");
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    socket = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      printQRInTerminal: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      qrTimeout: 60000
    });

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        log("info", "📲 QR Code Generated - Scan with WhatsApp");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        log("warn", "❌ Connection closed", {
          statusCode,
          shouldReconnect,
          reason: lastDisconnect?.error?.message
        });

        if (shouldReconnect) {
          isReconnecting = true;
          log("info", `🔄 Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);

          setTimeout(() => {
            isReconnecting = false;
            startBot();
          }, RECONNECT_DELAY_MS);
        } else {
          log("error", "🚪 Logged out. Delete auth folder and restart.");
          process.exit(1);
        }
      }

      if (connection === "open") {
        log("info", "✅ WhatsApp Connected Successfully");
        isReconnecting = false;
      }
    });

    socket.ev.on("messages.upsert", async ({ messages }) => {
      try {
        const msg = messages[0];
        if (!msg?.message) return;

        const jid = msg.key.remoteJid;
        const isFromMe = msg.key.fromMe;

        if (!jid) return;

        // Filter: Only private chat (no groups)
        if (jid.endsWith("@g.us")) return;

        // Filter: Only my messages
        if (!isFromMe) return;

        // Filter: Only self-chat (my number messaging myself)
        const selfChatJid = `${MY_NUMBER}@s.whatsapp.net`;
        if (jid !== selfChatJid) return;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text;

        if (!text) return;

        const cleanText = text.trim();

        // Prevent bot reply loops
        if (cleanText.startsWith("🤖")) return;

        // Filter: Only slash commands
        if (!cleanText.startsWith("/")) return;

        log("info", "🟢 Command received", { command: cleanText, jid });

        const command = cleanText.slice(1).toLowerCase();
        let reply = "";

        switch (command) {
          case "ping":
            reply = "🤖 pong";
            break;
          case "hi":
            reply = "🤖 Hello Alishan 🚀";
            break;
          case "time":
            reply = `🤖 ${new Date().toLocaleString()}`;
            break;
          default:
            reply = `🤖 Unknown command: ${command}`;
        }

        if (socket) {
          await socket.sendMessage(jid, { text: reply });
          log("info", "📤 Reply sent", { reply });
        }
      } catch (err) {
        log("error", "⚠️ Message handler error", err);
      }
    });
  } catch (err) {
    log("error", "🚨 Fatal startup error", err);
    isReconnecting = true;
    setTimeout(() => {
      isReconnecting = false;
      startBot();
    }, RECONNECT_DELAY_MS);
  }
}

process.on("SIGINT", () => {
  log("info", "🛑 SIGINT received, shutting down gracefully...");
  if (socket) {
    socket.end(undefined);
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("info", "🛑 SIGTERM received, shutting down gracefully...");
  if (socket) {
    socket.end(undefined);
  }
  process.exit(0);
});

log("info", "🚀 Starting WhatsApp Bot...");
startBot();
