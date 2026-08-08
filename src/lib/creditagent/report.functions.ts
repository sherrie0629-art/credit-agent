import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as report from "./report.server";

const weekSchema = z.enum(["this", "last"]);

export const fetchOpsAnalyticsFn = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ week: weekSchema }).parse(d))
  .handler(async ({ data }) => report.getOpsAnalyticsBundle(data.week));

export const fetchExecReportFn = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        week: weekSchema,
        includeAppendix: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) =>
    report.getExecWeeklyReport(data.week, data.includeAppendix ?? true),
  );
