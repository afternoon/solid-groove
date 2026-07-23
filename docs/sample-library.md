# Solid Groove Sample Library Plan

| Field | Value |
| --- | --- |
| Status | Draft for implementation |
| Scope | Private-alpha factory library and genre starters |
| Licensing posture | CC0-first; explicit raw-redistribution rights required |
| Primary outcome | A coherent, editable electronic-music palette that supports fast loop creation and complete tracks |

Related document: [Product requirements](./prd.md)

## 1. Purpose

Solid Groove needs a sample library that is useful immediately, broad enough to support its initial genres, small enough to curate properly, and legally safe to expose through a sampler, stem export, and Ableton Live export.

The library is not a large undifferentiated download catalogue. It is an opinionated factory collection whose assets work together, cover the roles needed to build complete electronic tracks, and give the assistant reliable material for creating editable ideas.

This plan defines:

- Which rights are required to bundle an asset.
- Initial sources and how they must be audited.
- The library taxonomy, metadata, and technical standards.
- Content targets for featured and supporting genres.
- The relationship among raw samples, kits, presets, clips, and generative genre starters.
- The intake, curation, quality, delivery, and expansion process.

This is a content-acquisition and implementation plan, not legal advice. Any ambiguous source or high-risk content requires qualified legal review or direct written permission from its rights holder.

## 2. Library principles

1. **Rights before sound.** An excellent sample without raw-redistribution rights does not enter the factory library.
2. **Curated beats comprehensive.** Every asset must fill a musical role, add a distinct character, or support a genre requirement.
3. **Genre-aware, never genre-locked.** Genre tags improve discovery and generation but do not restrict where an asset can be used.
4. **Everything remains editable.** Starters use normal samples, clips, devices, MIDI events, and automation rather than hidden backing tracks.
5. **Support complete tracks.** Include transitions, textures, ambience, fills, and contrasting sounds, not only loop-friendly drums.
6. **Leave room for accidents.** At least 15% of the collection should be strange, abrasive, organic, or difficult to categorize.
7. **Prefer foundations over recognizable phrases.** Strong one-shots, multisamples, short textures, and modular loops create more user ownership than distinctive premade melodies.
8. **Consistent technical quality, varied sonic quality.** Files should be cleanly prepared without making every sound polished, loud, bright, or conventional.
9. **Provenance is product data.** Source, authorship, licence evidence, transformations, and checksums travel with every asset.
10. **No URL identity.** Stable asset IDs survive CDN, storage, format, and source-location changes.

## 3. Licensing policy

### 3.1 Why royalty-free is insufficient

Most commercial and free sample-pack licences let a producer incorporate samples into finished music but prohibit redistribution of the raw files. Solid Groove exposes individual sounds in a browser, lets users load them into samplers, and copies or renders content during stem and Ableton export. That use resembles a sample library or DAW factory-content distribution, not merely use in a composition.

For example:

