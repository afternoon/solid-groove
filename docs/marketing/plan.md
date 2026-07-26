# Solid Groove — Plan to the First 100 Users

| Field | Value |
| --- | --- |
| Status | Draft for execution |
| Owner | Product owner (executable solo, or handed to a freelancer — see §12) |
| Budget | £1,000 total |
| Time cost | One 90-minute block per week, plus optional 15 min/day of replies |
| Goal | 100 activated users (defined in §2) |
| Horizon | Roughly 6 months, gated on product phases, not on the calendar |

This plan is written to be followed literally. Where it says "do X on Monday," do X on Monday. If you only ever read one section, read §4 (the teacher) — it is the highest-leverage thing available to you and it is also the least work.

---

## 1. Read this first: the plan is gated on the product, not on marketing effort

Solid Groove is currently in **Phase 0** of four ([`docs/backlog.md`](../backlog.md)). Two facts drive everything below:

1. **There is no public front door yet.** The landing page is `LOOP-001b`, in Phase 1. Until it ships, there is nowhere to send anyone.
2. **The AI producer — the actual differentiator — arrives in Phase 3.** Until then, marketing the product as "an AI music assistant" would be selling something that does not exist. That is both dishonest and strategically wasteful: you would burn your one launch moment on a promise you cannot yet keep.

So this is **not** a plan to get 100 users this month. It is a plan to spend very little effort now building an audience that is ready, and then convert it when the product can actually deliver the promise. Trying to acquire 100 users before Phase 3 would mean 100 people bouncing off an unfinished tool and never coming back — the most expensive mistake available to you.

**The sequence:**

| Stage | Product gate | Marketing goal | Effort |
| --- | --- | --- | --- |
| **A. Audience** | Now → Phase 1 landing page | 300 waitlist emails; the teacher relationship started (§4) | 90 min/week |
| **B. Cohort** | Phase 2 (export works) | 15 alpha testers — ~8 via the teacher, ~7 via communities | 3 h/week for 3 weeks |
| **C. Scale** | Phase 3 (AI producer works) | 100 activated users, most of them via educators | 90 min/week + the money |

Stage B also satisfies `DEC-006 - Alpha test cohort` in the backlog, which already requires recruiting 8–20 target users. That is not extra work; it is the same work, done once.

---

## 2. Define "user" before you start counting

"100 users" is meaningless without a definition, and a bad definition will make you feel successful while the product fails. Use this one:

> **An activated user is a person with an account who created their own project and pressed play on it.**

In the analytics events already planned in the PRD's `OPS-02` catalogue, that is: `account_upgraded` **and** `project_created` **and** `transport_play`. You do not need any new instrumentation to count this — Phase 1 already ships those events.

Track these four numbers and nothing else:

| # | Metric | How to read it |
| --- | --- | --- |
| 1 | **Waitlist emails** | Is anyone interested at all? |
| 2 | **Landing page → waitlist conversion %** | Is your *message* working? (Target: 20%+. Below 10% means the copy is wrong, not the traffic.) |
| 3 | **Invited → activated %** | Is the *product* working? (Target: 40%+. Below 20% means stop marketing and go fix onboarding.) |
| 4 | **Activated → returned in 7 days %** | Does anyone actually want this? (Target: 25%+.) |

Metric 3 is the one that decides whether you should be marketing at all. If invited people are not activating, more traffic is money set on fire. Fix the product first — that is a legitimate and correct outcome of this plan.

Put these four numbers in a spreadsheet, one row per week. Ten minutes a month. That is the entire analytics programme.

---

## 3. Positioning: sell the finishing problem, not the AI

### The one sentence

The PRD already contains the best line you will write:

> **Bring a loop. Leave with a track.**

Use it as the landing page headline. It is concrete, it names the transformation, and it is the exact thing your audience fails at.

### Lead with the pain, not the technology

Your audience has a folder with 200 unfinished eight-bar loops in it. They feel bad about that folder. Every one of them knows the feeling of a loop that sounds great for 30 seconds and then has nowhere to go. **That** is the emotion your marketing should touch. "AI assistant" is a feature; "you have 200 loops and no songs" is a wound.

Message hierarchy, in order:

