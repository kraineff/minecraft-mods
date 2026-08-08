#!/usr/bin/env bash
# Полностью пересобирает галерею Modrinth из screenshots/: удаляет всё, что
# там сейчас есть, и заливает заново текущие файлы. Проще, чем сравнивать
# хеши и решать add/update по отдельности, и даёт тот же результат: новый
# скриншот появится, а изменённый — заменит старый.
set -euo pipefail

: "${MODRINTH_TOKEN:?MODRINTH_TOKEN не задан}"

project=stallium
api="https://api.modrinth.com/v2/project/$project"

# Порядок, подписи и featured — источник истины для галереи; те же файлы,
# что и в README (см. секцию скриншотов).
files=(field.png field-shift.png baby-shift.png riding.png)
titles=(
	"Stat labels in the world"
	"Exact numbers (Shift)"
	"Foal growth timer"
	"Riding HUD"
)
descriptions=(
	"Speed, jump height and health above each horse; the best one nearby is outlined in gold"
	"Hold Shift to see exact values after the bars"
	"Growth timer shown next to a foal's stats"
	"Your mount's stats above the hotbar while riding"
)

uri_encode() {
	jq -rn --arg v "$1" '$v|@uri'
}

echo "Removing existing gallery images..."
existing_urls=$(curl -sf "$api" | jq -r '.gallery[].url')
while IFS= read -r url; do
	[ -z "$url" ] && continue
	curl -sf -X DELETE "$api/gallery?url=$(uri_encode "$url")" \
		-H "Authorization: $MODRINTH_TOKEN"
	echo "Deleted: $url"
done <<<"$existing_urls"

echo "Uploading current screenshots..."
for i in "${!files[@]}"; do
	file="screenshots/${files[$i]}"
	[ -f "$file" ] || { echo "Missing file: $file" >&2; exit 1; }

	featured=false
	[ "$i" -eq 0 ] && featured=true

	curl -sf -X POST \
		"$api/gallery?ext=png&featured=$featured&ordering=$i&title=$(uri_encode "${titles[$i]}")&description=$(uri_encode "${descriptions[$i]}")" \
		-H "Authorization: $MODRINTH_TOKEN" \
		--data-binary "@$file"
	echo "Uploaded: $file"
done

echo "Gallery synced."
