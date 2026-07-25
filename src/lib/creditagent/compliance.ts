// Mock compliance engine — Meta Special Ad Category + Google Personal Loans Policy.

export type RuleSeverity = "CRITICAL" | "WARNING";

export interface RuleResult {
  id: string;
  source: "Google Policy" | "Meta Policy" | "Fintech Policy";
  label: string;
  severity: RuleSeverity;
  passed: boolean;
  detail: string;
  weight: number;
}

export interface ComplianceInput {
  headline: string;
  bodyText: string;
  loanTermRange: string;
  maxApr: number;
  specialAdCategory: boolean;
}

export const BANNED_PHRASES = [
  "100% approval",
  "no credit check",
  "instant approval without income proof",
  "guaranteed approval",
  "guaranteed",
  "no income proof",
  "debt free forever",
];

const LEGAL_DISCLAIMER =
  "Representative example: borrow $5,000 over 24 months at 29.9% APR (fixed), monthly repayment $279.32, total repayable $6,703.68. Loan terms from 61 days to 36 months. Max APR 35.9%. Approval is subject to credit, income and affordability checks. CreditAgent Lending is a licensed lender. Late repayment may affect your credit score.";

function minTermDays(range: string): number | null {
  const m = range.match(/(\d+)\s*(day|days|month|months|year|years)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("day")) return n;
  if (unit.startsWith("month")) return n * 30;
  return n * 365;
}

export function scanCompliance(input: ComplianceInput): {
  score: number;
  rules: RuleResult[];
  status: "PASSED" | "WARNING" | "FAILED";
  blocked: boolean;
} {
  const text = `${input.headline} ${input.bodyText}`.toLowerCase();
  const hits = BANNED_PHRASES.filter((p) => text.includes(p));
  const minDays = minTermDays(input.loanTermRange);
  const aprMentioned = /apr/i.test(`${input.headline} ${input.bodyText}`);

  const rules: RuleResult[] = [
    {
      id: "g-term",
      source: "Google Policy",
      label: "明确标注还款期限（≥ 61 天）",
      severity: "CRITICAL",
      weight: 25,
      passed: minDays !== null && minDays >= 61,
      detail:
        minDays === null
          ? "未检测到有效的还款期限区间，Google 个人贷款政策强制要求披露。"
          : minDays >= 61
            ? `最短还款期限约 ${minDays} 天，符合 ≥ 61 天要求。`
            : `最短还款期限约 ${minDays} 天，低于 61 天，Google 将拒登。`,
    },
    {
      id: "g-apr",
      source: "Google Policy",
      label: "APR 披露且无高于 36% 的误导宣传",
      severity: "CRITICAL",
      weight: 25,
      passed: aprMentioned && input.maxApr > 0 && input.maxApr <= 36,
      detail:
        !aprMentioned || input.maxApr <= 0
          ? "文案缺少年化利率（APR）披露明细。"
          : input.maxApr > 36
            ? `最高 APR ${input.maxApr}% 超过 36% 上限，属于高风险宣传。`
            : `最高 APR ${input.maxApr}%，已在文案中披露。`,
    },
    {
      id: "f-banned",
      source: "Fintech Policy",
      label: "无合规禁词（100% Approval / No Credit Check 等）",
      severity: "CRITICAL",
      weight: 30,
      passed: hits.length === 0,
      detail:
        hits.length === 0
          ? "未检测到无条件批准类表述。"
          : `命中禁词：${hits.join("、")}。此类表述极易触发封号。`,
    },
    {
      id: "m-sac",
      source: "Meta Policy",
      label: "已勾选 Financial Products and Services 特殊广告类别",
      severity: "WARNING",
      weight: 12,
      passed: input.specialAdCategory,
      detail: input.specialAdCategory
        ? "特殊广告类别已声明，定向将自动受限（符合政策）。"
        : "未声明金融服务特殊广告类别，Meta 审核可能直接拒绝并累积账户风险分。",
    },
    {
      id: "f-disclaimer",
      source: "Fintech Policy",
      label: "包含 Legal Disclaimer / 代表性示例",
      severity: "WARNING",
      weight: 8,
      passed: /representative|disclaimer|subject to credit/i.test(input.bodyText),
      detail: /representative|disclaimer|subject to credit/i.test(input.bodyText)
        ? "已包含代表性示例或审批条件声明。"
        : "建议追加代表性还款示例与审批条件声明。",
    },
  ];

  const score = rules.reduce((sum, r) => (r.passed ? sum + r.weight : sum), 0);
  const criticalFail = rules.some((r) => !r.passed && r.severity === "CRITICAL");
  const anyFail = rules.some((r) => !r.passed);

  return {
    score,
    rules,
    status: criticalFail ? "FAILED" : anyFail ? "WARNING" : "PASSED",
    blocked: criticalFail,
  };
}

/** Compliance Agent auto-fix: rewrite copy, strip banned phrases, append disclaimer. */
export function autoFixCompliance(input: ComplianceInput): {
  next: ComplianceInput;
  changes: string[];
} {
  const changes: string[] = [];
  let headline = input.headline;
  let bodyText = input.bodyText;

  const replacements: [RegExp, string][] = [
    [/100%\s*approval/gi, "Fast eligibility check"],
    [/no credit check/gi, "Soft credit check, no impact on your score"],
    [/instant approval without income proof/gi, "Quick decision, subject to affordability checks"],
    [/guaranteed approval/gi, "Approval subject to credit checks"],
    [/\bguaranteed\b/gi, "subject to eligibility"],
    [/no income proof/gi, "simple income verification"],
    [/debt free forever/gi, "a clear repayment plan"],
  ];

  for (const [re, to] of replacements) {
    if (re.test(headline)) {
      headline = headline.replace(re, to);
      changes.push(`标题改写：移除禁词 → “${to}”`);
    }
    if (re.test(bodyText)) {
      bodyText = bodyText.replace(re, to);
      changes.push(`正文改写：移除禁词 → “${to}”`);
    }
  }

  let loanTermRange = input.loanTermRange;
  if (minTermDays(loanTermRange) === null || (minTermDays(loanTermRange) ?? 0) < 61) {
    loanTermRange = "61 days - 36 months";
    changes.push("补齐还款期限区间：61 days - 36 months（满足 Google ≥ 61 天）");
  }

  let maxApr = input.maxApr;
  if (maxApr <= 0 || maxApr > 36) {
    maxApr = 35.9;
    changes.push("最高 APR 归一为 35.9%（≤ 36% 上限）");
  }

  if (!/apr/i.test(bodyText)) {
    bodyText = `${bodyText.trim()} Representative APR ${maxApr}% (fixed). Terms ${loanTermRange}.`;
    changes.push("正文追加 APR 与期限披露明细");
  }

  if (!/representative example/i.test(bodyText)) {
    bodyText = `${bodyText.trim()}\n\n${LEGAL_DISCLAIMER}`;
    changes.push("末尾追加预置 Legal Disclaimer");
  }

  if (!input.specialAdCategory) {
    changes.push("自动勾选 Meta Financial Products and Services 特殊广告类别");
  }

  return {
    next: { headline, bodyText, loanTermRange, maxApr, specialAdCategory: true },
    changes: changes.length ? changes : ["文案已合规，无需修改。"],
  };
}
