import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { checkActionFn, fetchOntologyAuditFn } from "@/lib/creditagent/ontology/ontology.functions";
import { ACTION_TYPES, type ActionTypeId, type PreconditionId } from "@/lib/creditagent/ontology/actions";
import { OBJECT_TYPES } from "@/lib/creditagent/ontology/objects";
import { cn } from "@/lib/utils";

const PRECONDITION_LABEL: Record<PreconditionId, string> = {
  TARGET_EXISTS: "目标实体存在",
  MIRROR_WRITE_SCOPE: "镜像写入范围合法",
  PARENT_STATUS_CONSISTENT: "父子状态一致",
  COMPLIANCE_NOT_FAILED: "未被合规冻结",
  BID_STRATEGY_ACCEPTS_TARGET: "出价策略接受目标值",
  BUDGET_POOL_CONSERVED: "资金守恒",
  EXPERIMENT_DECIDABLE: "实验可判定",
};

type Field = { name: string; label: string; kind: "text" | "number"; optional?: boolean };

const ACTION_FIELDS: Record<ActionTypeId, Field[]> = {
  BUDGET_SHIFT: [
    { name: "toAdGroupId", label: "接收方广告组 ID", kind: "text" },
    { name: "fromAdGroupId", label: "出资方广告组 ID", kind: "text", optional: true },
    { name: "amount", label: "调拨金额", kind: "number" },
    { name: "nextDailyBudget", label: "调整后日预算", kind: "number" },
  ],
  BID_ADJUST: [
    { name: "adGroupId", label: "广告组 ID", kind: "text" },
    { name: "nextBidTarget", label: "调整后出价目标", kind: "number" },
  ],
  CREATIVE_PAUSE: [
    { name: "creativeId", label: "素材 ID", kind: "text" },
    { name: "adGroupId", label: "广告组 ID", kind: "text", optional: true },
  ],
  CREATIVE_REFRESH: [{ name: "creativeId", label: "素材 ID", kind: "text" }],
  VARIANT_PROMOTE: [
    { name: "experimentId", label: "实验 ID", kind: "text" },
    { name: "winnerVariantId", label: "胜出变体 ID", kind: "text" },
  ],
  COMPLIANCE_REJECT: [
    { name: "creativeId", label: "素材 ID", kind: "text" },
    { name: "reason", label: "驳回原因", kind: "text" },
  ],
};

type CheckResult = Awaited<ReturnType<typeof checkActionFn>>;

export function ActionsTab() {
  const [action, setAction] = useState<ActionTypeId>("BUDGET_SHIFT");
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  const check = useServerFn(checkActionFn);
  const fetchAudit = useServerFn(fetchOntologyAuditFn);
  const auditQuery = useQuery({
    queryKey: ["ontology-audit"],
    queryFn: () => fetchAudit({ data: { limit: 20 } }),
  });

  const def = ACTION_TYPES[action];
  const fields = ACTION_FIELDS[action];

  async function runCheck() {
    setRunning(true);
    setResult(null);
    try {
      const params: Record<string, unknown> = {};
      for (const f of fields) {
        const raw = (values[`${action}.${f.name}`] ?? "").trim();
        if (!raw) continue;
        params[f.name] = f.kind === "number" ? Number(raw) : raw;
      }
      setResult(await check({ data: { actionType: action, params } }));
    } catch {
      setResult(null);
    } finally {
      setRunning(false);
      void auditQuery.refetch();
    }
  }

  const violated = new Set((result?.result?.violations ?? []).map((v) => v.precondition));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">动作类型 × {Object.keys(ACTION_TYPES).length}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.values(ACTION_TYPES).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setAction(a.id);
                  setResult(null);
                }}
                className={cn(
                  "panel p-3 text-left transition-colors",
                  a.id === action ? "border-neon/50 shadow-neon" : "hover:border-neon/30",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{a.label}</span>
                  <span className="label-mono truncate">{a.id}</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  作用于 {OBJECT_TYPES[a.actsOn].label} · 改写{" "}
                  {a.mutatesColumns.length ? a.mutatesColumns.join(" / ") : "无字段"}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  副作用：{a.produces.map((p) => OBJECT_TYPES[p].label).join("、")}
                </p>
              </button>
            ))}
          </div>
        </section>

        <section className="panel space-y-3 p-4">
          <p className="label-mono">action preflight · 只校验不落库</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((f) => (
              <label key={f.name} className="space-y-1">
                <span className="block text-[11px] text-muted-foreground">
                  {f.label}
                  {f.optional ? "（可选）" : ""}
                </span>
                <input
                  value={values[`${action}.${f.name}`] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [`${action}.${f.name}`]: e.target.value }))
                  }
                  inputMode={f.kind === "number" ? "decimal" : "text"}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void runCheck()}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-md border border-neon/40 bg-neon/10 px-3 py-1.5 text-xs text-neon transition-colors hover:bg-neon/20 disabled:opacity-50"
          >
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            跑一遍不变量
          </button>

          <div className="space-y-1.5">
            {def.preconditions.map((p) => {
              const bad = violated.has(p);
              const detail = result?.result?.violations.find((v) => v.precondition === p);
              return (
                <div
                  key={p}
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                    !result
                      ? "border-border text-muted-foreground"
                      : bad
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-success/40 bg-success/10 text-success",
                  )}
                >
                  {!result ? (
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                  ) : bad ? (
                    <XCircle className="mt-0.5 size-3.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="font-mono text-[10px]">{p}</span> · {PRECONDITION_LABEL[p]}
                    {detail && <span className="block text-[11px]">{detail.detail}</span>}
                  </span>
                </div>
              );
            })}
          </div>

          {result?.paramError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
              参数 schema 校验失败：{result.paramError}
            </p>
          )}
          {result && !result.paramError && (
            <p className={cn("text-xs", result.ok ? "text-success" : "text-destructive")}>
              {result.ok
                ? "结构合法：该动作可以进入幅度护栏（agent_settings 限额）检查。"
                : "已拦截：动作在业务图谱上不成立，任何自动化路径都不会执行它。"}
            </p>
          )}
        </section>
      </div>

      <section className="panel p-4">
        <p className="label-mono flex items-center gap-1.5">
          <ShieldAlert className="size-3.5 text-warning" /> 近期本体拦截记录
        </p>
        {auditQuery.isLoading && (
          <p className="mt-2 text-xs text-muted-foreground">加载中…</p>
        )}
        {auditQuery.data?.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">暂无本体层拦截记录。</p>
        )}
        <ul className="mt-2 space-y-2">
          {(auditQuery.data ?? []).map((e) => (
            <li key={e.id} className="rounded-md border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                  {e.verdict}
                </span>
                <span className="font-mono">{e.action.replace("ONTOLOGY:", "")}</span>
                <span className="ml-auto text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString("zh-CN")}
                </span>
              </div>
              <p className="mt-1">{e.rule}</p>
              <p className="text-muted-foreground">{e.detail}</p>
              {e.targetId && (
                <p className="font-mono text-[10px] text-muted-foreground">target={e.targetId}</p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
