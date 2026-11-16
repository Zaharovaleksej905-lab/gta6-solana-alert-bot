const API = "https://api.dexscreener.com";


const TERMS = [
  "gta 6",
  "gta vi",
  "grand theft auto vi",
  "lucia",
  "jason",
  "vice city",
  "leonida",

  "gta6",
  "grand theft auto",
  "rockstar games",
  "rockstar",
  "vice",
  "vice city beach",
  "leonida state",
  "port gellhorn",
  "ambrosia",
  "mount kalaga",
  "grassrivers",
  "w vice",
  "jason duval",
  "lucia caminos",
  "project americas",
  "blaine county",
  "whetstone",
  "gator keys",
  "gta6 token"
];

const MIN_CAP = 50000;
const MIN_LIQUIDITY = 10000;
const MAX_TOP_HOLDER_PCT = 10;
const MAX_TOP10_HOLDERS_PCT = 35;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const GITHUB_REF_NAME = process.env.GITHUB_REF_NAME || "main";

const STATE_PATH = "data/seen.json";

async function getJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function isGtaRelated(pair) {
  const text = [
    pair.baseToken?.name,
    pair.baseToken?.symbol,
    pair.quoteToken?.name,
    pair.info?.websites?.map(x => x.url).join(" "),
    pair.info?.socials?.map(x => x.handle).join(" ")
  ].filter(Boolean).join(" ").toLowerCase();

  return TERMS.some(term => text.includes(term));
}

async function loadSeen() {
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${STATE_PATH}?ref=${GITHUB_REF_NAME}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (response.status === 404) {
    return { tokens: [], sha: null };
  }

  if (!response.ok) {
    throw new Error(`GitHub read error: ${response.status}`);
  }

  const file = await response.json();
  const content = Buffer.from(file.content, "base64").toString("utf8");

  return {
    tokens: JSON.parse(content).tokens || [],
    sha: file.sha
  };
}

async function saveSeen(tokens, sha) {
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/contents/${STATE_PATH}`;

  const body = {
    message: "Update scanned token addresses",
    content: Buffer.from(
      JSON.stringify({ tokens }, null, 2)
    ).toString("base64"),
    branch: GITHUB_REF_NAME
  };

  if (sha) body.sha = sha;

  await getJson(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}


async function checkRugCheck(address) {
  const url = `https://api.rugcheck.xyz/v1/tokens/${address}/report`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`RugCheck error: ${response.status}`);
  }

  const report = await response.json();

  if (
    !report ||
    !report.token ||
    !Array.isArray(report.risks) ||
    !Array.isArray(report.topHolders) ||
    report.topHolders.length === 0
  ) {
    throw new Error("Incomplete RugCheck holder report");
  }

  const mintAuthority = report.token.mintAuthority;
  const freezeAuthority = report.token.freezeAuthority;

  if (mintAuthority === undefined || freezeAuthority === undefined) {
    throw new Error("Authority data unavailable");
  }

  // Exclude known pools, lockers and burn accounts.
  const excluded = new Set();

  for (const [account, info] of Object.entries(report.knownAccounts || {})) {
    const type = String(info?.type || "").toUpperCase();

    if (/AMM|POOL|LOCKER|BURN|DEAD|CURVE|INCINERATOR/.test(type)) {
      excluded.add(account);
    }
  }

  for (const market of report.markets || []) {
    for (const key of ["pubkey", "liquidityAAccount", "liquidityBAccount"]) {
      const value = market[key];

      if (typeof value === "string") {
        excluded.add(value);
      } else if (value && typeof value === "object") {
        if (value.pubkey) excluded.add(value.pubkey);
        if (value.owner) excluded.add(value.owner);
      }
    }
  }

  // Aggregate balances by owner wallet.
  const wallets = new Map();

  for (const holder of report.topHolders) {
    const owner = holder.owner || holder.address;
    const pct = Number(holder.pct);

    if (!owner || !Number.isFinite(pct) || pct < 0) {
      throw new Error("Invalid holder data");
    }

    if (excluded.has(owner) || excluded.has(holder.address)) {
      continue;
    }

    wallets.set(owner, (wallets.get(owner) || 0) + pct);
  }

  if (wallets.size === 0) {
    throw new Error("No verifiable holder wallets");
  }

  const percentages = [...wallets.values()].sort((a, b) => b - a);

  const topHolderPct = percentages[0];
  const top10Pct = percentages
    .slice(0, 10)
    .reduce((sum, pct) => sum + pct, 0);

  const activeMint = mintAuthority !== null;
  const activeFreeze = freezeAuthority !== null;

  const dangerousRisks = report.risks.filter(risk => {
    const level = String(risk.level || "").toLowerCase();
    return ["danger", "critical", "high"].includes(level);
  });

  const holderRisk =
    topHolderPct > MAX_TOP_HOLDER_PCT ||
    top10Pct > MAX_TOP10_HOLDERS_PCT;

  return {
    approved:
      !activeMint &&
      !activeFreeze &&
      dangerousRisks.length === 0 &&
      !holderRisk,

    activeMint,
    activeFreeze,
    holderRisk,
    topHolderPct,
    top10Pct,

    warnings: report.risks.filter(risk =>
      ["warn", "warning"].includes(String(risk.level || "").toLowerCase())
    ),

    score: report.score ?? null
  };
}

  return {
    approved: !activeMint && !activeFreeze && dangerousRisks.length === 0,
    activeMint,
    activeFreeze,
    warnings: report.risks.filter(risk =>
      ["warn", "warning"].includes(String(risk.level || "").toLowerCase())
    ),
    score: report.score ?? null
  };
}
async function sendTelegram(token) {
  const message = [
    "🎮 GTA 6 SOLANA ALERT",
    "",
    `Name: ${token.name}`,
    `Symbol: ${token.symbol}`,
    `Market cap: $${Math.round(token.marketCap).toLocaleString("en-US")}`,
    `Liquidity: $${Math.round(token.liquidity).toLocaleString("en-US")}`,
    `24h volume: $${Math.round(token.volume24h).toLocaleString("en-US")}`,
    "",
    `Contract: ${token.address}`,
    "",
    `DexScreener: ${token.url || "Link unavailable"}`,
    "",
    "⚠️ Verification: NOT CONFIRMED",
    `RugCheck: ${token.rugCheck}`,
`RugCheck score: ${token.rugCheckScore ?? "Unknown"}`,
`RugCheck warnings: ${token.rugCheckWarnings}`,
    "⚠️ Manual risk check required. This is not a safety guarantee or investment advice."
  ].join("\n");
  `Largest holder: ${token.topHolderPct.toFixed(2)}%`,
`Top 10 holders: ${token.top10Pct.toFixed(2)}%`,

  await getJson(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      disable_web_page_preview: true
    })
  });
}

