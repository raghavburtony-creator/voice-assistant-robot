import { describe, expect, it } from "vitest"
import { parseEnvironmentalProposal, toEnvironmentalAttention } from "./environmental"

describe("environmental proposal validation", () => {
  it("accepts only a known topic and short plain text, dropping unknown fields", () => {
    expect(parseEnvironmentalProposal({
      topic: "object", message: "  A parcel\u0000 is visible\n ", action: "navigate", where: "#save",
    })).toEqual({ topic: "object", message: "A parcel is visible" })
    expect(parseEnvironmentalProposal({ topic: "activity", message: "x".repeat(500) })?.message).toHaveLength(120)
  })

  it("rejects malformed proposals, unknown topics and empty text", () => {
    for (const value of [
      null, 5, "object", [], {}, { topic: "identity", message: "A person" },
      { topic: "face", message: "A face" }, { topic: "emotion", message: "Happy" },
      { topic: "object", message: "  " }, { topic: "object", message: 5 },
    ]) expect(parseEnvironmentalProposal(value)).toBeNull()
  })

  it("maps only an active camera proposal to a minor attention event", () => {
    const proposal = { topic: "potential_hazard", message: "A cable is across the walkway." }
    expect(toEnvironmentalAttention("camera", proposal)).toEqual({
      type: "attention", importance: "minor", ...proposal,
    })
    expect(toEnvironmentalAttention("screen", proposal)).toBeNull()
    expect(toEnvironmentalAttention(null, proposal)).toBeNull()
    expect(toEnvironmentalAttention("camera", { ...proposal, topic: "navigate" })).toBeNull()
  })
})
