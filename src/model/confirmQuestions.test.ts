import { describe, expect, it } from 'vitest';
import { answersOf, confirmQuestions } from './confirmQuestions';
import { FORM_SETS } from '../forms/formSets';

const road = { 'road.water': 'する', 'road.sewer': 'しない' };

describe('確認の質問（人が決めることだけを、推奨つきで）', () => {
  it('南風原町: 工事の種類・排水の流し先・接続先・臨時給水・取出し 2 つ。推奨は初期値', () => {
    const qs = confirmQuestions(FORM_SETS.haebaru, {}, { workKind: '新設', drainTo: '公共下水道', sewerConnection: '公共ます', tempSupply: '有り' }, road);
    expect(qs.map((q) => q.id)).toEqual(['workKind', 'drainTo', 'sewerConnection', 'tempSupply', 'road.water', 'road.sewer']);
    expect(qs.every((q) => !q.answered)).toBe(true);
    const w = qs.find((q) => q.id === 'road.water')!;
    // 道路を掘るかどうかは図面から決められない: おすすめを付けず、選んでもらう
    expect(w.recommended).toBe('');
    expect(w.options.map((o) => o.value)).toEqual(['する', 'しない']);
    expect(w.options[0].hint).toContain('道路');
    expect(w.why.length).toBeGreaterThan(10);
    expect(answersOf(qs, {})).toEqual({ workKind: '新設', drainTo: '公共下水道', sewerConnection: '公共ます', tempSupply: '有り' });
  });

  it('沖縄市: 給水方式を聞く。もう答えた質問は済みになり、選んだ答えで上書きできる', () => {
    const qs = confirmQuestions(FORM_SETS['okinawa-city'], { supplyType: '受水槽' }, { supplyType: '受水槽', waterWorkKind: '新設', sewerConnection: '公共ます' }, road);
    const s = qs.find((q) => q.id === 'supplyType')!;
    expect(s.answered).toBe(true);
    expect(s.current).toBe('受水槽');
    expect(s.options.find((o) => o.value === '直結')!.hint).toContain('そのまま');
    expect(qs.filter((q) => !q.answered).map((q) => q.id)).toEqual(['waterWorkKind', 'sewerConnection', 'road.water', 'road.sewer']);
    expect(answersOf(qs, { 'road.water': 'しない' })['road.water']).toBe('しない');
  });

  it('推奨が決められない質問は選ぶまで答えに入れない（勝手に決めない）。様式が無い町は道路だけ', () => {
    const qs = confirmQuestions(FORM_SETS.yaese, {}, { workKind: '新設', drainTo: '', tempSupply: '有り' }, road);
    const d = qs.find((q) => q.id === 'drainTo')!;
    expect(d.recommended).toBe('');
    expect('drainTo' in answersOf(qs, {})).toBe(false);
    expect(confirmQuestions(undefined, {}, {}, road).map((q) => q.id)).toEqual(['road.water', 'road.sewer']);
  });

  it('前に入れた値: かっこの全角・半角の違いは同じ答えとして扱う。選択肢に無い値は「いまの値」として残す。空は未回答', () => {
    const set = FORM_SETS['okinawa-city'];
    const a = confirmQuestions(set, { sewerConnection: 'ます設置(新規)' }, { sewerConnection: 'ます設置(新規)' }, road).find((q) => q.id === 'sewerConnection')!;
    expect(a.answered).toBe(true);
    expect(a.current).toBe('ます設置（新規）');
    const b = confirmQuestions(set, { supplyType: '高置水槽' }, { supplyType: '高置水槽' }, road).find((q) => q.id === 'supplyType')!;
    expect(b.current).toBe('高置水槽');
    expect(b.options.at(-1)).toMatchObject({ value: '高置水槽', hint: '前に入れた値です' });
    const c = confirmQuestions(set, { supplyType: '' }, { supplyType: '' }, road).find((q) => q.id === 'supplyType')!;
    expect(c.answered).toBe(false);
  });

  it('浄化槽へ流す工事では、下水の取付管は聞かない', () => {
    const qs = confirmQuestions(FORM_SETS.yaese, { drainTo: '浄化槽' }, { drainTo: '浄化槽' }, road);
    expect(qs.map((q) => q.id)).not.toContain('road.sewer');
    expect(qs.map((q) => q.id)).toContain('road.water');
  });
});
