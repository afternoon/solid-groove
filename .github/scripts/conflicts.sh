#!/usr/bin/env bash
# Flag PRs that `main` has moved out from under. See .github/workflows/conflicts.yml.
#
#   main          main moved: every open PR on it that no longer merges cleanly is
#                 labelled `merge-conflict` and handed to @claude; one that does is
#                 left alone, and its label (if any) removed.
#   pushed <pr>   PR <pr> was pushed: its label is removed if it now merges cleanly.
#
# Nothing here rewrites a branch. The fix is a merge of `main` into the PR's
# branch, done by the agent the comment starts; a squash merge hides the merge
# commit, so the branch's history does not matter.
set -euo pipefail

mode="$1"
pr="${2:-}"
repo="${GITHUB_REPOSITORY:?}"
label="merge-conflict"
base="main"

log() { echo "conflicts: $*" >&2; }

ensure_label() {
	gh label create "$label" --repo "$repo" --color B60205 \
		--description "No longer merges cleanly into main; @claude has been asked to merge main in" \
		2>/dev/null || true
}

has_label() {
	gh api "repos/$repo/issues/$1/labels" --jq '.[].name' | grep -qx "$label"
}

# 0 when the PR's head merges cleanly into main.
merges_cleanly() {
	local head="$1"
	git fetch --quiet origin "$base" "$head"
	git merge-tree --write-tree "origin/$base" "origin/$head" >/dev/null 2>&1
}

flag() {
	local number="$1" head="$2"
	if has_label "$number"; then
		log "#$number already flagged; not commenting again"
		return
	fi
	ensure_label
	gh api --method POST "repos/$repo/issues/$number/labels" -f "labels[]=$label" >/dev/null
	gh pr comment "$number" --repo "$repo" --body-file - <<MSG
@claude \`main\` has moved and this PR no longer merges cleanly into it.

Check out \`$head\`, run \`git merge origin/$base\`, and resolve each conflict so both sides' behaviour survives. Never rebase or force-push: a merge commit keeps every checkout of this branch valid, and the squash merge hides it. Run \`bun run typecheck\`, \`bun run check\` and the tests the conflicted files touch, then push. If both sides changed the same logic and keeping both is not possible, stop and say which behaviour you need decided instead of picking one.

---
_Posted by the conflicts workflow (\`.github/workflows/conflicts.yml\`)._
MSG
	log "#$number ($head) conflicts with $base; handed to @claude"
}

clear_flag() {
	gh api --method DELETE "repos/$repo/issues/$1/labels/$label" >/dev/null 2>&1 || true
}

case "$mode" in
main)
	gh api --paginate "repos/$repo/pulls?state=open&base=$base&per_page=100" \
		--jq '.[] | select(.head.repo.full_name == "'"$repo"'") | "\(.number) \(.head.ref)"' |
		while read -r number head; do
			if merges_cleanly "$head"; then
				log "#$number ($head) merges cleanly"
				clear_flag "$number"
			else
				flag "$number" "$head"
			fi
		done
	;;
pushed)
	[ -n "$pr" ] || { log "no PR given"; exit 2; }
	head="$(gh api "repos/$repo/pulls/$pr" --jq .head.ref)"
	if merges_cleanly "$head"; then
		clear_flag "$pr"
		log "#$pr ($head) merges cleanly"
	else
		log "#$pr ($head) still conflicts with $base"
	fi
	;;
*)
	echo "usage: conflicts.sh main | pushed <pr>" >&2
	exit 2
	;;
esac
