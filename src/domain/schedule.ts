import {
  BUSINESS_TIME_ZONE,
  MINIMUM_LEAD_TIME_MINUTES,
} from "./booking.ts";

export type ScheduleErrorCode =
  | "invalid-date"
  | "invalid-time"
  | "nonexistent-time"
  | "ambiguous-time"
  | "too-soon";

export class ScheduleError extends Error {
  public readonly code: ScheduleErrorCode;

  constructor(code: ScheduleErrorCode, message: string) {
    super(message);
    this.name = "ScheduleError";
    this.code = code;
  }
}

const vilniusFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function vilniusParts(timestampMs: number): LocalParts {
  const parts = Object.fromEntries(
    vilniusFormatter.formatToParts(new Date(timestampMs)).map((part) => [
      part.type,
      part.value,
    ]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateTime(timestampMs: number): { date: string; time: string } {
  const parts = vilniusParts(timestampMs);
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}

function parseLocalDateTime(localDate: string, localTime: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new ScheduleError("invalid-date", "Pasirinkite teisingą paėmimo datą.");
  }
  const dateAsUtc = Date.parse(`${localDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(dateAsUtc) ||
    new Date(dateAsUtc).toISOString().slice(0, 10) !== localDate
  ) {
    throw new ScheduleError("invalid-date", "Pasirinkite teisingą paėmimo datą.");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
    throw new ScheduleError("invalid-time", "Pasirinkite teisingą paėmimo laiką.");
  }
  return Date.parse(`${localDate}T${localTime}:00.000Z`);
}

function offsetMinutesAt(timestampMs: number): number {
  const parts = vilniusParts(timestampMs);
  const shownAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  return Math.round((shownAsUtc - timestampMs) / 60_000);
}

/** Resolve a Vilnius wall-clock choice without silently shifting a DST gap or fold. */
export function validatePickupSchedule(
  localDate: string,
  localTime: string,
  nowMs = Date.now(),
): { scheduledAtUtc: string } {
  const localAsUtc = parseLocalDateTime(localDate, localTime);
  const candidateOffsets = new Set(
    [-86_400_000, 0, 86_400_000].map((delta) =>
      offsetMinutesAt(localAsUtc + delta),
    ),
  );
  const matchingInstants = [...candidateOffsets]
    .map((offsetMinutes) => localAsUtc - offsetMinutes * 60_000)
    .filter((timestampMs) => {
      const shown = localDateTime(timestampMs);
      return shown.date === localDate && shown.time === localTime;
    });

  if (matchingInstants.length === 0) {
    throw new ScheduleError(
      "nonexistent-time",
      "Šis laikas neegzistuoja dėl vasaros laiko pasikeitimo. Pasirinkite kitą laiką.",
    );
  }
  if (matchingInstants.length > 1) {
    throw new ScheduleError(
      "ambiguous-time",
      "Šis laikas kartojasi dėl žiemos laiko pasikeitimo. Pasirinkite kitą laiką.",
    );
  }
  const scheduledAtMs = matchingInstants[0];
  if (scheduledAtMs - nowMs < MINIMUM_LEAD_TIME_MINUTES * 60_000) {
    throw new ScheduleError(
      "too-soon",
      `Paėmimą galima užsakyti likus bent ${MINIMUM_LEAD_TIME_MINUTES} min. Pasirinkite vėlesnį laiką.`,
    );
  }
  return { scheduledAtUtc: new Date(scheduledAtMs).toISOString() };
}

/** First representable minute at least 30 minutes away in Europe/Vilnius. */
export function getEarliestVilniusPickup(
  nowMs = Date.now(),
): { date: string; time: string; scheduledAtUtc: string } {
  const firstMinuteMs =
    Math.ceil((nowMs + MINIMUM_LEAD_TIME_MINUTES * 60_000) / 60_000) * 60_000;
  for (let offset = 0; offset < 24 * 60; offset += 1) {
    const candidateMs = firstMinuteMs + offset * 60_000;
    const { date, time } = localDateTime(candidateMs);
    try {
      const { scheduledAtUtc } = validatePickupSchedule(date, time, nowMs);
      if (Date.parse(scheduledAtUtc) === candidateMs) {
        return { date, time, scheduledAtUtc };
      }
    } catch (error) {
      if (!(error instanceof ScheduleError)) throw error;
    }
  }
  throw new Error("No valid Vilnius pickup time within 24 hours");
}
