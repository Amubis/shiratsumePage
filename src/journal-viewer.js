/** Journal and image dialogs share a bounded paper surface and return focus. */
export function createJournalViewer({ document: doc, mount, getEntries, getWords, getLocale, renderArticle, takeComments, releaseComments, onReturn } = {}) {
  const win = doc?.defaultView;
  let detail = null, detailFrame = null, detailLeft = null, detailRight = null, detailPrevious = null, detailNext = null, detailClose = null;
  let imageDialog = null, imageFrame = null, image = null, imageError = null, imagePrevious = null, imageNext = null, imageClose = null;
  let selected = null, imagePost = null, imageIndex = 0, detailOpener = null, imageOpener = null;
  let detailAnimation = null, imageAnimation = null, detailSequence = 0, imageSequence = 0, destroyed = false;
  const reduced = () => Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  const el = (tag, className, text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, text, handler) => {
    const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', handler); return node;
  };
  const animate = async (node, frames, duration, channel) => {
    if (!node?.animate || reduced() || doc.hidden) return;
    const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.2,.72,.28,1)', fill: 'both' });
    if (channel === 'detail') { detailAnimation?.cancel(); detailAnimation = animation; }
    else { imageAnimation?.cancel(); imageAnimation = animation; }
    try { await animation.finished; } catch { /* A new selection owns the surface. */ }
    if (channel === 'detail' && detailAnimation === animation) detailAnimation = null;
    if (channel === 'image' && imageAnimation === animation) imageAnimation = null;
    animation.cancel();
  };
  const lock = () => doc.body?.classList.toggle('modal-open', Boolean(detail?.open || imageDialog?.open || doc.querySelector?.('dialog[open]')));
  const show = dialog => {
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.open = true; dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); }
    lock();
  };
  const hide = dialog => {
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else { dialog.open = false; dialog.removeAttribute('open'); }
    lock();
  };
  const selectedEntry = () => getEntries().find(post => post === selected || post.id && post.id === selected?.id) || null;
  function createDetail() {
    if (detail) return;
    detail = el('dialog', 'journal-detail-viewer');
    detailFrame = el('div', 'journal-detail-frame');
    detailLeft = el('div', 'journal-detail-content'); detailRight = el('aside', 'journal-detail-comments');
    detailClose = button('journal-detail-close', '×', () => closeDetail());
    detailPrevious = button('journal-detail-previous', '←', () => changeDetail(-1));
    detailNext = button('journal-detail-next', '→', () => changeDetail(1));
    detailFrame.append(detailLeft, detailRight); detail.append(detailFrame, detailClose, detailPrevious, detailNext); doc.body.append(detail);
    detail.addEventListener('cancel', event => { event.preventDefault?.(); void closeDetail(); });
    detail.addEventListener('click', event => { if (event.target === detail) void closeDetail(); });
    detail.addEventListener('close', () => { if (selected) finishDetailClose(); });
    detail.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault?.(); event.stopPropagation?.(); void closeDetail(); return; }
      if (['input', 'textarea', 'select'].includes(event.target?.localName) || event.target?.isContentEditable) return;
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault?.(); event.stopPropagation?.(); changeDetail(event.key === 'ArrowLeft' ? -1 : 1); }
    });
  }
  function releaseSelected() {
    if (selected) releaseComments?.(selected);
  }
  function renderDetail() {
    const post = selectedEntry();
    if (!post || !detail) return false;
    selected = post;
    const words = getWords();
    detail.setAttribute('aria-label', words.viewPost);
    detail.setAttribute('data-journal-id', post.id || '');
    detailClose.setAttribute('aria-label', words.closePost); detailPrevious.setAttribute('aria-label', words.previousPost); detailNext.setAttribute('aria-label', words.nextPost);
    const index = getEntries().indexOf(post);
    detailPrevious.disabled = index <= 0; detailNext.disabled = index >= getEntries().length - 1;
    detailLeft.replaceChildren(renderArticle(post, { detail: true }));
    const panel = takeComments?.(post);
    detailRight.replaceChildren(...(panel ? [panel] : []));
    detailLeft.scrollTop = detailRight.scrollTop = 0;
    return true;
  }
  function open(postOrId, opener = null) {
    if (destroyed) return false;
    const post = typeof postOrId === 'object' ? postOrId : getEntries().find(post => post.id === postOrId);
    if (!post) return false;
    createDetail();
    ++detailSequence; detailAnimation?.cancel();
    if (selected && selected !== post) releaseSelected();
    selected = post; detailOpener = opener || doc.activeElement;
    if (!renderDetail()) return false;
    show(detail); detailClose.focus?.({ preventScroll: true });
    void animate(detailFrame, [{ opacity: 0, transform: 'translateY(24px) scale(.975)' }, { opacity: 1, transform: 'translateY(-2px) scale(1.003)', offset: .76 }, { opacity: 1, transform: 'none' }], 360, 'detail');
    return true;
  }
  function finishDetailClose() {
    const post = selected;
    if (!post) return;
    releaseSelected(); selected = null;
    const target = onReturn?.(post);
    (target || detailOpener)?.focus?.({ preventScroll: true }); detailOpener = null;
    lock();
  }
  function closeDetail(immediate = false) {
    if (!detail?.open || !selected) return;
    if (imageDialog?.open) closeImage(true);
    const sequence = ++detailSequence;
    detailAnimation?.cancel();
    const finish = () => { if (sequence !== detailSequence || destroyed) return; hide(detail); finishDetailClose(); };
    if (immediate || !detailFrame?.animate || reduced() || doc.hidden) { finish(); return; }
    void animate(detailFrame, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(18px) scale(.98)' }], 220, 'detail').then(finish);
  }
  function changeDetail(direction) {
    const posts = getEntries(), index = posts.indexOf(selectedEntry()), next = posts[index + direction];
    if (!next || !detail?.open) return;
    const sequence = ++detailSequence; detailAnimation?.cancel();
    const commit = () => {
      if (sequence !== detailSequence || destroyed) return;
      releaseSelected(); selected = next; renderDetail();
      void animate(detailFrame, [{ opacity: .15, transform: `translateX(${direction * 16}px)` }, { opacity: 1, transform: 'none' }], 260, 'detail');
    };
    if (!detailFrame?.animate || reduced() || doc.hidden) { commit(); return; }
    void animate(detailFrame, [{ opacity: 1, transform: 'none' }, { opacity: .15, transform: `translateX(${-direction * 12}px)` }], 140, 'detail').then(commit);
  }
  function createImages() {
    if (imageDialog) return;
    imageDialog = el('dialog', 'personal-image-viewer'); imageFrame = el('div', 'personal-image-frame');
    image = el('img', 'personal-image-full'); image.decoding = 'async';
    imageError = el('p', 'personal-image-error'); imageError.setAttribute('data-language-text', ''); imageError.setAttribute('role', 'status');
    imageClose = button('personal-image-close', '×', () => closeImage());
    imagePrevious = button('personal-image-previous', '←', () => changeImage(-1)); imageNext = button('personal-image-next', '→', () => changeImage(1));
    imageFrame.append(image, imageError); imageDialog.append(imageFrame, imageClose, imagePrevious, imageNext); mount.append(imageDialog);
    image.addEventListener('error', () => { imageError.hidden = false; image.hidden = true; });
    imageDialog.addEventListener('cancel', event => { event.preventDefault?.(); void closeImage(); });
    imageDialog.addEventListener('click', event => { if (event.target === imageDialog) void closeImage(); });
    imageDialog.addEventListener('close', finishImageClose);
    imageDialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault?.(); event.stopPropagation?.(); void closeImage(); return; }
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault?.(); event.stopPropagation?.(); changeImage(event.key === 'ArrowLeft' ? -1 : 1); }
    });
  }
  function renderImage() {
    const picture = imagePost?.images[imageIndex]; if (!picture) return;
    const words = getWords(), alt = picture.alt;
    imageDialog.setAttribute('aria-label', words.viewImage); imageClose.setAttribute('aria-label', words.closeImage);
    imagePrevious.setAttribute('aria-label', words.previousImage); imageNext.setAttribute('aria-label', words.nextImage);
    imagePrevious.disabled = imageIndex <= 0; imageNext.disabled = imageIndex >= imagePost.images.length - 1;
    imageError.textContent = words.imageUnavailable; imageError.hidden = true; image.hidden = false;
    image.src = picture.url; image.alt = typeof alt === 'string' ? alt : alt?.[getLocale()] || alt?.zh || '';
  }
  function openImage(post, index, opener) {
    if (destroyed || !post?.images[index]) return false;
    createImages(); ++imageSequence; imageAnimation?.cancel(); imagePost = post; imageIndex = index; imageOpener = opener;
    renderImage(); show(imageDialog); imageClose.focus?.({ preventScroll: true });
    void animate(imageFrame, [{ opacity: 0, transform: 'translateY(18px) scale(.97)' }, { opacity: 1, transform: 'none' }], 300, 'image'); return true;
  }
  function finishImageClose() {
    if (!imagePost) return;
    imagePost = null; image?.removeAttribute('src'); imageOpener?.focus?.({ preventScroll: true }); imageOpener = null; lock();
  }
  function closeImage(immediate = false) {
    if (!imageDialog?.open) return;
    const sequence = ++imageSequence; imageAnimation?.cancel();
    const finish = () => { if (sequence !== imageSequence) return; hide(imageDialog); finishImageClose(); };
    if (immediate || !imageFrame?.animate || reduced() || doc.hidden) { finish(); return; }
    void animate(imageFrame, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px) scale(.98)' }], 190, 'image').then(finish);
  }
  function changeImage(direction) {
    const next = imageIndex + direction;
    if (!imagePost?.images[next]) return;
    const sequence = ++imageSequence; imageAnimation?.cancel();
    const commit = () => { if (sequence !== imageSequence) return; imageIndex = next; renderImage(); void animate(imageFrame, [{ opacity: .1, transform: `translateX(${direction * 14}px)` }, { opacity: 1, transform: 'none' }], 230, 'image'); };
    if (!imageFrame?.animate || reduced()) { commit(); return; }
    void animate(imageFrame, [{ opacity: 1 }, { opacity: .1, transform: `translateX(${-direction * 10}px)` }], 120, 'image').then(commit);
  }
  return {
    open, close: closeDetail, openImage, closeImage,
    get selectedId() { return selected?.id || null; },
    get openState() { return Boolean(detail?.open); },
    mount(nextMount = mount) { mount = nextMount; if (imageDialog) mount.append(imageDialog); },
    refresh() {
      closeImage(true);
      if (detail?.open && !renderDetail()) closeDetail(true);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; ++detailSequence; ++imageSequence;
      detailAnimation?.cancel(); imageAnimation?.cancel(); selected = null; imagePost = null;
      image?.removeAttribute('src'); hide(imageDialog); hide(detail); detail?.remove?.(); imageDialog?.remove?.(); lock();
    },
  };
}
