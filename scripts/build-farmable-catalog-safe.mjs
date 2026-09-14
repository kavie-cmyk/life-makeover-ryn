const nativeFetch = globalThis.fetch;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let gate = Promise.resolve();
let lastRequestAt = 0;
const MIN_GAP_MS = 750;

async function takeTurn() {
  let release;
  const previous = gate;
  gate = new Promise(resolve => { release = resolve; });
  await previous;
  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastRequestAt));
  if (wait) await sleep(wait);
  lastRequestAt = Date.now();
  release();
}

globalThis.fetch = async function rateLimitedFetch(input, init) {
  const url = typeof input === "string" ? input : input?.url || "";
  if (!url.startsWith("https://lifemakeover.wiki.gg/api.php")) {
    return nativeFetch(input, init);
  }

  let lastResponse;
  for (let attempt = 1; attempt <= 8; attempt++) {
    await takeTurn();
    lastResponse = await nativeFetch(input, init);
    if (lastResponse.status !== 429 && lastResponse.status < 500) return lastResponse;

    const retryAfter = Number(lastResponse.headers.get("retry-after") || 0);
    const waitMs = Math.max(retryAfter * 1000, 4000 * attempt);
    console.warn(`Wiki ${lastResponse.status}; retry ${attempt}/8 after ${waitMs}ms`);
    await sleep(waitMs);
  }
  return lastResponse;
};

await import("./build-farmable-catalog.mjs");