1. You start loops and never finish them. (Pain — they nod.)
2. Solid Groove turns a loop into a finished, exportable track, in the browser. (Promise.)
3. A producer sits beside you, suggests the next move, and shows you what it changed — so you learn instead of just receiving. (Differentiator, and *this* is where the AI belongs.)
4. Everything stays editable, and you can undo anything it does. (Objection handling.)

### Critical warning: "AI music" is a slur in these communities

The producer communities you are about to enter are, at the time of writing, openly hostile to generative AI music. Posting "AI makes your track for you" into r/edmproduction will get you downvoted into oblivion, and that reputational damage is not recoverable from the same account.

Your product is genuinely not that — the PRD is explicit that the assistant proposes and the user decides, and that everything stays editable. **Your marketing must say so in the same breath, every single time.** Never let "AI" appear without the qualifier attached.

Use these words:

- ✅ "It suggests, you decide." / "Shows you what it changed." / "Undo anything." / "You keep authorship." / "Like a producer looking over your shoulder."
- ❌ "Generates songs." / "Music in one click." / "No skills needed." / "Prompt-to-track." / "Let AI do the work."

If you get one thing from this whole document, get this. The distinction is real, it is your best story, and stating it clearly is what will make skeptical producers curious instead of angry.

---

## 4. Your unfair advantage: the teacher

You know someone who teaches music production. **This is worth more than the £1,000 and more than every other channel in this document.** Treat it as the primary route to the first 100 users and everything else as support.

### Why it matters this much

- **He is a concentrator of your exact target user.** Not "people who like music" — people who are actively learning production and are stuck. That is the PRD's primary user, sitting in a room, pre-qualified.
- **The trust is already built.** A tool a student's teacher suggests arrives with credibility you cannot buy, advertise for, or earn from a TikTok.
- **Your positioning is his value proposition.** "Learn by producing," "understand how it was made," "concepts that transfer to a real DAW" — those are pedagogical claims. He is the single best-placed person alive to tell you whether they are true, before you spend a year betting on them.
- **It is repeatable, not one-shot.** A video is a lottery ticket. A teacher is a *pipeline* — every new term is a new cohort of the right people.
- **The maths is favourable.** One teacher is perhaps 10–30 students a year. Five to eight teachers is your first 100 users. Eight conversations is dramatically less work than 40 videos, which is the whole point given how you want to spend your time.
- **Teachers know teachers.** This is the part that turns a favour into a channel.

### The one rule: never put students in front of a broken product

His professional reputation is the collateral for this, and he only gets to spend it once. If you send his students to a Phase 1 build with no arrangement tools and no assistant, you don't just lose the students — you lose him, his network, and the best channel you have.

**So the student-facing ask waits for Phase 2 at the earliest.** This is not caution for its own sake; it is protecting the highest-value asset in the plan.

### The ladder: four asks, in order, months apart. Never skip a rung.

**Ask 1 — this week. 45 minutes of his expertise.** Not about your product. You are asking him what his students get stuck on. He will almost certainly say yes, because it is flattering, free, and about his favourite subject. This is also real product research that will improve the assistant.

**Ask 2 — Phase 2. Him as a user.** Give him access. Ask for his honest reaction as a teacher: would you show this to a class, and if not, what's missing? A "no" here is enormously valuable and much cheaper than finding out later.

**Ask 3 — Phase 2/3, and only if Ask 2 went well. He offers it to students.** Crucially: *he* offers, you do not. He chooses who, and how. You give him something easy to forward.

**Ask 4 — Phase 3. Introductions.** "Do you know two or three other people who teach this?" Only ask once his own students have actually had a good experience — otherwise you are spending his credibility on a bet you haven't won yet.

### What to ask in conversation 1

Six questions. Record it if he's comfortable, or write notes straight afterwards.

1. Where in your course do students reliably stall? *(Prediction: arrangement. If he confirms it, your entire product thesis just got independent validation.)*
2. What do they ask you most often, over and over?
3. What do you wish you could *show* them but can't easily?
4. What are they using — which DAW do you teach, and what do they turn up with?
5. What would make you comfortable recommending a tool to your own students? What would make you refuse?
6. How many students do you have, and how often does a new group start? *(This is the sizing question — it tells you whether educators are a 10-user channel or a 100-user channel.)*

### What's in it for him

Do not ask for a favour. Make it a trade — that's what makes it repeat.

