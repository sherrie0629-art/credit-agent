/**
 * Meta Ads smoke checks (Phase 0 / 1).
 * Usage: META_ADS_MODE=test META_ACCESS_TOKEN=... META_AD_ACCOUNT_ID=act_... npm run test:meta-ads
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(name: string) {
  const p = resolve(process.cwd(), name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const { pingMetaAds, searchAdSets, getMetaAdsEnvStatus } = await import(
  "../src/lib/creditagent/meta-ads.server.ts"
);

function ok(name: string, detail?: string) {
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name: string, detail: string) {
  console.error(`FAIL  ${name} — ${detail}`);
}

let failed = 0;

async function main() {
  const env = getMetaAdsEnvStatus();
  console.log("Meta Ads smoke");
  console.log(`  mode=${env.mode} account=${env.adAccountId ?? "—"} graph=${env.graphVersion}`);

  if (env.mode !== "test") {
    fail("C1 MODE", "META_ADS_MODE 应为 test");
    failed += 1;
  } else ok("C1 MODE");

  if (!env.configured) {
    fail("C2 ENV", `缺少 ${env.missing.join(", ")}`);
    failed += 1;
    process.exit(1);
  } else ok("C2 ENV");

  const ping = await pingMetaAds();
  if (!ping.ok) {
    fail("C3 PING", ping.error ?? ping.message);
    failed += 1;
  } else {
    ok("C3 PING", ping.message);
    ok("C4 ACCOUNTS", `${ping.accounts?.length ?? 0} 个`);
    ok("C5 CAMPAIGNS", `${ping.campaigns?.length ?? 0} 个`);
  }

  try {
    const sets = await searchAdSets();
    ok("C6 ADSETS", `${sets.length} 个`);
  } catch (e) {
    fail("C6 ADSETS", e instanceof Error ? e.message : String(e));
    failed += 1;
  }

  console.log(failed ? `\n${failed} failed` : "\nAll checks passed (read-only)");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