async function main() {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID || !GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    throw new Error("Missing Telegram or GitHub environment variables.");
  }

  const results = await Promise.all(
    TERMS.map(term =>
      getJson(`${API}/latest/dex/search?q=${encodeURIComponent(term)}`)
        .catch(error => {
          console.error(`Search failed for "${term}":`, error.message);
          return { pairs: [] };
        })
    )
  );

  const addresses = new Set();

  for (const result of results) {
    for (const pair of result.pairs || []) {
      if (pair.chainId === "solana" && pair.baseToken?.address) {
        addresses.add(pair.baseToken.address);
      }
    }
  }

  const candidates = new Map();

  for (const address of addresses) {
    try {
      const pairs = await getJson(
        `${API}/token-pairs/v1/solana/${address}`
      );

      for (const pair of pairs || []) {
        if (!isGtaRelated(pair)) continue;

        const cap = Number(pair.marketCap ?? pair.fdv ?? 0);
        const liquidity = Number(pair.liquidity?.usd ?? 0);

        if (
  cap < MIN_CAP ||
  liquidity < MIN_LIQUIDITY
) continue;

        const candidate = {
          name: pair.baseToken?.name || "Unknown",
          symbol: pair.baseToken?.symbol || "Unknown",
          address,
          marketCap: cap,
          liquidity,
          volume24h: Number(pair.volume?.h24 || 0),
          url: pair.url,
          verification: "NOT CONFIRMED",
          verdict: "REQUIRES MANUAL RISK CHECK"
        };

        const previous = candidates.get(address);

        if (!previous || candidate.liquidity > previous.liquidity) {
          candidates.set(address, candidate);
        }
      }
    } catch (error) {
      console.error(address, error.message);
    }
  }

  
  const state = await loadSeen();
  const seen = new Set(state.tokens);

  const newTokens = [...candidates.values()].filter(
    token => !seen.has(token.address)
  );

  let sentAlerts = 0;
  let rejectedTokens = 0;
  let failedChecks = 0;

  for (const token of newTokens) {
    try {
      const risk = await checkRugCheck(token.address);

      if (!risk.approved) {
        rejectedTokens++;

        console.log("TOKEN REJECTED:", token.address, {
          activeMint: risk.activeMint,
          activeFreeze: risk.activeFreeze,
          score: risk.score
        });

        continue;
      }

      token.rugCheck = "PASSED BASIC CHECKS";
      token.rugCheckScore = risk.score;
      token.rugCheckWarnings = risk.warnings.length;
token.topHolderPct = risk.topHolderPct;
token.top10Pct = risk.top10Pct;
      await sendTelegram(token);

      sentAlerts++;
      seen.add(token.address);

      console.log("Telegram alert sent:", token.address);

    } catch (error) {
      failedChecks++;
      console.error("RUGCHECK FAILED:", token.address, error.message);
    }
  }

  if (sentAlerts > 0) {
    await saveSeen([...seen].slice(-5000), state.sha);
  }

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    found: candidates.size,
    newCandidates: newTokens.length,
    newAlerts: sentAlerts,
    rejected: rejectedTokens,
    failedChecks: failedChecks
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
