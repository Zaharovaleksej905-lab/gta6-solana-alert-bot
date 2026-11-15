export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Bot is running");
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (
    !secret ||
    req.headers["x-telegram-bot-api-secret-token"] !== secret
  ) {
    return res.status(401).send("Unauthorized");
  }

  const update = req.body;
  const message = update?.message;
  if (!message?.chat?.id) {
    return res.status(200).send("OK");
  }

  const chatId = message.chat.id;
  const text = message.text || "";

  let reply = "Бот работает! Ожидайте настройки поиска GTA 6 токенов.";

  if (text === "/start") {
    reply =
      "Привет! Я GTA 6 Solana Alert Bot. Скоро начну отслеживать новые токены и проверять риски.";
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: reply
    })
  });

  return res.status(200).send("OK");
}
