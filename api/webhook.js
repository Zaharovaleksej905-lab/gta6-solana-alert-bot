export default async function handler(req, res) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.WEBHOOK_SECRET;
  const webhookUrl = "https://gta6-solana-alert-bot.vercel.app/api/webhook";

  if (!token || !secret) {
    return res.status(500).send("Missing environment variables");
  }

  if (req.method === "GET" && req.query.setup === "1") {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: secret,
          allowed_updates: ["message"]
        })
      }
    );

    const result = await response.json();
    return res.status(response.ok ? 200 : 500).json(result);
  }

  if (req.method === "GET") {
    return res.status(200).send("Bot is running");
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    return res.status(401).send("Unauthorized");
  }

  const message = req.body?.message;
  if (!message?.chat?.id) {
    return res.status(200).send("OK");
  }

  let reply = "Бот работает! Скоро подключим поиск GTA 6 токенов.";

  if (message.text === "/start") {
    reply = "Привет! GTA 6 Solana Alert Bot подключён. Скоро начну отслеживать новые токены.";
  }

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: message.chat.id,
      text: reply
    })
  });

  return res.status(200).send("OK");
}

