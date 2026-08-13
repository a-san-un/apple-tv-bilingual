Bugfix-A/B/C/D-plan  
## リネーム対応表  
  
| 旧名称 | 新名称 | 種別・責務 | 備考 |  
|---|---|---|---|  
| `enabled` | `extensionEnabled` | 永続設定（`chrome.storage.sync`） | 拡張全体／ネイティブトグルの有効・無効 |  
| `showSidebar` | `panelDefaultOpen` | 永続設定（`chrome.storage.sync`） | 通常起動時に使う字幕パネルの既定開閉値 |  
| `panelVisible` | `panelOpen` | ランタイム状態（`chrome.storage.local`） | 現在の字幕パネル開閉状態 |  
| `normalizeEnabled()` | `normalizeExtensionEnabled()` | schema API | `extensionEnabled === true` のときだけ true |  
| `normalizeShowSidebar()` | `normalizePanelDefaultOpen()` | schema API | `false` のときだけ false、それ以外は true |  
| `showSidebarSetting` | `panelDefaultOpenSetting` | 関数引数 | local に `panelOpen` がない場合のフォールバック |  
| `initialVisible` | `initialOpen` 相当 | layout 内部状態 | 実際の差分では呼び出し側の状態プロパティを `panelOpen` へ変更 |  
| `keepPanelVisible` | `keepPanelOpen` | restart 引数・ログ文脈 | restart 時に保持するランタイム開閉状態 |  
| `layoutState.panelVisible` | `layoutState.panelOpen` | レイアウト内部状態 | パネルが開いている場合だけレイアウト調整を行う |  
  
`panelOpen` は `chrome.storage.local` に保存し、`panelDefaultOpen` には書き戻さない。  
  
## Storage キー  
  
| 保存先 | 旧キー | 新キー | 用途 |  
|---|---|---|---|  
| `chrome.storage.sync` | `enabled` | `extensionEnabled` | 拡張全体の ON / OFF |  
| `chrome.storage.sync` | `showSidebar` | `panelDefaultOpen` | 通常起動時のパネル既定状態 |  
| `chrome.storage.local` | `panelVisible` | `panelOpen` | 現在のパネル開閉状態 |  
  
`modules/panel-visibility-state.js` の `STORAGE_KEY` は `"panelOpen"`。  
  
## 状態の使い分け  
  
| 状態 | 正本 | 変更する操作 | 使う場面 |  
|---|---|---|---|  
| `extensionEnabled` | `chrome.storage.sync` | ネイティブトグル、popup / options 保存 | 拡張全体を有効化するか |  
| `panelDefaultOpen` | `chrome.storage.sync` | options の既定値設定 | 通常起動時の `panelOpen` 初期値 |  
| `panelOpen` | `chrome.storage.local` + `state.panelOpen` | 字幕パネル開閉ボタン | 現在パネルが開いているか |  
  