- [99Sounds](https://99sounds.org/license/) permits commercial creative work but prohibits selling or redistributing its audio files, including free redistribution.
- [Splice](https://splice.com/terms) prohibits sublicensing or redistributing isolated sounds and prohibits competitive sample-library use.
- [MusicRadar SampleRadar](https://www.musicradar.com/news/sampleradar-digital-vs-analogue-samples) allows use in music but asks users not to redistribute the samples.

None of those standard licences permits bundling in Solid Groove. They may be revisited only through a separate OEM, partnership, or direct-licensing agreement.

### 3.2 Accepted rights for the alpha

An asset may be bundled only when one of these applies:

- It is released under CC0 1.0 by a credible rights holder with recorded provenance.
- Solid Groove created it entirely from sources it owns or that independently satisfy this policy.
- A commissioned creator signed an agreement explicitly allowing commercial raw-sample redistribution inside a DAW, user audition and manipulation, project collaboration, WAV/stem export, native-project export, caching, format conversion, and derivative processing.
- A third-party owner granted Solid Groove equivalent written OEM rights.

The alpha factory library will not bundle CC-BY, CC-BY-SA, CC-BY-NC, CC-ND, GPL-licensed audio, or assets with custom attribution terms. Some may legally be usable, but they add user-facing attribution, share-alike, DRM, export, or interpretation obligations that are unnecessary while suitable CC0 material exists.

### 3.3 Additional rights checks

CC0 or a permissive copyright licence does not automatically resolve every right. Intake must also consider:

- Performer consent and personality/publicity rights for vocals, speech, and identifiable people.
- Composition rights for recognizable melodies, lyrics, performances, and arrangements.
- Trademark and passing-off concerns in names, artwork, and marketing.
- Whether the uploader actually created the recording or sampled another pack, record, film, game, or commercial instrument.
- Contractual restrictions inherited from software instruments, presets, source libraries, or recording locations.
- Content-ID disputes and whether the sound is already widely registered inside released tracks.
- Privacy and sensitive-context concerns in field recordings.

Vocal phrases and recognizable performances are excluded from the first intake unless provenance includes a suitable performer release. Historical recordings require collection-level rights review even when a source calls them public domain or free to remix.

### 3.4 Licence evidence

Every accepted asset needs an immutable evidence record containing:

- Source page and direct download URL.
- Source creator, uploader, and original filename.
- Licence identifier and canonical licence URL.
- A saved copy or timestamped capture of the applicable licence statement.
- Retrieval date and SHA-256 of the original download.
- Pack/archive checksum where applicable.
- Any direct permission or commissioned-content agreement ID.
- Known source tools or recordings when supplied.
- Modifications made by Solid Groove.
- Reviewer, review date, and approval status.

If the evidence disappears later, the archived record must still establish what was granted at acquisition time. A takedown process must be able to disable an asset for new projects without breaking existing project documents.

### 3.5 Existing prototype assets

The current `public/samples/house/drums/bd/909-bd.wav` and `909-oh.wav` files are prototype inputs, not approved factory content. The repository contains no recorded source, creator, licence, or checksum evidence for them.

They must remain outside the approved manifest and be replaced with internally synthesized or reviewed CC0 equivalents unless their complete provenance and raw-redistribution rights are established. Existing filenames must not be treated as proof that a recording is free to redistribute, and cleared replacements should use descriptive user-facing names rather than third-party product branding.

## 4. Initial source shortlist

### 4.1 Tier 1: clear bundling candidates

| Source | What to use | Licence position | Intake notes |
| --- | --- | --- | --- |
| [Producer Space](https://producerspace.com/) | Electronic one-shots, percussion, house material, MIDI, selected non-vocal loops | The [official clearance](https://producerspace.com/license) places the entire library under CC0 and expressly grants reproduction, modification, and distribution rights | Audit pack authorship and avoid vocals until performer provenance is documented |
| [FreePats](https://freepats.zenvoid.org/) | Electronic percussion, synth bass multisamples, pads, leads, tuned percussion, selected acoustic instruments | Licences are stated per bank; use CC0 banks only | Begin with [electronic percussion](https://freepats.zenvoid.org/Percussion/electric-percussion.html), [synth bass](https://freepats.zenvoid.org/Synthesizer/synth-bass.html), and [synth pads](https://freepats.zenvoid.org/Synthesizer/synth-pad.html) |
| [Versilian Community Sample Library](https://versilian-studios.com/vcsl/) | Experimental instruments, organic percussion, mallets, unusual resonances, textures, and multisamples | CC0; the publisher explicitly permits commercial software, DAWs, granular synths, and samplers | Select a small electronic-production subset rather than ingesting the full multi-gigabyte library |
| Internally synthesized and recorded content | Core drum hits, noise, sub tones, oscillator cycles, risers, impacts, and processing-derived textures | Owned by Solid Groove when created without restricted source presets or samples | Highest-priority route for a coherent core kit and reliable genre coverage |

### 4.2 Tier 2: useful after asset-level audit

| Source | What to use | Licence position | Intake notes |
| --- | --- | --- | --- |
| [Signature Sounds](https://signaturesounds.org/) | 808-style basses, organic percussion, ambience, drones, textures, impacts, bells, and unusual field recordings | The site states its packs include CC0 licence files | Verify the licence file, creator, and provenance inside every selected pack; do not treat a site-wide claim as the only evidence |
| [Freesound](https://freesound.org/) | Targeted gap-filling: foley, field recordings, noise, mechanical sounds, percussion, ambience, and some loops | Use sounds marked CC0 only; the catalogue also contains CC-BY and CC-BY-NC | Record sound ID/uploader/licence, manually assess provenance, avoid recognizable media, and do not bulk-import search results blindly |
| [Kenney audio assets](https://www.kenney.nl/assets) | Interface sounds, impacts, short effects, and raw sound-design material | Kenney states its asset-page downloads are CC0 | Useful mainly for application and transition effects rather than core musical identity |
| [OpenGameArt](https://opengameart.org/) | Selected CC0 impacts, percussion, ambience, and experimental audio | Licence varies per download; use CC0 only | Downloaded assets and previews may differ; archive and review the actual download rather than preview audio |
| [Freesound Loop Dataset](https://zenodo.org/records/3967852) | Discovery and metadata for tempo/key-labelled loops | Individual audio files have separate Creative Commons licences recorded in metadata | Filter to CC0, then apply the same uploader/provenance and musical-quality review as direct Freesound intake |

### 4.3 Partnership candidates

These sources have musically relevant catalogues but their standard licences do not permit factory-library redistribution:

- 99Sounds, particularly electronic loops, dub material, glitch, percussion, transitions, and textures.
- Independent pack makers such as Samples From Mars, Goldbaby, and specialist genre sound designers.
- Labels currently distributed through Splice or other marketplaces, contacted directly rather than licensed through a consumer account.

Any outreach should request a written quote for a perpetual, worldwide, non-exclusive OEM licence covering browser delivery, individual audition, sampler use, user projects, collaboration, stems, project export, CDN caching, and continued use in existing projects after the agreement ends.

## 5. Logical library structure

The user-facing library is metadata-driven. Storage paths may be optimized independently and must not define taxonomy or identity.

```text
library
  one-shots
    drums
      kick
      snare
      clap
      rim
      closed-hat
      open-hat
      cymbal
      tom
      percussion
    bass
      sub
      sustained
      stab
      reese
    tonal
      chord
      stab
      pluck
      key
      mallet
      bell
    texture
      noise
      ambience
      drone
      mechanical
      organic
    fx
      impact
      riser
      downer
      sweep
      reverse
      glitch
  loops
    drums
    tops
    percussion
    bass
    melodic
    harmonic
    texture
    transition
  instruments
    multisamples
    drum-kits
    synth-presets
  processing
    device-presets
    chains
  starters
    genre-recipes
    fallback-projects
```

### Asset types

- **One-shot:** A single triggerable sound with optional pitch/root information.
- **Audio loop:** Bar-aligned audio with verified BPM, bar count, and seamless boundaries.
- **Multisample zone:** One recording within a playable sampled instrument.
- **Instrument definition:** Mapping from samples to pitches, velocities, envelopes, and defaults.
- **Drum kit:** A stable mapping from pad roles to one-shot asset IDs and pad parameters.
- **Device preset:** Parameter values for one processing device; contains no third-party audio unless separately licensed.
- **Processing chain:** Ordered factory devices with parameters, gain staging, and intended role.
- **Genre recipe:** Constraints and weighted choices used to generate a new editable starting project.
- **Fallback project:** A curated static project used when assistant generation is unavailable.

## 6. Alpha size and coverage targets

### 6.1 Delivery milestones

| Milestone | Unique one-shots | Audio loops | Drum kits | Sampled instruments | Processing presets/chains | Purpose |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Bootstrap | 80 | 12 | 4 | 2 | 12 | Replace the current two-sample prototype and exercise metadata/browser/audio paths |
| Production seed | 250 | 60 | 12 | 8 | 36 | Build all editors, generators, export, caching, and curation workflows |
| Private alpha | 600 | 360 | 24 | 30 | 72 | Rounded factory library with six featured starters and all required genre demos |

Counts are minimums, not acquisition quotas. Duplicates, low-quality alternates, near-identical processing variations, and legally ambiguous files do not count.

### 6.2 Private-alpha one-shot allocation

| Role | Target | Required range |
| --- | ---: | --- |
| Kicks | 80 | Clean, soft, acoustic-derived, short, long, sub-heavy, distorted, and layered |
| Snares, claps, and rims | 90 | Tight, wide, dry, roomy, synthetic, organic, and noisy |
| Hats and cymbals | 100 | Closed/open pairs, rides, crashes, metallic/noise variants, short/long tails |
| Toms and conventional percussion | 60 | Tuned toms, congas, shakers, blocks, bells, and hand percussion |
| Found and experimental percussion | 70 | Metal, glass, wood, stone, mechanical, glitch, and processed foley |
| Bass and sub one-shots | 60 | Clean sine/sub, 808-style, reese, distorted, short stab, and sustained tones |
| Chords, stabs, plucks, keys, and mallets | 70 | Major/minor/neutral material, tonal hits, organ/piano colors, synthetic and organic |
| Impacts, sweeps, risers, reverses, and glitches | 70 | Short/long transitions, noise movement, drop impacts, fills, and unexpected effects |

### 6.3 Private-alpha loop allocation

| Role | Target | Requirements |
| --- | ---: | --- |
| Full drum loops and breaks | 100 | Modular, minimally processed versions preferred; no uncleared famous break recordings |
| Tops and percussion loops | 60 | Layerable hats, shakers, percussion, and syncopated movement |
| Bass loops | 45 | Clean and processed variants across straight, swung, syncopated, and halftime patterns |
| Melodic and harmonic loops | 55 | Short modular phrases; key-labelled; avoid recognizable or overly complete hooks |
| Textures, drones, ambience, and rhythmic noise | 60 | Drumless and atmospheric material, including seamless and evolving options |
| Transitions and fills | 40 | One-, two-, four-, and eight-bar builds, drops, turnarounds, and effects phrases |

Loops should not dominate the library. The assistant should normally combine editable MIDI, drum events, instruments, and modular audio rather than assemble songs entirely from finished loops.

### 6.4 Character balance

- At least 30% of one-shots must be dry or lightly processed enough to shape substantially.
- At least 20% must be organic, recorded, or derived from non-instrument sources.
- At least 15% must be explicitly experimental, abrasive, unstable-sounding, or cross-genre.
- No more than 20% of the library may be near-identical variations of one source family.
- At least half of drum loops must have separable or complementary top/percussion content.
- Every featured genre must have usable options at low, medium, and high intensity.

## 7. Genre coverage

The assumed six featured dashboard starters are House, Techno, Hip Hop/Trap, Drum & Bass/Jungle, Dubstep/Bass, and Ambient. This selection remains subject to product-owner approval. Lofi, Trance, UK Garage, Breakbeat, and Electronic Pop remain required library/demo coverage even if they are not featured starter buttons.

Assets can count toward multiple genres when the tags are honest. Dedicated counts below measure discoverable coverage, not necessarily unique files.

### 7.1 House

| Attribute | Plan |
| --- | --- |
| Tempo coverage | 118-132 BPM |
| Essential drums | Solid short kicks, round/deep kicks, claps, offbeat open hats, shuffled closed hats, shakers, congas, rides |
| Tonal material | Organ/piano chords, minor and dominant stabs, warm plucks, disco-derived but original bass tones, vocal-like synth chops |
| Loops | Straight and swung drums, tops, percussion, bass grooves, chord rhythms, fills |
| Processing | Pumping compression presets, filtered delay, plate/room reverb, saturation, dub delay, gentle bus glue |
| Variation goals | Deep, classic, garage-influenced, acid-adjacent, raw, and modern club palettes |
| Minimum coverage | 4 kits, 80 tagged one-shots, 50 loops, 12 processing presets/chains |

Avoid baking side-chain pumping or large reverb into every source. Provide dry foundations and demonstrate movement through devices and automation.

### 7.2 Techno

| Attribute | Plan |
| --- | --- |
| Tempo coverage | 125-150 BPM |
| Essential drums | Clean and driven kicks, rumble-ready tails, hard claps, metallic hats, rides, tuned toms, industrial percussion |
| Tonal material | Minimal stabs, drones, atonal hits, FM tones, alarm-like textures, noise, resonant sequences |
| Loops | Driving percussion, rolling low-end, polyrhythmic tops, industrial movement, sparse tonal loops |
| Processing | Overdrive, saturation, resonant filtering, long feedback delay, dark reverb, compression, destructive chains |
| Variation goals | Hypnotic, raw, industrial, dub, melodic-adjacent, and broken-beat possibilities |
| Minimum coverage | 4 kits, 80 tagged one-shots, 50 loops, 14 processing presets/chains |

Do not equate techno with one fixed kick or arrangement. Experimental percussion and automation recipes are central to this starter.

### 7.3 Hip Hop and Trap

| Attribute | Plan |
| --- | --- |
| Tempo coverage | 65-105 BPM and double-time metadata through 170 BPM |
| Essential drums | Punchy kicks, dry and wide snares, claps, rims, detailed hats, rolls, open hats, percussion, tuned 808-style bass |
| Tonal material | Keys, mallets, plucks, pads, original dusty textures, short chords, sub and distorted basses |
| Loops | Swung drums, halftime patterns, hat/top loops, bass phrases, sparse melodic fragments, turnarounds |
| Processing | Tape/lofi color, saturation, clipping, filtered sampling chains, short room reverb, delay throws, 808 distortion |
| Variation goals | Boom-bap-adjacent, modern trap, drill-adjacent, soulful, dark, sparse, and experimental |
| Minimum coverage | 4 kits, 90 tagged one-shots, 50 loops, 12 processing presets/chains |

Do not bundle uncleared record chops, branded producer imitations, or vinyl noise copied from records. Record or synthesize every texture and break from a cleared source.

### 7.4 Drum & Bass and Jungle

| Attribute | Plan |
| --- | --- |
| Tempo coverage | 160-180 BPM |
| Essential drums | Tight kicks, layered snares, ghost hits, rides, hats, percussion, original recorded/synthesized breaks and slices |
| Tonal material | Sub tones, reese basses, mid-bass stabs, pads, atmospheres, rave-adjacent but original chord hits |
| Loops | Full breaks, isolated tops, shuffled percussion, bass movement, pads, fills and edits |
| Processing | Parallel drum compression, saturation, break filtering, reese chains, short rooms, long atmospheric reverb, delay |
| Variation goals | Liquid, jungle-influenced, rolling, minimal, dark, and heavier bass-focused palettes |
| Minimum coverage | 4 kits, 90 tagged one-shots, 55 loops, 14 processing presets/chains |

Do not ship a copied Amen, Think, or other historically common break merely because it is widely sampled. Commission or record original break performances that teach the same chopping techniques without uncertain source rights.

### 7.5 Dubstep and Bass Music

| Attribute | Plan |
| --- | --- |
| Tempo coverage | 135-150 BPM |
| Essential drums | Heavy kicks, halftime snares, claps, sharp hats, metallic percussion, impacts, fills |
| Tonal material | Clean subs, reese and growl source tones, FM/wavetable-like one-shots, dark stabs, drones, noise movement |
| Loops | Halftime drums, syncopated percussion, bass rhythms, sparse atmospheres, tension and release effects |
| Processing | Multistage distortion, saturation, filtering, compression, feedback delay, large reverb, resampling-oriented chains |
| Variation goals | Deep 140, dub-influenced, heavy, spacious, halftime, leftfield, and experimental |
| Minimum coverage | 4 kits, 80 tagged one-shots, 45 loops, 16 processing presets/chains |

This starter should demonstrate the product's extreme processing range. Prefer simple source tones plus editable devices over a library made entirely of frozen finished growls.

### 7.6 Ambient

| Attribute | Plan |
| --- | --- |
| Tempo coverage | Tempo-free plus 50-120 BPM metadata where rhythmic |
| Essential material | Drones, evolving pads, field recordings, room tones, bells, mallets, resonances, noise, organic textures, granular-ready snippets |
| Loops | Drumless textures, slow pulses, seamless ambience, evolving harmonic beds, sparse percussion |
| Processing | Long and unusual reverbs, feedback delays, filtering, saturation, pitch shifting when available, destructive texture chains |
| Variation goals | Warm, dark, environmental, minimal, noisy, beatless, and rhythmic ambient |
| Minimum coverage | 2 kits, 60 tagged one-shots, 50 loops, 14 processing presets/chains |

Ambient validates that starters do not require a kick, fixed tempo, or conventional song density. Long files must still meet streaming, caching, and memory budgets.

### 7.7 Supporting genre coverage

| Genre | Required additions beyond shared library | Demo gate |
| --- | --- | --- |
| Lofi | Soft drums, dusty but original textures, tape-like chains, keys, mallets, subdued ambience | Complete editable demo without relying on an uncleared record sample |
| Trance | Clean club drums, rolling bass, plucks, pads, noise risers, long transitions, tempo-synced delays | Complete 132-140 BPM demo with build/release automation |
| UK Garage | Shuffled kicks/snares, skippy hats, rim/percussion, sub bass, organ/chord stabs | Complete swung demo whose groove is not a renamed house pattern |
| Breakbeat | Original breaks and slices, punchy one-shots, bass stabs, edits, fills | Complete demo using cleared original break sources |
| Electronic Pop | Versatile drums, synth bass, keys, pads, plucks, transitions, restrained processing | Complete instrumental demo with verse/chorus contrast and room for vocals |

## 8. Generative genre starters

A genre starter is a versioned recipe used by the assistant and a deterministic fallback generator. It is not one fixed project.

Each recipe defines:

- Tempo and optional key/scale ranges.
- Required, optional, and mutually exclusive track roles.
- Weighted asset queries by role, genre, character, intensity, and compatibility.
- Instrument and device preset choices.
- Rhythm grammar, swing, density, register, and velocity ranges.
- Allowed clip lengths and variation operations.
- An initial loop shape and optional arrangement outline.
- Gain-staging rules and effect-send defaults.
- A controlled probability of cross-genre or experimental choices.
- Validation rules and a curated static fallback project.

Generation requirements:

- Two generations from the same genre should not normally produce identical projects.
- The generated project records recipe version, random seed, selected asset IDs, assistant proposal ID, and all resulting normal domain commands.
- Reopening a generated project reproduces its saved state; it does not regenerate implicitly.
- `Generate another` creates a new proposal or project and never overwrites current work.
- A `Make it weird` modifier increases cross-genre, experimental-source, unusual processing, and rhythmic-variation weights without bypassing safety or licence validation.
- The assistant generates editable events, instruments, devices, and automation. It does not generate opaque audio for alpha starters.
- Generation works without a model through deterministic recipes and static fallbacks when the AI provider is unavailable.

## 9. Asset metadata

The canonical manifest should support a shape equivalent to:

```json
{
  "id": "sg-one-shot-kick-0001",
  "version": 1,
  "name": "Rounded Analog Kick 01",
  "type": "one-shot",
  "role": "kick",
  "files": {
    "master": {
      "storageKey": "sha256/ab/cd/...wav",
      "sha256": "...",
      "bytes": 123456,
      "format": "wav"
    }
  },
  "audio": {
    "sampleRate": 48000,
    "bitDepth": 24,
    "channels": 1,
    "durationSeconds": 0.42,
    "peakDbfs": -1.2,
    "rootNote": "C1",
    "tuningCents": -3,
    "bpm": null,
    "bars": null,
    "loopable": false
  },
  "tags": {
    "genres": ["house", "techno"],
    "characters": ["round", "clean", "short"],
    "intensity": "medium",
    "sourceTypes": ["synthesized"]
  },
  "license": {
    "id": "CC0-1.0",
    "sourceUrl": "https://example.com/source",
    "creator": "Example Creator",
    "retrievedAt": "2026-07-23",
    "evidencePath": "licenses/example/2026-07-23.html",
    "rawRedistributionAllowed": true,
    "agreementId": null
  },
  "provenance": {
    "originalFilename": "kick-01.wav",
    "originalSha256": "...",
    "modifications": ["trim", "fade", "resample-48000", "rename"],
    "reviewer": "...",
    "reviewedAt": "..."
  }
}
```

### Controlled vocabulary

- Genre tags use stable IDs and may be many-to-many.
- Role is functional: kick, bass, texture, transition, chord, and similar.
- Character tags describe audible qualities such as dry, distorted, metallic, warm, noisy, short, dark, wide, or organic.
- Mood is separate from genre and character.
- Intensity uses a small ordered scale: low, medium, high, extreme.
- Source type distinguishes recorded, synthesized, field recording, resampled, processed, and commissioned.
- Instrument, kit, and recipe definitions reference asset IDs, never filenames or URLs.

Manifest validation fails CI when an asset is missing its checksum, rights evidence, creator/source, required audio metadata, or raw-redistribution approval.

## 10. Audio preparation standards

### Master files

- Store lossless PCM WAV masters at 48 kHz and 24-bit where the source quality supports it.
- Preserve genuine mono sources as mono. Use stereo only when spatial information is musically meaningful.
- Do not upsample or increase bit depth merely to claim a higher specification; record source format and conversion honestly.
- Remove DC offset, corrupt chunks, unintended leading/trailing silence, and accidental clicks.
- Use very short fades where necessary without softening intended transients.
- Do not brick-wall normalize the collection. Prevent clipping and provide perceptually reasonable audition levels while retaining useful dynamics.
- Keep a checksum of the untouched source and treat processed masters as derived assets.

### One-shots

- Trim start latency tightly enough for rhythmic use.
- Preserve natural or designed tails unless silence is clearly accidental.
- Detect and review root note and tuning for tonal drums, basses, stabs, and instruments.
- Record choke relationships for open/closed hats and similar pairs.
- Identify near duplicates using audio fingerprints and human review.

### Loops

- Verify BPM by listening and bar-grid alignment; never trust filenames alone.
- Record exact bar count, time signature, key where applicable, and whether the file is truly seamless.
- Align boundaries to integer sample positions and test at repeated playback for at least 32 cycles.
- Reject loops with clipped reverb/delay tails, hidden count-ins, or tempo drift unless intentionally categorized as free-time.
- Prefer dry or stem-like modular loops over complete mixed phrases.

### Sampled instruments

- Validate root keys, zone boundaries, velocity layers, loop points, gain consistency, and release behavior.
- Convert SFZ mappings into a documented internal instrument definition rather than requiring a third-party player.
- Preserve the source SFZ and licence evidence for traceability.
- Load only zones required for the active register where practical; do not decode an entire multi-gigabyte source library eagerly.

## 11. Curation and quality workflow

### Intake states

1. **Candidate:** Link and initial musical reason recorded; asset cannot ship.
2. **Rights review:** Licence and provenance checked; ambiguous assets rejected or escalated.
3. **Quarantine:** Original downloaded, hashed, scanned, and isolated from production manifests.
4. **Audio preparation:** Format conversion, trimming, fades, analysis, and derived master generation.
5. **Metadata review:** Role, genre, character, musical metadata, and user-facing name checked.
6. **Musical review:** Auditioned alone and in at least two relevant project contexts.
7. **Approved:** Manifest entry reviewed and eligible for kits, recipes, demos, and production delivery.
8. **Deprecated:** Hidden from new selection while existing project references remain resolvable.
9. **Removed:** Delivery disabled for legal/security reasons with a documented project-recovery strategy.

### Musical review rubric

Each approved asset must pass:

- **Distinctness:** It adds something not already covered better.
- **Usefulness:** It can serve a clear role or valuable experimental purpose.
- **Editability:** It leaves room for user processing unless its finished character is the point.
- **Technical integrity:** It has no accidental clipping, clicks, corrupt data, or false metadata.
- **Context fit:** It works in a real Solid Groove kit, instrument, loop, or starter.
- **Naming:** The name describes the sound without unauthorized brands, artist imitation, or misleading genre claims.

At least two reviewers should approve commissioned packs and high-volume source imports. Spot checking is not sufficient for bulk acceptance.

## 12. Delivery and performance

- Keep only the bootstrap set and assets required by starter fallbacks in the initial application cache.
- Store the complete alpha library in Cloud Storage for Firebase behind stable asset records and cacheable versioned URLs.
- Fetch masters lazily on selection, audition, project load, or explicit prefetch.
- Prefetch all assets required by the open project and likely alternates for the current browser view without decoding the entire library.
- Cache decoded buffers through the shared audio-runtime asset cache and release them according to the Web Audio lifecycle requirements.
- Generate compact waveform peaks during ingestion; clients should not download a full long asset merely to display its browser waveform.
- A missing or failed asset is isolated, produces an actionable state, and never blocks unrelated project playback.
- Cross-origin headers must allow Web Audio decoding and offline export in every supported browser.
- The library manifest can be searched locally after a compact metadata fetch; search must not enumerate Cloud Storage objects.
- Export and collaboration resolve immutable asset versions so a later library update cannot silently change an existing track.

Initial performance targets:

- Library metadata payload below 1 MiB compressed for the private-alpha catalogue.
- Search/filter response below 50 ms for 1,000 assets on the 2019 Intel MacBook Pro baseline after metadata load.
- First audition begins within 500 ms for a cached one-shot and within 2 seconds for a typical uncached asset on broadband.
- Starter fallback assets add no more than 40 MiB to the first-project download before normal browser caching.

## 13. Implementation phases

### Phase A: policy and tooling

- Approve this licence policy and commissioned-content agreement requirements.
- Define the manifest schema, controlled vocabulary, stable ID rules, and validation command.
- Build source/evidence archiving, checksum, audio-analysis, waveform, and manifest-generation scripts.
- Implement candidate, review, approval, deprecation, and takedown states.

Exit criteria: one asset can travel from original download through reviewed evidence and generated delivery manifest without manual data duplication.

### Phase B: bootstrap library

- Create an internal core electronic drum set and noise/transition sources.
- Import reviewed CC0 FreePats electronic percussion, synth bass, and selected pad assets.
- Select small VCSL percussion and experimental-instrument subsets.
- Reach the bootstrap counts and replace prototype filenames with stable asset IDs.

Exit criteria: browser, sampler, drum machine, instruments, cache, missing-asset flow, and export work against the real manifest.

### Phase C: production seed

- Curate Producer Space non-vocal material and individually evidenced Signature Sounds packs.
- Add targeted Freesound CC0 foley, ambience, and unusual percussion.
- Build 12 coherent drum kits and initial processing chains.
- Draft and test all six genre recipe schemas with deterministic generation and fallbacks.

Exit criteria: every featured genre can produce at least three materially different playable loops using only approved assets.

### Phase D: rounded private-alpha library

- Reach the private-alpha asset targets without relaxing review standards.
- Commission missing core drums, breaks, bass sources, transitions, and genre-specific material.
- Complete all featured starter and supporting genre demo gates.
- Run duplicate, loudness, licence, missing-file, decode, loop-boundary, and export audits.

Exit criteria: every required genre demo opens, plays, saves, renders, exports stems, and exports to the supported Ableton handoff without a missing or unlicensed asset.

### Phase E: partnerships and user growth

- Pursue OEM licences with selected sample labels.
- Add user imports and separate user-owned asset storage from factory content.
- Use search, audition, replacement, and project-use telemetry to identify gaps without recording creative content.
- Retire weak assets and add curated packs through immutable versioned releases.

## 14. Immediate acquisition backlog

1. Download and archive the Producer Space full pack and official licence; quarantine vocals and select the first 40 clearly sourced non-vocal assets.
2. Import FreePats CC0 electronic percussion, Lately Bass, Synth Bass #1/#2, and a small pad set with original SFZ mappings.
3. Select 30-50 VCSL files covering organic percussion, mallets, resonances, and experimental textures.
4. Audit Signature Sounds packs for 808-style basses, unusual percussion, ambient loops, impacts, and transitions; accept only packs containing a matching CC0 licence file and credible provenance.
5. Curate at most 50 Freesound CC0 candidates for gaps that the named collections cannot fill; review every asset manually.
6. Create 80 original drum/noise/transition one-shots with Tone/Web Audio or owned recordings, retaining generation recipes and source sessions.
7. Assemble four bootstrap kits: clean electronic, driven club, broken/organic, and experimental.
8. Implement the manifest validator before adding further bulk content.

## 15. Alpha acceptance checklist

- Every delivered factory asset has approved raw-redistribution rights and archived evidence.
- No standard consumer royalty-free pack is bundled without a separate OEM grant.
- No asset depends on a third-party URL remaining live.
- Every audio file resolves through a stable asset ID and immutable version.
- Bootstrap, production-seed, and alpha counts are measured from approved unique assets only.
- Six featured genre recipes generate editable, non-identical projects and have static fallbacks.
- Lofi, Trance, UK Garage, Breakbeat, and Electronic Pop demos pass using the shared library.
- At least 15% of the approved collection is tagged and reviewed as experimental or cross-genre.
- All loops pass BPM/bar/seam tests and all tonal assets have reviewed tuning metadata.
- Every required asset decodes and plays in supported Firefox, Chrome, Edge, and Safari versions.
- The 2019 Intel MacBook Pro baseline meets search, first-audition, caching, and project-load targets.
- Stereo, stem, collaboration, and Ableton exports preserve or render every used asset according to its manifest and licence policy.
- Removing a library asset from new-project discovery does not corrupt existing project state.
