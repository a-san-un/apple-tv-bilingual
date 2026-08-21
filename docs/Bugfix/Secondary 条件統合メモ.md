# Secondary 条件統合案メモ

## 背景

secondary の selection / bind / monitor / recovery に関する条件が、`subtitle-sync-controller.js`、`cue-controller.js`、`cue-track-binder.js`、`subtitle-recovery-manager.js`、`secondary-track-recovery.js` に分散している。
そのため、同じ状態を複数の層が別々に解釈しており、条件追加のたびに見通しが悪くなっている。

現在の主な分散は次のとおり。

- `subtitle-sync-controller.js`
    - track 候補選定
    - readability snapshot 計算
    - `sameTrackRef` / `requestedLanguageChanged` の算出。
- `cue-controller.js`
    - `staleMonitor` 判定
    - `shouldRebind` の組み立て
    - bind の rationale 決定
    - clear / render 制御。
- `cue-track-binder.js`
    - same track / same mode / monitor healthy の skip 判定
    - monitor start / stop / mode apply。
- `secondary-track-recovery.js`
    - 継続 missing / debounce / missCount / terminated に基づく recovery action 決定。

この状態を改善するため、**selection result ではなく decision result を単一箇所で返す構成**へ寄せる。

***

## 今の問題

### 1. 同じ判断材料が複数層に重複している

secondary の扱いには、少なくとも次の判断材料がある。

- track が見つかったか
- その track が readable か
- 前回 bind と同じ track か
- requested language が変わったか
- monitor が健全か
- force rebind 要求があるか
- recovery が `recover` / `force-rebind` を要求しているか。

これらが各所で別々に解釈されているため、`shouldRebind`、`skip bind`、`recover` が独立に増えていく構造になっている。

### 2. readability が action 決定の中心になっていない

`subtitle-sync-controller.js` には `getTrackReadability()` があり、`cuesLength`、`activeCuesLength`、`currentCueTextLength`、`hasCueOverlapAtCurrentTime` から `readable` を作っている。
さらに `waitForReadableTrack()` もあるが、その考え方が secondary orchestration の中心概念になっておらず、条件整理が分裂しやすい。

### 3. `cue-controller.js` が判断を持ちすぎている

現状の `syncSecondaryTrackOrchestration()` では、`monitorState` 取得、`staleMonitor` 導出、`shouldRebind` 組み立て、rationale 選択まで行っている。
これは Step 7 の「cue-controller.js を薄くする」という方針に対して、今後の条件追加でさらに重くなりやすい構造である。

***

## 統合の基本方針

### 方針

`selectSecondarySubtitleTrack()` を拡張するか、同じモジュール内に新たに `buildSecondarySyncDecision()` を追加して、**secondary をどう扱うかの最終 decision** を返すようにする。

流れは次のように整理する。

1. `track` と `snapshot` を選ぶ
2. 前回状態と monitor 状態を受け取る
3. そこから derived condition を一箇所で作る
4. 最終 action を返す
5. `cue-controller.js` は action 実行だけを担当する

これにより、condition の正本が一つにまとまる。

***

## 目指す責務分割

| 層 | 持つ責務 | 持たない責務 |
| :-- | :-- | :-- |
| `subtitle-sync-controller.js` | selection、readability、前回との差分、monitor入力を受けた derived condition、最終 action 決定 | DOM cleanup 実行、lane state 更新、実際の bind/unbind 実行 |
| `cue-controller.js` | action 実行、render、scene rebuild、上位 orchestration | selection 詳細判定、monitor 健全性条件のローカル組み立て |
| `cue-track-binder.js` | bind / unbind / mode apply / monitor state 保持 | selection、requested language 変更判定、recovery policy |
| `secondary-track-recovery.js` | 継続 missing ベースの `recover` / `force-rebind` / `terminated` 判定 | track selection、sameTrackRef、monitor stale 判定 |

要点は、**「何をすべきか」は `subtitle-sync-controller.js` が返し、他はそれを実行するだけに寄せる**こと。

***

## 中心オブジェクト案

### decision result の例

