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

  const settlementId = event.pathParameters && event.pathParameters.id;
  if (!settlementId) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Settlement ID requerido' }) };
  }

  try {
    const sRes = await pool.query(
      `SELECT s.*
       FROM settlements s
       WHERE s.id = $1 AND s.user_id = $2`,
      [settlementId, userId]
    );

    if (sRes.rows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Settlement no encontrado' }) };
    }

    const settlement = sRes.rows[0];

    const ctgRes = await pool.query(
      `SELECT * FROM ctg_entries WHERE settlement_id = $1 ORDER BY created_at ASC`,
      [settlementId]
    );

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        data: {
          ...settlement,
          ctg_entries: ctgRes.rows,
        }
      })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
