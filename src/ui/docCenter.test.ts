import { describe, expect, it } from 'vitest';
import { checkSummary, docRows, statusText, type DocCenterInput } from './docCenter';
import { FORM_SETS } from '../forms/formSets';
import { EMPTY_CONTRACTOR } from '../forms/types';

const base = (over: Partial<DocCenterInput> = {}): DocCenterInput => ({
  set: FORM_SETS.haebaru, profileName: '南風原町',
  values: { siteAddress: '南風原町字兼城100-1', applicantName: '眞境名 太郎', applicantAddress: '南風原町字兼城1', ownerName: '眞境名 太郎', ownerAddress: '南風原町字兼城1' },
  contractor: { ...EMPTY_CONTRACTOR, name: 'テスト設備' },
  hasSupply: true, hasDrain: true, roadCount: 0, roadConfirmed: false, roadWarnings: [], productCount: 3, formWarnings: [],
  drawings: [{ label: '排水平面図', ready: true, picked: true, warnings: 0, text: '✓ 作れます' }, { label: '見取図', ready: false, picked: false, warnings: 0, text: '作れません: 工事場所が未設定' }],
  ...over,
});
const row = (rows: ReturnType<typeof docRows>, id: string) => rows.find((r) => r.id === id)!;

describe('提出書類の一覧（書類センター）', () => {
  it('南風原町: 給水一式・製品一覧表・下水道申請書・申請図面。道路は取出しが無ければ出さない', () => {
    const rows = docRows(base());
    expect(rows.map((r) => r.id)).toEqual(['nanbu', 'nanbuProducts', 'haebaruSewer', 'drawings']);
    expect(row(rows, 'nanbu').status).toBe('ready');
    expect(row(rows, 'haebaruSewer').format).toBe('PDF');
  });

  it('沖縄市: 給水は Excel。八重瀬町は下水道の様式が無いので出さない', () => {
    expect(docRows(base({ set: FORM_SETS['okinawa-city'] ?? Object.values(FORM_SETS).find((s) => !s.water)!, profileName: '沖縄市' })).map((r) => `${r.id}:${r.format}`)).toEqual(['water:Excel', 'sewer:PDF', 'products:PDF', 'drawings:PDF']);
    expect(docRows(base({ set: FORM_SETS.yaese, profileName: '八重瀬町' })).map((r) => r.id)).toEqual(['nanbu', 'nanbuProducts', 'drawings']);
  });

  it('必須の未入力・配管なしは「確認が必要」で理由を出す（出力可能と言わない）', () => {
    const rows = docRows(base({ values: { siteAddress: '' }, contractor: EMPTY_CONTRACTOR, hasDrain: false }));
    const n = row(rows, 'nanbu');
    expect(n.status).toBe('check');
    expect(n.reasons.join('|')).toContain('工事店の情報');
    expect(n.reasons.join('|')).toContain('申込者の氏名');
    expect(n.reasons.join('|')).toContain('設置場所');
    expect(row(rows, 'haebaruSewer').reasons.join('|')).toContain('排水の配管');
    expect(statusText(n)).toMatch(/^⚠ 確認が必要（\d+ 件）/);
  });

  it('要確認の値（手数料など）が入っていれば確認を促す。様式の注意も理由に入る', () => {
    const set = Object.values(FORM_SETS).find((s) => s.fields.some((f) => f.unverified))!;
    const f = set.fields.find((x) => x.unverified)!;
    const rows = docRows(base({ set, values: { ...base().values, [f.id]: '12650' }, formWarnings: ['口径が未入力です'] }));
    const first = rows[0];
    expect(first.status).toBe('check');
    expect(first.reasons.join('|')).toContain('自治体に確認');
    expect(first.reasons).toContain('口径が未入力です');
  });

  it('様式が未登録の自治体: 申請書の行は出さず、未登録と伝える（図面は出せる）', () => {
    const rows = docRows(base({ set: undefined, profileName: '宜野湾市' }));
    expect(rows.map((r) => r.id)).toEqual(['unregistered', 'drawings']);
    expect(row(rows, 'unregistered').status).toBe('blocked');
    expect(row(rows, 'unregistered').reasons[0]).toContain('宜野湾市');
  });

  it('道路: 取出しがあれば行が出る。申請図面は作れない図面があれば確認、1 つも無ければ作れない', () => {
    const rows = docRows(base({ roadCount: 1 }));
    expect(row(rows, 'road').status).toBe('check');
    expect(row(rows, 'road').reasons[0]).toContain('まだ選ばれていません');
    expect(row(docRows(base({ roadCount: 1, roadConfirmed: true })), 'road').status).toBe('ready');
    const d = row(rows, 'drawings');
    expect(d.status).toBe('check');
    expect(d.label).toContain('1 種類');
    expect(d.reasons.join('|')).toContain('見取図');
    expect(row(docRows(base({ drawings: [{ label: '見取図', ready: false, picked: false, warnings: 0, text: '作れません' }] })), 'drawings').status).toBe('blocked');
    expect(row(docRows(base({ drawings: [{ label: '排水平面図', ready: true, picked: true, warnings: 0, text: '✓' }] })), 'drawings').status).toBe('ready');
  });

  it('道路: 提出先・着工日などの未入力は理由に出る（出力できますと言わない）', () => {
    const r = row(docRows(base({ roadCount: 1, roadConfirmed: true, roadWarnings: ['着工日が未入力です', '道路管理者（提出先）が未入力です'] })), 'road');
    expect(r.status).toBe('check');
    expect(r.reasons).toEqual(['着工日が未入力です', '道路管理者（提出先）が未入力です']);
  });

  it('製品一覧表: 載せる製品が 1 つも無ければ確認を促す', () => {
    const r = row(docRows(base({ productCount: 0 })), 'nanbuProducts');
    expect(r.status).toBe('check');
    expect(r.reasons.join('|')).toContain('載せる製品がありません');
    expect(row(docRows(base({ set: FORM_SETS['okinawa-city'], productCount: 0 })), 'products').status).toBe('check');
  });

  it('まとめて保存の前の一言: 確認が必要な書類が入るときは件数を言う', () => {
    const rows = docRows(base({ contractor: EMPTY_CONTRACTOR }));
    expect(checkSummary(rows.filter((r) => r.status !== 'blocked'))).toMatch(/確認が必要な書類が \d+ 種類/);
    expect(checkSummary(docRows(base({ drawings: [] })).filter((r) => r.status === 'ready'))).toBe('');
  });

  it('確認の質問が残っていれば申請書は「確認が必要」。製品一覧表・道路の理由は別（工事店が先頭に来ない）', () => {
    const rows = docRows(base({ openQuestions: 2, contractor: EMPTY_CONTRACTOR, roadCount: 1, roadConfirmed: true }));
    expect(row(rows, 'nanbu').reasons[0]).toContain('確認の質問が 2 件');
    expect(row(rows, 'nanbuProducts').reasons).toEqual([expect.stringContaining('工事店の情報')]);
    expect(row(rows, 'road').reasons).toEqual([expect.stringContaining('工事店の情報')]);
  });
});
