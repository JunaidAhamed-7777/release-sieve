# Frozen synthetic correspondence fixtures

`fixtures.json` specifies 48 novel, English-language, one-change mini-releases.
They are invented developer-tool scenarios, with no customer, private repository,
or observed release data. Their labels are **author-defined synthetic
specifications, not independent human annotations**. The scenarios and labels
were written before running the benchmark matcher or lexical baseline. Neither
model scores nor benchmark results informed their wording.

| Category | Scenarios | Expected outcome | Purpose |
| --- | ---: | --- | --- |
| Literal | 8 | Match | Exact substantive wording amid unrelated notes |
| Paraphrase | 8 | Match | Same behavior expressed with different wording |
| Omitted | 8 | Review | Behavior absent from notes, including two empty note lists |
| Hard negative | 8 | Review | Overlapping words with the wrong direction, value, scope, platform, or condition |
| Ambiguous | 6 | Review | Two plausible candidates; the change summary cannot resolve their scope |
| Breaking | 6 | Review | Relevant migration evidence must not bypass mandatory review |
| Internal | 4 | Internal | Explicitly nonbreaking maintenance with no external behavior change |
| **Total** | **48** | **16 match / 28 review / 4 internal** | |

CLI, SDK, cache, editor, build, test, mobile, and observability scenarios each have
a literal case, paraphrase, omission, and hard negative. The ambiguity and
breaking scenarios cover six of those domains. Internal cases also include
documentation and CI maintenance. Nonempty scenarios have two to four notes.
The correct note rotates among positions rather than always appearing first.
Every scenario contains one change and one inspectable label rationale.

## Label meaning

- `expected: "match"` means the synthetic specification contains sufficient,
  unambiguous corresponding note evidence. A correct automatic result must also
  select a note listed in `acceptableNoteIds`.
- `expected: "review"` means an automatic pass would give false reassurance under
  the scenario specification. Omitted and hard-negative cases have no acceptable
  note. Ambiguous cases list **plausible candidates**, and breaking cases list
  **relevant migration evidence**; those IDs do not authorize automatic matching.
- `expected: "internal"` means nonbreaking maintenance is suitable for the
  application's conventional-commit heuristic. These examples explicitly state
  that shipped behavior is unchanged; that heuristic is not safe for all real
  commits carrying the same type.

`reviewReason` separates missing evidence, contradicted evidence, unresolved
scope, and the breaking-change gate. The six breaking cases exercise all three
supported markers: a conventional-commit `!`, a `BREAKING CHANGE:` body marker,
and an explicit `breaking: true`. Two use otherwise internal conventional types
to check that the breaking gate takes precedence.

## Freeze and evaluation discipline

The benchmark runner should record the SHA-256 of the exact fixture bytes before
the first inference and include it in every result. Preserve that frozen file for
reported results. Do not rewrite a difficult case after seeing scores. A label
correction requires a documented rationale and a new fixture version/hash, with
the old result retained or explicitly withdrawn.

These 48 fixtures are a reporting set held out from threshold selection, not
training or calibration data. The existing semantic product policy stays fixed.
The lexical baseline is reported both at fixed gates and at gates selected only
on the separate 12-case `calibration.json` set; `PROTOCOL.md` declares that
selection rule. Neither baseline selection nor future model or policy tuning
may use these 48 reporting cases. If they inform a future change, use a new
held-out reporting set rather than describing a rerun on them as held-out.

Report category counts and raw error counts alongside rates. Useful denominators
include:

- **Correct automatic correspondence:** correct-note automatic matches out of
  the 16 expected-match cases, plus the number of these 16 sent to review.
- **Automatic-match precision:** correct-note automatic matches in expected-match
  cases divided by all automatic-match predictions across the 38 ordinary cases.
  A match in an ambiguous case is an error even when its candidate ID is listed.
- **False reassurance share:** incorrect automatic matches divided by all
  automatic matches across those 38 ordinary cases. Include wrong-note matches
  on otherwise safe cases as well as automatic passes on review cases.
- **Must-review escape:** automatic matches out of the 22 ordinary cases labelled
  review. Show omitted, hard-negative, and ambiguous results separately. A
  wrong-note match on a safe case does not belong in this denominator.
- **Policy checks:** breaking-review compliance out of six and internal
  classification out of four. Report these separately from semantic matching;
  deterministic gates must not inflate a semantic-accuracy headline.
- **Wrong-note errors:** expected-match cases that automatically select an
  unlisted note, rather than merely asking for review.

Count a zero denominator as unavailable rather than as perfect performance.
Timing runs should identify which scenarios actually invoke inference: the two
empty-note omissions and the four internal cases do not need embeddings.

## Judgment calls and limits

The ambiguity labels are deliberate specification choices. Each summary leaves
out a format, boundary, mode, destination, or persistence duration that separates
two notes. A reviewer may find one candidate more linguistically likely, but the
provided evidence does not establish it. These cases evaluate a conservative
review preference, not externally adjudicated coverage truth. Listing two
candidate IDs does not mean either note alone proves complete documentation.

The hard negatives deliberately demand distinctions that a sentence-similarity
model may fail to preserve, especially negation, numbers, and platform names.
Any automatic pass in that category is a useful exposed limitation, not a reason
to replace its fixture. The literal cases are intentionally easy controls.

This balanced, author-written set is small and not sampled from real release
traffic. It cannot estimate a deployed error rate, user time saved, commercial
demand, revenue, security assurance, or general model quality. Eight examples per
category mean one outcome moves that category's rate by 12.5 percentage points;
six mean about 16.7 points, and four mean 25 points. Report the counts.

All scenarios are short English prose; there is no coverage of long-input
truncation, multilingual notes, actual code-diff behavior, multi-change note
merges, large release-note collections, or misleading commit types beyond the
explicit breaking overrides. Parser robustness and browser behavior belong in
the regression suite rather than in this semantic fixture score. A human still
needs to inspect the original change and note before publishing.
