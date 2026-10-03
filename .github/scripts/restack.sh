#!/usr/bin/env bash
# Keep stacked PRs current without anyone babysitting them.
#
# Called by .github/workflows/restack.yml with the PR that changed:
#
#   merged <pr>          A PR merged. Every open PR stacked on its branch is
#                        retargeted onto the merged PR's base, then brought up
#                        to date.
#   pushed <pr> <before> A PR's branch moved from <before>. Every PR stacked on
#                        it is brought up to date.
#   rebased <pr> <old>   A PR's base was changed from branch <old>. It is
#                        brought up to date on its new base.
#   base <branch>        <branch> (main) moved. Every open PR on it that now
#                        conflicts with it is brought up to date. A PR that
#                        still merges cleanly is left alone, so a merge to main
#                        does not rebuild every open PR's CI and preview.
#
# "Brought up to date" means rebasing the PR's own commits onto the tip of its
# base and pushing with --force-with-lease. GitHub's native stacks (which
# stack-link.yml links) only merge with a fully linear history, so a merge
# commit would block the stack. Only the PR's own commits move: the rebase is
# `--onto <base> <old base tip>`, so commits of a squash-merged or rewritten
# parent are dropped rather than replayed. An agent with the branch checked out
# gets a rejected push and recovers with `git pull --rebase`.
#
# Each update recurses into the PRs stacked on top of it, so one merge at the
# bottom of a three-PR stack updates the whole stack in one run.
#
# A rebase that conflicts is aborted, labelled `restack-conflict`, and handed to
# @claude with a comment (claude.yml picks it up). The label stops a second
# comment while the first is being worked; the next clean update removes it.
set -euo pipefail

mode="$1"
pr="$2"
old_ref="${3:-}"
repo="${GITHUB_REPOSITORY:?}"
conflict_label="restack-conflict"

log() { echo "restack: $*" >&2; }

pr_field() { gh pr view "$1" --repo "$repo" --json "$2" --jq ".$2"; }

# Open PRs whose base is the given branch, one number per line.
children_of() {
	gh pr list --repo "$repo" --state open --base "$1" --limit 100 \
		--json number,isCrossRepository \
		--jq '.[] | select(.isCrossRepository | not) | .number'
}

ensure_label() {
	gh label create "$conflict_label" --repo "$repo" --color B60205 \
		--description "Auto-restack hit a merge conflict; @claude has been asked to resolve it" \
		2>/dev/null || true
}

