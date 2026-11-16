import { describe, expect, test } from 'vitest';
import { applyKakunin, parseKakunin } from './kakunin';

/** 確認申請書（第二号様式）を pdf.js で行にしたものと同じ形（名前・住所は作り物） */
const SHINSEI = [
  '第二号様式（第一条の三、第三条、第三条の三関係）（A4）',
  '確 認 申 請 書（建築物）',
  '令和  8  年  06  月  20  日',
  '建築主等の概要',
  '〔1.建築主〕',
  '〔ｲ.氏名のﾌﾘｶﾞﾅ〕  ミズノ  タロウ',
  '〔ﾛ.氏  名〕  水野  太郎',
  '〔ﾊ.郵便番号〕  901-0000',
  '〔ﾆ.住  所〕  沖縄県島尻郡南風原町字テスト1-2 テストアパート101',
  '〔ﾎ.電話番号〕  090-0000-1111',
  '〔2.代理者〕',
  '〔ﾛ.氏  名〕  設計  一郎',
  '〔ﾆ.郵便番号〕  260-0000',
  '〔ﾍ.電話番号〕  043-000-0000',
  '件  名：  水野  太郎様邸  新築工事',
  '〔1.地名地番〕沖縄県島尻郡南風原町字テスト宇原100-1，2',
  '〔ｲ.幅  員〕  4.500  m',
  '〔8.主要用途〕 （区分  08010  )  08010:一戸建ての住宅',
  '〔9.工事種別〕',
  '■ 新築  □ 増築  □ 改築 □ 移転  □ 用途変更',
  '〔ﾖ.延べ面積〕  88.20 ㎡',
  '〔ﾊ.構  造〕  木造(軸組工法)  一部',
  '〔15.工事着手予定年月日〕  令和  8 年  12 月  01 日',
  '〔16.工事完了予定年月日〕  令和  9 年  02月  20 日',
  '〔4.構  造〕  木造(軸組工法)  一部  木造(軸組工法)',
  '〔ｲ.地階を除く階数〕  2階',
  '〔ﾛ.地階の階数〕  0階',
];

/** 確認済証（第十五号様式） */
const SUMI = [
  '第十五号様式(第三条の四関係)',
  '確認済証',
  '水野  太郎 様',
  '第  ABC-26-00000-1  号',
  '令和 8年9月30日',
  '1.建築場所、設置場所、  沖縄県島尻郡南風原町字テスト宇原100-1，2',
  '2)主要用途  08010:一戸建ての住宅',
  '3)工事種別  新築',
  '5)延べ面積(申請部分)  88.20㎡',
  '7)主たる建築物の構造  木造',
  '8)主たる建築物の階数  地階を除く階数  2階',
  '地階の階数  0階',
];

describe('確認申請書・確認済証の文字から読む（parseKakunin）', () => {
  test('確認申請書: 建築主・敷地・面積・階数・構造・用途・道路の幅員・工事予定', () => {
    expect(parseKakunin(SHINSEI)).toEqual({
      ownerKana: 'ミズノ タロウ', ownerName: '水野 太郎', ownerZip: '901-0000', ownerAddress: '沖縄県島尻郡南風原町字テスト1-2 テストアパート101', ownerTel: '090-0000-1111',
      siteAddress: '沖縄県島尻郡南風原町字テスト宇原100-1,2', totalArea: '88.20', floorsAbove: '2', floorsBelow: '0', structure: '木造', use: '一戸建ての住宅', workKind: '新築',
      roadWidth: '4.500', workStart: '2026-12-01', workEnd: '2027-02-20',
    });
  });
  test('確認済証: 確認番号と日付・建築主の氏名・場所', () => {
    expect(parseKakunin(SUMI)).toEqual({
      confirmNo: 'ABC-26-00000-1', confirmDate: '2026-09-30', ownerName: '水野 太郎',
      siteAddress: '沖縄県島尻郡南風原町字テスト宇原100-1,2', totalArea: '88.20', floorsAbove: '2', floorsBelow: '0', structure: '木造', use: '一戸建ての住宅', workKind: '新築',
    });
  });
  test('2 つを続けて読めば合わさる（代理者・設計者の氏名を建築主と取り違えない）', () => {
    const r = parseKakunin([...SUMI, ...SHINSEI]);
    expect(r.ownerName).toBe('水野 太郎');
    expect(r.confirmNo).toBe('ABC-26-00000-1');
    expect(r.ownerTel).toBe('090-0000-1111');
  });
  test('文字の無い PDF・関係ない書類は何も読まない', () => {
    expect(parseKakunin([])).toEqual({});
    expect(parseKakunin(['給水装置工事申請書及び設計書', '氏 名 山田 様', '第 号'])).toEqual({});
  });
});

describe('読んだ値を申請書の空欄にだけ入れる（applyKakunin）', () => {
  test('入力済みの項目（空にしたものを含む）は変えない。入れた項目を返す', () => {
    const r = applyKakunin({ applicantName: '水野 太郎', siteAddress: '南風原町字テスト', floors: '2' }, { siteAddress: '入力済み', floors: '' });
    expect(r.values).toEqual({ siteAddress: '入力済み', floors: '', applicantName: '水野 太郎' });
    expect(r.filled).toEqual(['applicantName']);
  });
  test('2 回読んでも同じ（2 回目は何も入れない）', () => {
    const a = applyKakunin({ applicantName: '水野 太郎' }, {});
    expect(applyKakunin({ applicantName: '水野 太郎' }, a.values).filled).toEqual([]);
  });
  test('空の値は入れない', () => {
    expect(applyKakunin({ applicantName: '' }, {}).filled).toEqual([]);
  });
});

describe('書式の違い（発行元・申請システムごと）', () => {
  test('括弧が【】の確認申請書も同じに読む', () => {
    const alt = SHINSEI.map((l) => l.replace(/〔/g, '【').replace(/〕/g, '】'));
    expect(parseKakunin(alt)).toEqual(parseKakunin(SHINSEI));
  });
  test('建築主事の確認済証（宛名が「殿」・番号に漢字）', () => {
    expect(parseKakunin(['確 認 済 証', '水野 太郎 殿', '第R08確認建築南風原00001号', '令和 8年9月30日'])).toEqual({ ownerName: '水野 太郎', confirmNo: 'R08確認建築南風原00001', confirmDate: '2026-09-30' });
  });
  test('宛名と番号は「確認済証」の行より後ろから（申請書の宛先の「殿」や「第 号」を拾わない）', () => {
    const r = parseKakunin(['テスト住宅保証株式会社 殿', '第 号', '確認済証', '水野 太郎 様', '第 ABC-26-00000-1 号', '令和 8年9月30日']);
    expect(r.ownerName).toBe('水野 太郎');
    expect(r.confirmNo).toBe('ABC-26-00000-1');
  });
});
