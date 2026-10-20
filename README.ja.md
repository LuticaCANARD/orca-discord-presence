# Orca Discord Presence

[English](README.md) · [한국어](README.ko.md) · **日本語** · [简体中文](README.zh-CN.md)

[Orca](https://github.com/stablyai/orca) のエージェント群（フリート）が何をしているかを、Orca のロゴと並べて Discord のステータスに公開する。

```text
┌──────┐  Orca                                                    ← minimal (default)
│ logo │  2 agents working · 1 blocked · across 2 worktrees   (3 of 5)
└──────┘  12:40 elapsed

┌──────┐  Orca · checkout-service · feat/ipc                      ← full
│ logo │  2 agents working · 1 wrapping up · in checkout-service, web   (3 of 5)
└──────┘  12:40 elapsed
```

1 行目は **ヘッダー** で、自由に設定できる。2 行目は [フリート](#フリート行) で、末尾には Discord 自身のパーティーゲージが付く。これは Orca が通知したエージェントのうち稼働中のものの数である。タイマーが計るのは [現在の作業区間](#経過タイマー) であり、Orca を開いている時間ではない。

TypeScript 製で、実行時の依存関係はない。Discord Rich Presence の IPC プロトコルを `node:net` 上で直接話す。

## 要件

- プラグインシステムを有効にした Orca `>= 1.4.0`（Settings → Plugins）。最後に検証したのは Orca `1.4.230`。[互換性](#互換性) を参照
- 同じマシン上で動作している Discord **デスクトップ** アプリ（Web クライアントはローカル IPC ソケットを公開しない）

それ以外は何も要らない。プラグインには Discord アプリケーション ID が同梱されており、エージェントが何か動き出した時点で公開を始める。

## インストール

Settings → Plugins → *Add marketplace* を開き、URL を貼り付けて同意ダイアログを承認する。

```text
https://github.com/LuticaCANARD/orca-discord-presence.git#v0.3.1
```

`#v0.3.1` は重要である。これがないと Orca は `main` からインデックスを読み、`main` は動き続ける。ダイアログには後述の [権限](#要求する権限) が一覧表示される。プラグイン自体に手を入れたい場合は [開発](#開発) を参照。

## 公開される内容

ここに設定項目はない。カードに何が表示されるか、そしてその理由である。

### フリート行

エージェントは `working`、`blocked`、`waiting` のいずれかである間、稼働中として数えられる。Orca は後ろの 2 つを同じように表示する（「エージェントがユーザーの対応を必要としている」）。そのため権限確認で止まっているフリートはアイドル扱いにならずタイマーが進み続ける。また、詰まっていることと尋ねていることは別の知らせなので、それぞれに独自の区分が与えられる。

`working` は Orca の **合成** 状態であり、この語には隠れた事情がある。ペインはメインエージェント *または生存中のサブエージェントのいずれか* が動いている間 `working` と表示されるので、サブエージェントが動き続けている限り、作業を終えたエージェントも数えられてしまう。ホストは現在、合成状態と並べてメインエージェント自身の状態も報告するため、そうしたペインは `1 wrapping up` として分離され、working の数から差し引かれる。working のペインが 3 つあり、そのうち 1 つがサブエージェントの残り作業であれば、4 エージェントではなく `2 agents working · 1 wrapping up` と表示される。メインエージェントの情報を送らないホストではどちらとも言えないため、そのペインは通常の working エージェントのままとなる。

*不調に終わった* ターンは意図的に表示しない。ホストはメインエージェントが最後に終えたターンの判定（`failure`、確認済みの `interruption`、誰かが要求した `cancellation`）を報告するが、公開プロフィール上の失敗数は、ニュースでなくなって数分後にはただのノイズである。代わりに **Show Connection Status**（接続状態の表示）が、対処できる場所で最近の失敗を報告する。

### 経過タイマー

タイマーは、フリートの現在の作業区間が始まった時点から数える。その答えは 2 通りあり、ホストのほうが優れている。`mainAgent.stateStartedAt` はエージェント自身の状態が始まった時点で記録されるのに対し、このプラグインに分かるのは自分が *気付いた* 時点だけである。この差こそが肝心な場面である。Orca はアイドル状態のプラグインワーカーを 5 分で回収し、次のイベントで再起動する。また、エージェントがすでに動いている最中にプラグインが有効化されることもある。ホストのタイムスタンプはどちらの場合も生き残るが、ローカルで観測したものは時計をゼロからやり直してしまう。

したがって、まだ稼働中のエージェントのうち最も早いもの自身のタイムスタンプが採用され、ローカルの観測値はフォールバックとなる。残り作業中（wrapping up）にすぎないペインは基準にならない。そのタイムスタンプはメインエージェントが `done` になった時点を示すもので、サブエージェントが仕上げている作業の開始時点ではないからである。タイムスタンプはエージェントが動いているマシン（SSH ホストならこのマシンではない）で記録されるため、1 分以上未来の値や 1 日以上古い値は、未来からカウントダウンするタイマーとして公開する代わりに破棄される。タイマーがどちらを使っているかは **Show Connection Status** が示す。

### パーティーゲージ

Discord はステータス行の横に `(3 of 5)` を表示する。これは、Orca がステータスを報告したペインのうち稼働中のエージェントの数である。名前を含まないので `full` と `minimal` のどちらでも公開され、何も稼働していないときは消える。`(0 of 5)` はアイドルなフリートではなく壊れたパーティーのように見えるからである。一緒に送られるパーティー ID はワーカーごとにランダムで、参加はできない。Rich Presence がプロフィールに **Join** ボタンを出すには参加用シークレットが必要だが、このプラグインはそれを決して送らない。

## プライバシー

**既定値は `minimal` であり、これは意図的である。** ブランチ名にはチケット ID や顧客名がよく含まれる。プラグインを有効にした瞬間にそれらを公開するステータスは、悪い既定値である。

| レベル | 公開される内容 |
| --- | --- |
| `full` | ヘッダー、フォーカス中のワークスペース、ブランチ、エージェント数、エージェントが作業しているワークスペース |
| `minimal` *（既定）* | ヘッダーとエージェント数。稼働中のワークツリーは数えるだけで名前は出さない。ヘッダー内の `{workspace}` と `{branch}` は空になる |
| `off` | 何も公開しない。ステータスは消去される |

レベルは **Cycle Privacy Level**（プライバシーレベルの切り替え）コマンドで順に切り替える。`minimal` のマスキングは慣習ではない。そのレベルではプロジェクト名、ブランチ名、ワークスペース名がペイロードに一切届かないことをテストで検証している。

ワークスペース名はワークツリーのディレクトリ名から取り、なければブランチ名を使う。名前を付けられるのは、プラグインの動作中に Orca が通知したワークツリーだけである。そのため `full` のステータスは空になる代わりに `across 2 worktrees` へと縮退し、長いリストは `in api, cli, docs +2` のようにまとめられる。

## コマンド

| コマンド | 効果 |
| --- | --- |
| `Discord Presence: Toggle` | 公開の有効／無効を切り替える |
| `Discord Presence: Cycle Privacy Level` | コマンドの引数でレベルを設定する。引数がなければ `full` → `minimal` → `off` → … と順に切り替える |
| `Discord Presence: Set Header` | コマンドの引数で 1 行目を設定する。引数がなければプリセットを順に切り替える |
| `Discord Presence: Reconnect` | Discord との接続を切り、すぐに再公開する |
| `Discord Presence: Show Connection Status` | 公開中の内容、ロゴとバッジのキー、最近不調に終わったターン、接続状態、ソケットパス、最後のエラー |

すべて設定として保存される。何かおかしいときに最初に使うべきは **Show Connection Status** である。直前の公開が失敗した理由を報告してくれる。

**Reconnect**（再接続）は、バックオフでは対処できない場合のためのものである。Discord が Orca より後に起動した場合や、フリートが静かな間に Discord が再起動した場合がそれにあたる。プラグインは自分で再試行するが、それはワーカーが生きている間だけであり、Orca はアイドル状態のワーカーを 5 分で回収する（[既知の制限](#既知の制限) を参照）。コマンドを実行するとワーカーが再起動され、*さらに* その新しいワーカーがすぐに接続する。

### ショートカット

すべてのコマンドは **Settings → Shortcuts → Plugins** に表示され、よく使うものにキーの組み合わせを記録できる。`Toggle` と `Cycle Privacy Level` が有力な候補であろう。

**プラグインは既定のキー割り当てを意図的に同梱していない。** マニフェストのキーバインディングは Orca にとって *命令的なコンテンツ* である。それを宣言すると利用者の同意がプラグインのファイルツリーに結び付けられるため、リリースのたびに Settings → Plugins で *Needs review* として届くことになる。さらに、他のプラグインのキー割り当てと衝突すると **両方の** プラグインのコマンドが無効になる。自分で記録したショートカットは上書き設定なので、アップデート後も残り、どちらのコストもかからない。

## 設定

すべての設定には動作する既定値がある。この節はそれを変更したい場合のためのものである。

### ヘッダー

テキストエディタを使わずに済む手段が **Set Header**（ヘッダーの設定）コマンドである。

- **引数あり** — 引数がそのままヘッダーになるので、キーバインディングや自動化からヘッダーを直接設定できる。`"My Fleet"` または `{ "header": "My Fleet" }`。空文字列はヘッダーを非表示にする。
- **引数なし** — プリセットを順に切り替える。コマンドパレット単体で操作できるのはこれだけである。

  `Orca` → `{workspace}` → `{workspace} · {branch}` → *非表示* → `Orca` → …

`{workspace}` と `{branch}` は設定に固定されるのではなく公開時に解決される。この違いこそが要点である。`checkout-service` というヘッダーは `minimal` に下げた後もその名前を公開し続けるが、`{workspace}` なら空になって `Orca` にフォールバックする。何にも解決されなかったトークンは区切り文字ごと消えるので、行末に中黒が残ることはない。

### ロゴとバッジ

`largeImage` はファイルパスではなく **アートアセットのキー** である。Discord は、プレゼンスの公開に使われているアプリケーションにアップロードされた画像を表示する。同梱のアプリケーションは Orca のロゴを `orca` というキーでホストしているため、ロゴの設定は不要である。

`clientId` を自分のアプリケーションに向けると、そうはいかなくなる。そこでは、その名前で画像をアップロードするまで `orca` というキーは何の意味も持たない。ロゴを `orca` としてアップロードするか、使ったキーを `largeImage` に設定すること。

`smallImage` はロゴの隅に付くバッジで、**既定ではオフ** である。同梱のアプリケーションは `orca` 以外のキーで画像をホストしていないので、既定値を設けると空の四角が公開されてしまう。自分のアプリケーションにバッジをアップロードし、そのキーを指定すれば有効になる。土台となるロゴがないバッジは、単独で公開されずに破棄される。

### 自分の Discord アプリケーションで公開する

ヘッダーの *上* の行は *"Playing \<application name\>"* と表示される。この名前はこのプラグインではなく Discord アプリケーションのものであり、Rich Presence IPC にはそれを指定するフィールドがない。`header` が存在するのはそのためで、プラグインが制御できる最上段の行である。*"Playing …"* の行そのものを変えたい場合は、自分のアプリケーションを通じて公開する。

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. ステータスに表示したい名前を付ける
3. *General Information* の **Application ID** をコピーして `clientId` に設定する
4. *Rich Presence → Art Assets* に画像をアップロードし、そのキーを `largeImage` に設定する

Rich Presence のアプリケーション ID は公開された識別子である。すべてのクライアントの IPC 通信に含まれており、それ単体では何の権限も与えない。秘匿すべきなのは OAuth のクライアントシークレットのほうだが、Rich Presence はそれを必要とせず、このプラグインも決して要求しない。ソースコードに ID を同梱しているのはこのためである。

### 設定ファイル

Orca にはまだプラグインごとの設定 UI がないため、コマンドで扱えないものは手で書く。

| プラットフォーム | パス |
| --- | --- |
| Linux | `~/.config/Orca/plugins-data/lutica-canard.discord-presence/settings.json` |
| macOS | `~/Library/Application Support/Orca/plugins-data/lutica-canard.discord-presence/settings.json` |
| Windows | `%APPDATA%\Orca\plugins-data\lutica-canard.discord-presence\settings.json` |

```json
{
  "enabled": true,
  "privacy": "minimal",
  "clientId": "1234567890123456789",
  "header": "Orca",
  "largeImage": "orca",
  "largeText": "Orca",
  "smallImage": "",
  "smallText": ""
}
```

| キー | 既定値 | 効果 |
| --- | --- | --- |
| `enabled` | `true` | 公開するかどうか |
| `privacy` | `"minimal"` | [プライバシー](#プライバシー) を参照 |
| `clientId` | 同梱の ID | 公開に使う Discord アプリケーション |
| `header` | `"Orca"` | 1 行目。`{workspace}` と `{branch}` を使える。`""` で非表示 |
| `largeImage` | `"orca"` | ロゴのアートアセットキー。`""` で画像を公開しない |
| `largeText` | `"Orca"` | ロゴにマウスを重ねたときのツールチップ |
| `smallImage` | `""` *（オフ）* | ロゴの隅に付くバッジのアートアセットキー |
| `smallText` | `""` | バッジにマウスを重ねたときのツールチップ |

どのキーも省略でき、`""` は *既定値* ではなく *オフ* を意味する。ファイルを反映させるには、Orca を再起動するか、プラグインを無効にしてから再び有効にする。

## 要求する権限

| 権限 | 理由 |
| --- | --- |
| `workspace:read` | `full` プライバシー用の、フォーカス中のワークスペース名とブランチ |
| `events:subscribe` | ワークツリーのライフサイクルとエージェントの状態変化。公開するデータそのもの |
| `storage` | フリートの状態をワーカーの回収後も保持する（後述） |
| `settings:own` | プラグイン自身の `enabled` / `privacy` / `clientId` / `header` / 画像キー |
| `notifications:show` | コマンドへのフィードバック |

`secrets` と `terminal:send` は意図的に **要求していない**。

## 互換性

2026-10-20 に、最新の安定版デスクトップリリース [`v1.4.230`](https://github.com/stablyai/orca/releases/tag/v1.4.230) と、`912c130` 時点の Orca `main` に対して確認した（`main` 自身のパッケージバージョンは `1.4.214` となっている。リリース系列と `main` はそれぞれ別に番号を振っているので、意味のある比較はその番号ではなくソースの同一性である）。

`v1.4.192` のチェックポイント以降、プラグインに影響する変更が 1 件リリースに入っており、このバージョンはそれを前提に作られている。

- **`plugin-events.ts` — `agent.status.changed` に `mainAgent` が追加された。** このイベントの `state` は以前から Orca の *合成* 状態であり、`working` にはメインエージェントがすでに落ち着いた後も生きているサブエージェントが含まれる。新しい省略可能な `mainAgent` は、メインエージェント自身の `state`、最後に終えたターンの `outcome`、ホストが記録した `stateStartedAt` を運ぶ。このプラグインは現在この 3 つすべてを使っている。[フリート行](#フリート行) と [経過タイマー](#経過タイマー) を参照。

それ以外に変わったものはリファクタリングであり、読んだうえで無害と判断した。

- **`plugin-manifest.ts`** — `isQualifiedPluginKey`、`pluginPanelTabKey`、`isPluginPanelTabKey` が新しい `plugin-tab-key.ts` に移動し、再エクスポートされている（リリース済み）。`main` ではさらに、スキーマオブジェクトに `pluginManifestV1Object` という名前が付き、`contributes` の既定値が手書きのリテラルではなく `prefault({})` で与えられるようになった。中身は同じ 7 つの空配列であり、このプラグインのように `contributes` を自分で宣言しているマニフェストには何の影響もない。
- **`plugin-marketplace.ts`**（`main` のみ） — フィールドのマップが切り出され、カテゴリ重複と ID 重複の検査に名前が付いた。ルールは同じである。

どちらもフィールド名の変更や検証内容の変更はないが、どちらも下準備のように読める。明示的に *V1* と名付けられたスキーマオブジェクトと、ファイル名でパラメータ化されたマーケットプレイスの読み込み処理である。

Orca はペインごとに把握する情報を増やし続けている。`main` はステータス行に `programStatus` という要素（プログラム自身の OSC 7501 による進捗、メッセージ、ブロック）を追加した。しかしプラグイン向けの射影は変わっていないので、そのどれも `agent.status.changed` には届かない。4 つのフィールドと `mainAgent` が、依然としてイベントのすべてである。

エンジンの下限は `>=1.4.0` のままである。どの契約も追加的であり、`mainAgent` は省略可能なので、それを送らないホストでもプラグインは以前とまったく同じように動作する。

上流を読み直し、変化がないことを確認したもの。これらが `src/lib/orca-api.mts` に書き写している契約である。

| 上流の契約 | 状態 |
| --- | --- |
| Host API v0 のメソッド表（`plugin-host-api.ts`） | 13 メソッド、すべて依然 `experimental`。`workspace.readContext` は依然として `{ branch, displayName, terminals }` を返す |
| イベント集合（`plugin-events.ts`） | 依然としてワークツリー／エージェントの 3 イベントのみで、フォーカス変更イベントはない。`agent.status.changed` は省略可能な `mainAgent` も運ぶようになった |
| 権限の種類（`plugin-capabilities.ts`） | 依然としてスコープなしの 7 種類。`net:*` は依然としてない |
| エージェントの状態（`agent-status-types.ts`） | 依然として `working` / `blocked` / `waiting` / `done`。行の豊富な内部情報のうち、プラグインのイベントペイロードに届くのは `mainAgent` だけ |
| ワーカーの環境（`plugin-worker-env.ts`） | 依然として `XDG_RUNTIME_DIR` を含まない許可リスト |
| アイドル時の回収（`plugin-host-protocol.ts`） | 依然として 5 分 |
| 設定とストレージの場所 | 依然として `<userData>/plugins-data/<publisher>.<id>/` |
| マニフェストとマーケットプレイスのスキーマ | スキーマは変更なし（`plugin-manifest.ts` の変化はヘルパーの移動）。`commands[].context` はここで宣言している |

`orca-compatibility.json` には、確認済みの Git blob ID が記録されている。読み取り専用の **Orca compatibility** ワークフローは、毎週月曜日に最新の安定版リリースと `main` を確認する。新しい安定版が出たとき（ファイルに変化がなくても）や、どちらかの参照で契約が変化したときに失敗し、この節と手書きの API 型の見直しを強制する。同じ確認は `npm run check:orca-compatibility` でローカルでも実行できる（公開 GitHub API へのネットワークアクセスが必要）。

`main` はリリースより数週間先行しているため、ファイルが `main` で変更されたまま、リリースされるまで長い間そのままになることがある。そうした未リリースのオブジェクト ID は、読んだ後に `verifiedMain` に入れる。すると確認はそれについては黙っているが、`main` がその先へ進んだ瞬間に失敗し、`main` がリリース済みの ID に戻ったときにはその上書きを不要として指摘する。誰も消さない上書きは、次にそのパスに入ってくるものを何であれ見逃し続けてしまうからである。

マニフェストに含められるが、意図的に含めていない貢献（contribution）の種類：

- **`keybindings`** — [ショートカット](#ショートカット) を参照。
- **`panels`** — サンドボックス化されたパネルが呼べるのは `workspace.readContext`、`terminal.sendText`、`notifications.show` だけである。プラグインのストレージと設定はワーカー専用なので、プレゼンス用のパネルはプラグインが何を公開しているかを読めない。まだ表示するものがない。
- **`languagePacks`、`vmRecipes`、`agents`** — 別の種類のプラグイン向けのコンテンツパック。
- **`icon`** — ホストは検証するが、プラグイン一覧にはまだどこにも表示されない。

## 既知の制限

**ステータスは設計上、一時的なものである。** Orca は、処理中の作業がないまま 5 分経ったプラグインワーカーを回収し（`PLUGIN_WORKER_IDLE_REAP_MS`）、次のイベントで再起動する。ワーカーは自分自身を生かし続けることができず、アイドル時計をリセットするのはホストからワーカーへの通信だけである。そのためプレゼンスはフリートが活動している間に現れ、静かな時間が数分続くと消え、次のエージェントイベントで戻ってくる。フリートの状態はプラグインストレージに保存されるので、その間に何かが失われることはない。また、6 時間より古いステータスは、まだ有効であるかのように復元されることなく破棄される。

**フォーカス中のワークスペースは通知ではなくポーリングで取得する。** Orca はフォーカス変更イベントを出さないので、`full` プライバシーではワークスペースとブランチを 30 秒ごとに更新して再公開する。**Show Connection Status** と **Reconnect** はそれを即座に更新する。

**コマンド引数はホスト次第である。** Orca が引数を渡してくれれば、**Set Header** は文字列または `{ header }` を、**Cycle Privacy Level** はレベルまたは `{ privacy }` を受け付ける。`1.4.192` の時点では、それを渡すホスト側の経路は存在しない。IPC は引数を運べるにもかかわらず、パレットも記録されたショートカットも引数なしでコマンドを呼び出す。それが変わるまでは順送りの切り替えが唯一の操作手段であり、自由なヘッダーは設定ファイルに書くことになる。

**作業開始のタイムスタンプはエージェント自身のホストから来る。** `mainAgent.stateStartedAt` はエージェントが動いているマシンで記録されるので、時計がずれた SSH ホストは Discord のタイマーを狂わせうる。このマシンより 1 分以上進んでいる、または 1 日以上古いタイムスタンプは退けられ、ローカルで観測した時点が代わりに使われる。それより小さいずれの時計は、ずれた分だけ経過表示をずらす。

**Linux のソケット探索はヒューリスティックである。** Orca のワーカー環境は `XDG_RUNTIME_DIR` を含まない許可リストなので、`/run/user/<uid>` を `process.getuid()` から組み立て直している。Flatpak と Snap の配置も探索する。

**プラグイン API は上流で EXPERIMENTAL である。** Orca 自身のドキュメントは、`pluginApi` v1 が固まるまで互換性を一切約束していない。現在ローカルソケットを開けるのは、権限モデルにまだ `net:*` という種類がないからにすぎない。ソースにはスコープ付きの種類が計画されていると記されている。将来の Orca がこれを制限すれば、このプラグインが動き続けるには権限の宣言が必要になる。

**Discord は `SET_ACTIVITY` にレート制限をかける。** 更新はデバウンスされ（1.5 秒）、公開と公開の間には最低 4 秒を空け、同一のペイロードは送信自体を省く。

**ワーカー自身のログは Settings にある。** **Show Connection Status** で足りないときは、Settings → Plugins → *View logs* でワーカーが記録した内容を見られる。接続失敗、権限の拒否、退けられたイベントはすべてそこに残る。

## 開発

```bash
git clone https://github.com/LuticaCANARD/orca-discord-presence.git
cd orca-discord-presence
npm install
npm run build      # tsc → dist/
npm test           # build + node --test (99 tests)
npm run typecheck  # no emit
```

Settings → Plugins → *Add development plugin* でチェックアウトしたディレクトリを選ぶと、Orca に読み込まれる。

```text
orca-plugin.json            manifest (validated against the host schema by a test)
orca-marketplace.json       marketplace index — lets this repo be its own source
orca-compatibility.json     reviewed Orca release and plugin-contract object ids
scripts/check-orca-compatibility.mjs
                            latest-release and main contract drift check
src/main.mts                worker entry: activate/deactivate, commands, events
src/lib/orca-api.mts        hand-maintained types for Orca's plugin worker API
src/lib/presence-model.mts  pure state model — events in, activity payload out
src/lib/discord-ipc.mts     Rich Presence IPC client over node:net
src/lib/socket-path.mts     socket discovery across platforms and sandboxes
orca-compatibility.json     reviewed upstream blob ids — the baseline the weekly check compares against
scripts/check-orca-compatibility.mjs  the check itself (also runs as a workflow)
.github/actions/verify-build  the gates, shared by CI and both release paths
.github/workflows/          CI, tag-and-release, release, orca-compatibility
```

インストールされるツリーはハッシュ化され、2,000 ファイル・50 MiB が上限である。このリポジトリはそれに達する心配はまったくないが、コンパイル済みの出力がその中に含まれて配布されるので、知っておく価値はある。

`dist/` **は意図的にコミットしている。** Orca はプラグインのディレクトリをホスト側でビルドせずにそのままインストールするので、コンパイル済みのエントリがリポジトリに含まれていなければならない。`dist/` と `src/` が一致しないと CI のビルドが失敗する。

Orca はプラグイン作者向けの型パッケージを提供していないので、`src/lib/orca-api.mts` がホストの契約（`plugin-host-api.ts`、`plugin-events.ts`、`plugin-capabilities.ts`）を書き写している。Orca をアップグレードした後にそこで型エラーが出たら、それは本物の兆候である。キャストで消す前に内容を読むこと。

### リリースの作成

**バージョンを上げることがリリースである。** バージョンは次の 4 か所に書かれており、食い違うとテストが失敗する。

1. `package.json` → `version`
2. `orca-plugin.json` → `version`
3. `orca-marketplace.json` → `plugins[].source.ref`（`v<version>` の形式）
4. `README.md` とその翻訳（`README.ko.md`、`README.ja.md`、`README.zh-CN.md`） → インストール URL の `#v<version>` フラグメント

`npm run build` を実行し、変更したファイルをすべてコミットして `main` にマージする。すると **Tag and release** がマニフェストのバージョンを読み、そのタグがすでにあれば止まり、ゲートを実行し、その後で初めてタグを作成してリリースを公開する。したがって、タグが自身の検査に落ちたツリーを指すことはなく、手元のマシンからタグが打たれることもない。`0.4.0-rc.1` のようなバージョンはプレリリースとして公開される。

従来の手順も引き続き使える。`v*` タグを自分でプッシュすると、**Release** がそれをマニフェストと照合して公開する。これは古いコミットからリリースを作り直すときに使うもので、通常のリリースには使わない。

| ワークフロー | トリガー | 処理 |
| --- | --- | --- |
| **CI** | `main` へのすべてのプッシュ、すべての PR | ゲート |
| **Tag and release** | `main` へのプッシュ | まだタグのないバージョンにタグを付けて公開する |
| **Release** | 手でプッシュした `v*` タグ | タグをマニフェストと照合して公開する |
| **Orca compatibility** | 毎週月曜日、または手動 | 上流を読み、未確認のものがあれば失敗する |

ゲート自体（型チェック、ビルド、`src/` と一致する `dist/`、テスト）は `.github/actions/verify-build` に一か所だけ置かれており、3 つの経路のどれもが他から気付かれないままずれていくことはない。

マーケットプレイスの掲載は `main` ではなく **リリースタグ** を固定している。ブランチ参照だと、次にマーケットプレイスが更新されたときにその時点の HEAD へと解決し直され、利用者を気付かないうちに未リリースのコミットへ移してしまう。参照がタグであり、マニフェストのバージョンと一致することはテストで強制している。

## ライセンス

MIT
