import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ChevronRight,
  FolderTree,
  Loader2,
  Pause,
  Play,
  Plus,
  Sparkles,
} from "lucide-react";

import { ChannelBadge } from "@/components/creditagent/badges";
import { CreateCreativeForm } from "@/components/creditagent/structure/CreateCreativeForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  bidStrategiesFor,
  bidStrategyNeedsTarget,
  bidTargetLabel,
  placementsFor,
} from "@/lib/creditagent/structure";
import { agentApi, useAgentStore } from "@/lib/creditagent/store";
import type { AdGroup, Campaign, Channel } from "@/lib/creditagent/types";
import { cn } from "@/lib/utils";

type Selection =
  | { kind: "campaign"; id: string }
  | { kind: "adGroup"; id: string }
  | null;

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "投放中",
  PAUSED: "已暂停",
  LEARNING: "学习期",
  COMPLIANCE_HOLD: "合规拦截",
};

function errMsg(e: unknown) {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw.includes("COMPLIANCE_BLOCKED")) return "合规 FAILED 的素材不能设为 ACTIVE";
  if (raw.includes("BUDGET_DENIED:")) return raw.split("BUDGET_DENIED:")[1] ?? raw;
  if (raw.includes("PLACEMENT_INVALID")) return "版位与渠道不匹配";
  if (raw.includes("BID_STRATEGY_INVALID")) return "出价策略与渠道不匹配";
  if (raw.includes("BID_TARGET_INVALID")) return "请填写有效的目标出价金额（须大于 0）";
  return raw;
}

