set -e # fail on error

git config --global pull.ff only
git config --global user.name "leanprover-community-bot"
git config --global user.email "leanprover-community@gmail.com"

git clone --branch gh-pages https://github.com/leanprover-community/lean-web-editor.git
cd lean-web-editor
git remote add deploy "https://$GITHUB_TOKEN@github.com/leanprover-community/lean-web-editor.git"
rm -f *.worker.js
cd ..

# After this point, we don't use any secrets in commands.
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

# push leanprover-community/lean-web-editor
cd lean-web-editor
git pull
cp -a ../dist/. .
git add -A
git diff-index HEAD
if [ "$github_repo" = "leanprover-community/lean-web-editor" ] && [ "$github_ref" = "refs/heads/master" ]; then
    git diff-index --quiet HEAD || { git commit -m "lean-web-editor: $(date)" && git push deploy || exit 1; }
fi
