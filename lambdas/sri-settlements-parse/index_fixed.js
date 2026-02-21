const { Pool } = require('pg');
const { parseLiquidacion } = require('./liquidacion.parser');
const { v4: uuidv4 } = require('uuid');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const pool = new Pool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port:     5432,
  ssl:      { rejectUnauthorized: false },
});

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function procesarPDF(buffer, filename, s3Key = null) {
  const p   = await parseLiquidacion(buffer);
  const now = new Date().toISOString();
  let sid   = uuidv4();

  const fechaDB = p.fecha
    ? p.fecha.split('/').reverse().join('-')
    : now.split('T')[0];

  const sRes = await pool.query(\`
    INSERT INTO settlements (
      id, settlement_number, company_id, settlement_date,
      grain_type, base_price_per_ton,
      total_gross_kg, total_net_kg, total_waste_kg,
      gross_amount, commercial_discount, commission_amount,
      paritarias_amount, freight_amount, net_amount,
      status,
      coe, coe_original, tipo_operacion, lugar,
      comprador_cuit, comprador_razon_social,
      vendedor_cuit, vendedor_razon_social,
      grano_codigo, grano_tipo, grado,
      flete_tn, puerto, fecha_contrato,
      pago_condiciones, datos_adicionales,
      s3_key,
      created_at, updated_at
    ) VALUES (
      \$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,
      \$13,\$14,\$15,\$16,\$17,\$18,\$19,\$20,\$21,\$22,
      \$23,\$24,\$25,\$26,\$27,\$28,\$29,\$30,\$31,\$32,\$33,\$34,\$35,\$36
    )
    ON CONFLICT (coe) DO UPDATE SET
      total_gross_kg    = EXCLUDED.total_gross_kg,
      total_net_kg      = EXCLUDED.total_net_kg,
      gross_amount      = EXCLUDED.gross_amount,
      freight_amount    = EXCLUDED.freight_amount,
      net_amount        = EXCLUDED.net_amount,
      pago_condiciones  = EXCLUDED.pago_condiciones,
      datos_adicionales = EXCLUDED.datos_adicionales,
      s3_key            = EXCLUDED.s3_key,
      status            = EXCLUDED.status,
      updated_at        = EXCLUDED.updated_at
    RETURNING id
  \`, [
    sid, p.coe, p.vendedor_cuit || null, fechaDB,
    p.grano_tipo || 'desconocido', p.precio_tn || 0,
    p.cantidad_kg || 0, p.cantidad_kg || 0, 0,
    p.subtotal || 0, 0, 0, 0,
    p.flete_tn || 0, p.pago_condiciones || 0,
    'procesada',
    p.coe, p.coe_original || null, p.tipo_operacion, p.lugar,
    p.comprador_cuit, p.comprador_razon_social,
    p.vendedor_cuit, p.vendedor_razon_social,
    p.grano_codigo, p.grano_tipo, p.grado,
    p.flete_tn, p.puerto, p.fecha_contrato,
    p.pago_condiciones, JSON.stringify(p.datos_adicionales || {}),
    s3Key,
    now, now,
  ]);
  sid = sRes.rows[0].id;

  for (const ctg of (p.ctgs || [])) {
    await pool.query(\`
      INSERT INTO ctg_entries (
        id, settlement_id, ctg_number,
        nro_comprobante, grado, factor,
        contenido_proteico, gross_kg, procedencia,
        created_at, updated_at
      ) VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11)
      ON CONFLICT (nro_comprobante) DO UPDATE SET
        factor   = EXCLUDED.factor,
        gross_kg = EXCLUDED.gross_kg,
        grado    = EXCLUDED.grado
    \`, [
      uuidv4(), sid, ctg.nro_comprobante, ctg.nro_comprobante,
      ctg.grado, ctg.factor, ctg.contenido_proteico,
      ctg.peso_kg, ctg.procedencia, now, now,
    ]);
  }

  return {
    filename, success: true,
    coe: p.coe, grano: p.grano_tipo,
    cantidad: p.cantidad_kg, ctgs: p.ctgs?.length || 0,
  };
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.Records?.[0]?.eventSource === 'aws:s3') {
    const resultados = [];
    for (const record of event.Records) {
      const bucket   = record.s3.bucket.name;
      const key      = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      const filename = key.split('/').pop();
      try {
        const resp   = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const buffer = await streamToBuffer(resp.Body);
        const res    = await procesarPDF(buffer, filename, key);
        resultados.push(res);
        console.log('S3 procesado:', JSON.stringify(res));
      } catch (err) {
        console.error('S3 error:', key, err.message);
        resultados.push({ filename, success: false, error: err.message });
      }
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, resultados }) };
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const pdfs = body.pdfs || [];

    if (!pdfs.length) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ success: false, error: 'No se enviaron PDFs' }) };
    }

    const resultados = [];
    for (const pdf of pdfs) {
      try {
        const buffer = Buffer.from(pdf.data, 'base64');
        const res    = await procesarPDF(buffer, pdf.filename, null);
        resultados.push(res);
      } catch (err) {
        resultados.push({ filename: pdf.filename, success: false, error: err.message });
      }
    }

    const ok    = resultados.filter(r => r.success).length;
    const fails = resultados.filter(r => !r.success).length;
    return {
      statusCode: 200, headers: cors,
      body: JSON.stringify({
        success: true,
        resumen: { total: pdfs.length, procesados: ok, errores: fails },
        resultados,
      }),
    };

  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
