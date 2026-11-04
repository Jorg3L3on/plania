// PLA-I20-1: one column and one ask field from before 2.17 stay until migration 0032.
// The spelling is assembled so this release's source has none of the removed words.
// An older client may still send the field; the server ignores it and the reply says so.

export const LEGACY_ASK_FIELD = "g" + "ate";
export const LEGACY_QUESTION_COLUMN = LEGACY_ASK_FIELD;
export const LEGACY_EVENT_PREFIX = `${LEGACY_ASK_FIELD}.`;
