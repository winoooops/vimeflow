# Vimeflow

> [!IMPORTANT]
> **Vimeflow は herdr ベースのターミナルへと移行中です。** 活発な開発は
> [herdr](https://github.com/herdrdev/herdr) の下流フォークである
> [**vimeflow-terminal**](https://github.com/winoooops/vimeflow-terminal) に移りました。本リポジトリで提供してきた機能は
> 順次フォーク側へ移植中で、エージェント識別レール（agent rail）とダイナミックアイランド
> （タブ操作・モーション・通知）はすでにフォーク側で稼働しています。**移植が完了するまで、
> 本リポジトリは更新を停止します**。この間、新機能は追加されません。ナイトリービルドは変更のないコードを引き続き公開します。移植完了後は、
> herdr ベースのフォークが Vimeflow のメインリポジトリを引き継ぐ予定です。進捗は
> [winoooops/vimeflow-terminal](https://github.com/winoooops/vimeflow-terminal) をご覧ください。

<div align="center">

<img src="build/icon.png" alt="Vimeflow ロゴ" width="128" />

**ターミナルか GUI か、どちらかで妥協する必要はありません。両方使って生産性を高め、フローを保ちましょう。**

エージェント CLI は本物のターミナルペインで動作し、GUI はその上に被せるのではなく、ターミナルを中心に設計されています。

[English](./README.md) | [简体中文](./README.zh-CN.md) | 日本語

<img src="docs/media/hero-workspace.gif" alt="デモプロジェクトでセッションを作成し、ネイティブ Ghostty ペインで Claude Code を起動して、エージェントパネルにトレースがストリーミングされる様子" width="900" />

</div>

Vimeflow は、Rust 製サイドカー（`vimeflow-backend`）を備えた Electron デスクトップアプリです。ひとつのウィンドウに、エージェント用ターミナル（macOS ではネイティブ Ghostty ペイン）、キーボード操作のマルチペインレイアウト、ファイルエクスプローラ、vim モード対応エディタ、hunk 単位の Git レビュー、vim スタイルのコマンドパレット、カスタマイズ可能なテーマ、そして Claude Code・Codex CLI・Kimi Code・OpenCode のライブ観測機能が揃っています。

## 目次

- [macOS のネイティブ Ghostty ターミナル](#macos-のネイティブ-ghostty-ターミナル)
- [ひとつのワークスペースに複数エージェント](#ひとつのワークスペースに複数エージェント)
- [中断したところから再開](#中断したところから再開)
- [hunk 単位で変更をレビュー](#hunk-単位で変更をレビュー)
- [Worktree 統合](#worktree-統合)
- [コマンドパレットと設定](#コマンドパレットと設定)
- [テーマ](#テーマ)
- [カーソルエフェクト](#カーソルエフェクト)
- [Linux](#linux)
- [現在のサポート範囲](#現在のサポート範囲)
- [ソースからビルドして実行](#ソースからビルドして実行)
- [プロジェクト参照](#プロジェクト参照)

## macOS のネイティブ Ghostty ターミナル

Vimeflow はブラウザ内でターミナルをエミュレートしません。macOS arm64 のパッケージ版は本物の Ghostty エンジン（`libghostty-spm`、親付けされた `NSView`）を組み込み、PTY の所有権は Rust サイドカーが保持します。その結果、Electron の中で Ghostty の GPU アクセラレーション描画が得られます。出力はストリーミングされたそばから描画され、リサイズ中もペインはティアリングや遅延なしに滑らかにリフローします。

<div align="center">
  <img src="docs/media/ghostty-resize.gif" alt="ターミナルがライブ描画されたまま Vimeflow のペイン分割線をドラッグする様子 — Ghostty がリサイズ中も滑らかに一貫して内容をリフローする" width="900" />
</div>

**フルスクリーン TUI をエージェントと並べて実行** — `nvim` や `lazygit` などのツールがエージェントセッションの隣で動作し、リサイズ時もきれいにリフローします。Linux と開発用フォールバックでは xterm.js を使用します。

<div align="center">
  <img src="docs/media/ghostty-tui.png" alt="エージェントセッションの隣で、ネイティブ Ghostty ターミナルペイン内にフルスクリーンで動作する Neovim" width="900" />
</div>

<sub><i>試してみる:<br>1. パッケージ版 macOS ビルドを起動するか、ソースから `npm run electron:dev:ghostty` を実行します。<br> 2. `⌘;` を押して `:layout` を実行し、2 ペインレイアウトを選択します。<br> 3. 片方のペインでエージェントを、もう片方で `nvim .` を起動します — どちらも本物の PTY です。</i></sub>

ターミナルの作業ディレクトリ同期は OSC 7 に依存します。`zsh` と `fish` は通常自動で発行しますが、`bash` の場合は次を実行してください:

```bash
./scripts/setup-shell-osc7.sh
```

## ひとつのワークスペースに複数エージェント

多くのコーディングエージェント CLI は、状態を 1 行のステータスラインで報告します。Vimeflow は代わりに各エージェントへ専用パネルを与えます — モデル、コンテキストウィンドウ、ライブトレースフィードを、CLI を起動するだけで自動検出し、ラッパーコマンドは不要です。トレースフィードは直近 50 件の完了したツール呼び出しを保持し、エージェントごとのプロファイル（Claude・Codex・Kimi・OpenCode それぞれ専用）に整理されます。作業ツリーを変更したトレースには **Show diff** ショートカットが付き、そのステップが行った変更へ直接ジャンプできます。

<div align="center">
  <img src="docs/media/multi-agent-grid.png" alt="Claude Code・Codex CLI・Kimi Code・OpenCode がそれぞれ専用ペインで動作し、エージェントステータスパネルが展開されている様子" width="900" />
</div>

<sub><i>試してみる:<br>1. サイドバーの **+** をクリックします — New Session ダイアログでセッション名、作業ディレクトリ、必要なら同時に起動するエージェントコマンドを指定できます。<br> 2. `⌘;` を押して `:layout` を実行し、マルチペイン配置を選択します。<br> 3. 任意のペインで `claude`、`codex`、`kimi`、`opencode` を実行します — 起動と同時にステータスパネルが検出します。</i></sub>

### ステータスサイドバーの読み方

パネルには一連のライブゲージが表示されます。サイドバーを折りたたむと、コンパクトなレールに収納されます:

<table>
  <tr>
    <td width="28%" valign="top"><img src="docs/media/agent-context.png" alt="エージェントステータスサイドバーのコンテキスト残量ゲージ" width="100%" /></td>
    <td width="28%" valign="top"><img src="docs/media/agent-cache.png" alt="エージェントステータスサイドバーのキャッシュ率リング" width="100%" /></td>
    <td width="28%" valign="top"><img src="docs/media/agent-traces.png" alt="エージェントステータスサイドバーの Traces フィード — 引数と結果ステータス付きの最近のツール呼び出し" width="100%" /></td>
    <td width="16%" valign="top" align="center"><img src="docs/media/agent-rail-collapsed.png" alt="折りたたまれたサイドバーレール — 小さなキャッシュリングの上にコンパクトな縦型コンテキスト残量ゲージ" width="52" /></td>
  </tr>
  <tr>
    <td valign="top"><b>コンテキスト残量</b> — モデルのコンテキストウィンドウの残り。使用量が増えると塗りの色が変わり、上限が近づくのが見て取れます。</td>
    <td valign="top"><b>キャッシュ率</b> — 現在のターンのうちキャッシュから供給された割合をリングで表示。リングが満ちるほど、安く速いターンです。</td>
    <td valign="top"><b>トレース</b> — 直近 50 件の完了したツール呼び出し: ツール、引数、結果を新しい順に表示。</td>
    <td valign="top"><b>折りたたみ</b> — 残量ゲージとリングがひとつのコンパクトレールに収納された状態。</td>
  </tr>
</table>

### プラン使用量（API が許す範囲で）

使用量 API を公開しているエージェント — 現在 Codex CLI と Claude Code を完全サポート — では、パネルがモデル名の隣にセッション使用量と週間使用量を表示します。

<div align="center">
  <img src="docs/media/usage-bars.png" alt="モデル、ターン数、5 時間セッションと週間使用量のプラン使用量バー（それぞれ残り割合付き）を表示するエージェントステータスカード" width="520" />
</div>

Kimi Code も同じバーを表示し、トラッキング全体をワンクリックで無効化できます:

<div align="center">
  <img src="docs/media/kimi-usage.png" alt="Kimi Code のプラン使用量カード — kimi-code/k3、5 時間セッションと週間使用量のバー、プラン使用量トラッキングをオフにするコントロール" width="520" />
</div>

<sub><i>Kimi Code のプラン使用量はオプトインです — 取得時に設定済みの Kimi 認証情報が Kimi API に送信されます。検出、トランスクリプトの追跡、アクティビティ監視はそれ以外すべてローカルに留まります（`~/.kimi-code/`）。</i></sub>

<sub><i>OpenCode は使用量クォータ API を公開していないため、バーは描画されません — ステータスカードは上流へのリクエスト（[sst/opencode#16017](https://github.com/sst/opencode/issues/16017)）へリンクします。OpenCode の検出は自動インストールされる小さなブリッジプラグインを通じて行われ、モデル、コンテキストウィンドウ（OpenCode の models.dev キャッシュからサイズ取得）、ツールアクティビティを、認証情報に一切アクセスせずに読み取ります。</i></sub>

## 中断したところから再開

Vimeflow を閉じても、エージェントの一日は終わりません。ワークスペースはすべてのセッション — レイアウト、ペイン、各ペインで進行中の会話 — を記憶し、次回起動時にすべてを復元します。各エージェントペインは、直前にいた会話そのものに対して自身の再開コマンド（`claude --resume`、`codex resume` など）を再発行します。やりかけのタスクだらけのワークスペースは、空のプロンプトの列ではなく、やりかけのタスクだらけのワークスペースとして再び開きます。

<div align="center">
  <img src="docs/media/session-resume.gif" alt="Vimeflow を再起動すると、3 つのエージェントペインがそれぞれ再開コマンドを再発行し、元いた会話へ正確に戻る様子" width="900" />
</div>

<sub><i>セッションはレイアウトごと復元されます。検出された各エージェントは会話 ID で再開し、再開するものがないペインは新しいシェルとして戻ります。</i></sub>

## hunk 単位で変更をレビュー

Vimeflow は `git diff` を呼び出す代わりに、ターミナルの隣にドッキングされた本格的なインラインレビュー画面を備えています。差分は Pierre のエンジン（`@pierre/diffs`）で描画され、ワークスペースのテーマに合わせて配色され、変更ファイル一覧がひとつ隣のペインに表示されます。hunk へはその場で操作できます: 単一 hunk のステージ/アンステージ、hunk 単位またはファイル全体の破棄が可能です。

レビューは対話的でもあります。行単位のコメントを残すと、そのセッションで作業中のエージェントが同じスレッドで返信し、コードを修正します。最後の **Resolve** クリックはあなたの手に残ります。セカンドオピニオンが欲しければ、**Request review** で差分を別のレビュアーに渡せます — 別のエージェントへディスパッチするか、プロンプトをコピーして好きな場所で使えます。いずれにせよ、編集を hunk 単位でたどり、コードが書かれている最中に問題を捕まえられます。ウィンドウを離れる必要はありません。

<div align="center">
  <img src="docs/media/hunk-review.png" alt="差分ドックの変更行に付いたレビュースレッド: アクセシビリティ改善を求めるコメントにエージェントが応答し、ユーザーが解決する様子" width="900" />
</div>

<sub><i>試してみる:<br>1. 未コミットの変更があるリポジトリでセッションを開きます。<br> 2. `⌘G`（または `⌘;` → `:open-diff`）でペインの隣に差分ドックを開きます。<br> 3. 変更ファイル一覧からファイルを選び、個々の hunk をステージ、アンステージ、破棄します。<br> 4. hunk の表示は **Settings → Version Control → Hunk Appearance** で調整できます。</i></sub>

## Worktree 統合

複数のエージェントと作業するということは、たいてい複数の git worktree を扱うことを意味し、いまどれを見ているのか分からなくなりがちです。Vimeflow は各エージェントのターミナルを監視し、worktree への移動を検出します — `Entering worktree(...)` メッセージ、素の `cd`、`EnterWorktree` スキルレポート、OSC 7 ヒントのいずれでも — そしてリロードなしにペインを追従させます。ステータスバーの git チップは常に現在地（`worktree → branch`）を表示し、worktree 名・パス・ブランチをワンクリックでコピーできます。

<div align="center">
  <img src="docs/media/worktree-chip.png" alt="git チップのコピー用ポップオーバー — Copy worktree (readme-refresh)、Copy path、Copy branch (docs/readme-refresh) — worktree からブランチを表示するステータスバーチップの上に表示" width="560" />
</div>

エージェントがいる worktree は表示内容も決めます: ファイルエクスプローラはそのツリーへ追従し、差分レビューは変更ファイル一覧と hunk をその worktree にスコープします。レビューするのは常にエージェントが実際に触っているコードであり、古いチェックアウトではありません。

## コマンドパレットと設定

パレットは、コマンドラインの速度、Neovim スタイルのエイリアス、Zed スタイルのあいまい一致を兼ね備えています。`⌘;` で開き、`:new` で新規セッション、`:layout` でペイン配置、さらに `:open-diff`、`:open-editor`、`:theme`、`:settings`、`:goto` など — あいまい一致とコマンドごとのショートカット付きです。Vim 風のエイリアス（`:tabnew`、`:vsplit`、`:split`、`:only` など）が欲しければ Vim キーマッププリセットを選択してください。それ以外は設定ダイアログがカバーします: 外観、キーマップ、コーディングエージェント、エディタ、ターミナル、バージョン管理など。

<div align="center">
  <img src="docs/media/command-palette.png" alt="ワークスペースの上に開いた vim スタイルのコマンドパレットに、レイアウトと差分のコマンドが表示されている様子" width="900" />
</div>

<sub><i>試してみる:<br>1. `⌘;` を押して数文字入力します — 入力に応じてコマンドがあいまい一致します。<br> 2. `:new` でセッションを立ち上げ、`:goto` でセッション間をジャンプします。<br> 3. サイドバー下部の **Settings** を開き、**Keymap** でキーの再割り当て、**Coding Agents** でエージェントランチャーを設定します。</i></sub>

## テーマ

Lens テーマシステムには複数の組み込みテーマが付属します — **Catppuccin**（ダーク・デフォルト）、**Flexoki**（ライト）、**Gruvbox**（ダークとライト）、**Tokyo Night**、**Dracula** など。アプリ内のすべての色はセマンティックトークンなので、ターミナルを含むワークスペース全体が即座に再配色され、適用前のライブプレビューも可能です。テーマは JSON でインポート/エクスポートでき、自作もできます。

<div align="center">
  <img src="docs/media/theme-tour.gif" alt="コマンドパレットから組み込みカラーテーマをライブプレビュー付きで切り替える様子" width="900" />
</div>

<sub><i>試してみる:<br>1. `⌘;` を押して `:theme` を実行します。<br> 2. リストを移動します — ワークスペースが各テーマをライブでプレビューします。<br> 3. `Enter` で適用、`Esc` でプレビューを破棄します。</i></sub>

## カーソルエフェクト

5 種類のアニメーションカーソルトレイルを用意しています（デフォルトはオフ）。macOS では Ghostty エンジン内の本物の GLSL シェーダーとして動作し、Linux では xterm.js アドオンが同等の描画を行います。各エフェクトはカーソルの動きに反応するため、ジャンプと連続移動でそれぞれ違った表情を見せます。

<table>
  <tr>
    <td width="50%" valign="top"><div><sub><b>Warp</b> — ジャンプ時に位置間で伸びる</sub></div><img src="docs/media/cursor-warp.gif" alt="Warp カーソルエフェクト — ファイル内をジャンプするカーソルが位置間で伸びてスナップする" width="100%" /></td>
    <td width="50%" valign="top"><div><sub><b>Sweep</b> — 帯が移動経路に沿って掃引する</sub></div><img src="docs/media/cursor-sweep.gif" alt="Sweep カーソルエフェクト — カーソルの移動経路に沿って明るい帯が掃引する" width="100%" /></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><div><sub><b>Tail</b> — 減衰する尾がカーソルを追う</sub></div><img src="docs/media/cursor-tail.gif" alt="Tail カーソルエフェクト — バッファ内を移動するカーソルを減衰する筋が追いかける" width="100%" /></td>
    <td width="50%" valign="top"><div><sub><b>Ripple</b> — 着地点からリングが広がる</sub></div><img src="docs/media/cursor-ripple.gif" alt="Ripple カーソルエフェクト — カーソルが着地した位置からリングが外へ広がる" width="100%" /></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><div><sub><b>Sonic Boom</b> — 高速で長いジャンプに衝撃波</sub></div><img src="docs/media/cursor-sonic-boom.gif" alt="Sonic Boom カーソルエフェクト — 高速・長距離の移動でカーソルから衝撃波が弾ける" width="100%" /></td>
    <td width="50%" valign="top"></td>
  </tr>
</table>

<sub><i>試してみる:<br>1. **Settings** → **Terminal** を開きます。<br> 2. **Cursor Effect** を Warp・Sweep・Tail・Ripple・Sonic Boom のいずれかに設定します — 再起動なしで即適用されます。<br> 3. **Off** に戻すと無効になります。</i></sub>

<sub><i>macOS では、シェーダーコンパイラを残した `libghostty` が必要ですが、[上流](https://github.com/Lakr233/libghostty-spm) はこれを削っています — パッケージ版は残してある[別バージョン](https://github.com/winoooops/libghostty-spm-shaders)をリンクします。Linux にフォークは不要です。シェーダーは Sahaj Bhatt 氏による MIT ライセンスです（[`sahaj-b/ghostty-cursor-shaders`](https://github.com/sahaj-b/ghostty-cursor-shaders)）。</i></sub>

## Linux

上記のすべては Linux でも動作しますが、ひとつだけ違いがあります: ターミナルは libghostty ではなく xterm.js を使用します（Linux ビルドは libghostty レンダリングエンジンをまだサポートしていません）。AppImage としてパッケージし、`chmod +x` して実行してください。

<div align="center">
  <img src="docs/media/linux-workspace.png" alt="Linux 上でフルワークスペースを実行する Vimeflow、ターミナルペインは xterm.js" width="900" />
</div>

## 現在のサポート範囲

Vimeflow は**ソースからのバージョン 0.1.0** をサポートします。nightly ワークフローは、デフォルトブランチの最新成功コミットから未署名インストーラをビルドするよう構成されています。

- サポート対象リリースライン: `0.1.0`
- サポート対象パッケージターゲット: Linux x64 AppImage と macOS arm64 DMG（ローカルまたは nightly CI でビルド）
- デスクトップランタイム: Electron 42 + LSP フレーミングの JSON IPC で通信する Rust サイドカー
- ターミナルランタイム: パッケージ版 macOS arm64 は `libghostty-spm` による組み込みネイティブ Ghostty、Linux/開発用フォールバックは xterm.js
- エージェント観測: Claude Code、Codex CLI、Kimi Code、OpenCode
- nightly リリースターゲット: ローリング更新の [`nightly` プレリリース](https://github.com/winoooops/vimeflow/releases/tag/nightly) 1 本（両プラットフォームとリリースチェックがすべて成功した場合のみ公開）
- 未サポート: 安定版バイナリリリース、Windows パッケージング、プロダクション署名/公証、自動更新

パッケージングはホスト固有です: Linux x64 AppImage は Linux x64 上で、macOS arm64 DMG は Apple Silicon Mac 上でビルドしてください。

## Nightly ビルドのインストール

ローリング更新の [`nightly` リリース](https://github.com/winoooops/vimeflow/releases/tag/nightly)から、お使いのプラットフォームのインストーラと `SHA256SUMS` をダウンロードします。nightly は実験的スナップショットです: 署名も公証もされておらず、自動更新はなく、次回の nightly 成功時に置き換えられます。リリースノートに正確なソースコミットとワークフロー実行が記載されています。

開く前にダウンロードしたファイルを検証してください。SHA-256 は破損や改変されたダウンロードを検出し、GitHub のアテステーションはファイルが本リポジトリの nightly ワークフロー由来であることも検証します:

```bash
# macOS (run in the download directory)
grep '\.dmg$' SHA256SUMS | shasum -a 256 -c -
gh attestation verify ./vimeflow-*.dmg \
  -R winoooops/vimeflow \
  --signer-workflow winoooops/vimeflow/.github/workflows/nightly-release.yml \
  --source-ref refs/heads/main

# Linux (run in the download directory)
grep '\.AppImage$' SHA256SUMS | sha256sum -c -
gh attestation verify ./vimeflow-*.AppImage \
  -R winoooops/vimeflow \
  --signer-workflow winoooops/vimeflow/.github/workflows/nightly-release.yml \
  --source-ref refs/heads/main
```

アテステーション検証には [GitHub CLI](https://cli.github.com/) が必要です。どちらかのチェックが失敗した場合、インストーラを実行しないでください。

### macOS へのインストール

DMG を開き、Vimeflow を **Applications** へドラッグします。アプリはまだ Apple による署名・公証を受けていないため、初回起動は Applications 内の **Vimeflow** を Control クリックして **開く** を選び、**開く** で確認してください。Gatekeeper がその検証済みコピーをまだブロックする場合は、そのアプリだけ隔離属性を外して再度開きます:

```bash
xattr -dr com.apple.quarantine /Applications/Vimeflow.app
```

### Linux へのインストール

AppImage に実行権限を付けて実行します:

```bash
chmod +x ./vimeflow-*.AppImage
./vimeflow-*.AppImage
```

`libfuse2` が利用できない場合は `--appimage-extract-and-run` を使ってください。`--no-sandbox` は、Chromium がホストのサンドボックスを起動できないと報告した場合にのみ使用してください。そのフォールバックは Chromium のプロセスサンドボックスを無効化します。

## ソースからビルドして実行

前提条件:

- Node.js >= 22（CI と揃えるため `.nvmrc` の Node 24 を推奨）
- `nvm` は任意ですが `.nvmrc` の利用に便利です。別のマネージャで Node 24 が有効なら `nvm use` は省略可
- Rust stable ツールチェーン
- Git
- サポート対象のパッケージビルドには Linux x64 または Apple Silicon macOS

```bash
git clone https://github.com/winoooops/vimeflow.git
cd vimeflow
nvm use # Optional: switches to Node 24 from .nvmrc
npm ci
```

開発実行をインストール済みの Vimeflow から完全に分離したい場合（セッション・設定・エージェント状態を分ける）、以下のコマンドを使い捨てのデータディレクトリに向けてください:

```bash
VIMEFLOW_USER_DATA_DIR=/tmp/vimeflow-demo npm run electron:dev
```

### macOS

**ネイティブ Ghostty ランタイム**で実行 — パッケージ版と同じターミナル基盤です:

```bash
npm run electron:dev:ghostty
```

または **xterm.js** パスで実行 — 同じアプリ、ネイティブ Ghostty なし:

```bash
npm run electron:dev
```

arm64 DMG のビルド:

```bash
npm run electron:build            # or: npm run electron:build:mac:arm64
```

DMG は `release/vimeflow-*-arm64.dmg` に生成されます。ネイティブ Ghostty 親ランタイムを同梱しており、署名・公証はされていません。

### Linux

ソースから実行 — Linux のターミナルは **xterm.js** です（ネイティブ Ghostty は現状 macOS のみ）:

```bash
npm run electron:dev
```

Chromium サンドボックスが動作しないホストでは:

```bash
VIMEFLOW_NO_SANDBOX=1 npm run electron:dev
```

x64 AppImage のビルド:

```bash
npm run electron:build            # or: npm run electron:build:linux:x64
```

実行:

```bash
chmod +x release/vimeflow-*.AppImage
./release/vimeflow-*.AppImage
```

ホストに `libfuse2` がない場合は、AppImage の extract-and-run フォールバックを使います:

```bash
./release/vimeflow-*.AppImage --appimage-extract-and-run
```

`--no-sandbox` は、Chromium がホストのサンドボックスを起動できないと報告した場合にのみ追加してください。

## Vimeflow を使う

1. `npm run electron:dev` またはローカルビルドのパッケージで Vimeflow を起動します。
2. **+** をクリックしてプロジェクト内にセッションを作成します。`claude`、`codex`、`kimi`、`opencode` を同時に起動することもできます。
3. ペインを分割し、ファイルを閲覧し、コードを編集し、git の変更を hunk 単位でレビューします — 上の機能ツアーをご覧ください。
4. サポート対象のエージェントが検出されると、エージェントステータスパネルが表示されます。

## Lifeline とハーネスエンジニアリング

このリポジトリは、実践的なハーネスエンジニアリングのプロジェクトでもあります。Vimeflow の開発ワークフローは、計画立案、自律的な実装ループ、レビュー、PR リクエスト、上流レビュー対応、PR 承認に [Lifeline Claude Code 拡張](https://github.com/winoooops/lifeline)を使用しています。

プロジェクトローカルなセットアップメモは [CLAUDE.md](./CLAUDE.md#lifeline-plugin-setup) にあります。

## チェックアウトの検証

```bash
npm run lint
npm run format:check
npm run type-check
npm test
cargo test --manifest-path crates/backend/Cargo.toml
```

Rust の型を変更したら TypeScript バインディングを再生成します:

```bash
npm run generate:bindings
```

## プロジェクト参照

- 後継フォーク（活発に開発中）: [vimeflow-terminal](https://github.com/winoooops/vimeflow-terminal) — [herdr](https://github.com/herdrdev/herdr) 上に再構築された Vimeflow の機能
- セットアップの詳細: [SETUP.md](./SETUP.md)
- 開発コマンドとスタイル: [DEVELOPMENT.md](./DEVELOPMENT.md)
- アーキテクチャと Electron サイドカー IPC: [ARCHITECT.md](./ARCHITECT.md)
- デザインシステム: [DESIGN.md](./DESIGN.md) と [docs/design/UNIFIED.md](./docs/design/UNIFIED.md)
- 現在のロードマップ状況: [docs/roadmap/progress.yaml](./docs/roadmap/progress.yaml)
- 変更履歴: [CHANGELOG.md](./CHANGELOG.md) / [CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md)
- バックエンドクレートのメモ: [crates/backend/README.md](./crates/backend/README.md)

## ライセンス

MIT
