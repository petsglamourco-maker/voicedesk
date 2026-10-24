import { describe, expect, it } from "vitest";
import { InMemoryAgentServices } from "../src/services";
import { initialState, stepNote } from "../src/state";
import { namesMatch, runTool, type ToolEnv } from "../src/tools";
import { makeContext } from "./fixtures";

/** Bright Dental fixture: Monday 19 Oct 2026, 09:00 London. Tuesday 20th is open 09–17. */
async function setup(callerPhone: string | null = null) {
  const services = new InMemoryAgentServices();
  const booked = await services.createBooking({
    service: "Check-up",
    startsAt: new Date("2026-10-20T09:00:00Z"), // 10:00 London
    endsAt: new Date("2026-10-20T09:30:00Z"),
    customerName: "Sam Patel",
    customerPhone: "+447700900123",
    customerEmail: null,
    notes: null,
  });
  const env: ToolEnv = {
    ctx: makeContext(),
    services,
    state: initialState("en", callerPhone),
  };
  return { env, services, booked };
}

describe("find_booking", () => {
  it("finds a booking by reference and name, and only then allows changes", async () => {
    const { env, booked } = await setup();
    const denied = await runTool("cancel_booking", { callerConfirmed: true }, env);
    expect(denied.isError).toBe(true);

    const found = await runTool(
      "find_booking",
      { reference: booked.reference.toLowerCase(), name: "sam" },
      env,
    );
    expect(found.isError).toBeFalsy();
    expect(found.result).toMatchObject({
      bookings: [{ reference: booked.reference, service: "Check-up" }],
    });
    expect(env.state.flow).toBe("change_booking");
    expect(env.state.change?.bookingId).toBe(booked.id);
  });

  it("reveals nothing when the details don't match, and stops after three tries", async () => {
    const { env, booked } = await setup();
    for (let i = 0; i < 3; i++) {
      const res = await runTool(
        "find_booking",
        { reference: booked.reference, name: "Alex Jones" },
        env,
      );
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.result)).not.toContain("Sam");
      expect(JSON.stringify(res.result)).not.toContain("Check-up");
    }
    const blocked = await runTool(
      "find_booking",
      { reference: booked.reference, name: "Sam Patel" },
      env,
    );
    expect(blocked.isError).toBe(true);
    expect(stepNote(env.state, "now")).toMatch(/couldn't be verified/);
  });

  it("uses the caller's number on a phone call, but only with the name (audit M8)", async () => {
    const { env, booked } = await setup("+447700900123");
    // Caller ID alone can be faked: it asks for the name and reveals nothing.
    const noName = await runTool("find_booking", {}, env);
    expect(noName.isError).toBe(true);
    expect(JSON.stringify(noName.result)).not.toContain(booked.reference);
    const wrongName = await runTool("find_booking", { name: "Someone Else" }, env);
    expect(wrongName.isError).toBe(true);
    const found = await runTool("find_booking", { name: "Patel" }, env);
    expect(found.result).toMatchObject({ bookings: [{ reference: booked.reference }] });
    const stranger = await setup("+447700900999");
    expect((await runTool("find_booking", { name: "Patel" }, stranger.env)).isError).toBe(true);
  });

  it("accepts the phone number the booking was made with instead of the name", async () => {
    const { env, booked } = await setup();
    const found = await runTool(
      "find_booking",
      { reference: booked.reference, phone: "07700 900123" },
      env,
    );
    expect(found.isError).toBeFalsy();
  });
});

