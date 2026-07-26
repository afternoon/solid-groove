# Solid Groove — Plan to the First 100 Users

| Field | Value |
| --- | --- |
| Status | Draft for execution |
| Owner | Product owner (executable solo, or handed to a freelancer — see §11) |
| Budget | £1,000 total |
| Time cost | One 90-minute block per week, plus optional 15 min/day of replies |
| Goal | 100 activated users (defined in §2) |
| Horizon | Roughly 6 months, gated on product phases, not on the calendar |

This plan is written to be followed literally. Where it says "do X on Monday," do X on Monday. If you only ever read one section, read §4 (the weekly routine) and §7 (the budget).

---

## 1. Read this first: the plan is gated on the product, not on marketing effort

Solid Groove is currently in **Phase 0** of four ([`docs/backlog.md`](../backlog.md)). Two facts drive everything below:

1. **There is no public front door yet.** The landing page is `LOOP-001b`, in Phase 1. Until it ships, there is nowhere to send anyone.
2. **The AI producer — the actual differentiator — arrives in Phase 3.** Until then, marketing the product as "an AI music assistant" would be selling something that does not exist. That is both dishonest and strategically wasteful: you would burn your one launch moment on a promise you cannot yet keep.

So this is **not** a plan to get 100 users this month. It is a plan to spend very little effort now building an audience that is ready, and then convert it when the product can actually deliver the promise. Trying to acquire 100 users before Phase 3 would mean 100 people bouncing off an unfinished tool and never coming back — the most expensive mistake available to you.

**The sequence:**

| Stage | Product gate | Marketing goal | Effort |
| --- | --- | --- | --- |
| **A. Audience** | Now → Phase 1 landing page | 300 waitlist emails | 90 min/week |
| **B. Cohort** | Phase 2 (export works) | 15 hand-picked alpha testers | 3 h/week for 3 weeks |
| **C. Scale** | Phase 3 (AI producer works) | 100 activated users | 90 min/week + the money |

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

## 4. The weekly routine (this is the actual plan)

You said you dislike marketing and want minimum work. The answer is not a clever tactic — it is a **fixed, small, repeatable block** that you never skip and never expand. Put it in your calendar as a recurring event right now.

### Every Monday, 90 minutes. Same order, every week.

| Min | Task |
| --- | --- |
| 0–20 | **Record one clip.** Screen-record something you built or fixed that week, with sound. Phone-quality is fine. No script. See §5 for hooks. |
| 20–35 | **Post it** to TikTok, YouTube Shorts and Instagram Reels. Same file, same caption, three uploads. |
| 35–65 | **Be useful in two communities.** Answer two questions genuinely, in full, with no link. See §6. |
| 65–80 | **Reply to every comment and DM** you received all week. |
| 80–90 | **Update the four numbers** in the spreadsheet. Stop. |

That is it. 90 minutes. Nothing else on this list is mandatory.

Optional and genuinely worth it: 15 minutes a day replying to comments, because early replies are what make short-form video spread. If you skip it, the plan still works.

**Rules that keep this sustainable:**

- Never batch-plan content. Record whatever you did that week. The work *is* the content.
- Never miss two Mondays in a row. One is fine.
- Do not add channels. The urge to add a fifth channel is procrastination wearing a suit.

---

## 5. Primary channel: short-form video of the thing working

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

## 6. Secondary channel: be genuinely useful where they already are

This is how you get the first 15 alpha testers. You cannot buy alpha testers with ads; you have to earn them one conversation at a time. The good news is you only need 15.

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

## 7. The £1,000

### Where it goes

| Line | Amount | When | Notes |
| --- | --- | --- | --- |
| Domain (2 years) + waitlist/landing hosting | £80 | Stage A, week 1 | Firebase Hosting is already in your pipeline; the domain is the real cost. |
| Email tool | £60 | Stage A | Start on a free tier (MailerLite, Buttondown). This is the paid tier once you pass ~1,000 contacts. |
| Video editing help | £160 | Stage A onwards | ~8 clips at £20 via Fiverr/Upwork. Buys back your time; captions and pacing measurably improve reach. |
| **Creator seeding** | **£400** | **Stage C only** | **4 creators × £100. The single highest-leverage spend. See below.** |
| Alpha cohort thank-you | £60 | Stage B | A curated sample pack, or £4 coffee vouchers × 15. Small gestures buy remarkable loyalty from early testers. |
| **Held back** | **£240** | Stage C | Untouched until something is proven to work. See below. |

### Why £400 on creators and (almost) nothing on ads

Reddit's self-serve ads take a £5/day minimum and typical CPCs land around £1.00–£1.50 — but meaningful data needs roughly £40–80/day for two to three weeks. Your entire budget is one week of a real test. **You cannot afford to learn anything from Reddit ads, so do not try.**

