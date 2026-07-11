# Scratch sb3 Vault

Solid Pod（分散型ストレージ）に `.sb3` を保存し、Nostrで「公開しました」というイベントを
リレーに流し、ホームページで最新プロジェクト一覧を表示、TurboWarpでその場実行できる
静的サイトです。ビルド不要・GitHub Pagesにそのまま置くだけで動きます。

## 仕組み

1. **Solid Podへログイン**（Inrupt社の `solid-client-authn-browser` を使用）
   - お使いのSolid Pod（例: solidcommunity.net, inrupt.net など）のIdentity Provider URLを入力してログイン
2. **`.sb3` をアップロード**すると、Pod内の `scratch-sb3-vault/` フォルダに保存され、
   ランダムな **Project ID**（UUID）が発行されます
3. **「Nostrに公開」** を押すと、以下を含む Nostr イベント（kind `31337`、`d`タグ=Project ID）
   がリレーに送信されます:
   - タイトル
   - Project ID
   - Pod上の公開URL
4. ホーム画面は起動時にリレーへ問い合わせ、`d`タグごとに最新のイベントだけを集めて
   **最新プロジェクト一覧** を表示します
5. 一覧から「▶ 実行」を押すと、`https://turbowarp.org/?project_url=<sb3のURL>` を
   iframeで読み込み、その場で実行されます。URLに `?p=<projectId>` が付くので、
   このURLをそのまま人に共有すれば該当プロジェクトが自動再生されます

## 重要: PodのACL設定について

TurboWarpや他の人のブラウザから `.sb3` を直接ダウンロードできる必要があるため、
保存先フォルダ（`scratch-sb3-vault/`）は **公開読み取り可**（CORS: `Access-Control-Allow-Origin: *`
に対応）にする必要があります。多くのSolid Podプロバイダでは、Podの管理画面や
`.acl` ファイル編集でフォルダ単位の公開設定ができます。設定方法はPodプロバイダに
よって異なるため、お使いのPodのドキュメントを参照してください。

非公開のままだとTurboWarp側からファイルを取得できず、実行時にエラーになります。

## Nostrの鍵について

- ブラウザ拡張機能（[nos2x](https://github.com/fiatjaf/nos2x) など、NIP-07対応）が
  入っていれば自動的にそちらを使って署名します
- 入っていない場合は、ローカル（`localStorage`）に鍵ペアを自動生成して使用します。
  この鍵は端末・ブラウザ内にしか保存されないため、他の端末からは同じ公開鍵で
  投稿できません。本格的に使う場合は拡張機能の利用を推奨します

## GitHub Pagesへのデプロイ

このフォルダの中身（`index.html`, `404.html`, `style.css`, `app.js`）を
リポジトリのルート（または `docs/` フォルダ）に置き、GitHub Pagesを有効化するだけです。

- ルート直下で公開する場合、`404.html` 内の `segmentCount` は `0` のままでOKです
- `https://<user>.github.io/<repo>/` のようにサブパスで公開する場合、
  ルート直下に置くなら基本設定のままで動作します（リポジトリ名フォルダごと公開されるため）

## 使用ライブラリ（すべてCDN経由・ビルド不要）

- [`@inrupt/solid-client-authn-browser`](https://docs.inrupt.com/) — Solidログイン
- [`@inrupt/solid-client`](https://docs.inrupt.com/) — Podへのファイル保存
- [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools) — Nostrイベントの作成・送受信
- [TurboWarp](https://turbowarp.org/) — `.sb3` の実行（`?project_url=` パラメータ経由）

## カスタマイズ

- `app.js` 冒頭の `RELAYS` 配列で使用するNostrリレーを変更できます
- `NOSTR_KIND` はデフォルトで `31337`（パラメータ化可能置換イベント）を使用しています。
  他のクライアントと衝突しないよう独自のkind番号に変えても構いません
- `CONTAINER_NAME` でPod内の保存先フォルダ名を変更できます
