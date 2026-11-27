/** 確認の質問の「答えたときの図面からのおすすめ」（confirmBasis）: 他の画面で手で直した項目は聞き直さない */
import { describe, expect, it } from 'vitest';
import { emptyDoc, useStore } from './store';

const s = () => useStore.getState();

describe('confirmBasis', () => {
  it('申請書の画面などで答えを手で変えたら、その項目の記録を消す（変えた答えを図面の変化で聞き直さない）', () => {
    s().newDoc(emptyDoc(), { id: 'p', name: 't', createdAt: 1 });
    s().updateSite({ application: { sewerConnection: 'ます設置(新規)', workKind: '新設' }, confirmBasis: { sewerConnection: 'ます設置(新規)', workKind: '新設' } });
    s().updateSite({ application: { ...s().doc.site!.application!, sewerConnection: '私設置ます', owner: '山田' } });
    expect(s().doc.site!.confirmBasis).toEqual({ workKind: '新設' });
  });
  it('答えと記録を一緒に保存するとき（提出書類一式の質問）は消さない。値が変わらない項目も消さない', () => {
    s().newDoc(emptyDoc(), { id: 'p', name: 't', createdAt: 1 });
    s().updateSite({ application: { sewerConnection: 'ます設置(新規)' }, confirmBasis: { sewerConnection: 'ます設置(新規)' } });
    s().updateSite({ application: { sewerConnection: 'ます設置(新規)', owner: '山田' } });
    expect(s().doc.site!.confirmBasis).toEqual({ sewerConnection: 'ます設置(新規)' });
  });
});
