// Media is shared across languages. The second theme deliberately contains no
// other avatar's media: replace its empty playlist when that model is supplied.
export const MODELS = {
  shiratsume: {
    name: 'しらつめ', theme: '#B7BB5A', dark: '#686D2F', rgb: '183,187,90',
    paper: '#F6F3EF', poster: './assets/poster.jpg',
    playlist: ['./assets/clip-01.mp4', './assets/clip-02.mp4', './assets/clip-03.mp4'],
    preview: false,
    switchArt: null,
  },
  preview: {
    name: { zh: '小小庭院', ja: '小さな庭' }, theme: '#B8A0C2', dark: '#745B80',
    rgb: '184,160,194', paper: '#F6F1F5', poster: './assets/theme-preview.svg',
    playlist: [], preview: true,
    switchArt: null,
  },
};

export const SECTION_IDS = ['home', 'hello', 'moments', 'collection'];
export const COPY = {
  zh: {
    skip: '跳过开场，开始探索', navHome: '入口', navHello: '模型介绍', navMoments: '超级相册', navCollection: '关于Amubis', personalHome: '回到主页', previewNavCollection: '日常收藏',
    heroDescription: '我家孩子的可爱程度是天下无敌的。', explore: '开始探索', watch: '看一会儿视频', returnHome: '返回主页', pause: '暂停视频', play: '播放视频',
    helloHeading: '你好呀，<br>又见面了。', helloLead: '一蹦一跳的日常，<br>都想好好留下。', helloDescription: '这里是一座小小的庭院。收集微笑、目光，还有那些不经意间，让人心软的瞬间。',
    frameLabel: '影像摘帧', handNote: '今天也，要开心呀。', seeMoments: '去看看那些瞬间', momentsHeading: '心动，<br>有迹可循。', momentsNote: '一个眼神，一次回眸。<br>都是想收藏的理由。',
    momentOne: '视线交会的那一秒', momentTwo: '把笑容留在这里', collectionHeading: '慢慢收集，<br>小小的喜欢。', collectionDescription: '让每一个平常的日子，<br>都有值得回看的理由。',
    collectionLabel: '影像手记', sampleNotice: '视频摘帧 · 相册预览', collectionOne: '小小的问候', collectionTwo: '留住这一刻', collectionThree: '下一次，也一起吧',
    footerLine: '一片幸运，一点日常。', backTop: '回到庭院入口', chooseModel: '选择一座小庭院', originalTheme: '四叶草庭院',
    previewThemeName: '紫藤色小庭院<small>第二主题预览</small>', anotherGarden: 'ANOTHER LITTLE GARDEN', switchModel: '切换主题', previewNotice: '第二主题预览 · 等待新的模型素材',
    previewHero: '另一片风景，等你来填满。', previewHelloHeading: '新的庭院，<br>慢慢生长。', previewHelloDescription: '这里先留一点空白，等待下一位主角的名字、照片与故事。',
    previewMomentsHeading: '新的故事，<br>还在路上。', previewMomentsNote: '为下一次相遇，<br>留一片小小的空白。', previewCollectionHeading: '下一页，<br>由你写下。', previewFrameLabel: '主题色预览',
    close: '关闭大图', switchLanguage: '切换至日本語', scrollExplore: '向下探索', scrollHint: '轻滚一下，翻开下一页', menu: '章节导航',
    frame1Alt: '用户测试视频的第一个摘帧', frame2Alt: '用户测试视频的第二个摘帧', frame3Alt: '用户测试视频的第三个摘帧', frame4Alt: '用户测试视频的第四个摘帧', previewAlt: '紫藤色四叶草主题占位画面',
    openVideo: '单独打开视频', videoLoading: '正在加载视频…', videoBlocked: '自动播放受限，点击播放视频。', videoTimeout: '视频加载较慢，可以重试或单独打开。', videoError: '视频暂时无法播放，可以重试或单独打开。', videoPaused: '视频已暂停。', videoReduced: '已按减少动态效果设置暂停自动播放。', videoReady: '点击播放视频。',
  },
  ja: {
    skip: 'オープニングをスキップ', navHome: '入り口', navHello: 'アバターについて', navMoments: '超アルバム', navCollection: 'Amubisについて', personalHome: 'ホームへ', previewNavCollection: '日々のかけら',
    heroDescription: 'かわいいを、毎日のすみっこに。', explore: 'ここから', watch: '映像をながめる', returnHome: '入り口にもどる', pause: '映像を一時停止', play: '映像を再生',
    helloHeading: 'こんにちは、<br>また会えたね。', helloLead: 'ぴょんとはずむ毎日を、<br>ひとつずつ、大切に。', helloDescription: 'ここは、小さな庭。笑顔も、まなざしも、ふと心がほどける瞬間も、そっと集めています。',
    frameLabel: '映像のひとこま', handNote: '今日も、いい日になりますように。', seeMoments: 'ときめきを見つけに', momentsHeading: 'ときめきは、<br>ここにある。', momentsNote: 'ふと合った目も、振り向いた顔も。<br>残しておきたい理由になる。',
    momentOne: '目が合った、その瞬間', momentTwo: '笑顔を、ここに', collectionHeading: '好きなかけらを、<br>少しずつ。', collectionDescription: '何気ない毎日にも、<br>また見返したくなる瞬間を。',
    collectionLabel: '日々の映像帖', sampleNotice: '映像のひとこま · アルバムプレビュー', collectionOne: '小さなごあいさつ', collectionTwo: 'この瞬間を残して', collectionThree: '次も、いっしょに',
    footerLine: '小さな幸運、ささやかな日々。', backTop: '庭の入り口にもどる', chooseModel: '小さな庭を選ぶ', originalTheme: 'クローバーの庭',
    previewThemeName: '藤色の小さな庭<small>第2テーマのプレビュー</small>', anotherGarden: 'ANOTHER LITTLE GARDEN', switchModel: 'テーマを切り替え', previewNotice: '第2テーマのプレビュー · 素材を準備中',
    previewHero: 'もうひとつの景色を、あなたの手で。', previewHelloHeading: '新しい庭が、<br>育つまで。', previewHelloDescription: '次の主役の名前も、写真も、物語も。ここに小さな余白を残しておきます。',
    previewMomentsHeading: '新しい物語は、<br>これから。', previewMomentsNote: '次の出会いのために、<br>小さな余白を。', previewCollectionHeading: '次のページは、<br>あなたと。', previewFrameLabel: 'テーマ色のプレビュー',
    close: '拡大画像を閉じる', switchLanguage: '切换至中文', scrollExplore: '下へ進む', scrollHint: 'スクロールして、次のページへ', menu: 'ページ案内',
    frame1Alt: 'テスト映像から切り出した1枚目の画像', frame2Alt: 'テスト映像から切り出した2枚目の画像', frame3Alt: 'テスト映像から切り出した3枚目の画像', frame4Alt: 'テスト映像から切り出した4枚目の画像', previewAlt: '藤色のクローバーテーマの仮画像',
    openVideo: '映像を別に開く', videoLoading: '映像を読み込み中…', videoBlocked: '自動再生できません。ボタンで再生できます。', videoTimeout: '読み込みに時間がかかっています。再試行するか、映像を別に開いてください。', videoError: '映像を再生できません。再試行するか、別に開いてください。', videoPaused: '映像は一時停止中です。', videoReduced: '視差効果を減らす設定に合わせ、自動再生を停止しています。', videoReady: 'ボタンで映像を再生できます。',
  },
};

export function getSelection(search = '') {
  const params = new URLSearchParams(search);
  const model = Object.hasOwn(MODELS, params.get('model')) ? params.get('model') : 'shiratsume';
  const language = Object.hasOwn(COPY, params.get('lang')) ? params.get('lang') : 'zh';
  return { model, language };
}

export function escapeXML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
