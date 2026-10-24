#!/bin/zsh
# 把 prototype 拷进 assets/www（去掉 Google Fonts，换本地字体），再打 debug APK
set -e
cd "$(dirname "$0")"
WWW=app/src/main/assets/www
rm -rf $WWW && mkdir -p $WWW
cp ../prototype/{index.html,style.css,snapshot.js,core.js,dir-paper.js,dir-signal.js,dir-deck.js,listen.js,translate.js,main.js} $WWW/
cp fonts/fonts.css fonts/jetbrains-mono-latin.woff2 $WWW/
python3 - "$WWW/index.html" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
s = re.sub(r'\s*<link rel="preconnect"[^>]*>', '', s)
s = re.sub(r'\s*<link href="https://fonts.googleapis.com[^>]*>', '', s)
s = s.replace('<link rel="stylesheet" href="style.css">', '<link rel="stylesheet" href="fonts.css">\n<link rel="stylesheet" href="style.css">')
s = s.replace('<html lang="zh-CN">', '<html lang="zh-CN" class="app">')
open(p, 'w').write(s)
PY
./gradlew --offline -q assembleDebug "$@"
V=$(grep versionName app/build.gradle.kts | sed -E 's/.*"(.*)".*/\1/')
cp app/build/outputs/apk/debug/app-debug.apk "AI热点-安卓原生版-v$V.apk"
echo "APK: $(pwd)/AI热点-安卓原生版-v$V.apk"
