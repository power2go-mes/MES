import fs from 'fs';
import { DEV_OTP_LOG_PATH } from './email.ts';

export const APP_LOG_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

export function retainRecentOtpLogLines(contents: string, now = Date.now()): string[] {
  return contents.split(/\r?\n/).filter(line => {
    const timestamp = Date.parse(line.slice(0, 24));
    return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < APP_LOG_RETENTION_MS;
  });
}

export async function pruneExpiredOtpLog(now = Date.now()): Promise<void> {
  try {
    const contents = await fs.promises.readFile(DEV_OTP_LOG_PATH, 'utf8');
    const retainedLines = retainRecentOtpLogLines(contents, now);
    if (retainedLines.length === 0) {
      await fs.promises.unlink(DEV_OTP_LOG_PATH);
      return;
    }
    await fs.promises.writeFile(DEV_OTP_LOG_PATH, `${retainedLines.join('\n')}\n`, 'utf8');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

let startupCleanup: Promise<void> | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;

export function startAppDataCleanup(): Promise<void> {
  startupCleanup ??= fs.promises.rm(DEV_OTP_LOG_PATH, { force: true });
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      void pruneExpiredOtpLog().catch(() => undefined);
    }, APP_LOG_RETENTION_MS);
    cleanupTimer.unref?.();
  }
  return startupCleanup;
}