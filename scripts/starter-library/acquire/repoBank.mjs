// A bulk source declared as a handful of named files in a git repository.
// Shared by bulkSources.mjs (CC0 banks) and alphaSources.mjs (private-alpha kits).

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&");

/**
 * A CC0 bank mirrored on GitHub, taken as a handful of named files: each
 * `take` entry is one repo path and the taxonomy (and, for a pitched sample,
 * the note it was recorded at) it lands under. The README or LICENSE named by
 * `licenseFile` is where the whole-bank CC0 statement lives.
 */
export function repoBank({
  owner = "freepats",
  repo,
  sourceId = "freepats",
  name,
  licenseFile = "README.txt",
  branch = "master",
  idBase,
  take,
  ...rights
}) {
  const [first] = take;
  return {
    id: `${sourceId}:${repo}`,
    sourceId,
    name: rights.licenseId ? name : `${name} (CC0 bank)`,
    archiveUrl: `https://github.com/${owner}/${repo}`,
    repoUrl: `https://github.com/${owner}/${repo}.git`,
    include: new RegExp(`^(${take.map((t) => escapeRegExp(t.file)).join("|")})$`),
    licenseUrl: `https://github.com/${owner}/${repo}/blob/${branch}/${licenseFile}`,
    rightsNote:
      "The bank's own README or LICENSE states CC0 for the whole bank; it is one archive under one licence (section 4.1).",
    ...rights,
    idBase,
    defaultFamily: first.family,
    defaultRole: first.role,
    defaultGenres: first.genres,
    defaultCharacters: first.characters,
    maxMembers: take.length,
    mappings: take.map((t) => ({
      match: new RegExp(`^${escapeRegExp(t.file)}$`),
      family: t.family,
      role: t.role,
      genres: t.genres,
      characters: t.characters,
      rootNote: t.note ?? null,
      name: t.name ?? null,
    })),
  };
}
