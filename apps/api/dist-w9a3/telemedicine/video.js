"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoAdapter = exports.VIDEO = exports.videoProblems = exports.ClinicP2pVideoAdapter = exports.MockVideoAdapter = void 0;
const node_crypto_1 = require("node:crypto");
const config_1 = require("../common/config");
const problems_1 = require("../common/providers/problems");
class MockVideoAdapter {
    mode = 'mock';
    name = 'mock';
    async createRoom(sessionId) { return { roomName: `kxmock-${sessionId}` }; }
    async issueToken(i) {
        const exp = new Date(Date.now() + i.ttlSeconds * 1000);
        const payload = Buffer.from(JSON.stringify({ room: i.roomName, id: (0, node_crypto_1.createHash)('sha256').update(i.identity).digest('hex').slice(0, 12), role: i.role, exp: Math.floor(exp.getTime() / 1000) })).toString('base64url');
        const sig = (0, node_crypto_1.createHmac)('sha256', (0, config_1.cfg)().fieldKey).update(payload).digest('base64url').slice(0, 22);
        return { token: `mockvid.${payload}.${sig}`, expiresAt: exp.toISOString(), url: `https://video.mock.invalid/${i.roomName}`, room: i.roomName, role: i.role, provider: 'mock' };
    }
}
exports.MockVideoAdapter = MockVideoAdapter;
class ClinicP2pVideoAdapter {
    mode = 'clinic-p2p';
    name = 'clinic-p2p';
    async createRoom() { throw new Error('CLINIC_OWNS_CALL: Kiorex does not host video; the Clinic issues the join link'); }
    async issueToken() { throw new Error('CLINIC_OWNS_CALL: Kiorex does not host video; the Clinic issues the join link'); }
}
exports.ClinicP2pVideoAdapter = ClinicP2pVideoAdapter;
exports.videoProblems = problems_1.videoProblems;
exports.VIDEO = Symbol('KX_VIDEO');
const videoAdapter = () => ((0, config_1.cfg)().videoMode === 'clinic-p2p' ? new ClinicP2pVideoAdapter() : new MockVideoAdapter());
exports.videoAdapter = videoAdapter;
//# sourceMappingURL=video.js.map