- Free permanent access, for him and for his students.
- Advisor credit, if he wants it.
- **Co-designing the starter templates.** `DEC-002 - Featured alpha templates` is an open decision in the backlog. Let him shape those around his curriculum and you get educator-designed, lesson-shaped entry points while he gets teaching material built to his syllabus. This is the most valuable thing you can offer him and it costs you nothing you weren't already doing.
- A tool that **shows a student exactly what changed and why** — genuinely hard to demonstrate live in Ableton, and precisely what a teacher wants.
- Paid advisory hours (see §8).

### Two things to get right

**Pay him for advice, not for signups.** Paying a teacher to route his own paying students toward your product — without those students knowing — is a real conflict of interest, and it will eventually cost you more than it earns. Keep it clean: pay him a fair rate for advisory time, which is genuine work, and let any student recommendation be unpaid and entirely his call. If you ever do set up a referral arrangement, the students should know it exists.

**Don't ask him for a list of student emails.** Aside from putting him in an awkward position, he probably can't hand over contact details without their consent. Ask him to forward your offer instead — which also converts better, because it comes from him.

### One caution on the alpha cohort

`DEC-006` exists specifically so that validation isn't biased. One teacher's class is a *correlated* sample: shared curriculum, probably the same DAW, similar genre leanings, similar skill level. So cap teacher-sourced testers at roughly 8 of the 15 and fill the rest from the communities in §7. You want the product validated against people who did not all learn from the same person.

### The message to send him this week

Keep it short. This is a mate, not a prospect.

> Hey — random one. I'm building a browser-based music production tool aimed at people who can make a loop but never finish a track. You teach exactly those people, so you know more about this than anyone I know.
>
> Can I buy you a pint / get 45 minutes of your time to pick your brain? Genuinely just want to hear where your students get stuck — not pitching you anything, there's barely anything to pitch yet.

### If it works, this becomes the channel

If his students activate at a decent rate, stop treating this as a lucky break and start treating it as your distribution strategy. Where the next six teachers come from, in order of ease:

1. **His introductions.** Always start here — a warm intro converts several times better than anything below it.
2. Local colleges and adult-education courses running music-tech modules.
3. Tutors at production schools (Point Blank, dBs, SAE and similar) — many teach privately on the side.
4. YouTube tutorial channels where the person also sells 1:1 lessons. These people are creators *and* educators, so they overlap with the §8 creator budget — he might be creator #1 himself.
5. Community music projects and youth music charities, which are often actively looking for free, install-free tools that run on locked-down school laptops. Your product being browser-based is a genuine advantage here.

Reuse the §4 ladder for each one. Once you have three teachers saying yes, you can largely stop doing everything else in this plan.

---

## 5. The weekly routine (this is the actual plan)

You said you dislike marketing and want minimum work. The answer is not a clever tactic — it is a **fixed, small, repeatable block** that you never skip and never expand. Put it in your calendar as a recurring event right now.

### Every Monday, 90 minutes. Same order, every week.

| Min | Task |
| --- | --- |
| 0–20 | **Record one clip.** Screen-record something you built or fixed that week, with sound. Phone-quality is fine. No script. See §6 for hooks. |
| 20–35 | **Post it** to TikTok, YouTube Shorts and Instagram Reels. Same file, same caption, three uploads. |
| 35–65 | **Be useful in two communities.** Answer two questions genuinely, in full, with no link. See §7. |
| 65–80 | **Reply to every comment and DM** you received all week. |
| 80–90 | **Update the four numbers** in the spreadsheet. Stop. |

That is it. 90 minutes. Nothing else on this list is mandatory.

### Once a month, swap the block for one educator conversation

On the first Monday of each month, skip the video and spend the 90 minutes on §4 instead: the conversation with your teacher, a follow-up, or an approach to the next one. This keeps your total effort flat while making the highest-value channel the thing that gets done first. **Never let a month pass with no educator contact** — this is the one commitment in the plan worth protecting above the others.

Optional and genuinely worth it: 15 minutes a day replying to comments, because early replies are what make short-form video spread. If you skip it, the plan still works.

**Rules that keep this sustainable:**

- Never batch-plan content. Record whatever you did that week. The work *is* the content.
- Never miss two Mondays in a row. One is fine.
- The educator conversation is never the thing you drop when you're busy. Drop the video instead.
- Do not add channels. The urge to add a fifth channel is procrastination wearing a suit.

