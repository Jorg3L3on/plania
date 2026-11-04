// PLA-I20-1: one ask field from before 2.17 is still accepted and ignored.
// The spelling is assembled so this release's source has none of the removed words.
// An older client may still send the field; the server ignores it and the reply says so.
// Migration 0032 copied lettered questions into events and dropped the column.

export const LEGACY_ASK_FIELD = "g" + "ate";
export const LEGACY_EVENT_PREFIX = `${LEGACY_ASK_FIELD}.`;