```js
{
  track,
  currentTime,
  snapshot,

  previous: {
    boundTrack,
    boundTrackId,
    requestedLang,
  },

  selection: {
    resolvedTrack,
    selectedTrackId,
    sameTrackRef,
    requestedLanguageChanged,
  },

  monitor: {
    active,
    hasCleanup,
    track,
    sameTrack,
    sameMode,
    healthy,
    stale,
  },

  recovery: {
    requested: false,
    forceRebind: false,
    reason: "",
  },

  derived: {
    trackFound,
    readable,
    shouldClear,
    needsReadableWait,
    needsRebind,
    canKeepCurrentBinding,
  },

  action: {
    type: "clear" | "keep" | "wait-and-bind" | "bind",
    reason:
      "track-missing" |
      "same-track-healthy" |
      "requested-language-changed" |
      "selected-track-changed" |
      "stale-monitor" |
      "force-rebind" |
      "track-unreadable",
    requestedMode: "hidden",
  }
}
```


### この形にする意図

- `selection` は「何を選んだか」
- `monitor` は「今の bind 側が健全か」
- `recovery` は「外部から昇格要求が来ているか」
- `derived` は「今の状態をどう解釈したか」
- `action` は「最終的に何をするか」

この 5 層に分けると、条件の意味が読みやすくなり、ログも整理しやすい。

***

## action の最小セット

### `clear`

secondary 用 track が存在しないとき。

```js
action.type === "clear"
```

実行内容:

- secondary unbind
- render clear
- 必要なら monitor cleanup


### `keep`

今の binding をそのまま維持してよいとき。

```js
action.type === "keep"
```

典型条件:

- track がある
- sameTrackRef
- monitor healthy
- force rebind なし
- requested language 変更なし。


### `wait-and-bind`

track はあるが readable でない、または warmup を入れたいとき。

```js
action.type === "wait-and-bind"
```

実行内容:

- 既存 `waitForReadableTrack()` を使う
- その後 bind
- timeout しても最終 snapshot を保持できる。


### `bind`

即 bind でよいとき。

```js
action.type === "bind"
```

典型条件:

- track が切り替わった
- stale monitor
- requested language changed
- recovery により force rebind 指示あり。

***

## derived condition の整理案

現在 `cue-controller.js` がローカルで組み立てている条件は、原則ここへ寄せる。

### 1. `trackFound`

```js
const trackFound = Boolean(track);
```


### 2. `readable`

```js
const readable = Boolean(snapshot?.readable);
```

readable の定義は今ある `getTrackReadability()` を正本とする。

### 3. `monitorHealthy`

`cue-track-binder.js` の skip 条件で使っている monitor 健全性を、decision 用の入力として同じ意味で扱う。

```js
const monitorHealthy =
  monitor.active &&
  monitor.hasCleanup &&
  monitor.sameTrack &&
  monitor.sameMode;
```


### 4. `staleMonitor`

今 `cue-controller.js` にある判定を decision builder 側へ寄せる。

```js
const staleMonitor =
  !monitor.active ||
  !monitor.hasCleanup ||
  (track && monitor.track && monitor.track !== track);
```


### 5. `needsReadableWait`

track は見つかったが readable ではなく、すぐ bind するより短時間待つべきケース。

```js
const needsReadableWait =
  trackFound &&
  !readable &&
  !recovery.forceRebind;
```

ここは後で policy 化できるが、第一段階ではシンプルに `trackFound && !readable` を中心に置くのがよい。

### 6. `needsRebind`

今の `shouldRebind` を置き換える中心条件。

```js
const needsRebind =
  recovery.forceRebind ||
  selection.requestedLanguageChanged ||
  !selection.sameTrackRef ||
  staleMonitor;
```

これは現行 `cue-controller.js` の条件をほぼそのまま引き継ぐ形になる。

### 7. `canKeepCurrentBinding`

```js
const canKeepCurrentBinding =
  trackFound &&
  selection.sameTrackRef &&
  monitorHealthy &&
  !recovery.forceRebind &&
  !selection.requestedLanguageChanged;
```

`cue-track-binder.js` 側の skip 条件と意味を合わせやすい。

### 8. `shouldClear`