---

## 6. Supporting channel: short-form video of the thing working

The teacher route in §4 is your primary path. Video is what runs alongside it — because it is the only thing here that keeps working while you sleep, and because it is how teachers five through eight eventually find *you* instead of you finding them.

**Why this and not something else:** your product is audiovisual. A screen recording of a loop becoming a track, with the audio, is inherently interesting in a way that a blog post about a browser DAW never will be. Producers live on TikTok, Shorts and Reels. The marginal cost is zero because you are building the thing anyway. And it compounds — one video that lands brings hundreds of signups while you sleep, which is the only kind of marketing that respects your time.

### The format

15–40 seconds. Vertical. **Audio is the product** — never post silent. Structure:

1. **Hook in the first 2 seconds** (see below). Not a logo, not "hey guys."
2. **The thing happening**, with sound.
3. **One line of payoff**, spoken or on-screen.
4. **Soft CTA**, on-screen text only: `solidgroove.app — waitlist in bio`.

No intro. No outro. No music bed over the top of your own product's audio.

### Ten hooks, ranked. Use them in this order.

Hooks 1–4 work **now**, in Phase 0/1, before the AI exists. Hooks 5–10 need the later phases. Do not use a hook that shows something you cannot demo.

| # | Hook | Available from |
| --- | --- | --- |
| 1 | "I have 200 unfinished loops. So I'm building the thing that finishes them." | Now |
| 2 | "Making a DAW that runs in a browser tab. Day 40." | Now |
| 3 | "This is what 8 bars sounds like through a drum machine I wrote myself." | Phase 1 |
| 4 | "Why do all your loops sound the same after 16 bars?" (teach something real, mention the tool once at the end) | Now |
| 5 | "8 bars in. Full track out. No plugins, no install." | Phase 2 |
| 6 | "I asked it what to do next. Here's what it changed — and here's me undoing half of it." | Phase 3 |
| 7 | "It explained why my bassline was muddy. It was right." | Phase 3 |
| 8 | "Not AI making music. AI showing you *how*." | Phase 3 |
| 9 | "From loop to Ableton project in one click." | Phase 2 |
| 10 | "Every change it makes, you can see, edit and undo." | Phase 3 |

### The honest expectation

Most videos will get 200 views. That is normal and not a failure. You are buying lottery tickets with a positive expected value: post 40 clips over 10 months and two or three will do 50k–500k views, and those two or three are where most of your 100 users come from. **The only way to lose is to stop posting because the first ten did nothing.**

---

## 7. Communities: be genuinely useful where they already are

This is where the non-teacher half of your alpha cohort comes from — roughly 7 of the 15, so that your validation isn't all drawn from one classroom (§4). You cannot buy alpha testers with ads; you have to earn them one conversation at a time. The good news is you only need seven.

### Where to go

Pick **two** and stick to them. Two done well beats eight done badly.

**Reddit** (~450k members on r/edmproduction alone):
- r/edmproduction — beginner-heavy, strong feedback culture. Best single fit.
- r/WeAreTheMusicMakers — the largest general music-making community.
- r/musicproduction — beginner friendly.
- r/makinghiphop, r/FL_Studio, r/ableton, r/synthesizers — secondary.

**Discord:**
- The r/WeAreTheMusicMakers server and the r/MusicProduction server (the latter has a feedback bot that tracks reciprocity — participate properly).
- "Bedroom Producers" servers on Disboard/top.gg. Note these skew young (13–22); check each server's age range and rules before deciding it is your audience.

Before your first post in any community: **read the sidebar rules and find the self-promotion policy.** Most of these subs ban direct promotion outright and route it into a weekly thread. Breaking that rule gets you banned permanently from the single best place to find your users. This is a five-minute task that protects the whole plan.

### The 20:1 rule

Twenty genuinely helpful contributions with no link, for every one mention of your product. This sounds slow. It is actually the fast route, because the alternative is a ban.

Your leverage: you are *building a DAW*. You know more than almost anyone in the thread about why arrangement is hard, why a mix goes muddy, why the browser struggles with audio. Answer those questions properly and people will click your profile without being asked. **Put the link in your profile, not in your comments.** Let the profile do the selling.