`panelDefaultOpen` は現在の表示状態ではなく既定値、`panelOpen` は現在のランタイム状態として扱う。  
  
  
Bugfix-A: panel-ui.js / content.js / settings-runtime.js を調査  
  → atv-toggle-btn 生成・破棄経路、ネイティブトグルOFF時のUI破棄経路（panel-ui.js、content.js、settings-runtime.js）  
      症状: 字幕パネル開閉ボタンが表示されない/効かない、またはネイティブトグルOFF時に再生画面の拡張UIが残る  
  
      最小修正:  
        - 新規ロジック追加ではなく、表示責務の分離と既存 build/destroy 条件のガード整理に留める  
        - applyPanelVisibility は「右側字幕パネル/overlay の表示切替」に限定する  
        - 字幕パネル開閉ボタンの表示可否は extensionEnabled ベースで別判定に分ける  
        - 未使用の旧補助関数は削除する  
        - ネイティブトグルOFF時は hide ではなく destroy ベースの経路へ寄せる  
  
      確定仕様:  
        - extensionEnabled（ネイティブトグル / 拡張全体の有効・無効）  
            OFF → 字幕パネル開閉ボタン非表示、右側字幕パネル非表示、overlay 非表示、再生画面に影響する拡張UI/処理はネイティブトグル表示を除いてすべて破棄する  
            ON  → 字幕パネル開閉ボタン表示対象になる  
            備考:  
              - OFF時に残すのはネイティブトグル表示、ポップアップ機能、設定ページ機能、設定保存のみ  
              - OFF時は Apple TV+ の素の状態へ戻し、本来の機能を使えるようにする  
              - extensionEnabled=false のときは panelOpen=false に寄せる  
  
        - panelOpen（右側字幕パネルのランタイム開閉状態、extensionEnabled=ON のときのみ意味を持つ）  
            false → 右側字幕パネル非表示  
            true  → 右側字幕パネル表示  
            備考: 字幕パネル開閉ボタンが閉じている状態のときは、右側字幕パネルは表示されない  
            字幕パネル開閉ボタンの動作:  
              クリックで開閉  
              開閉に応じてアイコン変化  
              開いているときはパネル左端に追従  
              設定保存には関与しない  
            保存:  
              panelOpen はランタイム状態として local 側に保存する  
              panelDefaultOpen には書き戻さない  
  
        - panelDefaultOpen（設定ページの永続設定）  
            役割: 通常起動時の panelOpen 初期値 / 既定値  
            備考: ランタイムの現在状態そのものではない  
  
        - 通常起動  
            panelDefaultOpen を初期値として panelOpen を復元してから UI を構築する  
            local に panelOpen 保存値があればそれを優先する  
  
        - restart 時  
            現在の panelOpen を keepPanelOpen として一時的に引き継ぐ  
            restart 時は panelDefaultOpen / 保存値を読み直して上書きしない  
            ただし extensionEnabled=false に切り替わる場合は panelOpen=false に寄せて UI を閉じる  
  
      実装メモ:  
        - extensionEnabled / panelOpen / panelDefaultOpen は責務を分離して維持する  
        - 1ファイルに完全統合するより、状態判定だけを小さな関数に寄せる方がシンプル  
        - 表示ルールは以下の3行に固定する  
            extensionEnabled=false → 字幕パネル開閉ボタンも右側字幕パネルも出さない  
            extensionEnabled=true かつ panelOpen=true  → 字幕パネル開閉ボタン表示 + 右側字幕パネル表示  
            extensionEnabled=true かつ panelOpen=false → 字幕パネル開閉ボタン表示 + 右側字幕パネル非表示  
        - ネイティブトグルは拡張全体の ON/OFF だけを担当する  
        - 字幕パネル開閉ボタンは右側字幕パネルの開閉だけを担当し、設定保存には関与しない  
  
      関数整理:  
        - content.js  
            削除済み:  
              - _showRightPanel  
              - _hideRightPanel  
              - _applySettingsToUI  
                  備考: panelDefaultOpen を現在の UI 状態へ直接流し込む旧補助関数は削除済み  
  
            残存する整理候補:  
              - _pinRightPanel  
              - _unpinRightPanel  
                  備考: 現在は空関数で未使用。Bugfix-A の主目的とは別だが削除候補  
  
            残す:  
              - panelUi.createToggleButton() 呼び出し  
              - panelUi.watchForPlayerTabs() 呼び出し  
              - panelUi.applyPanelVisibility(state.panelOpen) 呼び出し  
              - panelUi.destroyUiHosts() 呼び出し  
                  備考: destroy/build 経路の owner 整理は Bugfix-D でも使うため残す  
  
        - panel-ui.js  
            修正済み:  
              - applyPanelVisibility(show)  
                  以前は右側字幕パネル表示 + overlay 幅変更 + updateToggleButton(show) まで一括で行い、show=false で atv-toggle-btn まで消していた  
                  → 現在は「右側字幕パネル/overlay 表示切替」に限定  
                  → 字幕パネル開閉ボタンの表示可否はここで決めない  
  
              - updateToggleButton(isOpen)  
                  以前は panelOpen の開閉状態に加えて OFF 時 display:none を担当していた  
                  → 現在は「アイコン更新」「位置追従」に寄せている  
                  → 閉じているときも atv-toggle-btn は残す  
  
              - createToggleButton()  
                  atv-toggle-btn の存在確認を行って生成する中心関数として維持  
                  → extensionEnabled=true 時に再生成できることを確認する  
                  → extensionEnabled=false 時の非表示/破棄は build 前ガードまたは destroy 側で扱う  
  
              - togglePanel(force)  
                  panelOpen のランタイム切替と local 保存の中心として維持  
                  → panelDefaultOpen へは書き戻さない  
                  → applyLayout(state.panelOpen) / applyPanelVisibility(state.panelOpen) を呼ぶ責務は維持してよい  
  
            後で整理候補:  
              - showRightPanel  
              - hideRightPanel  
                  備考: どちらも applyPanelVisibility の薄いラッパー。OFF経路の destroy 化が終わるまで残す  
  
            残す:  
              - watchForPlayerTabs  
              - applyPanelState  
              - destroyFeatureUiHosts  
              - destroyUiHosts  
                  備考: これらは Bugfix-D や sync_interval 系経路でも影響があるため、Bugfix-A では削除しない  
  
        - settings-runtime.js  
            修正対象:  
              - extensionEnabled=false 分岐  
                  現状:  
                    - state.panelOpen = false  
                    - panelUi?.hideRightPanel?.()  
                    - detachForDisabled()  
                    - syncIntervalOrchestrator?.stop?.()  
                    - cleanupInitialAutoStartWatch()  
                  問題:  
                    - hideRightPanel は右側字幕パネルを隠すだけで、再生画面の拡張UI完全破棄仕様と一致しない  
                  方向:  
                    - panelUi?.hideRightPanel?.() を destroy ベースの経路へ置き換える  
                    - ネイティブトグルOFF時は、ネイティブトグル表示を除く拡張UI/処理を再生画面から完全に外す  
  
      他バグ修正との関係:  
        - Bugfix-B には直接関与しない  
            cue-controller / resolver 側の字幕 handoff 問題とは別軸  
        - Bugfix-C には直接関与しない  
            manifest 読み込み順問題とは別軸  
        - Bugfix-D とは一部共有  
            destroyFeatureUiHosts / destroyUiHosts / build-owner 整理は共通論点  
            とくにネイティブトグルOFF時の完全破棄は cleanup owner 整理とも接続する  
            ただし Bugfix-A では atv-toggle-btn と右側字幕パネルの生成条件・破棄条件に必要な最小範囲だけ触る  
  
      検証:  
        - browser verification  
            - 初期ロード  
                extensionEnabled=true, panelDefaultOpen=false, local panelOpen=false  
                → 字幕パネル開閉ボタン表示、右側字幕パネル非表示  
            - 初期ロード  
                extensionEnabled=true, panelDefaultOpen=true, local panelOpen=true  
                → 字幕パネル開閉ボタン表示、右側字幕パネル表示  
            - ネイティブトグルOFF  
                → 字幕パネル開閉ボタン非表示、右側字幕パネル非表示、overlay 非表示、再生画面に影響する拡張UI/処理を破棄  
                → ネイティブトグル表示は残る  
                → Apple TV+ の素の状態へ戻る  
            - ネイティブトグルOFF → ON  
                → 字幕パネル開閉ボタン再生成、panelOpen に応じて右側字幕パネル復元  
                → ポップアップ/設定ページで保存済みの設定を読み込み、即時反映  
            - restart  
                → keepPanelOpen を優先し、panelDefaultOpen / 保存値で上書きしない  
            - restart + extensionEnabled=false  
                → panelOpen=false に寄せ、再生画面の拡張UI/処理を作らない  
            - 字幕パネル開閉ボタンクリック  
                → 開閉、アイコン変化、開いているときはパネル左端へ追従  
  