```js
const shouldClear = !trackFound;
```


***

## action 決定ルール案

優先順位を固定して、あとから条件を増やしても崩れにくくする。

### 優先順位

1. `shouldClear`
2. `recovery.forceRebind`
3. `needsRebind`
4. `needsReadableWait`
5. `canKeepCurrentBinding`
6. それ以外は `bind`

### 例

```js
if (shouldClear) {
  return {
    action: { type: "clear", reason: "track-missing", requestedMode: "hidden" },
  };
}

if (recovery.forceRebind) {
  return {
    action: { type: "bind", reason: "force-rebind", requestedMode: "hidden" },
  };
}

if (needsRebind) {
  return {
    action: {
      type: "bind",
      reason: selection.requestedLanguageChanged
        ? "requested-language-changed"
        : staleMonitor
          ? "stale-monitor"
          : "selected-track-changed",
      requestedMode: "hidden",
    },
  };
}

if (needsReadableWait) {
  return {
    action: {
      type: "wait-and-bind",
      reason: "track-unreadable",
      requestedMode: "hidden",
    },
  };
}

if (canKeepCurrentBinding) {
  return {
    action: {
      type: "keep",
      reason: "same-track-healthy",
      requestedMode: "hidden",
    },
  };
}

return {
  action: {
    type: "bind",
    reason: "selected-track-changed",
    requestedMode: "hidden",
  },
};
```

この優先順位にすると、`force-rebind` や `stale-monitor` が `keep` より先に評価されるため、解釈の競合が起きにくい。

***

## `cue-controller.js` をどう薄くするか

現在は `syncSecondaryTrackOrchestration()` の中で

- selection 実行
- monitor 取得
- stale 判定
- rebind 判定
- rationale 決定
- bind 実行

まで持っている。

統合後は、概ね次の形に寄せられる。

```js
const decision = buildSecondarySyncDecision({
  video,
  requestedLang,
  previousBoundTrack,
  monitorState,
  recoveryRequest,
  forceRebind,
});

switch (decision.action.type) {
  case "clear":
    unbindSecondarySubtitleTrack();
    renderSecondarySubtitle("", null);
    return;

  case "wait-and-bind":
    await bindSecondarySubtitleTrackWithWarmup(decision);
    break;

  case "bind":
    bindSecondarySubtitleTrack(decision.track, {
      requestedMode: decision.action.requestedMode,
      policy: "secondary-sync",
      rationale: decision.action.reason,
      unreadableSnapshot: decision.snapshot,
    });
    break;

  case "keep":
  default:
    break;
}

const currentCue = getCurrentCue(decision.track, decision.currentTime);
const currentCueText = cleanCueText(currentCue);
renderSecondarySubtitle(currentCueText, currentCue);
```

こうすると `cue-controller.js` は本当に orchestration 役に近づく。

***

## `cue-track-binder.js` の位置づけ

`cue-track-binder.js` は今のままでも、「実行器」としてはかなり自然である。
ただし skip 条件の意味が decision と二重化しないよう、役割を次のように限定するのがよい。

### binder に残すもの

- mode apply
- listener binding
- cleanup
- monitor state の保持
- 既に monitor が健全なら start を skip する最終防波堤。


### binder から追い出すもの

- requested language の意味解釈
- selection 結果の正しさ判定
- recovery policy
- unreadable をどう扱うかの判断

つまり binder は「その bind を実行してよいか」ではなく、**「同じ bind を物理的に張り直す必要があるか」だけを見る**ようにする。

***

## recovery の位置づけ

`secondary-track-recovery.js` は、secondary lane の継続 missing 観測に基づいて `recover` / `force-rebind` / `terminated` を返している。
ここは policy として独立しているので、無理に sync decision へ吸収しなくてよい。

### 役割の整理

- recovery module:
    - 時間窓
    - debounce
    - missCount
    - terminated 管理。[^6][^7]
- decision builder:
    - recovery module から渡された `forceRebind` / `requested` を action に反映する

つまり recovery は **「昇格要求を出す層」**、decision builder は **「その要求も含めて今どう動くかを決める層」** と分ける。

***

