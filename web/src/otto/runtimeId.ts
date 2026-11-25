// The id rule for lists the page reports at runtime: guide targets and guided tasks (D-23). Core: pure.
//
// 1 to 64 characters from A-Z a-z 0-9 _ . : -, starting with a letter or a digit. No spaces, so an id can't carry a
// sentence to the model. The server applies the same rule (RUNTIME_ID in server/app/voice/tools.py; a test checks they match).

export const RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/

/** Whether `id` may be reported to the model, or accepted back from it. */
export function isRuntimeId(id: unknown): id is string {
  return typeof id === 'string' && RUNTIME_ID.test(id)
}
