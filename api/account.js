/* DELETE /api/account — удалить аккаунт и все данные дневника (нужен пароль) */
import { route, body, db, send, problem, currentSession, verifyPassword, clearCookie } from './_lib/server.js';

export default route(['DELETE'], async (req, res) => {
  const s = await currentSession(req);
  if (!s) return problem(res, 401, 'UNAUTHORIZED', 'Not signed in');
  if (!(await verifyPassword(String(body(req).password || ''), s.password_hash))) return problem(res, 401, 'INVALID_CREDENTIALS', 'Wrong password');
  await db()`delete from users where id = ${s.id}`; // sessions и user_data удаляются каскадом
  clearCookie(res);
  send(res, 204);
});
