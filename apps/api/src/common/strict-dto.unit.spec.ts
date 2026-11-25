import { IsString } from 'class-validator';
import { isOpsPath, runWithStrictFlag, StrictOpsValidationPipe, strictOpsEnabled } from './strict-dto';

class Dto { @IsString() a!: string }
const meta = { type: 'body' as const, metatype: Dto };

describe('STRICT_DTO=ops', () => {
  it('only /api/v1/admin paths are ops paths', () => {
    expect(isOpsPath('/api/v1/admin/growth/fraud/cases')).toBe(true);
    expect(isOpsPath('/api/v1/admin')).toBe(true);
    expect(isOpsPath('/api/v1/administrator')).toBe(false);
    expect(isOpsPath('/api/v1/me/profile')).toBe(false);
  });
  it('lenient by default: an undeclared property is stripped', async () => {
    const out = await runWithStrictFlag(false, () => new StrictOpsValidationPipe().transform({ a: 'x', extra: 1 }, meta)) as Dto;
    expect(out).toEqual({ a: 'x' });
  });
  it('strict on an ops route: an undeclared property is a 400', async () => {
    await expect(Promise.resolve().then(() => runWithStrictFlag(true, () => new StrictOpsValidationPipe().transform({ a: 'x', extra: 1 }, meta)))).rejects.toMatchObject({ status: 400 });
    expect(await runWithStrictFlag(true, () => new StrictOpsValidationPipe().transform({ a: 'x' }, meta))).toEqual({ a: 'x' });
  });
  it('the switch is the env value `ops`, default off', () => {
    const was = process.env.STRICT_DTO;
    try { delete process.env.STRICT_DTO; expect(strictOpsEnabled()).toBe(false); process.env.STRICT_DTO = 'ops'; expect(strictOpsEnabled()).toBe(true); } finally { if (was === undefined) delete process.env.STRICT_DTO; else process.env.STRICT_DTO = was; }
  });
});
