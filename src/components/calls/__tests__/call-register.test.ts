import { describe, expect, it } from "vitest";

import { pageWindow } from "@/components/calls/call-register";

const PAGE_SIZE = 12;

describe("pageWindow", () => {
  it("shows the whole set with no pager when it fits on one page", () => {
    expect(pageWindow(11, 0, PAGE_SIZE)).toEqual({
      pageStart: 0,
      rangeStart: 1,
      rangeEnd: 11,
      hasPrev: false,
      hasNext: false,
    });
  });

  it("offers Next but not Prev on the first of several pages", () => {
    expect(pageWindow(25, 0, PAGE_SIZE)).toEqual({
      pageStart: 0,
      rangeStart: 1,
      rangeEnd: 12,
      hasPrev: false,
      hasNext: true,
    });
  });

  it("offers both directions on a middle page", () => {
    expect(pageWindow(25, 1, PAGE_SIZE)).toEqual({
      pageStart: 12,
      rangeStart: 13,
      rangeEnd: 24,
      hasPrev: true,
      hasNext: true,
    });
  });

  it("offers Prev but not Next on the last page", () => {
    expect(pageWindow(25, 2, PAGE_SIZE)).toEqual({
      pageStart: 24,
      rangeStart: 25,
      rangeEnd: 25,
      hasPrev: true,
      hasNext: false,
    });
  });

  it("reads an empty register as 0–0 with no pager", () => {
    expect(pageWindow(0, 0, PAGE_SIZE)).toEqual({
      pageStart: 0,
      rangeStart: 0,
      rangeEnd: 0,
      hasPrev: false,
      hasNext: false,
    });
  });
});
