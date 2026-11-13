/** Scenario and session types. Scenarios are plain JSON so facilitators can write their own. */

export const VAR_NAMES = ["containment", "operations", "trust", "evidence", "legal", "cost"] as const;
export type VarName = (typeof VAR_NAMES)[number];
export type Vars = Record<VarName, number>;
export type Effects = Partial<Record<VarName, number>>;

export interface VarCondition { name: VarName; op: "<" | "<=" | ">" | ">="; value: number }
/** All listed flags set, none of the `none` flags set, and every variable test true. */
export interface Condition { all?: string[]; none?: string[]; vars?: VarCondition[] }

export interface Modifier { when: Condition; effects?: Effects; set?: string[]; text: string }

export type Quality = "good" | "ok" | "poor";
export interface Insight { quality: Quality; text: string; controls?: string[] }

export interface Choice {
  id: string;
  label: string;
  minutes: number;
  effects: Effects;
  set?: string[];
  visibleWhen?: Condition;
  modifiers?: Modifier[];
  next: string | null;
  insight: Insight;
}

export interface SceneNode {
  id: string;
  title: string;
  body: string;
  /** The simulated clock jumps forward to at least this many minutes after the first alert. */
  notBefore?: number;
  /** Real seconds the team has to decide in the UI; on expiry `onTimeout` is chosen. */
  timeLimitSeconds?: number;
  onTimeout?: string;
  choices: Choice[];
}

export interface Deadline {
  id: string;
  label: string;
  reference: string;
  dueMinutes: number;
  flag: string;
  penalty: Effects;
}

export interface Scenario {
  id: string;
  title: string;
  summary: string;
  difficulty: "intro" | "standard" | "hard";
  organisation: string;
  startLabel: string;
  startNode: string;
  initial?: Partial<Vars>;
  deadlines: Deadline[];
  nodes: SceneNode[];
}

export interface LogEntry {
  step: number;
  nodeId: string;
  nodeTitle: string;
  choiceId: string;
  choiceLabel: string;
  atMinutes: number;
  afterMinutes: number;
  timedOut: boolean;
  note: string;
  effects: Effects;
  notes: string[];
  insight: Insight;
  vars: Vars;
}

export interface DeadlineStatus {
  id: string;
  label: string;
  reference: string;
  dueMinutes: number;
  state: "pending" | "met" | "late" | "missed";
  metAtMinutes: number | null;
}

export interface Session {
  id: string;
  scenarioId: string;
  nodeId: string | null;
  minutes: number;
  vars: Vars;
  /** flag name -> simulated minute at which it was set */
  flags: Record<string, number>;
  deadlines: DeadlineStatus[];
  log: LogEntry[];
  history: Array<{ minutes: number; vars: Vars }>;
  events: string[];
  presentedAt: number;
}
