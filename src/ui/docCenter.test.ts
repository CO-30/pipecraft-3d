import { describe, expect, it } from 'vitest';
import { checkSummary, docRows, statusText, type DocCenterInput } from './docCenter';
import { FORM_SETS } from '../forms/formSets';
import { EMPTY_CONTRACTOR } from '../forms/types';

// 様式ごとの必須の欄（src/forms/required.ts）が入った状態。画面では既定値（withDefaults）と確認申請書で入る
const FILLED = { workKind: '新設', supplyKind: '専用給水', useKind: '一般用', buildingUse: '住宅', drainTo: '公共下水道', diameter: '20', tempSupply: '有り', tempUntil: '2027-03-31', userSame: '同じ', waterWorkKind: '新設', useType: '一般家庭用（一般住宅）', supplyType: '直結', purpose: '一般用', sewerConnection: '公共ます', sewerWorkKind: '新築', waterSource: '水道水', sewerBuildingUse: '一般家庭', people: '4', workFrom: '2026-12-01', workTo: '2026-12-20', pretreatment: '無し' };
const base = (over: Partial<DocCenterInput> = {}): DocCenterInput => ({
  set: FORM_SETS.haebaru, profileName: '南風原町',
  values: { siteAddress: '南風原町字兼城100-1', applicantName: '眞境名 太郎', applicantAddress: '南風原町字兼城1', ownerName: '眞境名 太郎', ownerAddress: '南風原町字兼城1', ...FILLED },
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

  it('検査の結果: 排水の注意は下水道の申請書と申請図面に、給水の注意は給水の申請書と申請図面に出す', () => {
    const inspection = { drain: ['排水の検査で注意が 1 件あります'], supply: ['水圧が足りません'] };
    const h = docRows(base({ inspection }));
    expect(row(h, 'haebaruSewer').status).toBe('check');
    expect(row(h, 'haebaruSewer').reasons).toContain('排水の検査で注意が 1 件あります');
    expect(row(h, 'haebaruSewer').reasons).not.toContain('水圧が足りません');
    expect(row(h, 'nanbu').reasons).toContain('水圧が足りません');
    expect(row(h, 'nanbu').reasons).not.toContain('排水の検査で注意が 1 件あります');
    expect(row(h, 'nanbuProducts').status).toBe('ready');
    expect(row(h, 'drawings').status).toBe('check');
    expect(row(h, 'drawings').reasons).toEqual(expect.arrayContaining(['排水の検査で注意が 1 件あります', '水圧が足りません']));
    const o = docRows(base({ set: Object.values(FORM_SETS).find((x) => x.water !== 'nanbu')!, profileName: '沖縄市', inspection }));
    expect(row(o, 'water').reasons).toContain('水圧が足りません');
    expect(row(o, 'sewer').reasons).toContain('排水の検査で注意が 1 件あります');
    expect(row(o, 'products').status).toBe('ready');
  });

  it('検査の結果: 配管が無くても、つなぎ忘れの器具は理由に出す。検査の結果が空なら今までどおり', () => {
    const inspection = { drain: ['排水がつながっていない器具・マスが 1 か所あります: トイレの汚水'], supply: [] };
    const r = docRows(base({ hasDrain: false, inspection }));
    expect(row(r, 'haebaruSewer').reasons.join('|')).toContain('排水の配管');
    expect(row(r, 'haebaruSewer').reasons.join('|')).toContain('トイレの汚水');
    expect(docRows(base({ inspection: { drain: [], supply: [] } }))).toEqual(docRows(base()));
  });

  it('様式ごとの必須の欄: 下水道の欄は下水道の申請書だけ、給水の欄は給水の申請書だけに出す', () => {
    const v = { ...base().values, people: '', workFrom: '', diameter: '' };
    const h = docRows(base({ values: v }));
    expect(row(h, 'haebaruSewer').status).toBe('check');
    expect(row(h, 'haebaruSewer').reasons.join('|')).toContain('人員・工事予定期間の「自」が未入力です（空欄のまま印刷されます');
    expect(row(h, 'haebaruSewer').reasons.join('|')).not.toContain('メーター口径');
    expect(row(h, 'nanbu').reasons.join('|')).toContain('メーター口径が未入力です');
    expect(row(h, 'nanbu').reasons.join('|')).not.toContain('人員');
    expect(row(h, 'nanbuProducts').status).toBe('ready');
    const o = docRows(base({ set: FORM_SETS['okinawa-city'], profileName: '沖縄市', values: { ...v, workTo: '2026-11-01', workFrom: '2026-12-01' } }));
    expect(row(o, 'water').reasons.join('|')).toContain('口径が未入力です');
    expect(row(o, 'sewer').reasons.join('|')).toContain('「至」が「自」より前');
    expect(row(o, 'sewer').reasons.join('|')).not.toContain('口径');
  });
});
