/** Only visitor-facing, commonly edited copy belongs in the normal editor. */
export const EDITOR_COPY_SECTIONS = Object.freeze([
  { id: 'navigation', label: '导航', section: 'home', description: '顶部导航与侧边导航共用这些名称。', fields: [
    { id: 'navHome', label: '首页名称', location: '导航中的第一个章节', group: 'site', key: 'navHome' },
    { id: 'navHello', label: '模型介绍名称', location: '导航中的第二个章节', group: 'site', key: 'navHello' },
    { id: 'navMoments', label: '相册名称', location: '导航中的第三个章节', group: 'site', key: 'navMoments' },
    { id: 'navCollection', label: '个人页名称', location: '导航中的第四个章节', group: 'site', key: 'navCollection' },
  ] },
  { id: 'home', label: '首页', section: 'home', description: '视频上方展示的标题、介绍和探索入口。', fields: [
    { id: 'modelName', label: '模型显示名称', location: '首页大标题与网页标题', kind: 'modelName' },
    { id: 'homeEyebrow', label: '标题上方短句', location: '首页大标题上方的小字', group: 'fixed', key: 'homeEyebrow' },
    { id: 'heroDescription', label: '首页介绍句', location: '首页大标题下方', group: 'site', key: 'heroDescription', multiline: true },
    { id: 'explore', label: '探索按钮', location: '首页中央的四叶草按钮', group: 'site', key: 'explore' },
    { id: 'scrollHint', label: '向下浏览提示', location: '首页底部的滚动提示', group: 'site', key: 'scrollHint' },
  ] },
  { id: 'hello', label: '模型介绍', section: 'hello', description: '角色预览右侧的介绍文字。服装名称请在「服装展示」中修改。', fields: [
    { id: 'modelEyebrow', label: '介绍小标题', location: '模型介绍标题上方', kind: 'modelProfile', key: 'eyebrow' },
    { id: 'modelHeading', label: '介绍标题', location: '第二页的大标题', kind: 'modelProfile', key: 'heading' },
    { id: 'modelReading', label: '标题下方读音', location: '模型介绍标题下的小字', group: 'fixed', key: 'modelReading' },
    { id: 'modelLead', label: '介绍引导语', location: '模型介绍的主要短句', kind: 'modelProfile', key: 'lead', multiline: true },
    { id: 'modelDescription', label: '模型介绍正文', location: '引导语下方的正文', kind: 'modelProfile', key: 'description', multiline: true },
    { id: 'seeMoments', label: '前往相册按钮', location: '模型介绍正文下方', group: 'site', key: 'seeMoments' },
  ] },
  { id: 'moments', label: '相册', section: 'moments', description: '相册纸张上的固定标题。每张照片的说明请在「照片相册」中修改。', fields: [
    { id: 'albumTitle', label: '相册标题', location: '相册纸张左上方', group: 'album', key: 'title' },
    { id: 'albumCoverNote', label: '相册标题旁短句', location: '相册标题右侧的小字', group: 'album', key: 'coverNote' },
  ] },
  { id: 'collection', label: '个人页', section: 'collection', description: '个人页的栏目文字。昵称、简介与链接请在「作者资料」中修改。', fields: [
    { id: 'personalEyebrow', label: '个人页上方短句', location: '作者头像上方的小字', group: 'personal', key: 'eyebrow' },
    { id: 'journalHeading', label: '碎碎念栏目标题', location: '个人页的碎碎念入口', group: 'personal', key: 'journal' },
    { id: 'journalNote', label: '碎碎念栏目介绍', location: '碎碎念栏目标题下方', group: 'personal', key: 'journalNote' },
    { id: 'personalHome', label: '回到首页按钮', location: '个人页底部的返回按钮', group: 'site', key: 'personalHome' },
  ] },
].map(section => Object.freeze({ ...section, fields: Object.freeze(section.fields.map(field => Object.freeze(field))) })));

export function editorCopySection(id) {
  return EDITOR_COPY_SECTIONS.find(section => section.id === id) || EDITOR_COPY_SECTIONS[0];
}

function copyField(id) {
  const field = EDITOR_COPY_SECTIONS.flatMap(section => section.fields).find(item => item.id === id);
  if (!field) throw new RangeError('Unknown page copy field.');
  return field;
}
const localeOf = value => value === 'ja' ? 'ja' : 'zh';

export function readEditorCopy(content, id, language = 'zh') {
  const field = copyField(id), locale = localeOf(language);
  if (field.kind === 'modelName') {
    const value = content?.modelProfile?.name;
    return typeof value === 'string' ? value : value?.[locale] ?? '';
  }
  const value = field.kind === 'modelProfile' ? content?.modelProfile?.[locale]?.[field.key] : content?.texts?.[field.group]?.[locale]?.[field.key];
  return typeof value === 'string' ? value : '';
}

/** Change only the explicitly selected field; hidden dictionaries stay intact. */
export function writeEditorCopy(content, id, language, value) {
  const field = copyField(id), locale = localeOf(language);
  if (typeof value !== 'string') throw new TypeError('Page copy must be text.');
  if (field.kind === 'modelName') {
    content.modelProfile ||= {};
    const current = content.modelProfile.name;
    if (typeof current === 'string') content.modelProfile.name = { zh: current, ja: current };
    content.modelProfile.name ||= { zh: '', ja: '' };
    content.modelProfile.name[locale] = value;
  } else if (field.kind === 'modelProfile') {
    content.modelProfile ||= {}; content.modelProfile[locale] ||= {};
    content.modelProfile[locale][field.key] = value;
  } else {
    content.texts ||= {}; content.texts[field.group] ||= {}; content.texts[field.group][locale] ||= {};
    content.texts[field.group][locale][field.key] = value;
  }
}