## 実装ステップ案

### Step 1: `buildSecondarySyncDecision()` を追加する

対象:

- `modules/subtitle-sync-controller.js`

内容:

- 既存 `selectSecondarySubtitleTrack()` を流用
- `monitorState` と `forceRebind` を入力に受ける
- `derived` と `action` を返す新関数を追加


### Step 2: `cue-controller.js` からローカル条件組み立てを外す

対象:

- `cue-controller.js`

内容:

- `staleMonitor`
- `shouldRebind`
- rationale の三項演算子

を削り、decision の `action` を使う形に置き換える。

### Step 3: readable 待ちを decision から使う

対象:

- `modules/subtitle-sync-controller.js`
- `cue-controller.js`

内容:

- `wait-and-bind` action を導入
- 既存 `waitForReadableTrack()` を流用
- unreadable でも trackFound のときの扱いを一元化する。


### Step 4: binder を最終防波堤に寄せる

対象:

- `modules/cue-track-binder.js`

内容:

- skip 条件の意味を「同じ monitor を再作成する必要がない」ケースだけに限定
- policy 的な分岐は持たせない。[^3]


### Step 5: debug / memory probe を decision ベースへ整理する

対象:

- `cue-controller.js`
- `modules/subtitle-sync-controller.js`
- `modules/cue-track-binder.js`

内容:

- `selection`
- `monitor`
- `derived`
- `action`

単位でログを揃える
→ 「どの条件で bind / keep / clear になったか」が追いやすくなる。

***

## この統合案の利点

### 1. 条件の正本が一つになる

今は `sameTrackRef`、`staleMonitor`、`monitorHealthy`、`shouldRebind` が別々の場所にあるが、decision builder に集約すれば見通しが大きく改善する。

### 2. Step 7 の方針に合う

`cue-controller.js` は selection や rebind policy の本体を持たず、交通整理役に寄せられる。

### 3. unreadable 対応を自然に織り込める

`readability` はすでに `subtitle-sync-controller.js` にあるため、それを action 決定に正面から使える。
これにより、「track はあるが cue が空」というケースを `wait-and-bind` で明示的に扱える。

### 4. recovery との境界が明確になる

recovery module は「継続失敗の昇格判定」に集中し、bind 条件の詳細には踏み込まなくてよい。

***

## 注意点

### 1. `requestedLanguageChanged` の意味は見直し余地がある

現状は `requestedLang` と `previousBoundTrack.language` の比較であり、secondary 言語の履歴そのものを持っているわけではない。
統合の際は、必要なら `previousRequestedLang` を state に持つ形へ見直した方が意図が明確になる。

### 2. `wait-and-bind` は policy として最小から始める

最初から複雑な待機戦略にせず、まずは既存 `waitForReadableTrack()` をそのまま接続するだけでよい。
それでも「今どこで待つのか」が decision に現れるので、挙動把握はかなりしやすくなる。

### 3. binder の skip と decision の `keep` を完全一致させすぎない

`decision.action.type === "keep"` は論理上の keep、`binder` の skip は物理的な listener 再作成回避であり、完全同義ではない。
ただし意味のズレが大きいと再び複雑化するので、ログ上では両者を対応づけて見えるようにするのが望ましい。

***

## まとめ

今回の統合案の核心は、**「どの track を選ぶか」ではなく「secondary を今どう扱うか」を一つの decision result にまとめる**ことにある。
そのために `subtitle-sync-controller.js` を selection モジュールから **decision builder** へ一段進め、`cue-controller.js` は action 実行だけに寄せるのが最も自然である。

実装の第一歩としては、次の順がよい。

1. `modules/subtitle-sync-controller.js` に `buildSecondarySyncDecision()` を追加する。
2. `cue-controller.js` の `staleMonitor` / `shouldRebind` / rationale 組み立てを置き換える。
3. `waitForReadableTrack()` を `wait-and-bind` action で接続する。
4. binder は monitor 実行器として薄く保つ。

この形なら、Step 7 の「cue-controller.js を薄くする」にそのまま繋がり、今後の sub 修正や Step 8 以降の配線整理にも乗せやすい。