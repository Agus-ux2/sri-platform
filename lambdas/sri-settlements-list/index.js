const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  port: 5432, ssl: { rejectUnauthorized: false }
});

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const userId = event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.userId;
  if (!userId) {
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'No autorizado' }) };
  }

  try {
    const qs = event.queryStringParameters || {};
    const page  = Math.max(1, parseInt(qs.page  || '1'));
    const limit = Math.min(100, parseInt(qs.limit || '20'));
    const offset = (page - 1) * limit;
    const grain  = qs.grain;
    const status = qs.status;

    const where = ['user_id = $1'];
    const params = [userId];

    if (grain)  { params.push(grain);  where.push(`grain_type = $${params.length}`); }
    if (status) { params.push(status); where.push(`status = $${params.length}`); }

    const whereSQL = 'WHERE ' + where.join(' AND ');

    const [result, countResult] = await Promise.all([
      pool.query(`
        SELECT id, coe, settlement_number, grain_type, grano_tipo,
               total_gross_kg, total_net_kg, net_amount,
               company_id, vendedor_razon_social,
               status, settlement_date, created_at, s3_key
        FROM settlements ${whereSQL}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limit, offset]),
      pool.query(`SELECT COUNT(*) FROM settlements ${whereSQL}`, params)
    ]);

    const total = parseInt(countResult.rows[0].count);
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        data: result.rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