### Reply template

> [Direct answer to their actual question, 3–6 sentences, specific and genuinely useful. Name the concept. Give one concrete thing to try tonight.]
>
> [Optional, only if it truly fits:] This is basically the problem I'm obsessed with — I'm building a browser tool for exactly this stage. Happy to go deeper if useful.

Note what that does *not* do: no link, no pitch, no "check out my app." If the answer is good, the curious will find you.

### Alpha invite DM (Stage B)

Send this to people whose questions you answered and who seemed like a fit — not cold, never bulk.

> Hey — you commented on [specific thing] a while back and your situation is exactly who I've been building for.
>
> I've made a browser-based production tool for people who get stuck turning loops into finished tracks. It's rough and early. I'm looking for about 15 people to use it properly and tell me where it falls apart.
>
> No cost, no catch, and I'm not going to spam you. I want about 30 minutes of your honest reaction. In exchange you get permanent free access to whatever this becomes, and your name in the credits if you want it.
>
> Interested? Happy to send a link.

Expect roughly 1 in 3 to say yes when the outreach is this targeted. So ~45 DMs to fill 15 seats. At 15 DMs per week, that is three weeks.

---

## 8. The £1,000

### Where it goes

| Line | Amount | When | Notes |
| --- | --- | --- | --- |
| Domain (2 years) + waitlist/landing hosting | £80 | Stage A, week 1 | Firebase Hosting is already in your pipeline; the domain is the real cost. |
| Email tool | £60 | Stage A | Start on a free tier (MailerLite, Buttondown). This is the paid tier once you pass ~1,000 contacts. |
| Video editing help | £160 | Stage A onwards | ~8 clips at £20 via Fiverr/Upwork. Buys back your time; captions and pacing measurably improve reach. |
| **Educator track** | **£200** | **Stage A–B** | **~3–4 hours of your teacher's time at a fair consulting rate, plus a one-page class handout and a 2-minute demo video he can play to a room. See below.** |
| **Creator seeding** | **£250** | **Stage C only** | **2–3 creators × ~£100. Your teacher may well be creator #1 — many teach and post.** |
| Alpha cohort thank-you | £60 | Stage B | A curated sample pack, or £4 coffee vouchers × 15. Small gestures buy remarkable loyalty from early testers. |
| **Held back** | **£190** | Stage C | Untouched until something is proven to work. See below. |

### Why the money goes to people and (almost) none of it to ads

Reddit's self-serve ads take a £5/day minimum and typical CPCs land around £1.00–£1.50 — but meaningful data needs roughly £40–80/day for two to three weeks. Your entire budget is one week of a real test. **You cannot afford to learn anything from Reddit ads, so do not try.**

Every other line above buys a human with an existing audience and existing trust. £200 of a teacher's time is the best-value spend in this table: it buys expert curriculum input, the `DEC-002` starter templates, and a relationship that keeps producing the right users every term. A small producer-YouTuber with 5,000 engaged subscribers will make you an honest first-look video for £75–150 — a real audience, a trusted voice, and a permanent asset. For a pre-launch tool with a visual product, both beat paid ads by a wide margin.

**On paying the teacher:** pay him for advisory hours and materials — genuine work, cleanly invoiced. Do not pay him per student. See §4 for why that distinction matters.

### The rule for the held-back £190

**Do not spend it to discover a message. Only spend it to amplify a proven one.**

Concretely: if one of your organic videos or one creator video converts well, take the exact hook and thumbnail from that video and put £190 behind it as a 14-day Reddit or Meta test at ~£13/day. If nothing has converted yet, the £190 stays in your pocket — it is not a budget you must exhaust. Unspent money is a valid, good outcome. If the educator track is working, spending it on a second teacher's advisory time beats any ad.

### Creator outreach email

Send 20 to get 4. Small channels (2k–20k subs) reply; large ones will not.

> **Subject:** Early access to a browser DAW — paid first-look?
>
> Hi [name],
>
> Your video on [specific, real video] was the clearest explanation of [specific thing] I've seen, which is why I'm writing to you and not someone with a bigger channel.
>
> I've built Solid Groove — a browser-based production tool for producers who write loops but struggle to finish tracks. It has an assistant that suggests what to do next and shows you exactly what it changed, so you can edit or undo all of it. It's deliberately not a song generator.
>
> I'd like to pay you £100 for an honest first look, positive or negative. If you hate it, say so on camera — I'd rather have the feedback than a nice review. I'll give you early access, answer anything, and won't ask for approval over the edit.
>
> Interested? I can send you a login this week.
>
> [name] — solidgroove.app

