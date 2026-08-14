<div id="atv-panel-host" style="position: fixed; top: 0px; right: 0px; width: 30%; height: 100vh; z-index: 999997; pointer-events: auto; box-sizing: border-box;"><template shadowrootmode="open">
        <link rel="stylesheet" href="chrome-extension://hllipaeebnlceafgnhhiiajpaeoijdbf/panel.css">
        <div id="panel" class="dual-subtitles-panel" data-dual-subtitles-panel="">
          <div id="panel-header">
            <span>📋 字幕履歴</span>
            <div class="panel-header-actions">
              <button id="settings-btn" type="button" title="設定">⚙️</button>
            </div>
          </div>
          
        <div id="debug-section" class="debug-section" data-expanded="0" data-bound="1">
          <div class="debug-section__header">
            <span class="debug-section__title">デバッグログ（開発者向け）</span>
            <button id="debugSectionToggle" class="debug-toggle-button" type="button" aria-expanded="false" aria-controls="debugSectionBody">▶</button>
          </div>
          <div id="debugSectionBody" class="debug-section__body" hidden="">
            <div class="debug-filters">
              <label class="debug-filter">
                <span class="debug-filter__label">source</span>
                <select id="debugFilterSource" class="debug-filter__control">
                  <option value="">all</option>
                  <option value="content">content</option>
                </select>
              </label>
              <label class="debug-filter">
                <span class="debug-filter__label">category</span>
                <select id="debugFilterCategory" class="debug-filter__control">
                  <option value="">all</option>
                  <option value="subtitle">subtitle</option>
                </select>
              </label>
              <label class="debug-filter debug-filter--text">
                <span class="debug-filter__label">text</span>
                <input id="debugFilterText" class="debug-filter__control" type="text" placeholder="cuechange / overlay / current subtitle block">
              </label>
            </div>
            <div class="debug-toolbar">
              <button id="debugCopyBtn" class="debug-btn" type="button">Copy</button>
              <button id="debugDownloadBtn" class="debug-btn" type="button">Download</button>
              <button id="debugClearBtn" class="debug-btn" type="button">Clear</button>
            </div>
            <textarea id="debug-log" readonly=""></textarea>
          </div>
        </div>
      
          <div id="panel-scroll">
            <div id="subtitle-list">
        <div class="subtitle-block" data-time="505.712675" data-seek-time="505.712675" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">08:25</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="See" data-sentence="See%20you%20out%20there.">See</span> <span class="atv-word" data-word="you" data-sentence="See%20you%20out%20there.">you</span> <span class="atv-word" data-word="out" data-sentence="See%20you%20out%20there.">out</span> <span class="atv-word" data-word="there." data-sentence="See%20you%20out%20there.">there.</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="またあとで" data-sentence="See%20you%20out%20there.">またあとで</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="512.3867416666667" data-seek-time="512.3867416666667" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">08:32</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="What?" data-sentence="What%3F">What?</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="何よ" data-sentence="What%3F">何よ</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="514.829475" data-seek-time="514.829475" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">08:34</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="You" data-sentence="You%20okay%3F">You</span> <span class="atv-word" data-word="okay?" data-sentence="You%20okay%3F">okay?</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="大丈夫か？" data-sentence="You%20okay%3F">大丈夫か？</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" id="current-block" data-time="517.2267416666666" data-seek-time="517.2267416666666" data-window-current="true" data-sequential-current="true" data-panel-emphasized="true">
          <div class="subtitle-row">
            <div class="subtitle-mark"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><polygon class="play-core" points="10,8 17,12 10,16"></polygon></svg></div>
            <div class="subtitle-content">
              <div class="subtitle-time">08:37</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="Yeah." data-sentence="Yeah.">Yeah.</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="ええ" data-sentence="Yeah.">ええ</span> <span class="atv-word" data-word="もちろん" data-sentence="Yeah.">もちろん</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="519.2617416666667" data-seek-time="519.2617416666667" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">08:39</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="Yeah." data-sentence="Yeah.">Yeah.</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="ええ" data-sentence="Yeah.">ええ</span> <span class="atv-word" data-word="もちろん" data-sentence="Yeah.">もちろん</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="530.5415083333334" data-seek-time="530.5415083333334" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">08:50</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="-" data-sentence="-%20Hi.%20-%20Madam%20Mayor.">-</span> <span class="atv-word" data-word="Hi." data-sentence="-%20Hi.%20-%20Madam%20Mayor.">Hi.</span> <span class="atv-word" data-word="-" data-sentence="-%20Hi.%20-%20Madam%20Mayor.">-</span> <span class="atv-word" data-word="Madam" data-sentence="-%20Hi.%20-%20Madam%20Mayor.">Madam</span> <span class="atv-word" data-word="Mayor." data-sentence="-%20Hi.%20-%20Madam%20Mayor.">Mayor.</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="市長" data-sentence="-%20Hi.%20-%20Madam%20Mayor.">市長</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="532.9149416666667" data-seek-time="532.9149416666667" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">08:52</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="Is" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">Is</span> <span class="atv-word" data-word="the" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">the</span> <span class="atv-word" data-word="Sheriff" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">Sheriff</span> <span class="atv-word" data-word="home?" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">home?</span> <span class="atv-word" data-word="I" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">I</span> <span class="atv-word" data-word="heard" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">heard</span> <span class="atv-word" data-word="I" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">I</span> <span class="atv-word" data-word="might" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">might</span> <span class="atv-word" data-word="be" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">be</span> <span class="atv-word" data-word="able" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">able</span> <span class="atv-word" data-word="to" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">to</span> <span class="atv-word" data-word="catch" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">catch</span> <span class="atv-word" data-word="him" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">him</span> <span class="atv-word" data-word="here." data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">here.</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="保安官は在宅？" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">保安官は在宅？</span><br><span class="atv-word" data-word="話があるの" data-sentence="Is%20the%20Sheriff%20home%3F%20I%20heard%20I%20might%20be%20able%20to%20catch%20him%20here.">話があるの</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="536.0481083333333" data-seek-time="536.0481083333333" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">08:56</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="No." data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">No.</span> <span class="atv-word" data-word="He" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">He</span> <span class="atv-word" data-word="left" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">left</span> <span class="atv-word" data-word="last" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">last</span> <span class="atv-word" data-word="night" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">night</span> <span class="atv-word" data-word="on" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">on</span> <span class="atv-word" data-word="a" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">a</span> <span class="atv-word" data-word="missing" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">missing</span> <span class="atv-word" data-word="persons" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">persons</span> <span class="atv-word" data-word="in" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">in</span> <span class="atv-word" data-word="the" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">the</span> <span class="atv-word" data-word="Mids." data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">Mids.</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="行方不明者の件で" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">行方不明者の件で</span><br><span class="atv-word" data-word="昨夜から出てます" data-sentence="No.%20He%20left%20last%20night%20on%20a%20missing%20persons%20in%20the%20Mids.">昨夜から出てます</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="539.9461416666667" data-seek-time="539.9461416666667" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">08:59</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="Do" data-sentence="Do%20you%20mind%20if%20I%20come%20in%3F">Do</span> <span class="atv-word" data-word="you" data-sentence="Do%20you%20mind%20if%20I%20come%20in%3F">you</span> <span class="atv-word" data-word="mind" data-sentence="Do%20you%20mind%20if%20I%20come%20in%3F">mind</span> <span class="atv-word" data-word="if" data-sentence="Do%20you%20mind%20if%20I%20come%20in%3F">if</span> <span class="atv-word" data-word="I" data-sentence="Do%20you%20mind%20if%20I%20come%20in%3F">I</span> <span class="atv-word" data-word="come" data-sentence="Do%20you%20mind%20if%20I%20come%20in%3F">come</span> <span class="atv-word" data-word="in?" data-sentence="Do%20you%20mind%20if%20I%20come%20in%3F">in?</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="入っても？" data-sentence="Do%20you%20mind%20if%20I%20come%20in%3F">入っても？</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="547.055075" data-seek-time="547.055075" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">09:07</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="Have" data-sentence="Have%20we%20met%20before%3F%20I'm%20sor...%20I%20can't...">Have</span> <span class="atv-word" data-word="we" data-sentence="Have%20we%20met%20before%3F%20I'm%20sor...%20I%20can't...">we</span> <span class="atv-word" data-word="met" data-sentence="Have%20we%20met%20before%3F%20I'm%20sor...%20I%20can't...">met</span> <span class="atv-word" data-word="before?" data-sentence="Have%20we%20met%20before%3F%20I'm%20sor...%20I%20can't...">before?</span> <span class="atv-word" data-word="I'm" data-sentence="Have%20we%20met%20before%3F%20I'm%20sor...%20I%20can't...">I'm</span> <span class="atv-word" data-word="sor..." data-sentence="Have%20we%20met%20before%3F%20I'm%20sor...%20I%20can't...">sor...</span> <span class="atv-word" data-word="I" data-sentence="Have%20we%20met%20before%3F%20I'm%20sor...%20I%20can't...">I</span> <span class="atv-word" data-word="can't..." data-sentence="Have%20we%20met%20before%3F%20I'm%20sor...%20I%20can't...">can't...</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="会ったことあるかしら？" data-sentence="Have%20we%20met%20before%3F%20I'm%20sor...%20I%20can't...">会ったことあるかしら？</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="549.2939416666667" data-seek-time="549.2939416666667" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">09:09</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="[Kathleen]" data-sentence="%5BKathleen%5D%20No.">[Kathleen]</span> <span class="atv-word" data-word="No." data-sentence="%5BKathleen%5D%20No.">No.</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="いいえ" data-sentence="%5BKathleen%5D%20No.">いいえ</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="551.095375" data-seek-time="551.095375" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">09:11</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="Really?" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">Really?</span> <span class="atv-word" data-word="I" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">I</span> <span class="atv-word" data-word="didn't..." data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">didn't...</span> <span class="atv-word" data-word="I" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">I</span> <span class="atv-word" data-word="didn't" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">didn't</span> <span class="atv-word" data-word="come" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">come</span> <span class="atv-word" data-word="visit" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">visit</span> <span class="atv-word" data-word="you" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">you</span> <span class="atv-word" data-word="as" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">as</span> <span class="atv-word" data-word="a" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">a</span> <span class="atv-word" data-word="sheriff" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">sheriff</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="私が保安官の時" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">私が保安官の時</span><br><span class="atv-word" data-word="ご主人に用事で来てない？" data-sentence="Really%3F%20I%20didn't...%20I%20didn't%20come%20visit%20you%20as%20a%20sheriff">ご主人に用事で来てない？</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="553.499975" data-seek-time="553.499975" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">09:13</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="when" data-sentence="when%20your%20husband%20was%20my%20deputy%3F">when</span> <span class="atv-word" data-word="your" data-sentence="when%20your%20husband%20was%20my%20deputy%3F">your</span> <span class="atv-word" data-word="husband" data-sentence="when%20your%20husband%20was%20my%20deputy%3F">husband</span> <span class="atv-word" data-word="was" data-sentence="when%20your%20husband%20was%20my%20deputy%3F">was</span> <span class="atv-word" data-word="my" data-sentence="when%20your%20husband%20was%20my%20deputy%3F">my</span> <span class="atv-word" data-word="deputy?" data-sentence="when%20your%20husband%20was%20my%20deputy%3F">deputy?</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="私が保安官の時" data-sentence="when%20your%20husband%20was%20my%20deputy%3F">私が保安官の時</span><br><span class="atv-word" data-word="ご主人に用事で来てない？" data-sentence="when%20your%20husband%20was%20my%20deputy%3F">ご主人に用事で来てない？</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="555.165375" data-seek-time="555.165375" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">09:15</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="No." data-sentence="No.">No.</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="ないです" data-sentence="No.">ないです</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="557.070575" data-seek-time="557.070575" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">09:17</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="[baby" data-sentence="%5Bbaby%20babbling%5D">[baby</span> <span class="atv-word" data-word="babbling]" data-sentence="%5Bbaby%20babbling%5D">babbling]</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="ないです" data-sentence="%5Bbaby%20babbling%5D">ないです</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="559.435575" data-seek-time="559.435575" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">09:19</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="[Kathleen]" data-sentence="%5BKathleen%5D%20Hmm.">[Kathleen]</span> <span class="atv-word" data-word="Hmm." data-sentence="%5BKathleen%5D%20Hmm.">Hmm.</span></div>
              
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="565.372275" data-seek-time="565.372275" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">09:25</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="What" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">What</span> <span class="atv-word" data-word="do" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">do</span> <span class="atv-word" data-word="you" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">you</span> <span class="atv-word" data-word="know" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">know</span> <span class="atv-word" data-word="about" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">about</span> <span class="atv-word" data-word="Patrick" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">Patrick</span> <span class="atv-word" data-word="Kennedy" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">Kennedy</span> <span class="atv-word" data-word="and" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">and</span> <span class="atv-word" data-word="Lukas" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">Lukas</span> <span class="atv-word" data-word="Kyle?" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">Kyle?</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="パトリック・ケネディと" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">パトリック・ケネディと</span><br><span class="atv-word" data-word="ルーカス・カイルを？" data-sentence="What%20do%20you%20know%20about%20Patrick%20Kennedy%20and%20Lukas%20Kyle%3F">ルーカス・カイルを？</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="569.7517416666666" data-seek-time="569.7517416666666" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">09:29</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="Nothing." data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">Nothing.</span> <span class="atv-word" data-word="I" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">I</span> <span class="atv-word" data-word="don't" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">don't</span> <span class="atv-word" data-word="mean" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">mean</span> <span class="atv-word" data-word="to" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">to</span> <span class="atv-word" data-word="rush," data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">rush,</span> <span class="atv-word" data-word="but" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">but</span> <span class="atv-word" data-word="I" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">I</span> <span class="atv-word" data-word="got" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">got</span> <span class="atv-word" data-word="a" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">a</span> <span class="atv-word" data-word="busy" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">busy</span> <span class="atv-word" data-word="day" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">day</span> <span class="atv-word" data-word="ahead" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">ahead</span> <span class="atv-word" data-word="of--" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">of--</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="知りません" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">知りません</span><br><span class="atv-word" data-word="悪いけど忙しくて" data-sentence="Nothing.%20I%20don't%20mean%20to%20rush%2C%20but%20I%20got%20a%20busy%20day%20ahead%20of--">悪いけど忙しくて</span></div>
            </div>
          </div>
        </div>
      
        <div class="subtitle-block" data-time="572.6524416666666" data-seek-time="572.6524416666666" data-window-current="false" data-sequential-current="false" data-panel-emphasized="false">
          <div class="subtitle-row">
            <div class="subtitle-mark"></div>
            <div class="subtitle-content">
              <div class="subtitle-time">09:32</div>
              <div class="subtitle-primary"><span class="atv-word" data-word="[Juliette]" data-sentence="%5BJuliette%5D%20I%20get%20it.%20You%20never%20heard%20of%20them%3F">[Juliette]</span> <span class="atv-word" data-word="I" data-sentence="%5BJuliette%5D%20I%20get%20it.%20You%20never%20heard%20of%20them%3F">I</span> <span class="atv-word" data-word="get" data-sentence="%5BJuliette%5D%20I%20get%20it.%20You%20never%20heard%20of%20them%3F">get</span> <span class="atv-word" data-word="it." data-sentence="%5BJuliette%5D%20I%20get%20it.%20You%20never%20heard%20of%20them%3F">it.</span> <span class="atv-word" data-word="You" data-sentence="%5BJuliette%5D%20I%20get%20it.%20You%20never%20heard%20of%20them%3F">You</span> <span class="atv-word" data-word="never" data-sentence="%5BJuliette%5D%20I%20get%20it.%20You%20never%20heard%20of%20them%3F">never</span> <span class="atv-word" data-word="heard" data-sentence="%5BJuliette%5D%20I%20get%20it.%20You%20never%20heard%20of%20them%3F">heard</span> <span class="atv-word" data-word="of" data-sentence="%5BJuliette%5D%20I%20get%20it.%20You%20never%20heard%20of%20them%3F">of</span> <span class="atv-word" data-word="them?" data-sentence="%5BJuliette%5D%20I%20get%20it.%20You%20never%20heard%20of%20them%3F">them?</span></div>
              <div class="subtitle-secondary"><span class="atv-word" data-word="聞いたこともない？" data-sentence="%5BJuliette%5D%20I%20get%20it.%20You%20never%20heard%20of%20them%3F">聞いたこともない？</span></div>
            </div>
          </div>
        </div>
      </div>
          </div>
        </div>
      </template><div data-secondary-subtitle="" class="dual-subtitles-secondary" slot="secondary-subtitle-slot" data-language="ja">ええ もちろん</div></div>