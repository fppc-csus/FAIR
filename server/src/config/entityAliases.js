/**
 * Known alternate names for organizations that appear on California agendas.
 * Each group lists names that refer to the same entity; matching any one name
 * on a Form 700 also searches the agenda for the others. Acronyms that can be
 * derived from the full name (Pacific Gas and Electric → PG&E / PGE) are
 * handled automatically and do not need to be listed here.
 *
 * Add a group when an investigator finds a missed match. Keep entries to
 * names that are unambiguous in a government-agenda context.
 */
export const ENTITY_ALIAS_GROUPS = [
  ["Pacific Gas and Electric Company", "PG&E", "PGE", "Pacific Gas & Electric"],
  ["Southern California Edison", "SCE", "Edison International", "SoCal Edison"],
  ["San Diego Gas & Electric", "SDG&E", "SDGE"],
  ["Southern California Gas Company", "SoCalGas", "SoCal Gas"],
  ["Sacramento Municipal Utility District", "SMUD"],
  ["Los Angeles Department of Water and Power", "LADWP"],
  ["AT&T", "AT and T", "American Telephone and Telegraph"],
  ["Bank of America", "BofA", "Bank of America Merrill Lynch"],
  ["International Business Machines", "IBM"],
  ["Hewlett Packard Enterprise", "HPE"],
  ["Hewlett-Packard", "HP Inc"],
  ["Kaiser Permanente", "Kaiser Foundation Health Plan", "Kaiser Foundation Hospitals"],
  ["Sutter Health", "Sutter Medical Center"],
  ["Comcast", "Xfinity"],
  ["Alphabet Inc", "Google"],
  ["Meta Platforms", "Facebook"],
  ["JPMorgan Chase", "JP Morgan Chase", "Chase Bank"],
  ["Wells Fargo", "Wells Fargo Bank"],
  ["Waste Management", "WM"],
  ["Republic Services", "Recology"],
];

/**
 * Company names that are also ordinary English words. A match on one of these
 * needs supporting context (a corporate suffix or the filer's reported line of
 * business near the mention) so "Apple Blossom Festival" is not read as Apple
 * Inc. Names are compared after normalization (lower case, no punctuation).
 */
export const COMMON_WORD_NAMES = new Set([
  "ally", "almond", "amazon", "american", "anchor", "apex", "apple", "barrel",
  "beacon", "berry", "block", "bloom", "blossom", "box", "bread", "butter", "canyon",
  "capital", "cellar", "chase", "cherry", "chime", "citizens", "classy", "coastal",
  "coffee", "compass", "cork", "cream", "crown", "cypress", "delta", "discover",
  "dodge", "eagle", "elite", "equity", "evergreen", "federal", "fidelity", "fifth",
  "fig", "forest", "frontier", "galaxy", "gap", "garden", "general", "golden", "grape",
  "harmony", "harvest", "honey", "horizon", "key", "keystone", "lake", "landmark",
  "lemon", "liberty", "lime", "maple", "mercury", "meridian", "meta", "milk", "mint",
  "monarch", "mosaic", "national", "noble", "nova", "oak", "ocean", "olive", "oracle",
  "orange", "orbit", "orchard", "pacific", "peach", "pear", "pepper", "phoenix",
  "pioneer", "plum", "premier", "prime", "progressive", "ram", "redwood", "regions",
  "river", "royal", "salt", "saturn", "scoop", "sequoia", "shell", "shift", "sierra",
  "slack", "snap", "solar", "southwest", "spice", "spirit", "sprint", "square",
  "standard", "stellar", "sterling", "subway", "sugar", "summit", "sun", "sunrise",
  "sunset", "target", "tea", "toast", "united", "unity", "valley", "vanguard",
  "vertex", "vineyard", "visa", "vista", "walnut", "zenith", "zoom",
]);
