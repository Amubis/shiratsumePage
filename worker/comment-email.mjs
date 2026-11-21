export const COMMENT_EMAIL_FROM = 'notifications@amubis.art';
export const COMMENT_EMAIL_TO = 'amubisxv@gmail.com';

export function createCommentEmailNotifier(binding, onError = () => {}) {
  if (!binding) return undefined;
  return (comment, context) => {
    const source = comment.targetType === 'photo' ? '照片' : '碎碎念';
    const delivery = Promise.resolve().then(() => binding.send({
      from: { email: COMMENT_EMAIL_FROM, name: 'SHIRATSUME' },
      to: COMMENT_EMAIL_TO,
      subject: `SHIRATSUME · 新${source}留言`,
      text: [`${comment.nickname || '匿名访客'} 在${source}下留言`, '', comment.body, '', '查看消息中心', 'https://amubis.art/admin/'].join('\n'),
    })).catch(onError);
    if (context?.waitUntil) context.waitUntil(delivery);
    else return delivery;
  };
}
