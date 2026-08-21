import { useState } from "react";
import { Lock, Pencil, ArrowRight, ArrowLeft } from "lucide-react";
import { OBJECT_TYPES, OBJECT_TYPE_IDS, type ObjectTypeId } from "@/lib/creditagent/ontology/objects";
import { incomingLinks, outgoingLinks } from "@/lib/creditagent/ontology/links";
import { cn } from "@/lib/utils";

const OVERVIEW = `Campaign ──contains──> AdGroup ──delivers──> CreativeAsset ──has──> CreativeVariant
                     │                        │                        └──> CreativeExperiment
                     │                        └──> Lead ──> LeadEvent
   AudienceSegment ──targets──┘
   AgentDecision ──acts_on──> Campaign / AdGroup / CreativeAsset
   AgentDecision ──produces──> BudgetPoolEntry     GuardrailEvent ──blocks──> AgentDecision`;

export function SchemaTab() {
  const [selected, setSelected] = useState<ObjectTypeId>("AdGroup");
  const def = OBJECT_TYPES[selected];
  const out = outgoingLinks(selected);
  const inc = incomingLinks(selected);

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <p className="label-mono">ontology overview</p>
        <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
          {OVERVIEW}
        </pre>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            实体类型 <span className="text-muted-foreground">× {OBJECT_TYPE_IDS.length}</span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {OBJECT_TYPE_IDS.map((id) => {
              const o = OBJECT_TYPES[id];
              const active = id === selected;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelected(id)}
                  className={cn(
                    "panel p-3 text-left transition-colors",
                    active ? "border-neon/50 shadow-neon" : "hover:border-neon/30",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">{o.label}</span>
                    <span className="label-mono truncate">{o.id}</span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {o.table} · {o.keyColumns.length} 属性
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {o.platformMirrored && (
                      <span className="rounded border border-warning/40 bg-warning/12 px-1.5 py-0.5 text-[10px] text-warning">
                        平台镜像
                      </span>
                    )}
                    {o.agentWritableColumns.length === 0 ? (
                      <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        <Lock className="size-3" /> 只读实体
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
                        <Pencil className="size-3" /> 可写 {o.agentWritableColumns.join(" / ")}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <article className="panel p-4">
            <p className="label-mono">selected object</p>
            <h3 className="mt-1 text-base font-semibold">
              {def.label} <span className="font-mono text-xs text-muted-foreground">{def.id}</span>
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              表 <span className="font-mono">{def.table}</span> · 主键{" "}
              <span className="font-mono">{def.idColumns.join(" + ")}</span>
            </p>
            <div className="mt-3">
              <p className="label-mono">关键属性</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {def.keyColumns.map((c) => (
                  <span
                    key={c}
                    className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                      def.agentWritableColumns.includes(c)
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {c}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                绿色为 Agent 白名单可写字段，其余字段任何自动化路径都改不了。
              </p>
            </div>
          </article>

          <LinkList title="出边（本实体指向）" links={out} dir="out" onJump={setSelected} />
          <LinkList title="入边（指向本实体）" links={inc} dir="in" onJump={setSelected} />
        </section>
      </div>
    </div>
  );
}

function LinkList({
  title,
  links,
  dir,
  onJump,
}: {
  title: string;
  links: ReturnType<typeof outgoingLinks>;
  dir: "in" | "out";
  onJump: (t: ObjectTypeId) => void;
}) {
  return (
    <article className="panel p-4">
      <p className="label-mono">{title}</p>
      {links.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">无。</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {links.map((l) => {
            const other = dir === "out" ? l.to : l.from;
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs">
                {dir === "out" ? (
                  <ArrowRight className="size-3.5 text-neon" />
                ) : (
                  <ArrowLeft className="size-3.5 text-muted-foreground" />
                )}
                <span>{l.label}</span>
                <button
                  type="button"
                  onClick={() => onJump(other)}
                  className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:border-neon/50 hover:text-neon"
                >
                  {OBJECT_TYPES[other].label}
                </button>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {l.cardinality} · fk={l.foreignKeyOnTo}
                  {l.through ? ` · via ${l.through.table}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
