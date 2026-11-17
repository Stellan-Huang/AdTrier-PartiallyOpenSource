/** QA & Delivery — validateAd result shapes (single definition). */

export type ValidationIssue = {
  sceneId?: string;
  severity: "hard" | "soft";
  reason: string;
  action: "regenerate" | "fallback_asset" | "accept";
};

export type ValidationResult = {
  pass: boolean;
  issues: ValidationIssue[];
};

/** @deprecated prefer ValidationResult */
export type QAResult = {
  version: 1;
  jobId: string;
  passed: boolean;
};
