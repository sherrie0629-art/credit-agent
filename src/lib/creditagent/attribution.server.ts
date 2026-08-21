// 前瞻归因：数据装配（server-only）。
import {
  TARGET_CPS,
  adjustForLag,
  buildMaturityCurve,
  buildPrescription,
  computeFactors,
  daysToBreach,
  decomposeCps,
  decomposeGrowth,
  linearForecast,
  type CpsDecomposition,
  type FactorSample,
  type Forecast,
  type GrowthDecomposition,
  type MaturityAdjustment,
  type Prescription,
  type AttributionBundle,
  type AttributionGroup,
} from "./attribution";

export type { AttributionBundle, AttributionGroup };

type Row = Record<string, any>;

const HORIZON_DAYS = 7;
const WINDOW_DAYS = 7;

async function db() {
  const { getReadClient } = await import("./read-client.server");
  return getReadClient();
}

const EMPTY_SAMPLE = (): FactorSample => ({
  spend: 0,
  clicks: 0,
  leads: 0,
  disbursed: 0,
  disbursedAmount: 0,
});

function addDays(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function emptyBundle(note: string): AttributionBundle {
  return {
    available: false,
    note,
    window: { curFrom: "", curTo: "", priorFrom: "", priorTo: "" },
    groups: [],
    portfolio: { decomposition: null, growth: null, curCps: 0, priorCps: 0, forecastCps: null },
    lag: null,
    target: TARGET_CPS,
  };
}

/**
 * 归因窗口锚定在「有日级投放数据的最后一天」，而不是 now：
 * 演示库与真实同步都可能滞后，锚定 now 会得到空窗口。
 */
export async function getAttributionBundle(maxBudgetDeltaPct = 30): Promise<AttributionBundle> {
  const supabase = await db();

  const [{ data: metricRows, error: metricErr }, { data: groupRows }, { data: segmentRows }, { data: creativeRows }] =
    await Promise.all([
      supabase
        .from("creative_metrics")
        .select("ad_group_id, creative_id, day, spend, clicks, impressions, cpl, cps")
        .not("ad_group_id", "is", null)
        .order("day", { ascending: true })
        .limit(5000),
      supabase
        .from("ad_groups")
        .select("id, name, channel, campaign_id, daily_budget, spent_today, audience, audience_segment_id"),
      supabase.from("audience_segments").select("id, name, channel"),
      supabase.from("creative_assets").select("id, headline"),
    ]);

  const metrics = (metricRows ?? []) as Row[];
  if (metricErr || metrics.length === 0) {
    return emptyBundle("暂无日级投放指标（creative_metrics），无法做因果拆解与趋势外推。");
  }

  const dataThrough = metrics.reduce((mx, r) => (String(r.day) > mx ? String(r.day) : mx), "0000-00-00");
  const curFrom = addDays(dataThrough, -(WINDOW_DAYS - 1));
  const priorTo = addDays(curFrom, -1);
  const priorFrom = addDays(priorTo, -(WINDOW_DAYS - 1));

  const segmentName = new Map<string, string>();
  for (const s of (segmentRows ?? []) as Row[]) {
    segmentName.set(String(s.id), String(s.name ?? s.id));
  }
  const creativeName = new Map<string, string>();
  for (const c of (creativeRows ?? []) as Row[]) {
    creativeName.set(String(c.id), String(c.headline ?? c.id));
  }

  const groupMeta = new Map<
    string,
    { name: string; channel: string; campaignId: string; segmentId: string; segmentLabel: string }
  >();
  for (const g of (groupRows ?? []) as Row[]) {
    const segId = g.audience_segment_id ? String(g.audience_segment_id) : "";
    groupMeta.set(String(g.id), {
      name: String(g.name ?? g.id),
      channel: String(g.channel ?? "-"),
      campaignId: String(g.campaign_id ?? ""),
      segmentId: segId || `text:${String(g.audience ?? "未标注受众")}`,
      segmentLabel: segId
        ? (segmentName.get(segId) ?? segId)
        : String(g.audience ?? "未标注受众"),
    });
  }


  // —— 花费 / 点击 / 线索 / 放款：统一以日级投放指标为准，保证口径同源 ——
  // leads = spend / CPL，disbursed = spend / CPS（平台日报口径），
  // 放款金额 = 放款笔数 × 历史平均单笔放款额（来自 lead_events）。
  const cur = new Map<string, FactorSample>();
  const prior = new Map<string, FactorSample>();
  const dailyCps = new Map<string, { day: string; cps: number }[]>();

  const [{ data: leadRows }, { data: eventRows }] = await Promise.all([
    supabase.from("leads").select("id, ad_group_id, click_at").limit(5000),
    supabase
      .from("lead_events")
      .select("lead_id, event_type, value, occurred_at")
      .eq("event_type", "LOAN_DISBURSED")
      .limit(5000),
  ]);

  const leads = (leadRows ?? []) as Row[];
  const events = (eventRows ?? []) as Row[];
  const leadById = new Map(leads.map((l) => [String(l.id), l]));

  const values = events.map((e) => Number(e.value ?? 0)).filter((v) => v > 0);
  const avgLoan = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 3000;

  for (const r of metrics) {
    const id = String(r.ad_group_id);
    const day = String(r.day);
    const spend = Number(r.spend ?? 0);
    const clicks = Number(r.clicks ?? 0);
    const cps = Number(r.cps ?? 0);
    const cpl = Number(r.cpl ?? 0);
    if (day >= priorFrom && day <= dataThrough) {
      const bucket = day >= curFrom ? cur : prior;
      const s = bucket.get(id) ?? EMPTY_SAMPLE();
      s.spend += spend;
      s.clicks += clicks;
      if (cpl > 0) s.leads += spend / cpl;
      if (cps > 0) {
        const d = spend / cps;
        s.disbursed += d;
        s.disbursedAmount += d * avgLoan;
      }
      bucket.set(id, s);
    }
    if (cps > 0) {
      const list = dailyCps.get(id) ?? [];
      list.push({ day, cps });
      dailyCps.set(id, list);
    }
  }

  // —— 时滞样本：仍取真实 leads → lead_events 的点击到放款间隔 ——
  const lagDays: number[] = [];
  for (const e of events) {
    const lead = leadById.get(String(e.lead_id));
    if (!lead) continue;
    const clickAt = new Date(lead.click_at).getTime();
    const at = new Date(e.occurred_at).getTime();
    if (Number.isFinite(clickAt) && Number.isFinite(at) && at >= clickAt) {
      lagDays.push((at - clickAt) / 86_400_000);
    }
  }

  const dayOf = (iso: string) => String(iso).slice(0, 10);

  // —— 逐组归因 ——
  const ids = [...new Set([...cur.keys(), ...prior.keys()])];
  const groups: AttributionGroup[] = [];

  for (const id of ids) {
    const c = cur.get(id) ?? EMPTY_SAMPLE();
    const p = prior.get(id) ?? EMPTY_SAMPLE();
    if (c.spend <= 0 && p.spend <= 0) continue;
    const meta = groupMeta.get(id);
    const series = (dailyCps.get(id) ?? []).filter((x) => x.day >= priorFrom).sort((a, b) => (a.day < b.day ? -1 : 1));
    const forecast = linearForecast(
      series.map((pt, i) => ({ t: i, v: pt.cps })),
      HORIZON_DAYS,
    );
    const cps = c.disbursed > 0 ? c.spend / c.disbursed : 0;
    const priorCps = p.disbursed > 0 ? p.spend / p.disbursed : 0;
    const forecastCps = forecast ? Math.max(0, forecast.predicted) : null;

    groups.push({
      adGroupId: id,
      adGroupName: meta?.name ?? id,
      campaignName: meta?.campaignId ?? "",
      channel: meta?.channel ?? "-",
      cur: c,
      prior: p,
      cps,
      priorCps,
      decomposition: decomposeCps(c, p),
      forecast,
      breachInDays: forecast ? daysToBreach(cps || forecast.predicted, forecast.slopePerDay) : null,
      prescription: buildPrescription({
        cps,
        disbursed: c.disbursed,
        spend: c.spend,
        forecastCps,
        slopePerDay: forecast?.slopePerDay ?? null,
        confidence: forecast?.confidence ?? "low",
        maxDeltaPct: maxBudgetDeltaPct,
      }),
      series,
    });
  }

  groups.sort((a, b) => b.cur.spend - a.cur.spend);

  // —— 组合层 ——
  const sumOf = (m: Map<string, FactorSample>): FactorSample =>
    [...m.values()].reduce(
      (acc, s) => ({
        spend: acc.spend + s.spend,
        clicks: acc.clicks + s.clicks,
        leads: acc.leads + s.leads,
        disbursed: acc.disbursed + s.disbursed,
        disbursedAmount: acc.disbursedAmount + s.disbursedAmount,
      }),
      EMPTY_SAMPLE(),
    );
  const curTotal = sumOf(cur);
  const priorTotal = sumOf(prior);
  const portfolioForecast = linearForecast(
    groups
      .flatMap((g) => g.series)
      .reduce((acc: { day: string; cps: number; n: number }[], pt) => {
        const hit = acc.find((x) => x.day === pt.day);
        if (hit) {
          hit.cps += pt.cps;
          hit.n += 1;
        } else acc.push({ day: pt.day, cps: pt.cps, n: 1 });
        return acc;
      }, [])
      .sort((a, b) => (a.day < b.day ? -1 : 1))
      .map((x, i) => ({ t: i, v: x.cps / x.n })),
    HORIZON_DAYS,
  );

  // —— 时滞成熟度 ——
  const curve = buildMaturityCurve(lagDays);
  let lag: AttributionBundle["lag"] = null;
  if (curve) {
    const anchor = new Date(`${dataThrough}T23:59:59Z`).getTime();
    const ages = leads
      .filter((l) => {
        const d = dayOf(l.click_at);
        return d >= curFrom && d <= dataThrough;
      })
      .map((l) => (anchor - new Date(l.click_at).getTime()) / 86_400_000);
    const adj = adjustForLag(curve, ages, curTotal.spend, curTotal.disbursed);
    if (adj) {
      lag = {
        ...adj,
        note: `放款中位时滞 ${adj.medianDays.toFixed(1)} 天、P90 ${adj.p90Days.toFixed(
          1,
        )} 天（样本 ${adj.samples} 笔）。本窗口线索成熟度约 ${(adj.maturity * 100).toFixed(
          0,
        )}%，未成熟部分已按历史曲线折算。`,
      };
    }
  }

  const curFactors = computeFactors(curTotal);
  const priorFactors = computeFactors(priorTotal);

  return {
    available: groups.length > 0,
    note: `归因窗口锚定日级数据最后一天 ${dataThrough}；本期 ${curFrom} ~ ${dataThrough}，对比期 ${priorFrom} ~ ${priorTo}。花费/点击/线索/放款均取自日级投放指标（同源口径），放款金额按历史平均单笔额折算；时滞曲线取自真实线索的点击→放款间隔。`,
    window: { curFrom, curTo: dataThrough, priorFrom, priorTo },
    groups,
    portfolio: {
      decomposition: decomposeCps(curTotal, priorTotal),
      growth: decomposeGrowth(
        groups.map((g) => ({ id: g.adGroupId, name: g.adGroupName, cur: g.cur, prior: g.prior })),
      ),
      curCps: curFactors?.cps ?? 0,
      priorCps: priorFactors?.cps ?? 0,
      forecastCps: portfolioForecast ? Math.max(0, portfolioForecast.predicted) : null,
    },
    lag,
    target: TARGET_CPS,
  };
}
