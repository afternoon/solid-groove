// The review page served by `bun run library:manage`.
//
// One candidate at a time: its source page in an iframe on the left, the
// best-effort crawled metadata as an editable form on the right. The reviewer
// listens, corrects anything the crawler guessed wrong, and clicks Verify. That
// POSTs the confirmed selection, which the server appends to sources.lock.json
// as a *draft* (no checksum yet — `library:acquire --pin` records that later).
//
// This is the human half of section 4.2 made concrete: nothing is written that a
// person did not look at and confirm on the actual source page.

/**
 * @param {object} options
 * @param {object[]} options.taxonomy   [{ family, roles }] for the role selector
 * @param {string[]} options.genres
 * @param {string[]} options.characters
 * @param {string[]} options.intensities
 * @param {string[]} options.sourceTypes
 * @param {object[]} options.packs      [{ slug, name }] destination packs (CNT-000b)
 */
export function renderManagePage({
  taxonomy,
  genres,
  characters,
  intensities,
  sourceTypes,
  packs,
}) {
  const config = JSON.stringify({
    taxonomy,
    genres,
    characters,
    intensities,
    sourceTypes,
    packs,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Solid Groove — sample library management</title>
<style>
:root {
	color-scheme: dark;
	--bg: #12121a; --panel: #1b1b26; --line: #2b2b3a; --text: #e8e8f0;
	--muted: #9a9ab0; --accent: #6ee7b7; --accent-dim: #2f6f5a; --warn: #fbbf24;
	--bad: #f87171; --good: #34d399;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); height: 100vh;
	display: grid; grid-template-rows: auto 1fr;
	font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
header { background: var(--panel); border-bottom: 1px solid var(--line);
	padding: 10px 16px; display: flex; gap: 16px; align-items: center; }
h1 { margin: 0; font-size: 15px; font-weight: 600; }
.sub { color: var(--muted); font-size: 12px; }
.spacer { flex: 1; }
button { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid var(--line);
	background: var(--bg); color: var(--text); padding: 6px 12px; }
button:disabled { opacity: .4; cursor: default; }
button.primary { background: var(--accent-dim); border-color: var(--accent); color: var(--text); font-weight: 600; }
button.skip { color: var(--muted); }
.wrap { display: grid; grid-template-columns: 1fr 400px; min-height: 0; }
iframe { width: 100%; height: 100%; border: 0; background: #fff; }
.panel { border-left: 1px solid var(--line); overflow-y: auto; padding: 16px; background: var(--panel); }
.candidate-title { font-weight: 600; font-size: 14px; margin: 0 0 2px; }
.note { color: var(--muted); font-size: 12px; margin: 0 0 12px; }
.field { margin-bottom: 11px; }
label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 3px; }
input, select, textarea { width: 100%; background: var(--bg); color: var(--text);
	border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font: inherit; font-size: 13px; }
textarea { resize: vertical; min-height: 44px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.hint { font-size: 11px; margin-top: 3px; }
.hint.ok { color: var(--good); } .hint.bad { color: var(--bad); } .hint.muted { color: var(--muted); }
.audio { margin: 4px 0 2px; width: 100%; }
.framewrap { position: relative; background: #fff; }
.frameblocked { position: absolute; inset: 0; display: none; place-items: center;
	background: var(--panel); color: var(--text); text-align: center; padding: 24px; }
.frameblocked.show { display: grid; }
.frameblocked p { max-width: 380px; color: var(--muted); font-size: 13px; }
.frameblocked a { font-size: 14px; font-weight: 600; }
.opentab { font-size: 12px; }
.status { padding: 8px 10px; border-radius: 6px; font-size: 12px; margin-bottom: 12px; }
.status.pending { background: #23233a; color: var(--muted); }
.status.done { background: var(--accent-dim); color: var(--text); }
.status.error { background: #3a2020; color: var(--bad); }
.pill { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px;
	border: 1px solid var(--line); color: var(--muted); }
.pill.verified { border-color: var(--accent); color: var(--accent); }
.pill.confidence-verified-cc0 { border-color: var(--good); color: var(--good); }
.pill.confidence-likely-cc0 { border-color: var(--warn); color: var(--warn); }
.pill.confidence-unconfirmed { border-color: var(--bad); color: var(--bad); }
a { color: var(--accent); }
.msg { font-size: 12px; margin-top: 8px; min-height: 1em; }
.msg.ok { color: var(--good); } .msg.bad { color: var(--bad); }
</style>
</head>
<body>
<header>
	<h1>Sample library management</h1>
	<span class="sub" id="progress"></span>
	<span class="spacer"></span>
	<button id="prev">&larr; Prev</button>
	<button id="next">Next &rarr;</button>
</header>
<div class="wrap">
	<div class="framewrap">
		<iframe id="frame" title="source page" sandbox="allow-same-origin allow-scripts allow-popups allow-forms"></iframe>
		<div class="frameblocked" id="frameblocked">
			<div>
				<p id="blockedmsg">This source blocks embedding. Open the page in a new tab to listen, then confirm the metadata here.</p>
				<a id="opensource" href="#" target="_blank" rel="noopener">Open source page in a new tab ↗</a>
			</div>
		</div>
	</div>
	<div class="panel">
		<div id="status" class="status pending"></div>
		<p class="candidate-title" id="ctitle"></p>
		<p><span class="pill" id="confidence"></span></p>
		<p class="note" id="cnote"></p>

		<div class="field">
			<label for="fileUrl">Direct audio / archive URL</label>
			<select id="fileChoices"></select>
			<input id="fileUrl" placeholder="https://…/909-kick.wav">
			<audio id="preview" class="audio" controls></audio>
			<div class="hint muted" id="fileHint"></div>
		</div>

		<div class="field">
			<label for="archiveMember">Archive member (only for a .zip)</label>
			<input id="archiveMember" placeholder="Pack/909/kick.wav">
		</div>

		<div class="two">
			<div class="field">
				<label for="family">Family</label>
				<select id="family"></select>
			</div>
			<div class="field">
				<label for="role">Role</label>
				<select id="role"></select>
			</div>
		</div>

		<div class="field">
			<label for="pack">Destination pack</label>
			<select id="pack"></select>
			<div class="hint muted">Every asset belongs to exactly one pack (docs/sample-library.md section 5.1). Its rights position must match this source's licence.</div>
		</div>

		<div class="field">
			<label for="name">User-facing name (no brand names)</label>
			<input id="name" placeholder="Rounded Analog Kick 01">
		</div>

		<div class="field">
			<label for="creator">Creator / uploader</label>
			<input id="creator">
			<div class="hint muted" id="licHint"></div>
		</div>

		<div class="two">
			<div class="field">
				<label for="genres">Genres (comma-separated)</label>
				<input id="genres" placeholder="house, techno">
			</div>
			<div class="field">
				<label for="characters">Characters</label>
				<input id="characters" placeholder="round, clean, short">
			</div>
		</div>

		<div class="two">
			<div class="field">
				<label for="intensity">Intensity</label>
				<select id="intensity"></select>
			</div>
			<div class="field">
				<label for="sourceType">Source type</label>
				<select id="sourceType"></select>
			</div>
		</div>

		<div class="two">
			<div class="field">
				<label for="rootNote">Root note (tonal only)</label>
				<input id="rootNote" placeholder="C1">
			</div>
			<div class="field">
				<label for="reviewer">Reviewer (you)</label>
				<input id="reviewer" placeholder="Your Name">
			</div>
		</div>

		<button id="verify" class="primary">Verify &amp; add to lockfile</button>
		<div class="msg" id="msg"></div>
	</div>
</div>
<script>
const CONFIG = ${config};
let candidates = [];
let index = 0;

const el = (id) => document.getElementById(id);

// The reviewer name is asked once and reused across candidates in a session.
let reviewer = localStorage.getItem("sg-reviewer") || "";

function fillSelect(select, values, current) {
	select.textContent = "";
	for (const value of values) {
		const option = document.createElement("option");
		option.value = option.textContent = value;
		if (value === current) option.selected = true;
		select.append(option);
	}
}

function roleOptions(family) {
	return (CONFIG.taxonomy.find((entry) => entry.family === family)?.roles) || [];
}

function refreshRoles() {
	fillSelect(el("role"), roleOptions(el("family").value));
}

fillSelect(el("family"), CONFIG.taxonomy.map((entry) => entry.family));
fillSelect(el("intensity"), CONFIG.intensities, "medium");
fillSelect(el("sourceType"), CONFIG.sourceTypes, "recorded");
fillSelect(
	el("pack"),
	CONFIG.packs.map((p) => p.slug),
	CONFIG.packs[0] && CONFIG.packs[0].slug,
);
// Slugs are not self-explanatory, so show the pack name instead.
for (const option of el("pack").options) {
	const pack = CONFIG.packs.find((p) => p.slug === option.value);
	if (pack) option.textContent = pack.name;
}
refreshRoles();
el("family").onchange = refreshRoles;

el("fileChoices").onchange = () => {
	if (el("fileChoices").value) {
		el("fileUrl").value = el("fileChoices").value;
		el("fileUrl").oninput();
	}
};
el("fileUrl").oninput = () => {
	const url = el("fileUrl").value.trim();
	el("preview").src = url && /\\.(wav|mp3|ogg|oga|flac|m4a|aiff?|)$/i.test(url) && !/\\.zip$/i.test(url) ? url : "";
	const isZip = /\\.zip(\\?|#|$)/i.test(url);
	el("archiveMember").parentElement.style.opacity = isZip ? "1" : ".5";
	const hint = el("fileHint");
	if (!url) { hint.textContent = ""; return; }
	hint.className = "hint " + (isZip ? "muted" : "ok");
	hint.textContent = isZip ? "Archive — set the member path below." : "Loose audio file.";
};

function setStatus(candidate) {
	const status = el("status");
	if (candidate.verified) {
		status.className = "status done";
		status.textContent = "✓ Verified — draft written to sources.lock.json.";
	} else if (candidate.crawl && candidate.crawl.ok === false) {
		status.className = "status error";
		status.textContent = "Crawl failed: " + candidate.crawl.error + " — fill in by hand.";
	} else {
		status.className = "status pending";
		status.textContent = "Listen, confirm the fields, then Verify.";
	}
}

function show() {
	const candidate = candidates[index];
	if (!candidate) return;
	el("progress").textContent =
		(index + 1) + " / " + candidates.length + " · " +
		candidates.filter((c) => c.verified).length + " verified";
	el("prev").disabled = index === 0;
	el("next").disabled = index === candidates.length - 1;

	// Many sources (GitHub, Freesound) send X-Frame-Options: DENY, so the iframe
	// stays blank. Detect those up front and show the open-in-new-tab fallback
	// instead of a mysterious white panel.
	const framesBlocked = /(^|\\.)(github\\.com|freesound\\.org)$/.test(
		new URL(candidate.pageUrl).hostname,
	);
	el("opensource").href = candidate.pageUrl;
	el("frameblocked").classList.toggle("show", framesBlocked);
	el("frame").src = framesBlocked ? "about:blank" : candidate.pageUrl;
	el("ctitle").textContent = (candidate.sourceName || candidate.sourceId) + " — " + candidate.id;
	const confidence = candidate.licenseConfidence || "unconfirmed";
	const pill = el("confidence");
	pill.className = "pill confidence-" + confidence;
	pill.textContent = {
		"verified-cc0": "source-wide CC0",
		"likely-cc0": "likely CC0 — check the page",
		"unconfirmed": "licence unconfirmed — verify CC0 on the page",
	}[confidence] || confidence;
	el("cnote").textContent = candidate.note || "";

	fillForm(candidate);

	// Crawl the page on demand the first time we show this candidate. When it
	// arrives, re-fill the form with the guessed URL/metadata — but only if the
	// reviewer has not navigated away in the meantime.
	if (!candidate.crawl) {
		const showingIndex = index;
		el("fileHint").textContent = "crawling the page for a file URL…";
		fetch("/crawl?id=" + encodeURIComponent(candidate.id))
			.then((r) => r.json())
			.then((data) => {
				candidate.crawl = data.crawl || { ok: false, error: "no result" };
				if (candidate.crawl.sourceName) candidate.sourceName = candidate.crawl.sourceName;
				if (index === showingIndex) {
					el("ctitle").textContent =
						(candidate.sourceName || candidate.sourceId) + " — " + candidate.id;
					fillForm(candidate);
				}
			})
			.catch(() => {
				candidate.crawl = { ok: false, error: "crawl request failed" };
				if (index === showingIndex) fillForm(candidate);
			});
	}
}

function fillForm(candidate) {
	const crawl = candidate.crawl || {};
	const seed = candidate.seedAsset || {};

	// Prefer a value the reviewer already set this session, else the crawl guess.
	const draft = candidate.draft || {};
	fillSelect(el("fileChoices"), ["", ...(crawl.fileUrls || [])].filter((v, i, a) => a.indexOf(v) === i));
	el("fileUrl").value = draft.downloadUrl || crawl.suggestedFileUrl || "";
	el("archiveMember").value = draft.archiveMember || "";
	el("name").value = (draft.asset && draft.asset.name) || seed.name || crawl.title || "";
	el("creator").value = draft.creator || crawl.creator || seed.creator || "";
	el("family").value = (draft.asset && draft.asset.family) || seed.family || CONFIG.taxonomy[0].family;
	refreshRoles();
	el("role").value = (draft.asset && draft.asset.role) || seed.role || roleOptions(el("family").value)[0];
	el("pack").value = (draft.asset && draft.asset.pack) || (CONFIG.packs[0] && CONFIG.packs[0].slug) || "";
	el("genres").value = ((draft.asset && draft.asset.genres) || seed.genres || []).join(", ");
	el("characters").value = ((draft.asset && draft.asset.characters) || seed.characters || []).join(", ");
	el("intensity").value = (draft.asset && draft.asset.intensity) || seed.intensity || "medium";
	el("sourceType").value = (draft.asset && draft.asset.sourceType) || seed.sourceType || "recorded";
	el("rootNote").value = (draft.asset && draft.asset.rootNote) || seed.rootNote || "";
	el("reviewer").value = (draft.reviewer && draft.reviewer !== "unreviewed" ? draft.reviewer : "") || reviewer;

	const lic = el("licHint");
	if (crawl.licenseHint) {
		const bad = /not bundleable/.test(crawl.licenseHint);
		lic.className = "hint " + (bad ? "bad" : "ok");
		lic.textContent = "Page mentions: " + crawl.licenseHint +
			(bad ? " — do not add this; rights come from the source, verify on the page." : "");
	} else { lic.className = "hint muted"; lic.textContent = "No licence string detected on the page — verify it yourself."; }

	el("fileUrl").oninput();
	el("msg").textContent = "";
	setStatus(candidate);
}

function splitTags(value) {
	return value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

async function verify() {
	const candidate = candidates[index];
	reviewer = el("reviewer").value.trim();
	if (reviewer) localStorage.setItem("sg-reviewer", reviewer);

	const url = el("fileUrl").value.trim();
	const isZip = /\\.zip(\\?|#|$)/i.test(url);
	const selection = {
		id: candidate.id,
		sourceId: candidate.sourceId,
		downloadUrl: url,
		sourcePageUrl: candidate.pageUrl,
		creator: el("creator").value.trim(),
		originalFilename: (url.split(/[?#]/)[0].split("/").pop()) || "",
		reviewer,
		asset: {
			family: el("family").value,
			role: el("role").value,
			pack: el("pack").value,
			name: el("name").value.trim(),
			genres: splitTags(el("genres").value),
			characters: splitTags(el("characters").value),
			intensity: el("intensity").value,
			sourceType: el("sourceType").value,
		},
	};
	if (isZip) selection.archiveMember = el("archiveMember").value.trim();
	const root = el("rootNote").value.trim();
	if (root) selection.asset.rootNote = root;

	const msg = el("msg");
	try {
		const response = await fetch("/verify", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(selection),
		});
		const body = await response.json();
		if (!response.ok) {
			msg.className = "msg bad";
			msg.textContent = (body.errors || [body.error]).join(" · ");
			return;
		}
		candidate.verified = true;
		candidate.draft = selection;
		msg.className = "msg ok";
		msg.textContent = "Added. Run library:acquire --pin to record its checksum.";
		setStatus(candidate);
		el("progress").textContent =
			(index + 1) + " / " + candidates.length + " · " +
			candidates.filter((c) => c.verified).length + " verified";
		if (index < candidates.length - 1) setTimeout(() => { index++; show(); }, 500);
	} catch (error) {
		msg.className = "msg bad";
		msg.textContent = String(error);
	}
}

el("verify").onclick = verify;
el("prev").onclick = () => { if (index > 0) { index--; show(); } };
el("next").onclick = () => { if (index < candidates.length - 1) { index++; show(); } };

fetch("/candidates").then((r) => r.json()).then((data) => {
	candidates = data.candidates;
	if (!candidates.length) {
		el("status").className = "status error";
		el("status").textContent = "No candidates in candidates.json.";
		return;
	}
	show();
});
</script>
</body>
</html>`;
}
