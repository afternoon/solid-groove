# Solid Groove — From Self-Validation to the First 100 Users

| Field | Value |
| --- | --- |
| Status | Draft for execution |
| Owner | Product owner (Stage 2 onwards is partly delegable — see §12) |
| Budget | £1,000 total, of which **£80 is spent before Stage 2** |
| Goal | 100 activated users (defined in §3), via a validated hypothesis and a 10–20 person alpha |
| Sequencing | Gated on your own conviction and on product milestones, never on the calendar |

**Marketing does not start until Stage 2 (§6).** Stages 0 and 1 are research, and treating them as marketing is the main way this goes wrong. If you only read one section, read §2 — it is the section that decides whether the rest is worth doing.

---

## 1. The four stages

Solid Groove is in **Alpha Milestone 0** of four (tracked in [GitHub issues](https://github.com/afternoon/solid-groove/issues)). The fundamental hypothesis is yours to test first:

> **A DAW with an AI assistant can help me become a better producer.**

Until you believe that from your own experience, there is nothing worth marketing and no one worth recruiting. So:

| Stage | Gate to enter | Goal | Marketing effort |
| --- | --- | --- | --- |
| **0. Self-validation** | Alpha Milestone 2, then Alpha Milestone 3 | You finish 3 tracks and write down a verdict on the hypothesis | **~zero** (§2) |
| **1. Alpha** | You believe the hypothesis | 10–20 hand-recruited testers, `DEC-006` satisfied | ~2 h/week for 4 weeks (§5) |
| **2. First 100** | The alpha retains people | 100 activated users | 90 min/week + most of the money (§6–§7) |
| **3. Educators** | 100 users and evidence in hand | Your producer friend, then teachers as a channel | (§8) |

Two consequences worth being clear-eyed about:

- **This puts real marketing after Alpha Milestone 3.** The hypothesis names the AI assistant, so you cannot test it before the assistant exists. That is a long way out in the backlog, and it is the honest implication of validating properly first. Better to know that now than to discover it in month seven.
- **A waitlist built now would be worthless later.** Email lists decay badly; a signup from nine months ago converts terribly. This is the strongest practical argument for doing nothing in Stage 0 — not discipline, just arithmetic.

---

## 2. Stage 0: prove it on yourself, and design the test so it can fail

This is the most important section in the document, because everything downstream is conditional on it and because **the test is very easy to accidentally rig.**

### You are the most generous judge this tool will ever have

Three mechanisms, all of which will operate on you without your noticing:

1. **You know where the bodies are buried.** You will unconsciously route around the broken paths, the awkward interactions, the features you know are half-done. A real user walks straight into them.
2. **You want it to work.** You have spent months building it. "Did it help me?" asked of your own tool, with no pre-committed bar, will return yes almost regardless of the truth.
3. **You can fix things mid-test.** Every time you hit friction you'll be tempted to go fix it, which is good for the product but destroys the experiment — you end up testing a tool that never existed for more than an hour.

None of this means self-validation is worthless. It means it needs a shape. The rest of this section is that shape, and none of it takes more than an hour to set up.

### Before you start: write down the bar

Do this in a file — `docs/marketing/hypothesis.md` or a notebook, it doesn't matter — **before** you begin the first track. Pre-committing is what makes the answer meaningful.

Record three things:

1. **Your baseline, honestly.** How many tracks did you actually finish in the last 12 months? How many unfinished loops are in the folder? Name your three biggest weaknesses as a producer — the real ones, the ones you avoid.
2. **What "it helped me improve" would look like** in concrete, checkable terms. My suggested bar is in the next subsection; write your own if you prefer, but write it *now*.
3. **What would make you abandon the hypothesis.** If you can't name this, you don't have a test — you have a plan to accumulate encouraging anecdotes.

### The two checkpoints

Splitting Stage 0 gives you an earlier, cheaper failure signal instead of one enormous bet at the end.

**Checkpoint 0a — "Can I finish anything in this at all?" (needs Alpha Milestone 2: arrangement and export.)**

No assistant involved. Take a loop and get it to an exported stereo file. This tests the product's core promise independently of the AI, and it is the cheaper half to fix. If you cannot finish a track in your own DAW-in-a-browser with no assistant, adding an assistant will not save it.

- **Bar:** one finished, exported track that you'd be willing to play to someone.
- **If it fails:** the arrangement and export workflow is the problem. Fix that before Alpha Milestone 3. Learning this at 0a instead of 0b saves you months.

**Checkpoint 0b — "Did it make me better?" (needs Alpha Milestone 3: the assistant.)**

This is the real hypothesis. Bar below.

### The bar for 0b: three tracks and one transferred technique

> **Three tracks**, each started from a short loop and finished to an exported file in Solid Groove. **And** for at least two of them, you can name a specific technique the assistant taught you that **you then applied yourself, unprompted, on a later track.**

The second clause is the whole test. Anything can help you produce a track — that only proves the tool is useful. **A technique you later reached for on your own is the only evidence that you got better,** which is what the hypothesis actually claims. Without that clause you are measuring convenience and calling it learning.

**Time-box it:** if after roughly ten weeks of genuine use you haven't finished three tracks, stop and treat that as the finding. "It didn't get me to finished" is a complete and important answer, and it is the same failure your target user will have.

### Keep a stuck log

One line, every time you get stuck. Nothing elaborate — a text file:

```
2026-08-14 | stuck: intro felt flat, no idea what to remove | asked assistant? yes | helped? partly — suggested filtering the pad, didn't address the arrangement | fixed it myself in ~20 min
```

This is the single highest-value artefact of Stage 0, for three reasons:

- It is your **assistant capability backlog**, written from real need instead of guesswork.
- It is what you will show your producer friend in Stage 3 — far more persuasive than a demo.
- It protects you from mechanism 2 above. At the end you read the log rather than consulting your feelings.

**Rule: log the friction, don't fix it immediately.** Keep a separate "fix later" list and batch it between tracks. Fixing mid-track means you never find out what using the tool is actually like.

### Two cheap guards against your own bias

**Keep a counterfactual visible.** Finish one track in your usual DAW during the same period. You cannot judge "better" without a comparison, and you may well find Solid Groove is better at some phases and worse at others — that's a more useful result than a verdict either way, and it tells you what to build next.

**Get blind ears on the output.** Post the finished tracks to a feedback thread in one of the communities in §5 — **as a producer, not as a founder.** Say nothing about how they were made or that you built the tool. You are testing whether the output stands up to strangers who have no reason to be kind. This is the one community activity worth doing in Stage 0, and note that it is not marketing: you are spending no credibility and making no claim. It also gets you familiar with the etiquette of those spaces long before you need anything from them.

### Write the verdict down

When you hit the bar or the time-box, write a short honest verdict in the same file: confirmed, partly confirmed, or not confirmed — and what the stuck log says about why. Three outcomes:

- **Confirmed.** Go to Stage 1, and take the stuck log with you.
- **Partly confirmed** (you finished tracks, but nothing transferred). Then the *DAW* works and the *assistant* doesn't teach. That is a narrow, fixable, extremely valuable finding — it points straight at how the assistant explains itself, which PRD principle 2 already cares about. Fix, then retest.
- **Not confirmed.** Do not proceed to an alpha to get a second opinion. If it doesn't work for the person who wanted it enough to build it, 15 strangers will be worse. Change the product or change the hypothesis.

### Stage 0 also replaces the teacher interview

Deferring your producer friend costs you one thing: the six questions you would have asked him about where students get stuck would have shaped the assistant's capability list. **Your stuck log is a decent substitute** — it is one producer's genuine friction, recorded in real time, which is more than most products have. Answer his six questions yourself from the log (they're in §8), note where you are guessing, and take those gaps to him in Stage 3 as your sharpest questions rather than your only ones.

### What marketing to do during Stage 0

Almost nothing, deliberately. The complete list:

- [ ] **Reserve the domain and the handles.** ~30 minutes, ~£80. Same handle on TikTok, YouTube, Instagram and Reddit. Handle-squatting is real and this is pure option value — you are not going to *use* the accounts yet.
- [ ] **Keep an unpublished clip archive.** When something looks or sounds good while you're building, screen-record it (with audio) and drop it in a folder. Costs seconds, and at Stage 2 you'll start with 30 clips instead of zero. Do **not** post them yet.
- [ ] Nothing else. No waitlist, no landing page copy, no accounts to maintain, no content schedule, no outreach.

That's it. Stage 0's marketing deliverable is a verdict and a stuck log.

---

## 3. Define "user" before you ever count one

Needed from Stage 1 onward. A bad definition will make you feel successful while the product fails:

> **An activated user is a person with an account who created their own project and pressed play on it.**

In the PRD's `OPS-02` event catalogue that is `account_upgraded` **and** `project_created` **and** `transport_play` — all of which Alpha Milestone 1 already ships, so this needs no new instrumentation.

Track these four numbers and nothing else:

| # | Metric | From | How to read it |
| --- | --- | --- | --- |
| 1 | **Invited → activated %** | Stage 1 | Is the *product* working? (Target: 40%+. Below 20%: stop and fix onboarding.) |
| 2 | **Activated → returned in 7 days %** | Stage 1 | Does anyone actually want this? (Target: 25%+.) |
| 3 | **Landing page → signup %** | Stage 2 | Is your *message* working? (Target: 20%+. Below 10%: the copy is wrong, not the traffic.) |
| 4 | **Weekly activated users** | Stage 2 | The only growth number that matters. |

Metrics 1 and 2 come first on purpose. They decide whether you should be marketing at all — if invited people don't activate and don't come back, traffic is money set on fire. One row per week in a spreadsheet, ten minutes a month, and that is the entire analytics programme.

---

## 4. Positioning: sell the finishing problem, not the AI

Needed from Stage 1 (you'll describe the product in DMs long before you write a landing page).

### The one sentence

The PRD already contains the best line you will write:

> **Bring a loop. Leave with a track.**

Concrete, names the transformation, and it is exactly what your audience fails at.

### Lead with the pain, not the technology

Your audience has a folder with 200 unfinished eight-bar loops in it, and they feel bad about that folder. Every one of them knows a loop that sounds great for 30 seconds and then has nowhere to go. **That** is what your marketing should touch. "AI assistant" is a feature; "200 loops and no songs" is a wound.

Message hierarchy, in order:

1. You start loops and never finish them. (Pain — they nod.)
2. Solid Groove turns a loop into a finished, exportable track, in the browser. (Promise.)
3. A producer sits beside you, suggests the next move, and shows you what it changed — so you learn instead of just receiving. (Differentiator, and *this* is where the AI belongs.)
4. Everything stays editable, and you can undo anything it does. (Objection handling.)

### Critical warning: "AI music" is a slur in these communities

The producer communities are, at the time of writing, openly hostile to generative AI music. Posting "AI makes your track for you" into r/edmproduction gets you buried, and that reputational damage is not recoverable from the same account.

Your product is genuinely not that — the PRD is explicit that the assistant proposes and the user decides, and that everything stays editable. **Say so in the same breath, every time.** Never let "AI" appear without the qualifier.

- ✅ "It suggests, you decide." / "Shows you what it changed." / "Undo anything." / "You keep authorship." / "Like a producer looking over your shoulder."
- ❌ "Generates songs." / "Music in one click." / "No skills needed." / "Prompt-to-track." / "Let AI do the work."

If you take one thing from this document, take this. The distinction is real, it is your best story, and stating it plainly is what makes a skeptical producer curious instead of hostile.

### One more reason it matters now

If Stage 0 works, you will have made three tracks with it. **Say that.** "I built this and used it to finish three tracks, here they are" is the most credible opening available to you, and it is unavailable to every well-funded competitor shipping a prompt-to-song box. Your Stage 0 output is also your best marketing asset — which is another reason to do Stage 0 properly.

---

## 5. Stage 1: the 10–20 person alpha

**Enter only when Stage 0's verdict is "confirmed."** This is user research, not marketing: you are not trying to grow, you are trying to find out whether the thing that worked for you works for anyone else. It also satisfies `DEC-006 - Alpha test cohort` in the backlog, so it is not extra work.

### Who you want

10–20 people matching the PRD's primary user: they can make a loop, they don't finish tracks, they use synths and samples rather than recording bands. Actively deprioritise: complete beginners, professionals, and anyone who mainly records live instruments. They will give you real feedback about a product you are not building.

`DEC-006` exists so validation isn't biased, so deliberately spread across: different DAWs of origin (Ableton, FL, Logic, mobile apps), a couple of different genres, a range of browsers and machines including at least one modest laptop, and at least a few people you have never met.

### Where they come from

Without the teacher, these come from communities. Pick **two** and stick to them.

**Reddit** (~450k members on r/edmproduction alone):
- r/edmproduction — beginner-heavy, strong feedback culture. Best single fit.
- r/WeAreTheMusicMakers — the largest general music-making community.
- r/musicproduction — beginner friendly.
- r/makinghiphop, r/FL_Studio, r/ableton, r/synthesizers — secondary.

**Discord:**
- The r/WeAreTheMusicMakers server, and the r/MusicProduction server (which has a feedback bot tracking reciprocity — participate properly).
- "Bedroom Producers" servers on Disboard/top.gg. These skew young (13–22); check each server's stated age range and rules before deciding it's your audience.

Before your first post anywhere: **read the sidebar and find the self-promotion policy.** Most of these subs ban promotion outright and route it into a weekly thread. Breaking that rule gets you permanently banned from the best place to find your users. Five minutes, protects everything.

If you did the blind-ears exercise in §2, you already have a normal posting history in one of these places — which is exactly the account you want to be recruiting from.

### The 20:1 rule

Twenty genuinely helpful contributions with no link, for every one mention of your product. Slow-sounding, but it is the fast route, because the alternative is a ban.

Your leverage: you have just built a DAW and finished three tracks in it. You know more than almost anyone in the thread about why arrangement is hard and why a mix goes muddy. Answer properly and people will click your profile unprompted. **Put the link in your profile, not in your comments.**

**Reply template:**

> [Direct answer to their actual question, 3–6 sentences, specific and genuinely useful. Name the concept. Give one concrete thing to try tonight.]
>
> [Optional, only if it truly fits:] This is basically the problem I'm obsessed with — I've been building a browser tool for exactly this stage. Happy to go deeper if useful.

No link, no pitch. If the answer is good, the curious will find you.

### The alpha invite DM

Send to people whose questions you answered and who fit — never cold, never bulk.

> Hey — you commented on [specific thing] a while back and your situation is exactly who I've been building for.
>
> I've made a browser-based production tool for people who get stuck turning loops into finished tracks. I've used it to finish three tracks myself — [link, if you're happy to share them] — and now I want to know whether it works for anyone who isn't me.
>
> I'm looking for about 15 people to use it properly and tell me where it falls apart. No cost, no catch, no spam. I'd want maybe 30 minutes of your honest reaction. In exchange: permanent free access to whatever this becomes, and your name in the credits if you want it.
>
> Interested? Happy to send a link.

Roughly 1 in 3 say yes to outreach this targeted, so ~45 DMs fills 15 seats. At 15 DMs a week, three weeks.

### What to ask them

Do not ask "what do you think?" — you'll get politeness. Ask:

1. Where did you get stuck? (Then shut up and watch, if you can get a screen-share.)
2. What did you expect to happen that didn't?
3. Did the assistant tell you anything you didn't already know? Did you use it again afterwards? *(This is the §2 transfer test, applied to someone who isn't you — the single most important question in the alpha.)*
4. Would you come back to finish this track tomorrow? *(Then check whether they actually did. Metric 2 is more honest than the answer.)*
5. What would make you stop using it?

Record what tools, experience, genres, browsers and hardware each person has — `DEC-006` requires it, and it's how you'll spot whether a problem is universal or one person's setup.

---

## 6. Stage 2: the weekly routine (marketing starts here)

**Enter only when the alpha retains people** (§11). You dislike marketing and want minimum work, so the answer is not a clever tactic — it is a **fixed, small, repeatable block** that you never skip and never expand. Put it in the calendar as a recurring event on the day Stage 2 opens, and not before.

### Every Monday, 90 minutes. Same order, every week.

| Min | Task |
| --- | --- |
| 0–20 | **Record one clip.** Screen-record something you built or fixed that week, with sound. Phone-quality is fine. No script. Hooks in §7. |
| 20–35 | **Post it** to TikTok, YouTube Shorts and Instagram Reels. Same file, same caption, three uploads. |
| 35–65 | **Be useful in your two communities.** Two genuine answers, no link. |
| 65–80 | **Reply to every comment and DM** from the week. |
| 80–90 | **Update the four numbers.** Stop. |

That is it. Nothing else is mandatory. Optional and genuinely worth it: 15 minutes a day replying to comments, because early replies are what make short-form video spread. Skip it and the plan still works.

**Rules that keep this sustainable:**

- Never batch-plan content. Record whatever you did that week. The work *is* the content.
- Never miss two Mondays in a row. One is fine.
- Do not add channels. The urge to add a fourth channel is procrastination wearing a suit.
- From Stage 3, give the first Monday of each month to an educator conversation (§8) instead of a video.

---

## 7. Stage 2: short-form video of the thing working

**Why this channel:** your product is audiovisual. A screen recording of a loop becoming a track, with the audio, is inherently interesting in a way a blog post about a browser DAW never will be. Producers live on TikTok, Shorts and Reels. The marginal cost is zero because you're building anyway. And it compounds — one video that lands brings signups while you sleep, which is the only kind of marketing that respects your time.

You also start with an unfair advantage: the clip archive from §2, plus three finished tracks that prove the tool works.

### The format

15–40 seconds. Vertical. **Audio is the product** — never post silent.

1. **Hook in the first 2 seconds.** Not a logo, not "hey guys."
2. **The thing happening**, with sound.
3. **One line of payoff**, spoken or on-screen.
4. **Soft CTA**, on-screen text only: `solidgroove.app`.

No intro, no outro, no music bed over your own product's audio.

### Ten hooks, best first

By Stage 2 the product does all of this, so everything here is fair game. Never use a hook for something you can't show.

1. "I made this track in a DAW I wrote myself. Here's the bit I couldn't have done a year ago."
2. "8 bars in. Full track out. No plugins, no install."
3. "I asked it what to do next. Here's what it changed — and here's me undoing half of it."
4. "I have 200 unfinished loops. So I built the thing that finishes them."
5. "It explained why my bassline was muddy. It was right."
6. "Not AI making music. AI showing you *how*."
7. "Why do all your loops sound the same after 16 bars?" (teach something real, mention the tool once at the end)
8. "Every change it makes, you can see, edit and undo."
9. "From loop to Ableton project in one click."
10. "Making a DAW that runs in a browser tab. Day 400."

Hook 1 is first for a reason: it is the one no competitor can copy, and it is only available because you did Stage 0.

### The honest expectation

Most videos will get 200 views. That is normal, not failure. You're buying lottery tickets with positive expected value: post 40 clips over ten months and two or three will do 50k–500k views, and those are where most of your 100 users come from. **The only way to lose is to stop because the first ten did nothing.**

---

## 8. Stage 3: your producer friend, and educators as a channel

**Enter with evidence in hand** — three tracks you finished, a stuck log, and 15+ alpha users' worth of data. You were right to move this later: you get one first impression with him, and "here is what happened when 15 people used it" is a categorically different conversation from "I have an idea."

### Why this is still the best channel, when you get to it

- **He is a concentrator of your exact target user** — people actively learning production and getting stuck. That is the PRD's primary user, sitting in a room, pre-qualified.
- **The trust is already built.** A tool a student's teacher suggests arrives with credibility you cannot buy or advertise for.
- **Your positioning is his value proposition.** "Learn by producing," "understand how it was made," "concepts that transfer to a real DAW" are pedagogical claims, and he is the best-placed person you know to judge them.
- **It is repeatable, not one-shot.** A video is a lottery ticket; a teacher is a pipeline, with a new cohort every term.
- **The maths is favourable.** One teacher is perhaps 10–30 students a year. Five to eight teachers is a few hundred users, from a handful of conversations rather than a hundred videos.
- **Teachers know teachers.** That's what turns a favour into a channel.

### The one rule: never put students in front of a product that isn't ready

His professional reputation is the collateral, and he only gets to spend it once. This is the same instinct that made you defer him — keep it.

### The ladder: four asks, in order. Never skip a rung.

**Ask 1 — 45 minutes of his expertise, plus your evidence.** Lead with the questions, not the pitch. Show him the tracks and the stuck log if it comes up naturally.

**Ask 2 — him as a user.** Would you show this to a class, and if not, what's missing? A "no" here is worth more than a yes elsewhere.

**Ask 3 — only if Ask 2 went well. He offers it to students.** *He* offers, you don't. He picks who and how; you give him something easy to forward.

**Ask 4 — introductions.** "Do you know two or three other people who teach this?" Only after his own students have had a good experience.

### The six questions for Ask 1

Answer these yourself from your stuck log first (§2), then ask him — the gaps between his answers and yours are the valuable part.

1. Where in your course do students reliably stall? *(Prediction: arrangement. If he confirms it unprompted, your product thesis just got independent validation.)*
2. What do they ask you most often, over and over?
3. What do you wish you could *show* them but can't easily?
4. Which DAW do you teach, and what do they turn up with?
5. What would make you comfortable recommending a tool to your own students? What would make you refuse?
6. How many students, and how often does a new group start? *(The sizing question: is this a 10-user channel or a 100-user one?)*

### What's in it for him

Make it a trade, not a favour — that's what makes it repeat.

- Free permanent access, for him and his students.
- Advisor credit, if he wants it.
- **Co-designing the starter templates.** `DEC-002 - Featured alpha templates` is still an open decision. Let him shape them around his curriculum: he gets syllabus-matched teaching material, you get educator-designed entry points. Costs you nothing you weren't already doing, and it's the most valuable thing you can offer.
- A tool that **shows a student exactly what changed and why** — hard to demonstrate live in Ableton, and precisely what a teacher wants.
- Paid advisory hours (§9).

### Two things to get right

**Pay him for advice, not for signups.** Paying a teacher to route his own paying students to your product, without those students knowing, is a real conflict of interest and will cost more than it earns. Pay a fair rate for advisory time — genuine work — and leave any student recommendation unpaid and entirely his call. If you ever do set up a referral arrangement, students should know it exists.

**Don't ask him for student emails.** He probably can't share contact details without consent, and it puts him in an awkward spot. Ask him to forward your offer — which converts better anyway, coming from him.

### The message, when the time comes

> Hey — you know I've been building that music production tool. It's at the point where I've finished three tracks with it myself and had about fifteen people put it through its paces.
>
> You teach exactly the people it's for, so you'll see things I can't. Can I get 45 minutes and a pint's worth of your honest opinion? Happy to pay you properly for your time if it turns into more than that.

### If it works, scale it

Where the next six teachers come from, easiest first:

1. **His introductions.** A warm intro converts several times better than anything below.
2. Local colleges and adult-education courses with music-tech modules.
3. Tutors at production schools (Point Blank, dBs, SAE and similar) — many teach privately too.
4. YouTube tutorial channels where the person also sells 1:1 lessons — creators *and* educators, so they overlap with the §9 creator budget.
5. Community music projects and youth music charities, often actively looking for free, install-free tools that run on locked-down school laptops. Browser-based is a real advantage here.

Reuse the ladder for each. Once three teachers say yes, you can largely stop doing everything else in this plan.

---

## 9. The £1,000

### Where it goes, and when

| Line | Amount | Stage | Notes |
| --- | --- | --- | --- |
| Domain (2 years) + handles | £80 | **0** | The only Stage 0 spend. Pure option value. |
| Alpha cohort thank-you | £60 | 1 | A curated sample pack, or £4 coffee vouchers × 15. Small gestures buy remarkable loyalty from early testers. |
| Email tool | £60 | 2 | Free tier to start (MailerLite, Buttondown); this is the paid tier past ~1,000 contacts. |
| Video editing help | £160 | 2 | ~8 clips at £20 via Fiverr/Upwork. Buys back your time; captions and pacing measurably improve reach. |
| **Creator seeding** | **£250** | **2–3** | **2–3 creators × ~£100 for an honest first look.** |
| **Educator advisory** | **£200** | **3** | **~3–4 hours of your friend's time at a fair rate, plus a class handout and a 2-minute demo he can play to a room.** |
| **Held back** | **£190** | 2–3 | Untouched until something is proven to work. |

**£920 of this is unspent until Stage 2.** If Stage 0 says the hypothesis is wrong, you have spent £80 finding that out, which is the plan working correctly.

### Why the money goes to people and (almost) none to ads

Reddit's self-serve ads take a £5/day minimum and typical CPCs land around £1.00–£1.50, but meaningful data needs roughly £40–80/day for two to three weeks. Your whole budget is one week of a real test. **You cannot afford to learn anything from Reddit ads, so don't try.**

Every other line buys a human with an existing audience and existing trust. A small producer-YouTuber with 5,000 engaged subscribers will make an honest first-look video for £75–150: a real audience, a trusted voice, and a permanent asset. £200 of a teacher's time buys curriculum input, the `DEC-002` templates, and a relationship that keeps producing the right users every term. For a pre-launch tool with a visual product, both beat paid ads by a wide margin.

### The rule for the held-back £190

**Don't spend it to discover a message. Only spend it to amplify a proven one.**

If an organic or creator video converts well, take that exact hook and put £190 behind it as a 14-day Reddit or Meta test at ~£13/day. If nothing has converted yet, it stays in your pocket — this is not a budget you must exhaust. And if the educator track is working, a second teacher's advisory time beats any ad.

### Creator outreach email

Send 20 to get 2–3. Small channels (2k–20k subs) reply; large ones won't.

> **Subject:** Early access to a browser DAW — paid first-look?
>
> Hi [name],
>
> Your video on [specific, real video] was the clearest explanation of [specific thing] I've seen, which is why I'm writing to you and not someone with a bigger channel.
>
> I've built Solid Groove — a browser-based production tool for producers who write loops but struggle to finish tracks. It has an assistant that suggests what to do next and shows you exactly what it changed, so you can edit or undo all of it. It's deliberately not a song generator. I've finished three tracks with it myself.
>
> I'd like to pay you £100 for an honest first look, positive or negative. If you hate it, say so on camera — I'd rather have the feedback than a nice review. Early access, I'll answer anything, and I won't ask for approval over the edit.
>
> Interested? I can send you a login this week.
>
> [name] — solidgroove.app

Don't ask for editorial control or a positive review. A creator who trusts you is worth more than a script you wrote, and their audience can smell a paid ad a mile off.

---

## 10. The landing page

Ships as `LOOP-001b`. Not needed until Stage 2 — during Stage 1 you're sending DMs, and a hand-written DM outperforms any page.

**Above the fold:**

- **Headline:** Bring a loop. Leave with a track.
- **Sub:** A browser music studio with a producer beside you. It suggests what to do next, shows you what it changed, and lets you undo all of it.
- **Primary CTA:** `Start making something` → straight into the anonymous editor, no signup. (The PRD's "fast path to sound" is also your best conversion tactic: a visitor who hears sound before signing up is a far warmer lead.)
- **Autoplaying, muted, looping:** the editor itself. Show the product, not an illustration.

**Three bullets:**

1. **Finish, don't just loop.** Turn eight bars into a full arrangement, and export it.
2. **Learn while you make.** Every suggestion explains itself and shows what changed.
3. **Nothing to install.** Open a tab and hear sound in ten seconds.

**An honesty block near the bottom** — this will do more for you than any other paragraph, because your audience arrives suspicious:

> **What this isn't.** It won't write your track for you. There's no "make me a song" button. It suggests, you decide, and you can undo anything it does. Everything it makes is normal editable notes, clips and devices — the same things you'd make by hand.

**And, if you're willing:** a link to the tracks you made with it. Nothing on the page will convert better than proof the tool made real music.

---

## 11. Gates and kill criteria

Being willing to stop is what makes this plan cheap. Check each gate before entering the next stage.

**Gate 0a** (before building the assistant on top of it):
- ✅ One track finished and exported, that you'd play to someone. → Continue to Alpha Milestone 3.
- ❌ You can't get a loop to a finished file. → The arrangement/export workflow is the problem. Fix it now; an assistant won't rescue it.

**Gate 0b → Stage 1** (the big one):
- ✅ Three tracks finished, and you can name at least two techniques the assistant taught you that you later used unprompted. → Recruit the alpha.
- ⚠️ Tracks finished, nothing transferred. → The DAW works, the assistant doesn't teach. Narrow and fixable — go at how it explains itself, then retest. Don't recruit yet.
- ❌ Ten weeks of genuine use, three tracks not finished. → **Do not open an alpha to get a second opinion.** If it doesn't work for the person motivated enough to build it, 15 strangers will be worse. Change the product or the hypothesis.

**Gate 1 → Stage 2** (before spending the bulk of the money):
- ✅ 8+ of 15 activated, 4+ returned unprompted in week two, and 2+ report the transfer effect. → Start marketing.
- ❌ Fewer than 4 of 15 activated. → **Don't start marketing.** Fix onboarding. Marketing a product that early users abandon is the most expensive thing you could do with this budget, and every pound makes it worse.

**Gate 2:**
- ✅ 100 activated users. Done — now you have the data for a real growth plan instead of a first-100 plan.
- ❌ Stalled at 40–60. Almost always retention masquerading as acquisition. Check metric 2 before buying more traffic.

**Gate 3** (is the educator route a channel?):
- ✅ 5+ of 8 offered students activated. → Educators are your channel. Go find six more teachers.
- ❌ 1–2 of 8. → It's the product, not the channel. Warm-intro traffic from a trusted teacher is the friendliest you'll ever get; if that doesn't convert, nothing colder will.

**One-shot launches, scheduled once, at Stage 2:** a Product Hunt launch and one r/edmproduction post in whatever thread the rules permit. Both free, both one-shot, both worth doing only once the assistant genuinely works. A launch moment spent early is gone.

---

## 12. Handing this off

Stages 0 and 1 are not delegable — they are you finding out whether your product works. From Stage 2, §6 and §7 can be run by someone else.

**Hire for:** short-form video editing and scheduling, community monitoring and first-draft replies, creator outreach and admin, the weekly spreadsheet.

**Do not hire for:** answering technical production questions, or anything speaking as you in a community thread. A freelancer faking expertise in r/edmproduction is spotted within a day.

**Never delegate:** the Stage 0 verdict, the alpha conversations, or the educator relationships. Those depend on you being the builder, and they are where the value is.

**What to pay:** £15–25/hour on Upwork or Fiverr for a video editor / community assistant, 4–6 hours a week — roughly £400–600/month, beyond this £1,000 budget. Treat it as the thing you do *after* Gate 1 confirms the product retains people.

**What to give them:** this document, the four-number spreadsheet, the social logins, and the hook list in §7. Review once a week for 20 minutes.

---

## 13. What not to do

Every item is something you can safely ignore. That's the point.

- **Any marketing at all during Stage 0.** No waitlist, no landing page, no content schedule, no outreach. An email collected nine months before launch is worth almost nothing, and the effort is better spent finishing tracks.
- **Fixing bugs mid-track during Stage 0.** Log them, batch them between tracks. Otherwise you never learn what using the tool is actually like.
- **Opening an alpha to get a second opinion on a failed Stage 0.** The most tempting mistake in this document.
- **A blog / SEO.** 9–18 months to pay off.
- **Twitter/X growth.** Producers aren't there in numbers; the effort-to-user ratio is terrible.
- **Paid search ads.** Nobody searches for a category that doesn't exist yet.
- **A Discord server of your own.** Not until 100 users. An empty server is worse than none.
- **Press and music-tech blogs.** They cover launches, not prototypes.
- **A newsletter.** One email when you invite people, one when you launch. That's the whole email programme.
- **Instagram grid posts, Pinterest, LinkedIn, Threads.** No.
- **Product Hunt before the assistant works.** You get one launch.
- **Asking your producer friend for student emails.** Ask him to forward your offer instead.
- **Paying anyone per student signup.** Advisory time yes, commission on his own students no (§8).
- **Any second channel before the first one works.** The most common and most expensive mistake here.

---

## 14. If you do only three things

1. **Write the bar down before you start Stage 0, including what would make you abandon the hypothesis.** You are the most generous judge this tool will ever have, and a pre-committed bar is the only cheap defence against that. Everything else in this plan is conditional on getting this one honest.
2. **Keep the stuck log.** One line each time you get stuck. It is your assistant backlog, your evidence for the alpha, your substitute for the teacher interview, and your protection against your own optimism — for about ten seconds a day.
3. **Never say "AI" without immediately saying "you decide, and you can undo it."** This is your whole story, and it is the difference between curiosity and contempt — with producers and educators alike.

---

## Sources

- [Best subreddits for music production (2026)](https://www.mediafa.st/best-subreddits-for/music-production)
- [r/edmproduction community profile — The Hive Index](https://thehiveindex.com/communities/r-edmproduction/)
- [Best Discord servers for musicians and producers](https://indiemusicianresources.com/best-discord-servers-musicians-producers/)
- [Bedroom Producers Discord — Disboard](https://disboard.org/server/830853153028964382)
- [Music-making platform BandLab surpasses 100 million users — Music Business Worldwide](https://www.musicbusinessworldwide.com/music-making-app-bandlab-surpasses-100-million-users/)
- [BandLab hits 100 million users — Billboard](https://www.billboard.com/business/tech/bandlab-100-million-users-report-1235637853/)
- [Reddit ads minimum budget requirements 2026 — Stackmatix](https://www.stackmatix.com/blog/reddit-ads-minimum-budget-requirements-2026)
- [Reddit ads cost: CPC, CPM and CPA benchmarks 2026 — Benly](https://benly.ai/learn/reddit-ads/reddit-ads-cost-benchmarks)
