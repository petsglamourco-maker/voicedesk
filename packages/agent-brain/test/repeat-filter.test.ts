import { describe, expect, it } from "vitest";
import { RepeatFilter } from "../src/engine";

function run(previous: string, deltas: string[]) {
  const out: string[] = [];
  const f = new RepeatFilter(previous, (d) => out.push(d));
  for (const d of deltas) f.push(d);
  f.end();
  return { streamed: out.join(""), filter: f };
}

describe("RepeatFilter", () => {
  const prev = "Perfecto, las nueve. ¿Me dice su nombre completo, por favor?";

  it("drops a verbatim repeat of the previous text", () => {
    const { streamed, filter } = run(prev, [
      "Perfecto, las ",
      "nueve. ¿Me dice su nombre ",
      "completo, por favor?",
    ]);
    expect(streamed).toBe("");
    expect(filter.strip(prev)).toBe("");
  });

  it("keeps what follows a repeat", () => {
    const { streamed, filter } = run(prev, [prev, " Y su teléfono?"]);
    expect(streamed).toBe("Y su teléfono?");
    expect(filter.strip(`${prev} Y su teléfono?`)).toBe("Y su teléfono?");
  });

  it("passes new text through unchanged", () => {
    const { streamed, filter } = run(prev, ["Perfecto, ", "le confirmo la cita."]);
    expect(streamed).toBe("Perfecto, le confirmo la cita.");
    expect(filter.strip("Perfecto, le confirmo la cita.")).toBe("Perfecto, le confirmo la cita.");
  });

  it("releases a partial match at the end of the round", () => {
    expect(run(prev, ["Perfecto,"]).streamed).toBe("Perfecto,");
  });

  it("ignores short previous text", () => {
    expect(run("Okay.", ["Okay."]).streamed).toBe("Okay.");
  });
});