export function StructureTab() {
  const campaigns = useAgentStore((s) => s.campaigns);
  const adGroups = useAgentStore((s) => s.adGroups);
  const creatives = useAgentStore((s) => s.creatives);
  const placements = useAgentStore((s) => s.placements);

  const [selection, setSelection] = useState<Selection>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [wizardOpen, setWizardOpen] = useState(false);
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);

  const selectedCampaign =
    selection?.kind === "campaign" ? campaigns.find((c) => c.id === selection.id) : null;
  const selectedGroup =
    selection?.kind === "adGroup" ? adGroups.find((g) => g.id === selection.id) : null;

  const groupsByCampaign = useMemo(() => {
    const map = new Map<string, AdGroup[]>();
    for (const g of adGroups) {
      const list = map.get(g.campaignId) ?? [];
      list.push(g);
      map.set(g.campaignId, list);
    }
    return map;
  }, [adGroups]);

  return (
    <div className="space-y-4">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label-mono">structure</p>
            <h2 className="mt-1 text-sm font-semibold tracking-wide">投放结构管理</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Campaign → Ad Group → Creative · 本地为 SoT · Google 测试户可手工绑定
              resource name（MODE=test 时推送预算/状态）
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setWizardOpen(true)}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              新建向导
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreateCampaignOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              新建系列
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreateGroupOpen(true)}
              disabled={campaigns.length === 0}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              新建广告组
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="panel overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FolderTree className="h-4 w-4 text-muted-foreground" />
              结构树
            </div>
          </div>
          <ul className="max-h-[640px] overflow-y-auto p-2">
            {campaigns.map((camp) => {
              const groups = groupsByCampaign.get(camp.id) ?? [];
              const open = expanded[camp.id] ?? true;
              const campSelected =
                selection?.kind === "campaign" && selection.id === camp.id;
              return (
                <li key={camp.id} className="mb-1">
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60",
                      campSelected && "bg-muted",
                    )}
                    onClick={() => {
                      setSelection({ kind: "campaign", id: camp.id });
                      setExpanded((s) => ({ ...s, [camp.id]: !open }));
                    }}
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        open && "rotate-90",
                      )}
                    />
                    <ChannelBadge channel={camp.channel} />
                    <span className="min-w-0 flex-1 truncate font-medium">{camp.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {groups.length}
                    </span>
                  </button>
                  {open && (
                    <ul className="ml-5 border-l border-border pl-2">
                      {groups.map((g) => {
                        const groupSelected =
                          selection?.kind === "adGroup" && selection.id === g.id;
                        return (
                          <li key={g.id}>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/60",
                                groupSelected && "bg-muted",
                              )}
                              onClick={() => setSelection({ kind: "adGroup", id: g.id })}
                            >
                              <span className="min-w-0 truncate">{g.name}</span>
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                ${g.dailyBudget.toLocaleString()}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                      {groups.length === 0 && (
                        <li className="px-2 py-1.5 text-[11px] text-muted-foreground">
                          暂无广告组
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
            {campaigns.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                还没有广告系列，请用「新建向导」开工。
              </li>
            )}
          </ul>
        </section>

        <section className="panel min-h-[420px] p-5">
          {!selection && (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
              <p className="text-sm font-medium">选择左侧结构节点进行编辑</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                或使用「新建向导」一次完成：系列 → 广告组 → 挂素材。
              </p>
            </div>
          )}
          {selectedCampaign && (
            <CampaignEditor
              campaign={selectedCampaign}
              groupCount={(groupsByCampaign.get(selectedCampaign.id) ?? []).length}
              onSaved={() => toast.success("广告系列已更新")}
            />
          )}
          {selectedGroup && (
            <AdGroupEditor
              group={selectedGroup}
              creatives={creatives}
              placements={placements.filter((p) => p.adGroupId === selectedGroup.id)}
              onSaved={() => toast.success("广告组已更新")}
            />
          )}
        </section>
      </div>

      <CreateCampaignDialog
        open={createCampaignOpen}
        onOpenChange={setCreateCampaignOpen}
        onCreated={(id) => {
          setSelection({ kind: "campaign", id });
          setExpanded((s) => ({ ...s, [id]: true }));
        }}
      />
      <CreateAdGroupDialog
        open={createGroupOpen}
        onOpenChange={setCreateGroupOpen}
        campaigns={campaigns}
        defaultCampaignId={
          selection?.kind === "campaign"
            ? selection.id
            : selection?.kind === "adGroup"
              ? adGroups.find((g) => g.id === selection.id)?.campaignId
              : campaigns[0]?.id
        }
        onCreated={(id, campaignId) => {
          setExpanded((s) => ({ ...s, [campaignId]: true }));
          setSelection({ kind: "adGroup", id });
        }}
      />
      <StructureWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        campaigns={campaigns}
        creatives={creatives}
        onDone={(adGroupId, campaignId) => {
          setExpanded((s) => ({ ...s, [campaignId]: true }));
          setSelection({ kind: "adGroup", id: adGroupId });
        }}
      />
    </div>
  );
}

function CampaignEditor({
  campaign,
  groupCount,
  onSaved,
}: {
  campaign: Campaign;
  groupCount: number;
  onSaved: () => void;
}) {
  const [name, setName] = useState(campaign.name);
  const [status, setStatus] = useState<"ACTIVE" | "PAUSED">(
    campaign.status === "PAUSED" ? "PAUSED" : "ACTIVE",
  );
  const [dailyBudget, setDailyBudget] = useState(String(campaign.dailyBudget));
  const [googleResourceName, setGoogleResourceName] = useState(
    campaign.googleResourceName ?? "",
  );
  const [googleBudgetResourceName, setGoogleBudgetResourceName] = useState(
    campaign.googleBudgetResourceName ?? "",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(campaign.name);
    setStatus(campaign.status === "PAUSED" ? "PAUSED" : "ACTIVE");
    setDailyBudget(String(campaign.dailyBudget));
    setGoogleResourceName(campaign.googleResourceName ?? "");
    setGoogleBudgetResourceName(campaign.googleBudgetResourceName ?? "");
  }, [
    campaign.id,
    campaign.name,
    campaign.status,
    campaign.dailyBudget,
    campaign.googleResourceName,
    campaign.googleBudgetResourceName,
  ]);

  return (
    <div className="space-y-4">
      <div>
        <p className="label-mono">广告系列</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <ChannelBadge channel={campaign.channel} />
          <h3 className="text-base font-semibold">{campaign.name}</h3>
          <span className="font-mono text-[11px] text-muted-foreground">
            {groupCount} 个广告组 · CPS ${campaign.cps.toFixed(2)}
          </span>
        </div>
      </div>
      <form
        className="grid max-w-xl gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await agentApi.updateCampaign(campaign.id, {
              name,
              status,
              dailyBudget: Number(dailyBudget) || 0,
            });
            if (campaign.channel === "Google") {
              await agentApi.bindGoogleCampaign(
                campaign.id,
                googleResourceName.trim() || null,
                googleBudgetResourceName.trim() || null,
              );
            }
            onSaved();
          } catch (err) {
            toast.error("保存失败", { description: errMsg(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="名称">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <Field label="渠道（创建后不可改）">
          <Input value={campaign.channel} disabled />
        </Field>
        <Field label="状态">
          <Select value={status} onValueChange={(v) => setStatus(v as "ACTIVE" | "PAUSED")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">投放中 ACTIVE</SelectItem>
              <SelectItem value="PAUSED">已暂停 PAUSED</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="系列日预算（可选，软上限）">
          <Input
            type="number"
            min={0}
            value={dailyBudget}
            onChange={(e) => setDailyBudget(e.target.value)}
          />
        </Field>
        {campaign.channel === "Google" && (
          <>
            <Field label="Google campaign resource name">
              <Input
                value={googleResourceName}
                onChange={(e) => setGoogleResourceName(e.target.value)}
                placeholder="customers/123/campaigns/456"
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Google campaign_budget resource name">
              <Input
                value={googleBudgetResourceName}
                onChange={(e) => setGoogleBudgetResourceName(e.target.value)}
                placeholder="customers/123/campaignBudgets/789"
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                测试 API 改日预算写入此 CampaignBudget；未绑定则 MODE=test 下拒绝推送。
              </p>
            </Field>
          </>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            保存系列
          </Button>
          <Button type="button" size="sm" variant="outline" asChild>
            <Link to="/campaigns" search={{ tab: "budget" }}>
              查看预算矩阵
            </Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

function AdGroupEditor({
  group,
  creatives,
  placements,
  onSaved,
}: {
  group: AdGroup;
  creatives: import("@/lib/creditagent/types").CreativeAsset[];
  placements: import("@/lib/creditagent/types").CreativePlacement[];
  onSaved: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [placement, setPlacement] = useState(group.placement);
  const [audience, setAudience] = useState(group.audience);
  const [bidStrategy, setBidStrategy] = useState(group.bidStrategy);
  const [bidTarget, setBidTarget] = useState(
    group.bidTarget != null ? String(group.bidTarget) : "",
  );
  const [dailyBudget, setDailyBudget] = useState(String(group.dailyBudget));
  const [status, setStatus] = useState<"ACTIVE" | "PAUSED" | "LEARNING">(
    group.status === "COMPLIANCE_HOLD" ? "PAUSED" : (group.status as "ACTIVE" | "PAUSED" | "LEARNING"),
  );
  const [googleResourceName, setGoogleResourceName] = useState(group.googleResourceName ?? "");
  const [busy, setBusy] = useState(false);

  const [bindCreativeId, setBindCreativeId] = useState(creatives[0]?.id ?? "");
  const [bindShare, setBindShare] = useState("100");
  const [bindBusy, setBindBusy] = useState(false);

  useEffect(() => {
    setName(group.name);
    setPlacement(group.placement);
    setAudience(group.audience);
    setBidStrategy(group.bidStrategy);
    setBidTarget(group.bidTarget != null ? String(group.bidTarget) : "");
    setDailyBudget(String(group.dailyBudget));
    setStatus(
      group.status === "COMPLIANCE_HOLD"
        ? "PAUSED"
        : (group.status as "ACTIVE" | "PAUSED" | "LEARNING"),
    );
    setGoogleResourceName(group.googleResourceName ?? "");
  }, [
    group.id,
    group.name,
    group.placement,
    group.audience,
    group.bidStrategy,
    group.bidTarget,
    group.dailyBudget,
    group.status,
    group.googleResourceName,
  ]);

  const placementOptions = placementsFor(group.channel);
  const bidOptions = bidStrategiesFor(group.channel);

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono">广告组 · 执行单元</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <ChannelBadge channel={group.channel} />
          <h3 className="text-base font-semibold">{group.name}</h3>
          <span className="rounded border px-2 py-0.5 text-[11px]">
            {STATUS_LABEL[group.status] ?? group.status}
          </span>
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {group.campaignName} · CPL ${group.cpl.toFixed(2)} · CPS ${group.cps.toFixed(2)}
        </p>
      </div>

      <form
        className="grid max-w-xl gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (bidStrategyNeedsTarget(bidStrategy) && !(Number(bidTarget) > 0)) {
              toast.error("请填写目标出价金额");
              setBusy(false);
              return;
            }
            const res = await agentApi.updateAdGroup(group.id, {
              name,
              placement,
              audience,
              bidStrategy,
              bidTarget: bidStrategyNeedsTarget(bidStrategy) ? Number(bidTarget) : null,
              dailyBudget: Math.round(Number(dailyBudget)),
              status,
            });
            if (group.channel === "Google") {
              await agentApi.bindGoogleAdGroup(group.id, googleResourceName.trim() || null);
            }
            if (res.guardrail?.verdict === "CLAMP") {
              toast.warning("预算已被风控截断", { description: res.guardrail.detail });
            } else {
              onSaved();
            }
          } catch (err) {
            toast.error("保存失败", { description: errMsg(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="名称">
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="版位">
            <Select value={placement} onValueChange={setPlacement}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {placementOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
                {!placementOptions.includes(placement) && (
                  <SelectItem value={placement}>{placement}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="出价策略">
            <Select
              value={bidStrategy}
              onValueChange={(v) => {
                setBidStrategy(v);
                if (!bidStrategyNeedsTarget(v)) setBidTarget("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bidOptions.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
                {!bidOptions.includes(bidStrategy) && (
                  <SelectItem value={bidStrategy}>{bidStrategy}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {bidStrategyNeedsTarget(bidStrategy) && (
          <Field label={bidTargetLabel(bidStrategy)}>
            <Input
              type="number"
              min={0.01}
              step="0.01"
              value={bidTarget}
              onChange={(e) => setBidTarget(e.target.value)}
              required
              placeholder={bidStrategy === "Cost Cap" ? "例如 25" : "例如 42"}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              本地先存档；LIVE 同步到广告平台后才会真正生效。与账户 CPS 目标不是同一指标。
            </p>
          </Field>
        )}
        <Field label="受众摘要">
          <Textarea
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            rows={2}
            required
            maxLength={240}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="日预算 $">
            <Input
              type="number"
              min={1}
              value={dailyBudget}
              onChange={(e) => setDailyBudget(e.target.value)}
              required
            />
          </Field>
          <Field label="状态">
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as "ACTIVE" | "PAUSED" | "LEARNING")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LEARNING">学习期 LEARNING</SelectItem>
                <SelectItem value="ACTIVE">投放中 ACTIVE</SelectItem>
                <SelectItem value="PAUSED">已暂停 PAUSED</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {group.channel === "Google" && (
          <Field label="Google ad_group resource name">
            <Input
              value={googleResourceName}
              onChange={(e) => setGoogleResourceName(e.target.value)}
              placeholder="customers/123/adGroups/456"
              className="font-mono text-xs"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              手工绑定测试户资源；未绑定且 MODE=test 时状态/预算推送会被拒绝。
            </p>
          </Field>
        )}
        <Button type="submit" size="sm" disabled={busy} className="w-fit">
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          保存广告组
        </Button>
      </form>

      <div className="border-t border-border pt-4">
        <h4 className="text-sm font-semibold">素材绑定</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          同广告组 ACTIVE 份额合计建议 ≈ 100%。合规 FAILED 不可 ACTIVE。
        </p>
        <ul className="mt-3 space-y-2">
          {placements.map((p) => {
            const c = creatives.find((x) => x.id === p.creativeId);
            return (
              <li
                key={`${p.creativeId}-${p.adGroupId}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{c?.headline ?? p.creativeId}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    份额 {(p.share * 100).toFixed(0)}% · {p.status}
                    {c && ` · 合规 ${c.complianceStatus}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[11px]"
                  onClick={async () => {
                    try {
                      const next = p.status === "PAUSED" ? "ACTIVE" : "PAUSED";
                      await agentApi.updatePlacementStatus({
                        adGroupId: group.id,
                        creativeId: p.creativeId,
                        status: next,
                      });
                      toast(`${c?.headline ?? p.creativeId} → ${next}`);
                    } catch (err) {
                      toast.error("更新失败", { description: errMsg(err) });
                    }
                  }}
                >
                  {p.status === "PAUSED" ? (
                    <>
                      <Play className="mr-1 h-3 w-3" /> 启用
                    </>
                  ) : (
                    <>
                      <Pause className="mr-1 h-3 w-3" /> 暂停
                    </>
                  )}
                </Button>
              </li>
            );
          })}
          {placements.length === 0 && (
            <li className="text-xs text-muted-foreground">尚未绑定素材。</li>
          )}
        </ul>

        <form
          className="mt-4 grid max-w-xl gap-3 rounded-md border border-dashed border-border p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!bindCreativeId) return;
            setBindBusy(true);
            try {
              const share = Math.min(1, Math.max(0, Number(bindShare) / 100));
              const res = await agentApi.upsertPlacement({
                adGroupId: group.id,
                creativeId: bindCreativeId,
                share,
                status: "ACTIVE",
              });
              if (res.shareWarning) {
                toast.warning("已绑定，但 ACTIVE 份额合计偏离 100%", {
                  description: `当前合计 ${(res.activeShareSum * 100).toFixed(0)}%`,
                });
              } else {
                toast.success("素材已绑定");
              }
            } catch (err) {
              toast.error("绑定失败", { description: errMsg(err) });
            } finally {
              setBindBusy(false);
            }
          }}
        >
          <Field label="选择素材">
            <Select value={bindCreativeId} onValueChange={setBindCreativeId}>
              <SelectTrigger>
                <SelectValue placeholder="选择素材" />
              </SelectTrigger>
              <SelectContent>
                {creatives.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.headline} ({c.complianceStatus})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="流量份额 %">
            <Input
              type="number"
              min={0}
              max={100}
              value={bindShare}
              onChange={(e) => setBindShare(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={bindBusy || !bindCreativeId}>
              {bindBusy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              绑定到此广告组
            </Button>
            <Button type="button" size="sm" variant="outline" asChild>
              <Link to="/creative" search={{ tab: "library" }}>
                去素材中心新建
              </Link>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function CreateCampaignDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>("Google");
  const [status, setStatus] = useState<"ACTIVE" | "PAUSED">("ACTIVE");
  const [dailyBudget, setDailyBudget] = useState("0");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建广告系列</DialogTitle>
          <DialogDescription>渠道创建后不可修改。真正花钱在广告组日预算。</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const res = await agentApi.createCampaign({
                name,
                channel,
                status,
                dailyBudget: Number(dailyBudget) || 0,
              });
              toast.success("广告系列已创建");
              onCreated(res.id);
              onOpenChange(false);
              setName("");
            } catch (err) {
              toast.error("创建失败", { description: errMsg(err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="渠道">
            <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Google">Google</SelectItem>
                <SelectItem value="Meta">Meta</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="状态">
            <Select value={status} onValueChange={(v) => setStatus(v as "ACTIVE" | "PAUSED")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                <SelectItem value="PAUSED">PAUSED</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="系列日预算（可选）">
            <Input
              type="number"
              min={0}
              value={dailyBudget}
              onChange={(e) => setDailyBudget(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            创建
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateAdGroupDialog({
  open,
  onOpenChange,
  campaigns,
  defaultCampaignId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaigns: Campaign[];
  defaultCampaignId?: string;
  onCreated: (id: string, campaignId: string) => void;
}) {
  const [campaignId, setCampaignId] = useState(defaultCampaignId ?? campaigns[0]?.id ?? "");
  const campaign = campaigns.find((c) => c.id === campaignId);
  const channel = campaign?.channel ?? "Google";
  const [name, setName] = useState("");
  const [placement, setPlacement] = useState(placementsFor(channel)[0]);
  const [audience, setAudience] = useState("");
  const [bidStrategy, setBidStrategy] = useState(bidStrategiesFor(channel)[0]);
  const [bidTarget, setBidTarget] = useState("");
  const [dailyBudget, setDailyBudget] = useState("1000");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const id = defaultCampaignId ?? campaigns[0]?.id ?? "";
    setCampaignId(id);
    const ch = campaigns.find((c) => c.id === id)?.channel ?? "Google";
    setPlacement(placementsFor(ch)[0]);
    const strategy = bidStrategiesFor(ch)[0];
    setBidStrategy(strategy);
    setBidTarget(bidStrategyNeedsTarget(strategy) ? "42" : "");
  }, [open, defaultCampaignId, campaigns]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建广告组</DialogTitle>
          <DialogDescription>执行单元：版位、受众、出价与日预算。</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              if (bidStrategyNeedsTarget(bidStrategy) && !(Number(bidTarget) > 0)) {
                toast.error("请填写目标出价金额");
                setBusy(false);
                return;
              }
              const res = await agentApi.createAdGroup({
                campaignId,
                name,
                placement,
                audience,
                bidStrategy,
                bidTarget: bidStrategyNeedsTarget(bidStrategy) ? Number(bidTarget) : null,
                dailyBudget: Math.round(Number(dailyBudget)),
                status: "LEARNING",
              });
              if (res.guardrail?.verdict === "CLAMP") {
                toast.warning("已创建，预算被风控截断", { description: res.guardrail.detail });
              } else {
                toast.success("广告组已创建（学习期）");
              }
              onCreated(res.id, campaignId);
              onOpenChange(false);
              setName("");
              setAudience("");
            } catch (err) {
              toast.error("创建失败", { description: errMsg(err) });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="所属系列">
            <Select
              value={campaignId}
              onValueChange={(id) => {
                setCampaignId(id);
                const ch = campaigns.find((c) => c.id === id)?.channel ?? "Google";
                setPlacement(placementsFor(ch)[0]);
                const strategy = bidStrategiesFor(ch)[0];
                setBidStrategy(strategy);
                setBidTarget(bidStrategyNeedsTarget(strategy) ? "42" : "");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.channel} · {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="版位">
              <Select value={placement} onValueChange={setPlacement}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {placementsFor(channel).map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="出价策略">
              <Select
                value={bidStrategy}
                onValueChange={(v) => {
                  setBidStrategy(v);
                  if (!bidStrategyNeedsTarget(v)) setBidTarget("");
                  else if (!bidTarget) setBidTarget("42");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bidStrategiesFor(channel).map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {bidStrategyNeedsTarget(bidStrategy) && (
            <Field label={bidTargetLabel(bidStrategy)}>
              <Input
                type="number"
                min={0.01}
                step="0.01"
                value={bidTarget}
                onChange={(e) => setBidTarget(e.target.value)}
                required
              />
            </Field>
          )}
          <Field label="受众摘要">
            <Textarea
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              required
              rows={2}
              placeholder="高意图搜索 · 债务整合 Lookalike 3%"
            />
          </Field>
          <Field label="日预算 $">
            <Input
              type="number"
              min={1}
              value={dailyBudget}
              onChange={(e) => setDailyBudget(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" disabled={busy || !campaignId}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            创建（默认学习期）
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StructureWizard({
  open,
  onOpenChange,
  campaigns,
  creatives,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaigns: Campaign[];
  creatives: import("@/lib/creditagent/types").CreativeAsset[];
  onDone: (adGroupId: string, campaignId: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // Step 1
  const [useExistingCampaign, setUseExistingCampaign] = useState(campaigns.length > 0);
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [campName, setCampName] = useState("");
  const [channel, setChannel] = useState<Channel>("Google");

  // Step 2
  const resolvedChannel =
    useExistingCampaign
      ? (campaigns.find((c) => c.id === campaignId)?.channel ?? "Google")
      : channel;
  const [groupName, setGroupName] = useState("");
  const [placement, setPlacement] = useState(placementsFor(resolvedChannel)[0]);
  const [audience, setAudience] = useState("");
  const [bidStrategy, setBidStrategy] = useState(bidStrategiesFor(resolvedChannel)[0]);
  const [bidTarget, setBidTarget] = useState(
    bidStrategyNeedsTarget(bidStrategiesFor(resolvedChannel)[0]) ? "42" : "",
  );
  const [dailyBudget, setDailyBudget] = useState("1000");

  // Step 3
  const [creativeMode, setCreativeMode] = useState<"pick" | "create">(
    creatives.length > 0 ? "pick" : "create",
  );
  const [creativeId, setCreativeId] = useState(creatives[0]?.id ?? "");
  const [share, setShare] = useState("100");
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null);
  const [finalCampaignId, setFinalCampaignId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setUseExistingCampaign(campaigns.length > 0);
    setCampaignId(campaigns[0]?.id ?? "");
    setCampName("");
    setGroupName("");
    setAudience("");
    setCreatedGroupId(null);
    setFinalCampaignId(null);
    setCreativeMode(creatives.length > 0 ? "pick" : "create");
    setCreativeId(creatives[0]?.id ?? "");
  }, [open, campaigns, creatives]);

  useEffect(() => {
    setPlacement(placementsFor(resolvedChannel)[0]);
    const strategy = bidStrategiesFor(resolvedChannel)[0];
    setBidStrategy(strategy);
    setBidTarget(bidStrategyNeedsTarget(strategy) ? "42" : "");
  }, [resolvedChannel]);

  async function ensureStructure() {
    let cid = campaignId;
    if (!useExistingCampaign) {
      const camp = await agentApi.createCampaign({
        name: campName,
        channel,
        status: "ACTIVE",
      });
      cid = camp.id;
    }
    if (bidStrategyNeedsTarget(bidStrategy) && !(Number(bidTarget) > 0)) {
      throw new Error("BID_TARGET_INVALID");
    }
    const group = await agentApi.createAdGroup({
      campaignId: cid,
      name: groupName,
      placement,
      audience,
      bidStrategy,
      bidTarget: bidStrategyNeedsTarget(bidStrategy) ? Number(bidTarget) : null,
      dailyBudget: Math.round(Number(dailyBudget)),
      status: "LEARNING",
    });
    setCreatedGroupId(group.id);
    setFinalCampaignId(cid);
    return { adGroupId: group.id, campaignId: cid };
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建投放结构向导</DialogTitle>
          <DialogDescription>
            步骤 {step}/4 · 系列 → 广告组 → 挂素材 → 确认（仅写本地库）
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={useExistingCampaign ? "default" : "outline"}
                disabled={campaigns.length === 0}
                onClick={() => setUseExistingCampaign(true)}
              >
                使用已有系列
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!useExistingCampaign ? "default" : "outline"}
                onClick={() => setUseExistingCampaign(false)}
              >
                新建系列
              </Button>
            </div>
            {useExistingCampaign ? (
              <Field label="广告系列">
                <Select value={campaignId} onValueChange={setCampaignId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.channel} · {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <>
                <Field label="系列名称">
                  <Input value={campName} onChange={(e) => setCampName(e.target.value)} required />
                </Field>
                <Field label="渠道">
                  <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Google">Google</SelectItem>
                      <SelectItem value="Meta">Meta</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </>
            )}
            <Button
              size="sm"
              disabled={useExistingCampaign ? !campaignId : !campName.trim()}
              onClick={() => setStep(2)}
            >
              下一步
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">渠道：{resolvedChannel}</p>
            <Field label="广告组名称">
              <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="版位">
                <Select value={placement} onValueChange={setPlacement}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {placementsFor(resolvedChannel).map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="出价">
                <Select
                  value={bidStrategy}
                  onValueChange={(v) => {
                    setBidStrategy(v);
                    if (!bidStrategyNeedsTarget(v)) setBidTarget("");
                    else if (!bidTarget) setBidTarget("42");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {bidStrategiesFor(resolvedChannel).map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {bidStrategyNeedsTarget(bidStrategy) && (
              <Field label={bidTargetLabel(bidStrategy)}>
                <Input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={bidTarget}
                  onChange={(e) => setBidTarget(e.target.value)}
                  required
                />
              </Field>
            )}
            <Field label="受众摘要">
              <Textarea value={audience} onChange={(e) => setAudience(e.target.value)} rows={2} />
            </Field>
            <Field label="日预算 $">
              <Input
                type="number"
                min={1}
                value={dailyBudget}
                onChange={(e) => setDailyBudget(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setStep(1)}>
                上一步
              </Button>
              <Button
                size="sm"
                disabled={
                  !groupName.trim() ||
                  !audience.trim() ||
                  (bidStrategyNeedsTarget(bidStrategy) && !(Number(bidTarget) > 0))
                }
                onClick={() => setStep(3)}
              >
                下一步
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={creativeMode === "pick" ? "default" : "outline"}
                disabled={creatives.length === 0}
                onClick={() => setCreativeMode("pick")}
              >
                选择已有素材
              </Button>
              <Button
                type="button"
                size="sm"
                variant={creativeMode === "create" ? "default" : "outline"}
                onClick={() => setCreativeMode("create")}
              >
                现场新建素材
              </Button>
            </div>
            {creativeMode === "pick" ? (
              <>
                <Field label="素材">
                  <Select value={creativeId} onValueChange={setCreativeId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {creatives.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.headline} ({c.complianceStatus})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="流量份额 %">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={share}
                    onChange={(e) => setShare(e.target.value)}
                  />
                </Field>
              </>
            ) : (
              <CreateCreativeForm
                submitLabel="创建素材并继续"
                onCreated={(id) => {
                  setCreativeId(id);
                  setCreativeMode("pick");
                  toast.message("素材已就绪，请确认份额后进入摘要");
                }}
              />
            )}
            {creativeMode === "pick" && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setStep(2)}>
                  上一步
                </Button>
                <Button size="sm" disabled={!creativeId} onClick={() => setStep(4)}>
                  下一步
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1.5">
              <p>
                <span className="text-muted-foreground">系列：</span>
                {useExistingCampaign
                  ? campaigns.find((c) => c.id === campaignId)?.name
                  : campName}{" "}
                · {resolvedChannel}
              </p>
              <p>
                <span className="text-muted-foreground">广告组：</span>
                {groupName} · {placement} · {bidStrategy}
                {bidStrategyNeedsTarget(bidStrategy) ? ` · 目标 $${bidTarget}` : ""} · $
                {Number(dailyBudget).toLocaleString()}/日
              </p>
              <p>
                <span className="text-muted-foreground">受众：</span>
                {audience}
              </p>
              <p>
                <span className="text-muted-foreground">素材：</span>
                {creatives.find((c) => c.id === creativeId)?.headline ?? creativeId} · 份额{" "}
                {share}%
              </p>
              <p className="text-muted-foreground">
                同步到 Google / Meta：暂不可用（待 LIVE Adapter）
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setStep(3)} disabled={busy}>
                上一步
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const ids =
                      createdGroupId && finalCampaignId
                        ? { adGroupId: createdGroupId, campaignId: finalCampaignId }
                        : await ensureStructure();
                    const res = await agentApi.upsertPlacement({
                      adGroupId: ids.adGroupId,
                      creativeId,
                      share: Math.min(1, Math.max(0, Number(share) / 100)),
                      status: "ACTIVE",
                    });
                    if (res.shareWarning) {
                      toast.warning("结构已创建，份额合计偏离 100%", {
                        description: `当前 ${(res.activeShareSum * 100).toFixed(0)}%`,
                      });
                    } else {
                      toast.success("投放结构已写入本地库");
                    }
                    onDone(ids.adGroupId, ids.campaignId);
                    onOpenChange(false);
                  } catch (err) {
                    toast.error("创建失败", { description: errMsg(err) });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                确认写入
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
