#!/bin/sh
set -eu

destination="${1:-../../data/jeopardy/clues.tsv}"
mkdir -p "$(dirname "$destination")"
temporary="${destination}.download"
url="https://raw.githubusercontent.com/jwolle1/jeopardy_clue_dataset/main/seasons/season42.tsv"

curl --fail --location --retry 3 --output "$temporary" "$url"
header=$(head -n 1 "$temporary")
case "$header" in
  round*) mv "$temporary" "$destination" ;;
  *) rm -f "$temporary"; echo "Downloaded file was not a clue TSV" >&2; exit 1 ;;
esac
echo "Clues saved to $destination"