Do not ask for editorial control. Do not ask for a positive review. A creator who trusts you is worth more than a script you wrote, and their audience can smell a paid ad from a mile off.

---

## 9. The landing page (your one real conversion asset)

This ships as `LOOP-001b`. Its copy is a marketing deliverable, so here it is.

**Above the fold:**

- **Headline:** Bring a loop. Leave with a track.
- **Sub:** A browser music studio with a producer beside you. It suggests what to do next, shows you what it changed, and lets you undo all of it.
- **Primary CTA:** `Start making something` → straight into the anonymous editor, no signup. (The PRD's "fast path to sound" principle is also your best conversion tactic — a visitor who hears sound before signing up is a dramatically warmer lead.)
- **Secondary CTA:** `Get early access` → email field, one field only.
- **Above the fold, autoplaying, muted, looping:** the editor. Show the product, not an illustration.

**Three bullets, in this order:**

1. **Finish, don't just loop.** Turn eight bars into a full arrangement, and export it.
2. **Learn while you make.** Every suggestion explains itself and shows what changed.
3. **Nothing to install.** Open a tab and hear sound in ten seconds.

**An honesty block, near the bottom.** This will do more for you than any other paragraph on the page, because your audience is pre-loaded with suspicion:

> **What this isn't.** It won't write your track for you. There's no "make me a song" button. It suggests, you decide, and you can undo anything it does. Everything it makes is normal editable notes, clips and devices — the same things you'd make by hand.

**Pre-launch, if the app is not yet reachable:** the page is a single screen — headline, muted looping video, one email field, the honesty block. Nothing else. Do not build a marketing site. Do not add a pricing page for a product with no price.

---

## 10. The 12-week calendar for Stage A

Weeks are relative to your start, not to the calendar. Everything here fits the Monday block from §5.

| Week | Do this |
| --- | --- |
| 1 | **Message the teacher (§4, Ask 1).** Then: buy the domain, put up the single-screen waitlist page, set up the email tool, create accounts on TikTok/YouTube/Instagram/Reddit with the same handle. Read the rules of your two chosen communities. |
| 2 | **Have the conversation with the teacher.** Write up the answers to the six questions the same day. First video (hook #2). Write the four-number spreadsheet. |
| 3–4 | Repeat the Monday block. Hire the video editor; send them clips 3 and 4. Send the teacher a thank-you and a one-line summary of what you took from the conversation — this is what makes Ask 2 easy. |
| 5 | **Check metric 2.** Under 10% page→email conversion? Rewrite the headline, not the traffic plan. First Monday of the month: educator block, not video. |
| 6–9 | Repeat. Start a running list of named individuals who look like alpha material — name, source, what they struggle with. Target 30 names from communities, plus the teacher's cohort. If he's up for it, start sketching the `DEC-002` starter templates with him. |
| 10 | Draft the creator shortlist: 20 channels, 2k–20k subs, English-speaking, tutorial-focused — teacher first. Do not contact them yet. |
| 11–12 | Repeat. **Gate review** (§11). |

At the end of Stage A you should have: a teacher who has told you where his students stall and is warm to trying it, ~150–300 waitlist emails, ~10 videos posted, ~30 named alpha prospects, a shortlist of 20 creators, and roughly £650–850 unspent. If you have those, the plan is working even if no video went viral.

---

## 11. Gates and kill criteria

Check these at each stage boundary. Being willing to stop is what makes the plan cheap.

**Gate A → B** (before recruiting the cohort):
- ✅ The teacher has given you 45 minutes and is willing to try it himself, **or** 100+ waitlist emails, **or** one video over 10k views. → Continue.
- ❌ Under 40 emails after 12 weeks of consistent posting. → Your *message* is wrong, not your channel. Do not spend money. Rewrite the headline around a different pain and give it four more weeks.

**Gate: the teacher himself** (before he offers anything to students):
- ✅ He says he'd show it to a class. → Proceed to Ask 3.
- ❌ He wouldn't show it to a class. → **Do not ask him to anyway.** Find out precisely what's missing and fix that first. A teacher's professional reluctance is the most reliable product signal you will get all year, and it is worth more than the waitlist.

**Gate B → C** (before spending the creator and ad money):
- ✅ 8+ of the 15 testers activated, and 4+ came back unprompted in week two. → Spend the money.
- ❌ Fewer than 4 of 15 activated. → **Stop marketing entirely.** Go and fix onboarding. Marketing a product that early users abandon is the most expensive thing you could do with this budget, and every pound spent makes it worse.

**Gate: is the educator route a channel?** Measure this on his students specifically:
- ✅ 5+ of 8 offered students activated. → **Educators are your channel.** Go find six more teachers (§4) and you can largely stop doing everything else in this plan.
- ❌ 1–2 of 8 activated. → It is the product, not the channel. Warm-intro traffic from a trusted teacher is the friendliest traffic you will ever get; if it doesn't convert, nothing colder will. Go back to the product.

**Gate C:**
- ✅ 100 activated users. Done — and now you have the data to write a real growth plan instead of a first-100 plan.
- ❌ Stalled at 40–60. Almost always a retention problem masquerading as an acquisition problem. Check metric 4 before buying more traffic.

**Also worth scheduling, once, at Stage C:** a Product Hunt launch and one r/edmproduction post in whatever thread the rules permit. Both are free, both are one-shot, and both are worth doing on the day the AI producer actually works — not before. A launch moment you spend early is gone.

---

## 12. Handing this off

This plan is designed so that someone else can run §5–§7 without you. What you cannot delegate is being the credible builder in community threads — that voice has to be yours, and it is the part that works.

**Hire for:** short-form video editing and scheduling, community monitoring and first-draft replies, creator outreach and admin, the weekly spreadsheet.

**Do not hire for:** answering technical production questions, or anything that speaks as you in a community thread. A freelancer faking expertise in r/edmproduction will be spotted within a day and it will cost you more than it saves.

**Never delegate:** the educator relationships in §4. That one is personal, it depends on you being the builder, and it is the highest-value thing in the plan. An assistant can book the calls and send the follow-ups; you have the conversations.

**What to pay:** £15–25/hour on Upwork or Fiverr for a video editor / community assistant, 4–6 hours a week. That is roughly £400–600/month — beyond this £1,000 budget, so treat it as the thing you do *after* Gate B confirms the product retains people.

**What to give them:** this document, the four-number spreadsheet, logins to the four social accounts, and the hook list in §6. Then review once a week for 20 minutes.

---

## 13. What not to do

Every item here is something a marketing-averse founder can safely ignore. That is the point.

- **A blog / SEO.** Takes 9–18 months to pay off. You need users this year.
- **Twitter/X growth.** Producers are not there in numbers; the effort-to-user ratio is terrible.
- **Paid search ads.** Nobody searches for a product category that does not exist yet.
- **A Discord server of your own.** Not until you have 100 users. An empty server is worse than no server.
- **Press and music-tech blogs.** They cover launches, not prototypes. Revisit at Stage C, if at all.
- **A newsletter.** One email when you invite people, one when you launch. That is your entire email programme.
- **Instagram grid posts, Pinterest, LinkedIn, Threads.** No.
- **Product Hunt before Phase 3.** You get one launch. Spend it on a product that works.
- **Any second channel before the first one is working.** This is the most common and most expensive mistake on this list.
- **Asking the teacher for a list of student emails.** Ask him to forward your offer instead. It's less awkward for him, it avoids a data-protection problem, and it converts better because it comes from him.
- **Paying anyone per student signup.** Advisory time, yes. Commission on his own students, no — see §4.

---

## 14. If you do only three things

1. **Message the teacher this week, and ask only for 45 minutes of his expertise.** Then walk the §4 ladder patiently, one rung at a time, and never spend his credibility on a build that isn't ready. This is the shortest path to 100 users and the least work of anything in this document.
2. **Keep the Monday 90-minute block, every week, posting the product working with sound.** It is the only thing here that compounds while you sleep, and it's how teacher #5 finds you instead of the reverse.
3. **Never say "AI" without immediately saying "you decide, and you can undo it."** This is your whole story, and it is the difference between curiosity and contempt — with producers and with educators alike.

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