Bugfix-B: resolver / cue-controller.js を調査  
  → syncNativeSubtitleSelectionViaMenu、track.mode 変更経路  
      症状: ネイティブUI字幕が表示されない / handoff が崩れる  
  
      最小修正:  
        - 新規の大きな設計変更ではなく、まず track.mode を変更する入口に重複ガードを入れる  
        - 「同じ track に同じ mode を連続適用する」処理を抑止する  
        - cleanup 側は直接 track.mode を複数箇所で触らず、既存 owner 経路を優先する  
        - native handoff / recovery / cleanup の呼び順ログを追加または既存ログで追跡できるようにする  
  
      確定方針:  
        - native UI 字幕の制御経路は最終的に1本へ寄せる  
        - track.mode の直接変更は所有者を絞る  
        - cleanup は handoff API を呼ぶだけの形に近づける  
        - debug / mode 変化記録は track 管理側へ寄せる  
  
      関数整理:  
        - cue-controller.js  
            修正対象:  
              - native handoff 系  
              - primary / secondary bind 系  
              - track.mode 制御系  
            役割:  
              - 今は字幕制御の司令塔だが、track.mode の直接変更まで抱えている可能性がある  
              - Bugfix-B では「どこで mode を変えるか」を狭める方向で整理する  
  
        - resolver / menu sync 系  
            修正対象:  
              - syncNativeSubtitleSelectionViaMenu  
            役割:  
              - Apple TV+ 側のネイティブ字幕選択状態と、拡張側の secondary / primary track 選択を同期する  
              - handoff 成功直後に別経路で再同期が走ると競合源になるため、二重呼び出しや不要再実行を疑う  
  
        - modules/playback-session-cleanup.js  
            修正対象:  
              - clearSecondaryTrackState()  
              - teardownForRestart()  
              - detachForDisabled()  
            役割:  
              - restart / extensionEnabled=false 時の後始末を担当する  
              - Bugfix-B では track.mode を直接何度も変えないよう、既存 owner を壊さない最小ガードに留める  
  
      他バグ修正との関係:  
        - Bugfix-A とは基本別軸  
            字幕パネル開閉ボタン / panelOpen 問題とは分離して扱う  
        - Bugfix-C とは一部関係あり  
            secondary-track-recovery module 自体が読まれていないと recovery/handoff 崩れに見える可能性がある  
        - Bugfix-D とは関係あり  
            restart cleanup や extensionEnabled=false 時の cleanup 順序崩れが handoff 崩れの原因候補になる  
  
      検証:  
        - browser verification  
            - native handoff  
                拡張側字幕停止後にネイティブUI字幕が再表示されるか  
            - extensionEnabled=false → extensionEnabled=true  
                再開後に primary / secondary の mode が競合しないか  
            - large seek 後 recovery  
                recovery 後に native 字幕の track.mode が hidden / disabled に戻されないか  
            - restart  
                teardown 後の再 attach で handoff が壊れないか  
            - debug log  
                track.mode 変更順序が 1 経路に近づいているか  
  
  
