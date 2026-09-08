#!/bin/sh
# Have the vendored Delver format files drifted from grimoire's?
#
# Each file here is a verbatim copy of js/<name> in ratlizard/grimoire, which
# is where the format work and its checks live. These four run inside the
# player, so the comparison is of the whole file rather than of a recorded
# hash: an edit made here would make the player read the format differently
# from the tool that proves it, and that is the failure worth catching.
#
# Skips, with status 0, when grimoire is not checked out beside this
# repository -- there is nothing to compare against, which is not a failure.
# COPIES.txt still records which version was taken.
set -u
here=$(cd "$(dirname "$0")" && pwd)
# Grimoire is a sibling of this repository's root, and this script sits two
# directories down from it. Both depths are tried because this tree has moved
# once already (it was alchemy/web/ until 8 September 2026) and a wrong depth
# makes the check skip rather than fail, which is the one outcome worth
# designing against here: silence that reads as a pass.
src=""
for cand in "$here/../../../grimoire/js" "$here/../../../../grimoire/js"; do
  [ -d "$cand" ] && { src="$cand"; break; }
done

if [ -z "$src" ]; then
  echo "skip: grimoire is not checked out beside this repository"
  exit 0
fi

fails=0
for name in mac-bytes.js mac-containers.js mac-stuffit.js delv-archive.js; do
  if [ ! -f "$src/$name" ]; then
    echo "FAIL $name: gone from grimoire"; fails=$((fails + 1)); continue
  fi
  if cmp -s "$src/$name" "$here/$name"; then
    echo "  ok  $name"
  else
    echo "FAIL $name: this copy and grimoire's differ"
    echo "      re-copy from grimoire, or move the change there first:"
    echo "      cp $src/$name $here/$name"
    fails=$((fails + 1))
  fi
done

if [ "$fails" -ne 0 ]; then
  echo "$fails file(s) drifted"
  exit 1
fi
echo "all four match grimoire"
