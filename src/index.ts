import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys"
import pino from "pino"
import { Boom } from "@hapi/boom"

const logger = pino({ level: "silent" })

// 🔒 YOUR NUMBER (no +, no spaces)
const MY_NUMBER = "923245400743"

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth")
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    }
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut

      console.log("Connection closed. Reconnecting:", shouldReconnect)

      if (shouldReconnect) {
        startBot()
      }
    }

    if (connection === "open") {
      console.log("✅ Private WhatsApp Agent Ready")
    }
  })

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0]
      if (!msg?.message) return

      const jid = msg.key.remoteJid
      const isFromMe = msg.key.fromMe

      if (!jid) return

      // ❌ Ignore groups
      if (jid.endsWith("@g.us")) return

      // ❌ Ignore LID format completely
      if (jid.endsWith("@lid")) return

      // ❌ Only allow messages YOU send
      if (!isFromMe) return

      // ❌ Only allow your own number
      if (!jid.startsWith(MY_NUMBER)) return

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text

      if (!text) return

      const cleanText = text.trim()

      // ❌ Prevent loop (ignore bot replies)
      if (cleanText.startsWith("🤖")) return

      // ❌ Only slash commands
      if (!cleanText.startsWith("/")) return

      console.log("🟢 Private command:", cleanText)

      const command = cleanText.slice(1).trim().toLowerCase()

      let reply = ""

      switch (command) {
        case "ping":
          reply = "🤖 pong"
          break

        case "hi":
          reply = "🤖 Hello Alishan 🚀"
          break

        case "time":
          reply = `🤖 ${new Date().toLocaleString()}`
          break

        default:
          reply = `🤖 Command received: ${command}`
      }

      await sock.sendMessage(jid, { text: reply })

    } catch (err) {
      console.error("Error handling message:", err)
    }
  })
}

startBot()
