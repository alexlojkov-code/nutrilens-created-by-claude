/* GET /api/auth/me — кто вошёл (401, если никто) */
import { route, send, problem, currentSession, publicUser } from '../_lib/server.js';

export default route(['GET'], async (req, res) => {
  const s = await currentSession(req);
  if (!s) return problem(res, 401, 'UNAUTHORIZED', 'Not signed in');
  send(res, 200, { user: publicUser(s) });
});
