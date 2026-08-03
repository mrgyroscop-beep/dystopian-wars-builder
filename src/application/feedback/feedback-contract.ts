export type FeedbackKind = "feedback" | "bug" | "idea";

export interface FeedbackSubmission {
  readonly requestId: string;
  readonly kind: FeedbackKind;
  readonly message: string;
  readonly email: string;
  readonly source: string;
  readonly appVersion: string;
  readonly catalogVersion: string;
  readonly commitSha: string;
}

export interface FeedbackReceipt {
  readonly id: string;
  readonly duplicate: boolean;
}

export interface FeedbackGateway {
  readonly contractVersion: 1;
  submit(submission: FeedbackSubmission): Promise<FeedbackReceipt>;
}
