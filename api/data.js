/* GET /api/data — дневник пользователя; PUT /api/data — сохранить.
   PUT передаёт version: если на сервере уже новее (правка с другого устройства), ответ 409 с серверной копией. */
import { route, body, db, send, problem, currentSession } from './_lib/server.js';

const MAX_BYTES = 4 * 1024 * 1024;

export default route(['GET', 'PUT'], async (req, res) => {
  const s = await currentSession(req);
  if (!s) return problem(res, 401, 'UNAUTHORIZED', 'Not signed in');

  if (req.method === 'GET') {
    const rows = await db()`select data, version, updated_at from user_data where user_id = ${s.id}`;
    return send(res, 200, rows[0] || { data: null, version: 0, updated_at: null });
  }

  const b = body(req);
  const data = b.data;
  const version = Number.isInteger(b.version) ? b.version : -1;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return problem(res, 400, 'VALIDATION_FAILED', 'data must be an object');
  if (data.settings) delete data.settings.apiKey; // ключ ИИ никогда не хранится на сервере
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > MAX_BYTES) return problem(res, 413, 'TOO_LARGE', 'Diary is too large');

  const rows = await db()`
    insert into user_data (user_id, data, version) values (${s.id}, ${json}::jsonb, 1)
    on conflict (user_id) do update set data = excluded.data, version = user_data.version + 1, updated_at = now()
      where user_data.version = ${version}
    returning version, updated_at`;
  if (rows.length) return send(res, 200, rows[0]);
  // версия устарела: отдаём серверную копию, чтобы клиент объединил данные и повторил
  const cur = await db()`select data, version, updated_at from user_data where user_id = ${s.id}`;
  send(res, 409, { type: 'about:blank', title: 'CONFLICT', status: 409, code: 'CONFLICT', detail: 'Diary was changed on another device', ...(cur[0] || { data: null, version: 0 }) });
});
