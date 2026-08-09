/**
 * Google Ads test-account smoke cases (REST + SOCKS).
 * Usage: npx tsx scripts/google-ads-smoke.mts
 * Secrets are never printed.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

type Verdict = "PASS" | "FAIL" | "SKIP";

type CaseResult = {
  id: string;
  name: string;
  verdict: Verdict;
  ms: number;
  detail: string;
};

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(ROOT, ".env"));
loadEnvFile(resolve(ROOT, ".env.local"));

function maskId(id: string | null | undefined): string {
  if (!id) return "(none)";
  const d = id.replace(/\D/g, "");
  if (d.length < 6) return "***";
  return `${d.slice(0, 3)}…${d.slice(-3)}`;
}

async function runCase(
  id: string,
  name: string,
  fn: () => Promise<{ verdict: Verdict; detail: string }>,
): Promise<CaseResult> {
  const t0 = Date.now();
  try {
    const { verdict, detail } = await fn();
    return { id, name, verdict, ms: Date.now() - t0, detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id,
      name,
      verdict: "FAIL",
      ms: Date.now() - t0,
      detail: msg.slice(0, 280),
    };
  }
}

async function main() {
  const ads = await import("../src/lib/creditagent/google-ads.server.ts");
  const { requireGoogleBinding, GoogleAdsBindingError } = await import(
    "../src/lib/creditagent/google-ads.ts"
  );

  const results: CaseResult[] = [];

  results.push(
    await runCase("C1", "env_configured", async () => {
      const env = ads.getGoogleAdsEnvStatus();
      if (env.mode !== "test") {
        return { verdict: "FAIL", detail: `MODE=${env.mode} (need test)` };
      }
      if (!env.configured) {
        return {
          verdict: "FAIL",
          detail: `missing ${env.missing.join(", ") || "(unknown)"}`,
        };
      }
      return {
        verdict: "PASS",
        detail: `MODE=test CID=${maskId(env.customerId)} login=${maskId(env.loginCustomerId)}`,
      };
    }),
  );

  results.push(
    await runCase("C2", "proxy_present", async () => {
      const proxy = (
        process.env.GOOGLE_ADS_PROXY ||
        process.env.ALL_PROXY ||
        process.env.HTTPS_PROXY ||
        ""
      ).trim();
      if (!proxy) {
        return { verdict: "FAIL", detail: "no GOOGLE_ADS_PROXY / ALL_PROXY / HTTPS_PROXY" };
      }
      const kind = proxy.split(":")[0] ?? "proxy";
      return { verdict: "PASS", detail: `proxy scheme=${kind}` };
    }),
  );

  results.push(
    await runCase("C3", "ping_ok", async () => {
      const res = await ads.pingGoogleAds();
      if (!res.ok) {
        return {
          verdict: "FAIL",
          detail: `${res.message}${res.error ? ` | ${res.error.slice(0, 200)}` : ""}`,
        };
      }
      return {
        verdict: "PASS",
        detail: `${res.message} customers=${res.customers?.length ?? 0}`,
      };
    }),
  );

  results.push(
    await runCase("C4", "list_accessible_customers", async () => {
      const list = await ads.listAccessibleCustomers();
      if (!list.length) {
        return { verdict: "FAIL", detail: "empty accessible customers" };
      }
      const sample = list[0]!.replace(/customers\/(\d{3})\d+(\d{3})/, "customers/$1…$2");
      return { verdict: "PASS", detail: `count=${list.length} first=${sample}` };
    }),
  );

  let campaigns: Awaited<ReturnType<typeof ads.searchCampaigns>> = [];
  results.push(
    await runCase("C5", "search_campaigns", async () => {
      campaigns = await ads.searchCampaigns();
      const first = campaigns[0];
      return {
        verdict: "PASS",
        detail: first
          ? `count=${campaigns.length} first=${first.resourceName} budget=${first.budgetResourceName ?? "n/a"}`
          : "count=0 (empty account ok for smoke)",
      };
    }),
  );

  results.push(
    await runCase("C6", "search_ad_groups", async () => {
      const groups = await ads.searchAdGroups();
      const first = groups[0];
      return {
        verdict: "PASS",
        detail: first
          ? `count=${groups.length} first=${first.resourceName}`
          : "count=0 (empty account ok for smoke)",
      };
    }),
  );

  results.push(
    await runCase("C7", "require_binding_rejects", async () => {
      try {
        requireGoogleBinding({
          channel: "Google",
          adGroupId: "adg_smoke_unbound",
          adGroupResourceName: null,
          forBudget: true,
        });
        return { verdict: "FAIL", detail: "expected throw, got none" };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof GoogleAdsBindingError || msg.includes("GOOGLE_ADS_UNBOUND")) {
          return { verdict: "PASS", detail: "threw GOOGLE_ADS_UNBOUND as expected" };
        }
        return { verdict: "FAIL", detail: `unexpected error: ${msg.slice(0, 160)}` };
      }
    }),
  );

  results.push(
    await runCase("C8", "mutate_budget_roundtrip", async () => {
      if (!campaigns.length) {
        campaigns = await ads.searchCampaigns();
      }
      const target = campaigns.find((c) => c.budgetResourceName && c.budgetMicros != null);
      if (!target?.budgetResourceName || target.budgetMicros == null) {
        return {
          verdict: "SKIP",
          detail: "no campaign with budget resource + amount_micros to mutate",
        };
      }

      const originalMicros = target.budgetMicros;
      const originalDollars = originalMicros / 1_000_000;
      const bumpedDollars = Math.round((originalDollars + 1) * 100) / 100;

      await ads.mutateCampaignBudget(target.budgetResourceName, bumpedDollars);
      const afterBump = await ads.searchCampaigns();
      const bumped = afterBump.find((c) => c.budgetResourceName === target.budgetResourceName);
      const bumpedMicros = bumped?.budgetMicros;
      if (bumpedMicros == null || Math.abs(bumpedMicros - bumpedDollars * 1_000_000) > 1) {
        // best-effort restore even on verify fail
        await ads.mutateCampaignBudget(target.budgetResourceName, originalDollars);
        return {
          verdict: "FAIL",
          detail: `bump verify failed: expected ~${bumpedDollars} got micros=${bumpedMicros ?? "null"}; restored`,
        };
      }

      await ads.mutateCampaignBudget(target.budgetResourceName, originalDollars);
      const afterRestore = await ads.searchCampaigns();
      const restored = afterRestore.find((c) => c.budgetResourceName === target.budgetResourceName);
      const restoredMicros = restored?.budgetMicros;
      if (restoredMicros == null || Math.abs(restoredMicros - originalMicros) > 1) {
        return {
          verdict: "FAIL",
          detail: `restore verify failed: expected micros=${originalMicros} got=${restoredMicros ?? "null"}`,
        };
      }

      return {
        verdict: "PASS",
        detail: `budget ${target.budgetResourceName}: ${originalDollars} → ${bumpedDollars} → ${originalDollars}`,
      };
    }),
  );

  console.log("\nGoogle Ads API smoke results\n");
  console.log(
    "CID=",
    maskId(process.env.GOOGLE_ADS_CUSTOMER_ID),
    " MODE=",
    process.env.GOOGLE_ADS_MODE ?? "(unset)",
    "\n",
  );

  let pass = 0;
  let fail = 0;
  let skip = 0;
  for (const r of results) {
    if (r.verdict === "PASS") pass += 1;
    else if (r.verdict === "FAIL") fail += 1;
    else skip += 1;
    console.log(`[${r.verdict}] ${r.id} ${r.name} (${r.ms}ms)`);
    console.log(`       ${r.detail}`);
  }
  console.log(`\nSummary: PASS=${pass} FAIL=${fail} SKIP=${skip} total=${results.length}\n`);

  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("smoke runner crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