describe("cancel_booking and reschedule_booking", () => {
  it("cancels only after a read-back and a yes in a later turn", async () => {
    const { env, services, booked } = await setup();
    env.state.turns = 1;
    await runTool("find_booking", { reference: booked.reference, name: "Patel" }, env);
    // Claiming confirmation in the same turn as the request doesn't count.
    expect((await runTool("cancel_booking", { callerConfirmed: true }, env)).isError).toBe(true);
    expect(services.bookings[0]?.status).toBeUndefined();
    env.state.turns = 2; // the caller heard the read-back and said yes
    const done = await runTool("cancel_booking", { callerConfirmed: true }, env);
    expect(done.record).toMatchObject({ type: "cancellation", reference: booked.reference });
    expect(services.bookings[0]?.status).toBe("cancelled");
    expect(
      await services.listBusy(new Date("2026-10-20T00:00:00Z"), new Date("2026-10-21T00:00:00Z")),
    ).toEqual([]);
  });

  it("moves a booking to a free slot, including one overlapping its old time", async () => {
    const { env, services, booked } = await setup();
    env.state.turns = 1;
    await runTool("find_booking", { reference: booked.reference, name: "Sam" }, env);
    const move = { startsAt: "2026-10-20T09:15:00Z", callerConfirmed: true };
    // No times offered yet: can't move straight away.
    expect((await runTool("reschedule_booking", move, env)).isError).toBe(true);
    env.state.turns = 2;
    await runTool("check_availability", { service: "Check-up", date: "2026-10-20" }, env);
    expect(env.state.flow).toBe("change_booking");
    // Offered and moved in the same turn: the caller hasn't chosen or confirmed yet.
    expect((await runTool("reschedule_booking", move, env)).isError).toBe(true);
    env.state.turns = 3;
    expect(
      (await runTool("reschedule_booking", { ...move, callerConfirmed: false }, env)).isError,
    ).toBe(true);
    const moved = await runTool("reschedule_booking", move, env);
    expect(moved.isError).toBeFalsy();
    expect(moved.record).toMatchObject({ type: "reschedule" });
    expect(services.bookings[0]?.startsAt.toISOString()).toBe("2026-10-20T09:15:00.000Z");
    expect(services.bookings[0]?.endsAt.toISOString()).toBe("2026-10-20T09:45:00.000Z");
  });

  it("refuses a time that is taken by someone else", async () => {
    const { env, services, booked } = await setup();
    await services.createBooking({
      service: "Check-up",
      startsAt: new Date("2026-10-20T13:00:00Z"),
      endsAt: new Date("2026-10-20T13:30:00Z"),
      customerName: "Other",
      customerPhone: "+447700900555",
      customerEmail: null,
      notes: null,
    });
    await runTool("find_booking", { reference: booked.reference, name: "Sam" }, env);
    const res = await runTool(
      "reschedule_booking",
      { startsAt: "2026-10-20T13:00:00Z", callerConfirmed: true },
      env,
    );
    expect(res.isError).toBe(true);
  });
});

describe("namesMatch", () => {
  it.each([
    ["Sam", "Sam Patel", true],
    ["patel", "Sam Patel", true],
    ["Lucia", "Lucía Fernández", true],
    ["王丽", "王丽", true],
    ["Al", "Alan Smith", false],
    ["Jones", "Sam Patel", false],
    [undefined, "Sam Patel", false],
  ])("%s vs %s → %s", (given, booked, expected) => {
    expect(namesMatch(given, booked)).toBe(expected);
  });
});

describe("several bookings in one conversation", () => {
  it("books a parent and then a child, but not twice in one turn", async () => {
    const services = new InMemoryAgentServices();
    const env: ToolEnv = { ctx: makeContext(), services, state: initialState("en") };
    const book = async (name: string, startsAt: string) => {
      await runTool("check_availability", { service: "Check-up", date: "2026-10-20" }, env);
      await runTool(
        "update_booking",
        {
          service: "Check-up",
          startsAt,
          customerName: name,
          phone: "07700 900123",
          phoneConfirmed: true,
        },
        env,
      );
      return runTool("create_booking", { callerConfirmed: true }, env);
    };
    env.state.turns = 1;
    expect((await book("Camille Martin", "2026-10-20T09:00:00Z")).isError).toBeFalsy();
    expect((await runTool("create_booking", { callerConfirmed: true }, env)).isError).toBe(true);
    expect(env.state.booking.phone).toBe("+447700900123"); // carried over
    env.state.turns = 2;
    expect((await book("Léo Martin", "2026-10-20T09:30:00Z")).isError).toBeFalsy();
    expect(services.bookings.map((b) => b.customerName)).toEqual(["Camille Martin", "Léo Martin"]);
  });
});