Bugfix-C: manifest.json / secondary-track-recovery.js を調査  
  → module 読み込み順  
      症状: secondary_recovery_module_unavailable が発生する  
  
      現在確認できていること:  
        - manifest.json の content_scripts 配列には modules/secondary-track-recovery.js が含まれている  
        - 同じ配列には cue-track-binder.js、cue-sequence-builder.js、cue-render-coordinator.js、playback-session-cleanup.js、playback-startup-coordinator.js、subtitle-sync-controller.js などの関連 module も並んでいる  
  
      最小修正:  
        - まず manifest の現行順序を確認し、secondary-track-recovery.js の前後関係だけを直す  
        - 新しい recovery 所有者を増やさず、必要なら順序修正のみに留める  
        - content.js 側で旧 fallback 経路が残っている場合は、owner が二重になっていないかだけ確認する  
  
      確定方針:  
        - recovery module の owner は 1 つにする  
        - 「manifest 順序で直る問題」と「二重所有で直らない問題」を分けて確認する  
        - まず読み込み順を疑い、その後に旧経路残存を疑う  
  
      関数・ファイル整理:  
        - manifest.json  
            修正対象:  
              - content_scripts の modules 配列  
            役割:  
              - content.js 実行前後に必要 module を決まった順で読み込む  
              - Bugfix-C ではここが最優先確認点  
  
        - modules/secondary-track-recovery.js  
            修正対象:  
              - module 公開面  
              - 初期化前提  
              - 依存している global / injected API の前提  
            役割:  
              - secondary track が見つからない / 読めないときの recovery を担当する  
              - unavailable の場合は、未読込か依存未解決かを切り分ける  
  
      他バグ修正との関係:  
        - Bugfix-B に近い  
            recovery module unavailable は、結果として native handoff 崩れに見える可能性がある  
        - Bugfix-D にも近い  
            start / restart 時の初期化順が崩れていると unavailable に見える可能性がある  
        - Bugfix-A とは直接関係しない  
  
      検証:  
        - 拡張再読み込み後のログ確認  
            - secondary_recovery_module_unavailable が消えるか  
            - module 初期化ログが期待順で出るか  
        - browser verification  
            - 通常起動で recovery module が有効になるか  
            - restart 後にも unavailable にならないか  
  
  
