// 治理（审批中心与申诉）共享类型（T-15-D）：与后端 governance 蛇形契约一致。
export interface ModerationCaseItem {
  id: number;
  target_type: string;
  target_id: number;
  risk_level: string;
  source: string;
  reason: string;
  snapshot: string | null;
  status: string;
  resolution: string | null;
  resolved_by: number | null;
  resolved_at: string | null;
  manager_feedback: string | null;
  agent_decision: string | null;
  decision_trace: string | null;
  trace_id: string | null;
  agent_run_id: string | null;
  created_at: string;
}

export interface ModerationCaseList {
  items: ModerationCaseItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AppealItem {
  id: number;
  case_id: number;
  user_id: number;
  reason: string;
  status: string;
  resolution_note: string | null;
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
}

export interface AppealList {
  items: AppealItem[];
  total: number;
  page: number;
  page_size: number;
}
