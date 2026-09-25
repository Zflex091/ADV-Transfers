import assert from "node:assert/strict";
import { mock, test } from "node:test";

import type { VercelRequest, VercelResponse } from "@vercel/node";

let calls = 0;
let requestedLimit = 0;
let failWorker = false;

mock.module(new URL("../api/_booking-notifications.ts", import.meta.url).href, {
  exports: {
    processPendingBookingEmails: async (limit: number) => {
      calls += 1;
      requestedLimit = limit;
      if (failWorker) throw new Error("private database error");
      return { sent: 1, failed: 0, skipped: 1 };
    },
  },
});

const { default: handler } = await import("../api/retry-booking-emails.ts");
const originalSecret = process.env.CRON_SECRET;
const TEST_SECRET = "test-cron-secret-at-least-sixteen-characters";

function response() {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 200,
    payload: undefined as unknown,
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: unknown) {
      this.payload = value;
      return this;
    },
  };
}

async function invoke(method: string, authorization?: string) {
  const res = response();
  await handler(
    { method, headers: authorization === undefined ? {} : { authorization } } as VercelRequest,
    res as unknown as VercelResponse,
  );
  return res;
}

test.after(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

test("only GET is accepted", async () => {
  process.env.CRON_SECRET = TEST_SECRET;
  const res = await invoke("POST", `Bearer ${TEST_SECRET}`);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "GET");
  assert.equal(calls, 0);
});

test("a missing CRON_SECRET fails closed", async () => {
  delete process.env.CRON_SECRET;
  const res = await invoke("GET", "Bearer undefined");
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.payload, { error: "Retry unavailable" });
  assert.equal(calls, 0);
});

test("missing and incorrect bearer credentials cannot run the worker", async () => {
  process.env.CRON_SECRET = TEST_SECRET;
  for (const header of [undefined, TEST_SECRET, "Bearer wrong-secret"]) {
    const res = await invoke("GET", header);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.payload, { error: "Unauthorized" });
  }
  assert.equal(calls, 0);
});

test("valid bearer credentials run a bounded batch and disclose counts only", async () => {
  process.env.CRON_SECRET = TEST_SECRET;
  const res = await invoke("GET", `Bearer ${TEST_SECRET}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual(res.payload, { ok: true, sent: 1, failed: 0, skipped: 1 });
  assert.equal(calls, 1);
  assert.equal(requestedLimit, 2);
});

test("worker failure does not expose internal details", async () => {
  process.env.CRON_SECRET = TEST_SECRET;
  failWorker = true;
  const oldError = console.error;
  console.error = () => undefined;
  try {
    const res = await invoke("GET", `Bearer ${TEST_SECRET}`);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.payload, { error: "Retry unavailable" });
    assert.equal(JSON.stringify(res.payload).includes("database"), false);
  } finally {
    console.error = oldError;
    failWorker = false;
  }
});
