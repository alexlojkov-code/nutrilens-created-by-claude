/* POST /api/auth/password — сменить пароль; остальные устройства выходят из аккаунта */
import { route, body, db, send, problem, currentSession, verifyPassword, hashPassword, passwordProblem } from '../_lib/server.js';

export default route(['POST'], async (req, res) => {
  const s = await currentSession(req);
  if (!s) return problem(res, 401, 'UNAUTHORIZED', 'Not signed in');
  const b = body(req);
  if (!(await verifyPassword(String(b.current || ''), s.password_hash))) return problem(res, 401, 'INVALID_CREDENTIALS', 'Wrong current password');
  const pwErr = passwordProblem(b.next, s.email);
  if (pwErr) return problem(res, 400, pwErr, 'Password does not meet requirements');
  await db()`update users set password_hash = ${await hashPassword(b.next)} where id = ${s.id}`;
  await db()`delete from sessions where user_id = ${s.id} and token_hash <> ${s.token_hash}`;
  send(res, 204);
});
