/**
 * Phase 5 (Production Stabilization) — minimal structured JSON server
 * logger. Deliberately NOT a full logging framework (no external
 * dependency): every call emits a single-line JSON object to stdout/stderr
 * so it's trivially parseable by any hosting platform's log pipeline, and
 * easy to forward to an external monitor (e.g. Sentry) later without
 * changing call sites.
 *
 * `event` is restricted to a fixed vocabulary so log consumers/dashboards
 * can rely on a stable, greppable set of event names instead of free-form
 * strings. Extend this union when a genuinely new event is introduced.
 *
 * NEVER pass secret values (API keys, Authorization headers) as fields —
 * callers are responsible for only passing non-secret diagnostic data.
 */

export type LogEvent =
  | "provider_refresh_start"
  | "provider_refresh_success"
  | "provider_refresh_failure"
  | "provider_stale_fallback"
  | "provider_unavailable"
  | "provider_pagination_inconsistent"
  | "request_start"
  | "request_complete"
  | "request_error"
  | "health_check";

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

type LogLevel = "info" | "warn" | "error";

function emit(level: LogLevel, event: LogEvent, fields?: LogFields) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(event: LogEvent, fields?: LogFields) {
    emit("info", event, fields);
  },
  warn(event: LogEvent, fields?: LogFields) {
    emit("warn", event, fields);
  },
  error(event: LogEvent, fields?: LogFields) {
    emit("error", event, fields);
  },
};
