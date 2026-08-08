import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { agentApi } from "@/lib/creditagent/store";

export function CreateCreativeForm({
  onCreated,
  submitLabel = "创建素材",
}: {
  onCreated?: (id: string) => void;
  submitLabel?: string;
}) {
  const [headline, setHeadline] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [loanTermRange, setLoanTermRange] = useState("12 months - 60 months");
  const [maxApr, setMaxApr] = useState("35.9");
  const [specialAdCategory, setSpecialAdCategory] = useState(true);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const res = await agentApi.createCreative({
            headline,
            bodyText,
            loanTermRange,
            maxApr: Number(maxApr),
            specialAdCategory,
          });
          if (res.blocked || res.complianceStatus === "FAILED") {
            toast.warning("素材已创建，但合规未通过", {
              description: "请先修复文案后再绑定为 ACTIVE 投放。",
            });
          } else if (res.complianceStatus === "WARNING") {
            toast.success("素材已创建（合规警告）", {
              description: "建议在合规审计页复核后再放量。",
            });
          } else {
            toast.success("素材已创建并通过合规扫描");
          }
          onCreated?.(res.id);
          setHeadline("");
          setBodyText("");
        } catch (err) {
          toast.error("创建失败", { description: String(err) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-1.5">
        <Label className="text-xs">标题 Headline</Label>
        <Input
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="Personal Loans up to $25,000 — Fixed Rates"
          required
          maxLength={200}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">正文 Body</Label>
        <Textarea
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          placeholder="Check your rate in 2 minutes. Representative APR…"
          required
          rows={4}
          maxLength={2000}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">贷款期限披露</Label>
          <Input
            value={loanTermRange}
            onChange={(e) => setLoanTermRange(e.target.value)}
            placeholder="12 months - 60 months"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">最高 APR %</Label>
          <Input
            type="number"
            step="0.1"
            min={0.1}
            max={100}
            value={maxApr}
            onChange={(e) => setMaxApr(e.target.value)}
            required
          />
        </div>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={specialAdCategory}
          onCheckedChange={(v) => setSpecialAdCategory(v === true)}
          className="mt-0.5"
        />
        <span>已确认 Meta「Financial Products and Services」特殊广告类别（投放 Meta 时必填）</span>
      </label>
      <p className="text-[11px] text-muted-foreground">
        主视觉可在创建后于素材库生成或上传。创建时会立即跑合规引擎。
      </p>
      <Button type="submit" size="sm" disabled={busy}>
        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  );
}
