
CREATE TABLE public.campaigns (
  id text PRIMARY KEY,
  name text NOT NULL,
  channel text NOT NULL,
  placement text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  daily_budget numeric NOT NULL DEFAULT 0,
  spent_today numeric NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  leads bigint NOT NULL DEFAULT 0,
  approved_loans bigint NOT NULL DEFAULT 0,
  disbursed_amount numeric NOT NULL DEFAULT 0,
  cpl numeric NOT NULL DEFAULT 0,
  cps numeric NOT NULL DEFAULT 0,
  compliance_pass_rate numeric NOT NULL DEFAULT 0,
  last20_approval_rate numeric NOT NULL DEFAULT 0,
  ai_suggestion text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.campaigns TO service_role;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.agent_decisions (
  id text PRIMARY KEY,
  timestamp timestamptz NOT NULL DEFAULT now(),
  agent_type text NOT NULL,
  action_type text NOT NULL,
  target_channel text NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text NOT NULL,
  confidence_score numeric NOT NULL DEFAULT 0,
  reasoning_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  trigger_metric text NOT NULL,
  trigger_current_value numeric NOT NULL DEFAULT 0,
  trigger_threshold_value numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING_APPROVAL',
  effect text NOT NULL DEFAULT '',
  rollback_to text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.agent_decisions TO service_role;
ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.creative_assets (
  id text PRIMARY KEY,
  headline text NOT NULL,
  body_text text NOT NULL,
  image_url text,
  loan_term_range text NOT NULL DEFAULT '',
  max_apr numeric NOT NULL DEFAULT 0,
  compliance_status text NOT NULL DEFAULT 'WARNING',
  compliance_logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.creative_assets TO service_role;
ALTER TABLE public.creative_assets ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.agent_settings (
  id text PRIMARY KEY DEFAULT 'default',
  mode text NOT NULL DEFAULT 'SEMI_AUTO',
  risk_first boolean NOT NULL DEFAULT true,
  auto_takeovers int NOT NULL DEFAULT 0,
  cps_improvement_pct numeric NOT NULL DEFAULT 0,
  agent_online boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.agent_settings TO service_role;
ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.funnel_stages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stage text NOT NULL,
  value bigint NOT NULL,
  note text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0
);
GRANT ALL ON public.funnel_stages TO service_role;
ALTER TABLE public.funnel_stages ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.channel_trend (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day text NOT NULL,
  google_front_end_roi numeric NOT NULL,
  meta_front_end_roi numeric NOT NULL,
  google_true_roas numeric NOT NULL,
  meta_true_roas numeric NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
GRANT ALL ON public.channel_trend TO service_role;
ALTER TABLE public.channel_trend ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.channel_breakdown (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel text NOT NULL,
  spend numeric NOT NULL,
  disbursed numeric NOT NULL,
  cps numeric NOT NULL,
  approval numeric NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
GRANT ALL ON public.channel_breakdown TO service_role;
ALTER TABLE public.channel_breakdown ENABLE ROW LEVEL SECURITY;

INSERT INTO public.agent_settings (id, mode, risk_first, auto_takeovers, cps_improvement_pct, agent_online)
VALUES ('default', 'SEMI_AUTO', true, 37, 18.4, true);

INSERT INTO public.campaigns (id, name, channel, placement, status, daily_budget, spent_today, impressions, clicks, leads, approved_loans, disbursed_amount, cpl, cps, compliance_pass_rate, last20_approval_rate, ai_suggestion, sort_order) VALUES
('cmp_g_search_01','US Personal Loan — Exact Match','Google','Google Search','ACTIVE',5200,3810,412540,9840,612,214,1284000,6.22,17.8,0.98,0.35,'扩量 +15%：授信通过率 35% 高于阈值 22%',1),
('cmp_g_pmax_02','PMax — Debt Consolidation Q3','Google','Google Performance Max','LEARNING',3000,2140,780210,12410,498,118,702000,4.30,18.1,0.94,0.24,'保持观察：学习期剩余 2 天',2),
('cmp_m_feed_03','Meta Feed — Fast Cash Lookalike 3%','Meta','Meta Feed','ACTIVE',2400,2280,1204880,21400,1042,96,388000,2.19,23.75,0.86,0.09,'风控预警：近 20 条线索授信通过率 9% < 10%',3),
('cmp_m_reels_04','Meta Reels — Creator UGC Loan Stories','Meta','Meta Reels','COMPLIANCE_HOLD',1600,640,512300,14980,388,41,141500,1.65,15.6,0.61,0.16,'合规拦截：素材缺少 APR 与还款期限披露',4);

INSERT INTO public.agent_decisions (id, timestamp, agent_type, action_type, target_channel, campaign_id, campaign_name, confidence_score, reasoning_chain, trigger_metric, trigger_current_value, trigger_threshold_value, status, effect, rollback_to) VALUES
('dec_1042','2026-07-25T09:42:00Z','Planner','BUDGET_SHIFT','Google','cmp_g_search_01','US Personal Loan — Exact Match',0.91,
 '["拉取近 24h 数据：Meta Feed 线索 1,042 条，CPL $2.19（前端表现最优）。","对齐借贷 CRM 后端数据：Meta Feed 授信通过率 9.2%，Google Search 授信通过率 35.0%（差值 25.8pt）。","折算真实成本：Meta Feed CPS $23.75 vs Google Search CPS $17.80，Google 每笔放款便宜 25.1%。","Google Search 今日预算消耗 73%，尚有 impression share lost (budget) 18%，具备承接空间。","决策：从 Meta Feed 转移 $1,000 日预算至 Google Search，预计降低整体 CPS 约 6.4%。"]'::jsonb,
 'ApprovalRate',0.092,0.22,'EXECUTED','Meta Feed −$1,000 → Google Search +$1,000','Meta Feed $3,400 / Google Search $4,200'),
('dec_1041','2026-07-25T09:15:00Z','Compliance','COMPLIANCE_REJECT','Meta','cmp_m_reels_04','Meta Reels — Creator UGC Loan Stories',0.99,
 '["扫描新素材 crv_reels_88：正文包含 “Instant approval without income proof”。","命中 Fintech 禁词库（无条件批准类表述）与 Google Personal Loans Policy 误导性宣传条款。","素材未声明最长还款期限（Google 要求 ≥ 61 天），未披露最高 APR。","Meta 侧未勾选 Financial Products and Services 特殊广告类别，存在封号风险。","决策：阻断提交，广告系列置为 COMPLIANCE_HOLD，推送 Auto-Fix 建议。"]'::jsonb,
 'CPL',1.65,6.0,'EXECUTED','素材拦截 + 广告系列 COMPLIANCE_HOLD','Meta Reels ACTIVE'),
('dec_1040','2026-07-25T08:50:00Z','Execution','BID_ADJUST','Google','cmp_g_pmax_02','PMax — Debt Consolidation Q3',0.76,
 '["PMax 处于学习期，tCPA $42 下放款量偏低（118 笔 / 498 线索）。","后端 30 天 ROAS 2.4x，高于盈亏平衡线 1.8x。","决策：tCPA 上调 8%（$42 → $45.4），扩大高质量流量覆盖。"]'::jsonb,
 'ROAS',2.4,1.8,'EXECUTED','tCPA $42.00 → $45.36','tCPA $42.00'),
('dec_1039','2026-07-25T08:20:00Z','Planner','BUDGET_SHIFT','Meta','cmp_m_feed_03','Meta Feed — Fast Cash Lookalike 3%',0.68,
 '["Meta Feed 近 20 条线索授信通过率 9%，低于风控优先模式阈值 10%。","计划削减该广告系列日预算 42%（$2,400 → $1,400），幅度 > 30%。","变更幅度超过自动执行阈值，转入 Human-in-the-Loop 审批队列。"]'::jsonb,
 'CostPerDisbursement',23.75,19.0,'PENDING_APPROVAL','Meta Feed 日预算 $2,400 → $1,400（−42%）','Meta Feed $2,400'),
('dec_1038','2026-07-25T07:55:00Z','Creative','CREATIVE_PAUSE','Meta','cmp_m_feed_03','Meta Feed — Fast Cash Lookalike 3%',0.84,
 '["素材 crv_feed_12 疲劳度指标：frequency 4.8，CTR 7 日下降 38%。","该素材线索授信通过率 6.1%，显著低于账户均值 18.4%。","决策：暂停该素材，启用合规版变体 crv_feed_19（含 APR 披露）。"]'::jsonb,
 'ApprovalRate',0.061,0.15,'PENDING_APPROVAL','暂停 crv_feed_12 → 启用 crv_feed_19','crv_feed_12 ACTIVE');

INSERT INTO public.creative_assets (id, headline, body_text, loan_term_range, max_apr, compliance_status, compliance_logs, sort_order) VALUES
('crv_g_01','Personal Loans up to $25,000 — Fixed Rates','Check your rate in 2 minutes. Representative APR 12.9%–35.9%. Repayment terms from 12 to 60 months. Approval subject to credit and affordability checks.','12 months - 60 months',35.9,'PASSED','["Google Personal Loans Policy: 期限与 APR 披露完整。"]'::jsonb,1),
('crv_m_02','Need cash before payday?','Apply online and get a decision fast. Terms 61 days to 36 months. Max APR 34.9%.','61 days - 36 months',34.9,'WARNING','["Meta: 需勾选 Financial Products and Services 特殊广告类别。"]'::jsonb,2),
('crv_reels_88','100% Approval — No Credit Check!','Instant approval without income proof. Get money in your account today, guaranteed.','—',0,'FAILED','["命中禁词：100% Approval / No Credit Check / Instant approval without income proof。","缺少还款期限（≥ 61 天）与最高 APR 披露。"]'::jsonb,3);

INSERT INTO public.funnel_stages (stage, value, note, sort_order) VALUES
('Impressions',2909930,'四渠道聚合曝光',1),
('Clicks',58630,'CTR 2.01%',2),
('Form Leads',2540,'CPL $3.71',3),
('Credit Approved',469,'授信通过率 18.5%',4),
('Loan Disbursed',312,'CPS $19.02',5);

INSERT INTO public.channel_trend (day, google_front_end_roi, meta_front_end_roi, google_true_roas, meta_true_roas, sort_order) VALUES
('07-19',3.1,4.4,2.2,1.3,1),
('07-20',3.2,4.6,2.3,1.25,2),
('07-21',3.0,4.9,2.35,1.1,3),
('07-22',3.4,5.1,2.5,1.05,4),
('07-23',3.5,5.3,2.6,0.98,5),
('07-24',3.6,5.0,2.72,0.95,6),
('07-25',3.8,4.8,2.86,0.92,7);

INSERT INTO public.channel_breakdown (channel, spend, disbursed, cps, approval, sort_order) VALUES
('Google Search',3810,1284000,17.8,0.35,1),
('Google PMax',2140,702000,18.1,0.24,2),
('Meta Feed',2280,388000,23.75,0.09,3),
('Meta Reels',640,141500,15.6,0.16,4);
