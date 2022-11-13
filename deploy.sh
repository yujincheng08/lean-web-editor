set -e # fail on error
set -x # echo commands

LATEST_BROWSER_LEAN_URL=https://github.com/leanprover-community/lean/releases/download/v$LATEST_BROWSER_LEAN/lean-$LATEST_BROWSER_LEAN--browser.zip

rm -f dist/*.worker.js
npm install
NODE_ENV=production ./node_modules/.bin/webpack
cd dist
curl -sL $LATEST_BROWSER_LEAN_URL --output leanbrowser.zip
unzip -q leanbrowser.zip
rm leanbrowser.zip
mv build/shell/* .
rm -rf build/
cd ..
