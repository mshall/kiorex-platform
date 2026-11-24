"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chiSquareSf = exports.normSf = exports.normCdf = void 0;
exports.erfc = erfc;
exports.normInv = normInv;
exports.lnGamma = lnGamma;
exports.gammaQ = gammaQ;
function erfc(x) {
    const z = Math.abs(x);
    let r;
    if (z < 3) {
        let term = z, sum = z;
        for (let n = 1; n < 200; n++) {
            term *= (-z * z) / n;
            const add = term / (2 * n + 1);
            sum += add;
            if (Math.abs(add) < 1e-17 * Math.abs(sum))
                break;
        }
        r = 1 - (2 / Math.sqrt(Math.PI)) * sum;
    }
    else {
        let f = z;
        for (let k = 60; k >= 1; k--)
            f = z + (k / 2) / f;
        r = Math.exp(-z * z) / (Math.sqrt(Math.PI) * f);
    }
    return x >= 0 ? r : 2 - r;
}
const normCdf = (x) => 0.5 * erfc(-x / Math.SQRT2);
exports.normCdf = normCdf;
const normSf = (x) => 0.5 * erfc(x / Math.SQRT2);
exports.normSf = normSf;
function normInv(p) {
    if (!(p > 0 && p < 1))
        throw new RangeError('normInv: p must be in (0,1)');
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425;
    let x;
    if (p < pl) {
        const q = Math.sqrt(-2 * Math.log(p));
        x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    else if (p <= 1 - pl) {
        const q = p - 0.5, r = q * q;
        x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    else {
        const q = Math.sqrt(-2 * Math.log(1 - p));
        x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const e = (0, exports.normCdf)(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    return x - u / (1 + (x * u) / 2);
}
function lnGamma(z) {
    const g = [57.1562356658629235, -59.5979603554754912, 14.1360979747417471, -0.491913816097620199, 3.39946499848118887e-5, 4.65236289270485756e-5, -9.83744753048795646e-5, 1.58088703224912494e-4, -2.10264441724104883e-4, 2.17439618115212643e-4, -1.64318106536763890e-4, 8.44182239838527433e-5, -2.61908384015814087e-5, 3.68991826595316234e-6];
    let y = z, tmp = z + 5.24218750000000000;
    tmp = (z + 0.5) * Math.log(tmp) - tmp;
    let ser = 0.999999999999997092;
    for (const c of g)
        ser += c / ++y;
    return tmp + Math.log((2.5066282746310005 * ser) / z);
}
function gammaQ(a, x) {
    if (x <= 0)
        return 1;
    if (x < a + 1) {
        let ap = a, sum = 1 / a, del = sum;
        for (let n = 0; n < 500; n++) {
            ap++;
            del *= x / ap;
            sum += del;
            if (Math.abs(del) < Math.abs(sum) * 1e-15)
                break;
        }
        return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
    }
    let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
        const an = -i * (i - a);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < 1e-300)
            d = 1e-300;
        c = b + an / c;
        if (Math.abs(c) < 1e-300)
            c = 1e-300;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < 1e-15)
            break;
    }
    return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}
const chiSquareSf = (x, df) => gammaQ(df / 2, x / 2);
exports.chiSquareSf = chiSquareSf;
//# sourceMappingURL=normal.js.map