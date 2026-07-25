// The audition page served by `bun run library:audition`.
//
// Assets are stored under content-addressed keys (`sha256/ab/cd/<hash>.wav`),
// which is right for delivery and useless for listening: a directory of hashes
// tells you nothing. This renders the manifest as something you can actually
// audition — search, filter by family/role/genre/character, and play with the
// keyboard.
//
// It draws waveforms from the manifest's own `waveform.peaks`, so browsing the
// library also exercises the claim that a client can draw an asset without
// downloading its audio (docs/sample-library.md section 12).

/** @param {object} manifest the merged library manifest */
export function renderAuditionPage(manifest) {
	const payload = JSON.stringify(manifest).replace(/</g, "\\u003c");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Solid Groove — starter library audition</title>
<style>
:root {
	color-scheme: dark;
	--bg: #12121a; --panel: #1b1b26; --line: #2b2b3a; --text: #e8e8f0;
	--muted: #9a9ab0; --accent: #6ee7b7; --accent-dim: #2f6f5a; --warn: #fbbf24;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
	font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: var(--panel);
	border-bottom: 1px solid var(--line); padding: 12px 16px; }
h1 { margin: 0 0 2px; font-size: 15px; font-weight: 600; letter-spacing: .01em; }
.sub { color: var(--muted); font-size: 12px; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }
input[type=search], select { background: var(--bg); color: var(--text);
	border: 1px solid var(--line); border-radius: 6px; padding: 6px 9px; font: inherit; font-size: 13px; }
input[type=search] { min-width: 220px; flex: 1 1 220px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { background: var(--bg); color: var(--muted); border: 1px solid var(--line);
	border-radius: 999px; padding: 4px 11px; font-size: 12px; cursor: pointer; }
.chip[aria-pressed=true] { background: var(--accent-dim); color: var(--text); border-color: var(--accent); }
main { padding: 8px 16px 64px; }
.row { display: grid; grid-template-columns: 1fr 150px 128px 88px auto;
	gap: 12px; align-items: center; padding: 7px 10px; border-radius: 8px;
	border: 1px solid transparent; cursor: pointer; }
.row:hover { background: var(--panel); }
.row[aria-selected=true] { border-color: var(--accent); background: var(--panel); }
.row.playing .name { color: var(--accent); }
.name { font-weight: 500; }
.meta, .num { color: var(--muted); font-size: 12px; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; }
.tag { background: var(--bg); border: 1px solid var(--line); border-radius: 4px;
	padding: 1px 6px; font-size: 11px; color: var(--muted); }
canvas { display: block; width: 128px; height: 30px; }
.empty { color: var(--muted); padding: 32px 10px; }
kbd { background: var(--bg); border: 1px solid var(--line); border-bottom-width: 2px;
	border-radius: 4px; padding: 0 4px; font-size: 11px; font-family: ui-monospace, monospace; }
.acquired { color: var(--warn); }
</style>
</head>
<body>
<header>
	<h1>Starter library audition <span class="sub" id="count"></span></h1>
	<div class="sub" id="summary"></div>
	<div class="controls">
		<input type="search" id="q" placeholder="Search name, role, or tag…" autofocus>
		<select id="genre"><option value="">All genres</option></select>
		<select id="character"><option value="">All characters</option></select>
		<div class="chips" id="families"></div>
	</div>
	<div class="sub" style="margin-top:8px">
		<kbd>&uarr;</kbd> <kbd>&darr;</kbd> move &amp; play · <kbd>space</kbd> replay · <kbd>/</kbd> search
	</div>
</header>
<main><div id="list"></div></main>
<script>
const MANIFEST = ${payload};
const assets = MANIFEST.assets;
const player = new Audio();
let filtered = assets;
let selected = 0;

const el = (id) => document.getElementById(id);
const uniq = (values) => [...new Set(values)].sort();

el("count").textContent = "— " + assets.length + " assets";
const acquired = assets.filter((a) => a.provenance.sourceType !== "synthesized").length;
el("summary").textContent =
	MANIFEST.libraryId + " v" + MANIFEST.libraryVersion + " · " + MANIFEST.deliveryTier +
	" · " + (assets.length - acquired) + " synthesized" +
	(acquired ? " · " + acquired + " acquired" : "");

for (const [id, values] of [
	["genre", uniq(assets.flatMap((a) => a.tags.genres))],
	["character", uniq(assets.flatMap((a) => a.tags.characters))],
]) {
	for (const value of values) {
		const option = document.createElement("option");
		option.value = option.textContent = value;
		el(id).append(option);
	}
}

const families = uniq(assets.map((a) => a.family));
const active = new Set();
for (const family of families) {
	const chip = document.createElement("button");
	chip.className = "chip";
	chip.textContent = family;
	chip.setAttribute("aria-pressed", "false");
	chip.onclick = () => {
		active.has(family) ? active.delete(family) : active.add(family);
		chip.setAttribute("aria-pressed", String(active.has(family)));
		apply();
	};
	el("families").append(chip);
}

function matches(asset, query) {
	if (active.size && !active.has(asset.family)) return false;
	const genre = el("genre").value;
	if (genre && !asset.tags.genres.includes(genre)) return false;
	const character = el("character").value;
	if (character && !asset.tags.characters.includes(character)) return false;
	if (!query) return true;
	const haystack = [asset.name, asset.family, asset.role, ...asset.tags.genres, ...asset.tags.characters]
		.join(" ").toLowerCase();
	return query.split(/\\s+/).every((term) => haystack.includes(term));
}

function drawWaveform(canvas, peaks) {
	const ratio = window.devicePixelRatio || 1;
	const width = canvas.width = 128 * ratio;
	const height = canvas.height = 30 * ratio;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#6ee7b7";
	const buckets = peaks.length / 2;
	const step = width / buckets;
	for (let i = 0; i < buckets; i++) {
		const low = peaks[i * 2];
		const high = peaks[i * 2 + 1];
		const top = ((1 - high) / 2) * height;
		const bottom = ((1 - low) / 2) * height;
		ctx.fillRect(i * step, top, Math.max(1, step - ratio), Math.max(ratio, bottom - top));
	}
}

function play(index) {
	if (!filtered[index]) return;
	selected = index;
	const asset = filtered[index];
	player.src = "/audio/" + asset.files.master.storageKey;
	player.currentTime = 0;
	player.play().catch(() => {});
	for (const row of document.querySelectorAll(".row")) {
		row.setAttribute("aria-selected", String(Number(row.dataset.index) === index));
		row.classList.toggle("playing", Number(row.dataset.index) === index);
	}
	document.querySelector('.row[aria-selected=true]')?.scrollIntoView({ block: "nearest" });
}

function apply() {
	const query = el("q").value.trim().toLowerCase();
	filtered = assets.filter((asset) => matches(asset, query));
	const list = el("list");
	list.textContent = "";
	if (!filtered.length) {
		list.innerHTML = '<div class="empty">Nothing matches those filters.</div>';
		return;
	}
	const fragment = document.createDocumentFragment();
	filtered.forEach((asset, index) => {
		const row = document.createElement("div");
		row.className = "row";
		row.dataset.index = String(index);
		row.onclick = () => play(index);

		const name = document.createElement("div");
		name.className = "name";
		name.textContent = asset.name;
		if (asset.provenance.sourceType !== "synthesized") {
			const badge = document.createElement("span");
			badge.className = "acquired";
			badge.textContent = " ◆";
			badge.title = "acquired: " + asset.provenance.sourceType;
			name.append(badge);
		}

		const meta = document.createElement("div");
		meta.className = "meta";
		meta.textContent = asset.family + " / " + asset.role +
			(asset.audio.rootNote ? " · " + asset.audio.rootNote : "");

		const canvas = document.createElement("canvas");
		drawWaveform(canvas, asset.waveform.peaks);

		const num = document.createElement("div");
		num.className = "num";
		num.textContent = asset.audio.durationSeconds.toFixed(2) + "s";
		num.title = "peak " + asset.audio.peakDbfs + " dBFS · RMS " + asset.audio.rmsDbfs + " dBFS";

		const tags = document.createElement("div");
		tags.className = "tags";
		for (const tag of [...asset.tags.characters, asset.tags.intensity]) {
			const span = document.createElement("span");
			span.className = "tag";
			span.textContent = tag;
			tags.append(span);
		}

		row.append(name, meta, canvas, num, tags);
		fragment.append(row);
	});
	list.append(fragment);
	el("count").textContent = "— " + filtered.length + " of " + assets.length + " assets";
}

el("q").oninput = apply;
el("genre").onchange = apply;
el("character").onchange = apply;

document.addEventListener("keydown", (event) => {
	if (event.key === "/" && document.activeElement !== el("q")) {
		event.preventDefault();
		el("q").focus();
		return;
	}
	if (event.key === "ArrowDown") { event.preventDefault(); play(Math.min(selected + 1, filtered.length - 1)); }
	if (event.key === "ArrowUp") { event.preventDefault(); play(Math.max(selected - 1, 0)); }
	if (event.key === " " && document.activeElement !== el("q")) { event.preventDefault(); play(selected); }
});

apply();
</script>
</body>
</html>`;
}
