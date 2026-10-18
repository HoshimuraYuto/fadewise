// Types for the vendored Agent.mjs (one beat-tracking hypothesis).
export interface AgentParams {
  expiryTime?: number;
  toleranceWndInner?: number;
  toleranceWndPre?: number;
  toleranceWndPost?: number;
  correctionFactor?: number;
  maxChange?: number;
  penaltyFactor?: number;
}
export default class Agent {
  constructor(tempo: number, firstBeatTime: number, firsteventScore: number, agentList: Agent[], params?: AgentParams);
  beatInterval: number;
  initialBeatInterval: number;
  beatTime: number;
  totalBeatCount: number;
  // Beat times (s).
  events: number[];
  score: number;
  considerEvent(eventTime: number, eventScore: number): boolean;
  acceptEvent(eventTime: number, eventScore: number, err: number, beatCount: number): void;
  // Interpolates the missing beats into `events`.
  fillBeats(): void;
  clone(): Agent;
}