report_conflict() {
	local number="$1" head="$2" base="$3" onto="$4"
	if gh pr view "$number" --repo "$repo" --json labels --jq '.labels[].name' |
		grep -qx "$conflict_label"; then
		log "#$number already flagged; not commenting again"
		return
	fi
	ensure_label
	gh pr edit "$number" --repo "$repo" --add-label "$conflict_label" >/dev/null
	gh pr comment "$number" --repo "$repo" --body-file - <<EOF
@claude Auto-restack could not rebase \`$head\` onto \`$base\`: it conflicts.

Check out \`$head\`, run \`git rebase --onto origin/$base $onto\` (only this PR's own commits), and resolve each conflict so both sides' behaviour survives. Run \`bun run typecheck\`, \`bun run check\` and the tests the conflicted files touch, then \`git push --force-with-lease\`. This is the one case where force-pushing a stacked branch is expected: the stack must stay linear. If two sides changed the same logic and keeping both is not possible, stop and say which behaviour you need decided instead of picking one.

---
_Posted by the restack workflow (\`.github/workflows/restack.yml\`)._
EOF
}

# Rebase the PR's own commits onto its base and force-push with a lease.
# $2 is the old tip of the PR's base: everything up to it is the base's, not
# the PR's. Without it, the merge base stands in. Returns 1 on conflict.
update_pr() {
	local number="$1" old_base_tip="${2:-}" head base onto head_sha
	head="$(pr_field "$number" headRefName)"
	base="$(pr_field "$number" baseRefName)"

	git fetch --quiet origin "$base" "$head"
	head_sha="$(git rev-parse "origin/$head")"
	git checkout --quiet -B "$head" "origin/$head"

	if git merge-base --is-ancestor "origin/$base" HEAD; then
		log "#$number ($head) already sits on $base"
		gh pr edit "$number" --repo "$repo" --remove-label "$conflict_label" >/dev/null 2>&1 || true
		return 0
	fi

	if [ -n "$old_base_tip" ] && git merge-base --is-ancestor "$old_base_tip" HEAD 2>/dev/null; then
		onto="$old_base_tip"
	else
		onto="$(git merge-base "origin/$base" HEAD)"
	fi

	if git rebase --quiet --onto "origin/$base" "$onto" >/dev/null 2>&1; then
		# The lease fails if anyone pushed since we fetched; the next event redoes it.
		if git push --quiet --force-with-lease="$head:$head_sha" origin "HEAD:$head"; then
			log "#$number ($head) rebased onto $base and pushed"
		else
			log "#$number ($head) moved while restacking; leaving it for the next run"
			return 1
		fi
	else
		git rebase --abort
		log "#$number ($head) conflicts with $base"
		report_conflict "$number" "$head" "$base" "$onto"
		return 1
	fi

	gh pr edit "$number" --repo "$repo" --remove-label "$conflict_label" >/dev/null 2>&1 || true
}

# Update a PR, then everything stacked on it, passing each child its parent's
# tip from before the update. A conflicted PR stops its own subtree: its
# children would only inherit the conflict.
restack_tree() {
	local number="$1" old_base_tip="${2:-}" head old_head child
	head="$(pr_field "$number" headRefName)"
	git fetch --quiet origin "$head"
	old_head="$(git rev-parse "origin/$head")"
	update_pr "$number" "$old_base_tip" || return 0
	for child in $(children_of "$head"); do
		restack_tree "$child" "$old_head"
	done
}

case "$mode" in
merged)
	merged_head="$(pr_field "$pr" headRefName)"
	merged_base="$(pr_field "$pr" baseRefName)"
	merged_sha="$(pr_field "$pr" headRefOid)"

	# Still stacked on the merged branch: retarget them.
	for child in $(children_of "$merged_head"); do
		log "#$child: retargeting $merged_head -> $merged_base"
		gh pr edit "$child" --repo "$repo" --base "$merged_base" >/dev/null
		restack_tree "$child" "$merged_sha"
	done

	# Already retargeted by GitHub (it does that when the merged branch is
	# deleted), so they are no longer findable by base. They are the open PRs
	# on the same base whose history contains the merged PR's head.
	git fetch --quiet origin
	for candidate in $(children_of "$merged_base"); do
		head="$(pr_field "$candidate" headRefName)"
		if git merge-base --is-ancestor "$merged_sha" "origin/$head" 2>/dev/null; then
			restack_tree "$candidate" "$merged_sha"
		fi
	done
	;;
pushed)
	head="$(pr_field "$pr" headRefName)"
	for child in $(children_of "$head"); do
		restack_tree "$child" "$old_ref"
	done
	;;
rebased)
	# The old base branch's tip, if it still exists, bounds the PR's own commits.
	old_tip=""
	if [ -n "$old_ref" ] && git fetch --quiet origin "$old_ref" 2>/dev/null; then
		old_tip="$(git rev-parse "origin/$old_ref")"
	fi
	restack_tree "$pr" "$old_tip"
	;;
base)
	branch="$pr"
	for candidate in $(children_of "$branch"); do
		# Test the merge here rather than asking GitHub, whose `mergeable` can
		# stay unknown for minutes after the base moves.
		head="$(pr_field "$candidate" headRefName)"
		git fetch --quiet origin "$branch" "$head"
		if git merge-tree --write-tree "origin/$branch" "origin/$head" >/dev/null 2>&1; then
			log "#$candidate merges cleanly into $branch; leaving it"
		else
			log "#$candidate conflicts with $branch; rebasing it"
			restack_tree "$candidate" ""
		fi
	done
	;;
*)
	echo "usage: restack.sh merged <pr> | pushed <pr> <before-sha> | rebased <pr> <old-base> | base <branch>" >&2
	exit 2
	;;
esac
