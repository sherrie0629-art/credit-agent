import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Pause, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/creditagent/AppShell";
import { ChannelBadge } from "@/components/creditagent/badges";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { agentApi, useAgentStore } from "@/lib/creditagent/store";
import type { Campaign } from "@/lib/creditagent/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/campaigns")({
  head: () => ({
    meta: [
      { title: "全托管预算调配引擎 | CreditAgent AI" },
      {
        name: "description",
        content:
          "Full-Auto / Semi-Auto 托管模式切换与多渠道预算矩阵：CPL、后端授信通过率与实际放款成本 CPS 一屏对比。",
      },
      { property: "og:title", content: "全托管预算调配引擎 | CreditAgent AI" },
      {
        property: "og:description",
        content: "Google Search / PMax 与 Meta Feed / Reels 的预算矩阵与 AI 调优建议。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CampaignsPage,
});

const STATUS_STYLE: Record<Campaign["status"], string> = {
  ACTIVE: "border-success/40 bg-success/12 text-success",
  PAUSED: "border-border bg-muted text-muted-foreground",
  LEARNING: "border-creative/40 bg-creative/12 text-creative",
  COMPLIANCE_HOLD: "border-compliance/40 bg-compliance/12 text-compliance",
};

const STATUS_LABEL: Record<Campaign["status"], string> = {
  ACTIVE: "投放中",
  PAUSED: "已暂停",
  LEARNING: "学习期",
  COMPLIANCE_HOLD: "合规拦截",
};


function BudgetCell({ campaign }: { campaign: Campaign }) {
  const [value, setValue] = useState(String(campaign.dailyBudget));
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(campaign.dailyBudget));
          setEditing(true);
        }}
        className="font-mono text-xs text-foreground underline decoration-dotted decoration-muted-foreground underline-offset-4"
      >
        ${campaign.dailyBudget.toLocaleString()}
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const next = Number(value);
        setEditing(false);
        if (!Number.isFinite(next) || next <= 0) return;
        await agentApi.setCampaignBudget(campaign.id, Math.round(next));
        toast.success("预算已更新（Mock Ads API）", {
          description: `${campaign.name} → $${Math.round(next).toLocaleString()}/日`,
        });
      }}
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        className="h-7 w-24 font-mono text-xs"
      />
    </form>
  );
}