Bugfix-D: content.js の destroy/build 経路を調査  
  → destroyFeatureUiHosts / destroyUiHosts / ensureSyncIntervalOrchestrator  
      症状:  
        - restart 後に UI host が二重生成される  
        - extensionEnabled=false 後に listener / observer / interval が残留する  
        - 旧経路と新 module 経路が並行して attach / destroy している疑いがある  
  
      現在確認できていること:  
        - content.js には _ensureSyncIntervalOrchestrator() がある  
        - content.js から panelUi.destroyUiHosts() / panelUi.destroyFeatureUiHosts() を cleanup へ注入している  
        - modules/playback-session-cleanup.js 側でも destroyUiHosts() / destroyFeatureUiHosts() / destroyOverlay() が呼ばれている  
        - playback-startup-coordinator.js から attachTracks() が呼ばれており、起動 watch cleanup も別で持っている  
  
      最小修正:  
        - owner を 1 つに固定するガード条件を追加する  
        - restart 用 destroy と extensionEnabled=false 用 destroy の入口を分け、同じ host を二重破棄・二重再生成しないようにする  
        - ensureSyncIntervalOrchestrator は「未生成時のみ起動」のガードを強める  
        - attach / destroy / cleanup の呼び順だけを整理し、新しい責務分割は増やさない  
  
      確定方針:  
        - build owner と destroy owner を明示する  
        - content.js は Composition Root として依存注入と入口に寄せるが、destroy 実処理の owner は増やさない  
        - cleanup module は cleanup owner、panel-ui は panel host owner のように所有者を分ける  
        - restart と extensionEnabled=false は終状態が違うので同じ destroy API に押し込めすぎない  
  
      関数整理:  
        - content.js  
            修正対象:  
              - _ensureSyncIntervalOrchestrator()  
              - destroy/build 呼び出し経路  
              - attachTracks() まわり  
              - startup / reinitialize / navigation change 入口  
            役割:  
              - 依存注入と起動順の司令塔  
              - Bugfix-D では「誰が build/destroy の最終 owner か」を見えるようにする  
  
        - modules/playback-session-cleanup.js  
            修正対象:  
              - teardownForRestart()  
              - detachForDisabled()  
              - clearPlaybackSessionUiState(...)  
            役割:  
              - restart と extensionEnabled=false の cleanup を分ける中心  
              - destroyUiHosts / destroyFeatureUiHosts / destroyOverlay の呼び方を揃える  
  
        - modules/playback-startup-coordinator.js  
            修正対象:  
              - attachAndMaybeStart(...)  
              - cleanupStartupWatch()  
            役割:  
              - 起動時の attachTracks と startBilingual をまとめる  
              - Bugfix-D では二重 attach の発火源になっていないかを確認する  
  
        - panel-ui.js  
            残す:  
              - destroyFeatureUiHosts()  
              - destroyUiHosts()  
            備考:  
              - Bugfix-A と共通で使うため残す  
              - ただし destroy owner が複数にならないよう呼び出し元を整理する  
  
      他バグ修正との関係:  
        - Bugfix-A と一部共有  
            atv-toggle-btn や panel host の build/destroy 条件に直結する  
        - Bugfix-B とも関係あり  
            restart / extensionEnabled=false 時の cleanup 順序崩れで track handoff が壊れる可能性がある  
        - Bugfix-C とも関係あり  
            初期化順と owner 崩れが recovery module unavailable に見える可能性がある  
  
      検証:  
        - browser verification  
            - restart  
                UI host が二重生成されないか  
            - extensionEnabled=false → extensionEnabled=true  
                listener / observer / interval が残留せず再 attach されるか  
            - navigation change  
                旧 host が残ったまま新 host が増えないか  
            - sync interval  
                orchestrator が多重起動しないか  
            - cleanup log  
                destroy owner が 1 経路に収束しているか  
  
  
Bugfix-E（暫定）: native toggle OFF 時のネイティブ字幕復元不足  
  対象: settings-runtime.js / cue-controller.js / detachForDisabled 周辺  
  症状: 拡張を OFF にすると Apple TV+ 本来の字幕が表示されなくなる  
  原因候補:  
    1. detachForDisabled() が subtitle track の mode を showing → disabled に  
       落としたまま復元していない  
    2. ON 時に syncAppleTvNativeSubtitleToSecondaryLang() で変更した  
       track 状態を OFF 時に対称的に戻す処理がない  
    3. Bugfix-A の UI destroy 未完によって拡張 DOM が残り、  
       Apple TV+ 側の字幕レイヤーが隠れている（系統1との重複可能性あり）  
  切り分け方針:  
    - Bugfix-A の destroy 経路を完成させてから再テストする  
    - それでも再現する場合は track.mode の before/after をログで確認する  
    - 系統1と系統2は独立して直せるが、系統1が解決すると系統2の  
      症状が消える可能性もあるため、Bugfix-A 完了後に再判定する  
  着手タイミング: Bugfix-A-2（OFF 時 destroy 仕上げ）完了後  
  Bugfix-B との関係: cue-controller 側の handoff 問題と部分的に重なる可能性あり  
