```zsh
npm init -y
npm i typescript @types/node --save-dev
npx tsc --init
```

packages/sinan-core
```zsh
npm init -w ./packages/sinan-core -y
```

apps/server
```zsh
npm init -w ./apps/sinan-server -y
npm i @earendil-works/pi-agent-core @earendil-works/pi-ai @earendil-works/pi-coding-agent -w sinan-server
```

apps/web
```zsh
npm init -w ./apps/sinan-web -y
```


sqlite visible

```shell
brew install litecli
```
