// Shared (client-safe) types for the offline conversion feedback loop.

export type ConversionPlatform = "google" | "meta";

export type LeadEventType =
  | "LEAD"
  | "CREDIT_APPROVED"
  | "LOAN_DISBURSED"
  | "FIRST_PAYMENT_DEFAULT";

export type UploadStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";

export const EVENT_LABELS: Record<LeadEventType, string> = {
  LEAD: "线索提交",
  CREDIT_APPROVED: "授信通过",
  LOAN_DISBURSED: "成功放款",
  FIRST_PAYMENT_DEFAULT: "首期逾期",
};

export const UPLOAD_STATUS_LABELS: Record<UploadStatus, string> = {
  PENDING: "待回传",
  SENT: "已回传",
  FAILED: "回传失败",
  SKIPPED: "已跳过",
};

export const ERROR_LABELS: Record<string, string> = {
  UNPARSEABLE_GCLID: "gclid 无法解析",
  CLICK_NOT_FOUND: "平台侧未匹配到点击",
  EXPIRED_CLICK: "点击已过期",
  OUTSIDE_LOOKBACK_WINDOW: "超出回溯窗口",
  INVALID_MATCH_KEYS: "匹配参数缺失",
  RATE_LIMITED: "触发配额限流",
  MISSING_CLICK_ID: "缺少点击标识",
  ADAPTER_DISABLED: "该平台回传已关闭",
};

export interface UploadRow {
  id: string;
  eventId: string;
  platform: ConversionPlatform;
  status: UploadStatus;
  attempts: number;
  errorCode?: string;
  matchQuality: number;
  sentAt?: string;
  createdAt: string;
  requestPayload: unknown;
  responseBody: unknown;
  eventType: LeadEventType;
  value: number;
  occurredAt: string;
  leadId: string;
  channel: string;
  campaignId: string;
}

export interface ConversionSetting {
  platform: ConversionPlatform;
  mode: "MOCK" | "LIVE";
  enabled: boolean;
  destinationId: string;
  conversionAction: string;
  lookbackDays: number;
}

export interface ConversionKpis {
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  successRate: number;
  matchRate: number;
  avgLatencyMinutes: number;
  uploadedValue: number;
}

export interface AttributionDay {
  day: string;
  dbDisbursed: number;
  platformReported: number;
}

export interface ConversionSnapshot {
  kpis: ConversionKpis;
  uploads: UploadRow[];
  settings: ConversionSetting[];
  attribution: AttributionDay[];
  leadCount: number;
}
