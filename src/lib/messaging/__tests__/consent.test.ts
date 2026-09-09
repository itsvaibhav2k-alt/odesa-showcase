import { describe, expect, it } from "vitest";

import { parseConsentCommand } from "../consent";

describe("parseConsentCommand", () => {
  it.each([
    "STOP",
    " stop ",
    "Stop all",
    "UNSUBSCRIBE",
    "cancel",
    "END",
    "quit",
  ])("normalizes %j as an opt-out command", (body) =>
    expect(parseConsentCommand(body)).toBe("stop"),
  );

  it.each(["START", " unstop ", "YES"])(
    "normalizes %j as an opt-in command",
    (body) => expect(parseConsentCommand(body)).toBe("start"),
  );

  it.each(["HELP", " info "])("normalizes %j as a help command", (body) =>
    expect(parseConsentCommand(body)).toBe("help"),
  );

  it.each([
    "please stop by tomorrow",
    "restart",
    "help me with rent",
    "",
    "👍",
  ])("does not treat free-form text %j as a consent transition", (body) =>
    expect(parseConsentCommand(body)).toBeNull(),
  );
});
