const API = "https://api.dexscreener.com";

const TERMS = [
  "gta 6",
  "gta vi",
  "grand theft auto vi",
  "lucia",
  "jason",
  "vice city",
  "leonida"
];

const MIN_CAP = 50000;
const MAX_CAP = 100000;
const MIN_LIQUIDITY = 10000;

async function getJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
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

async function main() {
  const results = await Promise.all(
    TERMS.map(term =>
      getJson(
        `${API}/latest/dex/search?q=${encodeURIComponent(term)}`
      ).catch(() => ({ pairs: [] }))
    )
  );

  const tokens = new Set();

  for (const result of results) {
    for (const pair of result.pairs || []) {
      if (
        pair.chainId === "solana" &&
        pair.baseToken?.address
      ) {
        tokens.add(pair.baseToken.address);
      }
    }
  }

  const candidates = [];

  for (const address of tokens) {
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
          cap > MAX_CAP ||
          liquidity < MIN_LIQUIDITY
        ) continue;

        candidates.push({
          name: pair.baseToken.name,
          symbol: pair.baseToken.symbol,
          address,
          marketCap: cap,
          liquidity,
          volume24h: pair.volume?.h24 ?? 0,
          url: pair.url,
          verification: "NOT CONFIRMED",
          verdict: "REQUIRES MANUAL RISK CHECK"
        });
      }
    } catch (error) {
      console.error(address, error.message);
    }
  }

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    candidates
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
