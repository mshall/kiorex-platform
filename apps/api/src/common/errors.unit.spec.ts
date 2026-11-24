import { clientFaultOf } from './errors';

/** EDGE 49: client faults that used to surface as 500 INTERNAL_ERROR. */
describe('clientFaultOf', () => {
  const prisma = (code: string) => Object.assign(new Error('boom'), { name: 'PrismaClientKnownRequestError', code });
  it.each([['P2025', 404], ['P2002', 409], ['P2003', 409], ['P2023', 400], ['P2020', 400], ['P2000', 400]])('%s -> %i', (code, status) => expect(clientFaultOf(prisma(code))?.status).toBe(status));
  it('Prisma validation errors and invalid dates are 400', () => {
    expect(clientFaultOf(Object.assign(new Error('Invalid value for argument `gte`: Provided Date object is invalid'), { name: 'PrismaClientValidationError' }))?.status).toBe(400);
    expect(clientFaultOf(new RangeError('Invalid time value'))?.status).toBe(400);
  });
  it('Prisma negative skip/take assertion is 400', () => { expect(clientFaultOf(Object.assign(new Error('Invalid value for skip argument: Value can only be positive, found: -100'), { name: 'AssertionError' }))?.status).toBe(400); });
  it('genuine faults stay 500 (connection errors, unknown Prisma codes, plain errors, non-errors)', () => {
    for (const e of [prisma('P1001'), prisma('P2024'), new Error('x'), new TypeError('undefined is not iterable'), null, undefined, 'str', 7]) expect(clientFaultOf(e)).toBeNull();
  });
});
