import type { Request, Router } from 'express';

export interface ReportarIdentity {
  id: string;
  canReport: boolean;
  isAdmin: boolean;
}

export interface SmtpOptions {
  host: string;
  from: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  allowInsecure?: boolean;
}

export interface ReportarMail {
  to: string;
  subject: string;
  text: string;
  messageId: string;
}

export type SendMail = (message: ReportarMail) => Promise<void>;

export type ReportarOptions = {
  databasePath: string;
  publicOrigin: string;
  authenticate(request: Request): ReportarIdentity | null | Promise<ReportarIdentity | null>;
  getRecipient(id: string): string | null | undefined | Promise<string | null | undefined>;
  appName?: string;
  intervalMs?: number;
  onError?(error: unknown): void;
} & ({ smtp: SmtpOptions; sendMail?: never } | { smtp?: never; sendMail: SendMail });

export interface ReportarWorker {
  start(): void;
  stop(): Promise<void>;
  runOnce(): Promise<void>;
}

export function createSmtpSender(options: SmtpOptions): SendMail;
export function createReportarKit(options: ReportarOptions): {
  router: Router;
  worker: ReportarWorker;
  close(): Promise<void>;
};