Meanwhile, a small producer-YouTuber with 5,000 engaged subscribers will make you an honest first-look video for £75–150. That gets you: a real audience, a trusted voice, watch-time on the product actually working, and a permanent asset that keeps delivering signups for years. For a pre-launch tool with a visual product, this beats paid ads by a wide margin.

### The rule for the held-back £240

**Do not spend it to discover a message. Only spend it to amplify a proven one.**

Concretely: if one of your organic videos or one creator video converts well, take the exact hook and thumbnail from that video and put £240 behind it as a 14-day Reddit or Meta test at ~£17/day. If nothing has converted yet, the £240 stays in your pocket — it is not a budget you must exhaust. Unspent money is a valid, good outcome.

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

## 8. The landing page (your one real conversion asset)

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

## 9. The 12-week calendar for Stage A

Weeks are relative to your start, not to the calendar. Everything here fits the Monday block from §4.

| Week | Do this |
| --- | --- |
| 1 | Buy the domain. Put up the single-screen waitlist page. Set up the email tool. Create accounts: TikTok, YouTube, Instagram, Reddit — same handle everywhere. Read the rules of your two chosen communities. |
| 2 | First video (hook #2). Write the four-number spreadsheet. First two community answers. |
| 3–4 | Repeat the Monday block. Hire the video editor; send them clips 3 and 4. |
| 5 | **Check metric 2.** Under 10% page→email conversion? Rewrite the headline, not the traffic plan. |
| 6–9 | Repeat. Start a running list of named individuals who look like alpha material — name, community, what they struggle with. Target 40 names. |
| 10 | Draft the creator shortlist: 20 channels, 2k–20k subs, English-speaking, tutorial-focused. Do not contact them yet. |
| 11–12 | Repeat. **Gate review** (§10). |

At the end of Stage A you should have: ~150–300 waitlist emails, ~10 videos posted, ~40 named alpha prospects, a shortlist of 20 creators, and roughly £850 unspent. If you have those five things, the plan is working even if no video went viral.

---

## 10. Gates and kill criteria

Check these at each stage boundary. Being willing to stop is what makes the plan cheap.

**Gate A → B** (before recruiting the cohort):
- ✅ 100+ waitlist emails, or one video over 10k views. → Continue.
- ❌ Under 40 emails after 12 weeks of consistent posting. → Your *message* is wrong, not your channel. Do not spend money. Rewrite the headline around a different pain and give it four more weeks.

**Gate B → C** (before spending the £400):
- ✅ 8+ of the 15 testers activated, and 4+ came back unprompted in week two. → Spend the money.
- ❌ Fewer than 4 of 15 activated. → **Stop marketing entirely.** Go and fix onboarding. Marketing a product that early users abandon is the most expensive thing you could do with this budget, and every pound spent makes it worse.

**Gate C:**
- ✅ 100 activated users. Done — and now you have the data to write a real growth plan instead of a first-100 plan.
- ❌ Stalled at 40–60. Almost always a retention problem masquerading as an acquisition problem. Check metric 4 before buying more traffic.

**Also worth scheduling, once, at Stage C:** a Product Hunt launch and one r/edmproduction post in whatever thread the rules permit. Both are free, both are one-shot, and both are worth doing on the day the AI producer actually works — not before. A launch moment you spend early is gone.

---

## 11. Handing this off

This plan is designed so that someone else can run §4–§6 without you. What you cannot delegate is being the credible builder in community threads — that voice has to be yours, and it is the part that works.

**Hire for:** short-form video editing and scheduling, community monitoring and first-draft replies, creator outreach and admin, the weekly spreadsheet.

**Do not hire for:** answering technical production questions, or anything that speaks as you in a community thread. A freelancer faking expertise in r/edmproduction will be spotted within a day and it will cost you more than it saves.

**What to pay:** £15–25/hour on Upwork or Fiverr for a video editor / community assistant, 4–6 hours a week. That is roughly £400–600/month — beyond this £1,000 budget, so treat it as the thing you do *after* Gate B confirms the product retains people.

**What to give them:** this document, the four-number spreadsheet, logins to the four social accounts, and the hook list in §5. Then review once a week for 20 minutes.

---

## 12. What not to do

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

---

## 13. If you do only three things

1. **The Monday 90-minute block, every week, without fail.** Consistency beats cleverness, and it is the only thing here that compounds.
2. **Post the product working, with sound, in vertical video.** Your product is the marketing asset. Everything else is commentary.
3. **Never say "AI" without immediately saying "you decide, and you can undo it."** This is your whole story, and it is the difference between curiosity and contempt in the communities you need.

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