function CampaignsPage() {
  const campaigns = useAgentStore((s) => s.campaigns);
  const mode = useAgentStore((s) => s.mode);
  const riskFirst = useAgentStore((s) => s.riskFirst);
  const [busyId, setBusyId] = useState<string | null>(null);

  const totalBudget = campaigns.reduce((s, c) => s + c.dailyBudget, 0);
  const totalSpent = campaigns.reduce((s, c) => s + c.spentToday, 0);
  const totalDisbursed = campaigns.reduce((s, c) => s + c.disbursedAmount, 0);
  const blendedCps =
    totalSpent / Math.max(1, campaigns.reduce((s, c) => s + c.approvedLoans, 0));

  return (
    <AppShell>
      <header className="panel p-5">
        <p className="label-mono">module 02</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          广告投放与预算调配
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          全托管预算调配引擎 · Planner Agent 按后端放款表现分配资金
        </p>


        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-border bg-background/50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-xs">托管模式</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {mode === "FULL_AUTO"
                    ? "全自动：Agent 直接调用广告 API 执行调价与预算转移。"
                    : "半自动：Agent 拟定计划后推送审批卡片，人工确认后执行。"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">半自动</span>
                <Switch
                  checked={mode === "FULL_AUTO"}
                  onCheckedChange={async (v) => {
                    await agentApi.setMode(v ? "FULL_AUTO" : "SEMI_AUTO");
                    toast.success(`托管模式已切换为${v ? "全自动" : "半自动"}`);
                  }}
                />
                <span className="text-[11px] text-neon">全自动</span>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border bg-background/50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-xs">风控优先模式</Label>

                <p className="mt-1 text-xs text-muted-foreground">
                  连续 20 个 Lead 授信通过率 &lt; 10% 时，Agent 自动暂停该广告组。
                </p>
              </div>
              <Switch
                checked={riskFirst}
                onCheckedChange={async (v) => {
                  const res = await agentApi.setRiskFirst(v);
                  if (v && res.pausedCampaigns.length) {
                    toast.warning("风控优先已触发自动暂停", {
                      description: res.pausedCampaigns.join("、"),
                    });
                  } else {
                    toast(`风控优先模式 ${v ? "已开启" : "已关闭"}`);
                  }
                }}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "今日预算总额", value: `$${totalBudget.toLocaleString()}` },
          { label: "今日已花费", value: `$${totalSpent.toLocaleString()}` },
          { label: "30 天放款金额", value: `$${(totalDisbursed / 1000).toFixed(0)}k` },
          { label: "综合放款成本 CPS", value: `$${blendedCps.toFixed(2)}` },
        ].map((s) => (
          <div key={s.label} className="panel p-4">
            <p className="label-mono">{s.label}</p>
            <p className="mt-2 font-mono text-xl neon-text">{s.value}</p>
          </div>
        ))}
      </div>

      <section className="panel mt-4 overflow-hidden">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-semibold tracking-wide">
            多渠道预算矩阵
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            聚合 Google Search / Performance Max 与 Meta Feed / Reels · 点击预算可手动接管
          </p>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="label-mono">渠道</TableHead>
                <TableHead className="label-mono">广告系列</TableHead>
                <TableHead className="label-mono">今日预算</TableHead>
                <TableHead className="label-mono">CPL</TableHead>
                <TableHead className="label-mono">后端授信通过率</TableHead>
                <TableHead className="label-mono">放款成本 CPS</TableHead>
                <TableHead className="label-mono">状态</TableHead>
                <TableHead className="label-mono">AI 建议 / 操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <ChannelBadge channel={c.channel} />
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {c.placement}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <p className="truncate text-sm">{c.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {c.leads} 条线索 · {c.approvedLoans} 笔通过
                    </p>
                  </TableCell>
                  <TableCell>
                    <BudgetCell campaign={c} />
                    <p className="font-mono text-[11px] text-muted-foreground">
                      已花费 ${c.spentToday.toLocaleString()}
                    </p>

                  </TableCell>
                  <TableCell className="font-mono text-xs">${c.cpl.toFixed(2)}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "font-mono text-xs",
                        c.last20ApprovalRate < 0.1
                          ? "text-destructive"
                          : c.last20ApprovalRate < 0.22
                            ? "text-warning"
                            : "text-success",
                      )}
                    >
                      {(c.last20ApprovalRate * 100).toFixed(1)}%
                    </span>
                    <p className="text-[11px] text-muted-foreground">最近 20 条线索</p>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "font-mono text-xs",
                        c.cps > 19 ? "text-destructive" : "text-success",
                      )}
                    >
                      ${c.cps.toFixed(2)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex rounded border px-2 py-0.5 text-[11px]",
                        STATUS_STYLE[c.status],
                      )}
                    >
                      {STATUS_LABEL[c.status]}
                    </span>
                  </TableCell>

                  <TableCell className="max-w-[280px]">
                    <p className="text-xs text-muted-foreground">{c.aiSuggestion}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === c.id}
                        className="text-[11px]"
                        onClick={async () => {
                          setBusyId(c.id);
                          try {
                            const d = await agentApi.applyAiSuggestion(c.id);
                            if (d?.status === "EXECUTED") {
                              toast.success("全自动模式已执行", { description: d.effect });
                            } else if (d) {
                              toast.warning("已推送至人工审批队列", { description: d.effect });
                            }
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        <Sparkles className="size-3.5" /> 应用建议
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === c.id}
                        className="text-[11px]"
                        onClick={async () => {
                          setBusyId(c.id);
                          try {
                            const next = c.status === "PAUSED" ? "ACTIVE" : "PAUSED";
                            await agentApi.setCampaignStatus(c.id, next);
                            toast(`${c.name} → ${STATUS_LABEL[next]}`);

                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        {c.status === "PAUSED" ? (
                          <>
                            <Play className="size-3.5" /> 启用
                          </>
                        ) : (
                          <>
                            <Pause className="size-3.5" /> 暂停
                          </>
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </AppShell>
  );
}
